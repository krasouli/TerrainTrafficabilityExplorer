"""
Replace WLDAS RCI Profile Earth Engine Assets (DOY 001-366)

Purpose:
    1) Delete existing GEE assets named WLDAS_RCI_Profile_DOY_001 ... _366
       under projects/rci-nwus/assets/
    2) Upload the new local GeoTIFFs (same naming convention) to a Google
       Cloud Storage bucket, then ingest each one as a new EE asset with
       the same asset ID.

Why GCS is required:
    The Earth Engine Python API cannot ingest a raster directly from a
    local file path. Rasters must first be staged in a Google Cloud
    Storage bucket, then registered as an EE asset via ee.data.startIngestion().
    This script automates both the GCS upload and the EE ingestion.

Requires:
    pip install earthengine-api google-cloud-storage
    earthengine authenticate      (one-time, in a terminal)
    gcloud auth application-default login   (for GCS access, one-time)

Permissions needed:
    - Write/delete access to projects/rci-nwus/assets/
    - Write access to the specified GCS bucket
"""

import os
import time
import ee
from google.cloud import storage

# ============================================================================
# Step 1: Configuration
# ============================================================================

EE_PROJECT_FOLDER = 'projects/rci-nwus/assets'   # target EE asset folder
LOCAL_DIR          = './RCI2'  # local directory with new GeoTIFFs -- update this path
GCS_BUCKET          = 'rci_bucket'       # update this: staging bucket for uploads
GCS_STAGING_PREFIX  = 'smoist_grav'   # folder inside the bucket
DOY_START, DOY_END  = 1, 366

ee.Initialize()
storage_client = storage.Client()
bucket = storage_client.bucket(GCS_BUCKET)


def asset_id_for_doy(doy):
    doy_str = str(doy).zfill(3)
    return f'{EE_PROJECT_FOLDER}/WLDAS_SM_Gravimetric_Profile_DOY_{doy_str}'
    #return f'{EE_PROJECT_FOLDER}/WLDAS_RCI_Profile_DOY_{doy_str}'


def local_path_for_doy(doy):
    doy_str = str(doy).zfill(3)
    return os.path.join(LOCAL_DIR, f'WLDAS_SM_Gravimetric_Profile_DOY_{doy_str}.tif')
    #return os.path.join(LOCAL_DIR, f'WLDAS_RCI_Profile_DOY_{doy_str}.tif')


# ============================================================================
# Step 2: Delete Existing EE Assets
# ============================================================================

def delete_existing_assets(doy_start, doy_end):
    print('=' * 80)
    print('STEP 1: DELETING EXISTING EE ASSETS')
    print('=' * 80)

    deleted, missing, failed = [], [], []

    for doy in range(doy_start, doy_end + 1):
        asset_id = asset_id_for_doy(doy)
        try:
            ee.data.getAsset(asset_id)  # raises if asset does not exist
        except ee.EEException:
            missing.append(asset_id)
            continue

        try:
            ee.data.deleteAsset(asset_id)
            deleted.append(asset_id)
            print(f'  Deleted: {asset_id}')
        except ee.EEException as e:
            failed.append((asset_id, str(e)))
            print(f'  FAILED to delete {asset_id}: {e}')

    print(f'\nDeleted: {len(deleted)}, Missing (skipped): {len(missing)}, Failed: {len(failed)}\n')
    return deleted, missing, failed


# ============================================================================
# Step 3: Upload Local GeoTIFFs to Google Cloud Storage
# ============================================================================

def upload_to_gcs(doy_start, doy_end):
    print('=' * 80)
    print('STEP 2: UPLOADING LOCAL FILES TO GOOGLE CLOUD STORAGE')
    print('=' * 80)

    uploaded, missing_local, failed = [], [], []

    for doy in range(doy_start, doy_end + 1):
        doy_str = str(doy).zfill(3)
        local_path = local_path_for_doy(doy)

        if not os.path.exists(local_path):
            missing_local.append(local_path)
            print(f'  WARNING: local file not found, skipping: {local_path}')
            continue

        blob_name = f'{GCS_STAGING_PREFIX}/WLDAS_SM_Gravimetric_Profile_DOY_{doy_str}.tif'
        #blob_name = f'{GCS_STAGING_PREFIX}/WLDAS_RCI_Profile_DOY_{doy_str}.tif'
        gcs_uri = f'gs://{GCS_BUCKET}/{blob_name}'

        try:
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(local_path)
            uploaded.append((doy, gcs_uri))
            print(f'  Uploaded: {local_path} -> {gcs_uri}')
        except Exception as e:
            failed.append((local_path, str(e)))
            print(f'  FAILED to upload {local_path}: {e}')

    print(f'\nUploaded: {len(uploaded)}, Missing local files: {len(missing_local)}, '
          f'Failed: {len(failed)}\n')
    return uploaded, missing_local, failed


# ============================================================================
# Step 4: Ingest Each GCS File as a New EE Asset
# ============================================================================

def ingest_assets(uploaded):
    print('=' * 80)
    print('STEP 3: INGESTING NEW EE ASSETS FROM GCS')
    print('=' * 80)

    task_ids = []

    for doy, gcs_uri in uploaded:
        asset_id = asset_id_for_doy(doy)

        request_id = ee.data.newTaskId()[0]
        params = {
            'name': asset_id,
            'tilesets': [{'sources': [{'uris': [gcs_uri]}]}],
        }

        try:
            ee.data.startIngestion(request_id, params)
            task_ids.append((asset_id, request_id))
            print(f'  Ingestion started: {asset_id} (task {request_id})')
        except ee.EEException as e:
            print(f'  FAILED to start ingestion for {asset_id}: {e}')

    print(f'\nStarted {len(task_ids)} ingestion tasks.\n')
    return task_ids


# ============================================================================
# Step 5: Monitor Ingestion Task Status (optional polling)
# ============================================================================

def monitor_tasks(task_ids, poll_interval=30, max_wait=3600):
    print('=' * 80)
    print('STEP 4: MONITORING INGESTION TASKS')
    print('=' * 80)

    remaining = {tid: aid for aid, tid in task_ids}
    elapsed = 0

    while remaining and elapsed < max_wait:
        for task_id in list(remaining.keys()):
            status = ee.data.getTaskStatus(task_id)[0]
            state = status.get('state')
            if state in ('COMPLETED', 'FAILED', 'CANCELLED'):
                asset_id = remaining.pop(task_id)
                print(f'  {asset_id}: {state}')
                if state == 'FAILED':
                    print(f'    Error: {status.get("error_message")}')

        if remaining:
            time.sleep(poll_interval)
            elapsed += poll_interval

    if remaining:
        print(f'\n{len(remaining)} tasks still running after {max_wait}s; '
              'check the EE Task Manager for final status.')
    else:
        print('\nAll ingestion tasks finished.')


# ============================================================================
# Step 6: Run the Full Replace Workflow
# ============================================================================

if __name__ == '__main__':
    delete_existing_assets(DOY_START, DOY_END)
    uploaded, missing_local, upload_failed = upload_to_gcs(DOY_START, DOY_END)

    if uploaded:
        task_ids = ingest_assets(uploaded)
        monitor_tasks(task_ids)
    else:
        print('No files were uploaded; skipping ingestion.')

    print('=' * 80)
    print('WORKFLOW COMPLETE')
    print('=' * 80)
