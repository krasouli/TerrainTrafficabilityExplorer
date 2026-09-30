
# ============================================================================
# Python Script: Soil-Texture-Specific Rating Cone Index (RCI)
#                for Mean, 5th, and 95th Percentile Soil Moisture
# Purpose: Calculate RCI per pixel using texture-class-specific empirical
#          equations (Sullivan and Anderson, 2000), applied to gravimetric
#          soil moisture (converted from volumetric SM using per-texture-
#          class bulk density). RCI is computed for three soil moisture
#          statistics per DOY - mean, 5th percentile, 95th percentile -
#          and written into a single 3-band RCI GeoTIFF per DOY, alongside
#          a matching 3-band Gravimetric SM GeoTIFF.
# Input:
#   - soiltexture_NWUSA.tif        : dominant soil texture class map (1-16)
#   - WLDAS_SM_Profile_DOY_###.tif : 3-band profile-average soil moisture
#                                     (band 1 = SM_mean, band 2 = SM_p5,
#                                      band 3 = SM_p95), volumetric fraction
# Output:
#   - WLDAS_SM_Gravimetric_Profile_DOY_###.tif : 3-band gravimetric SM
#                                     (band 1 = GSM_mean, band 2 = GSM_p5,
#                                      band 3 = GSM_p95)
#   - WLDAS_RCI_Profile_DOY_###.tif  : 3-band RCI
#                                     (band 1 = RCI_mean, band 2 = RCI_p5,
#                                      band 3 = RCI_p95)
#   - Summary CSV and annual cycle plot
# ============================================================================

import os
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
import matplotlib.pyplot as plt
import glob

# ============================================================================
# Step 1: Configuration
# ============================================================================

INPUT_DIR   = '/mnt/c/Users/krasouli/Downloads/GEE_WLDAS_Climatology'  # Update this path
OUTPUT_DIR  = './RCI2'                                                  # Update this path
TEXTURE_TIF = 'soiltexture_NWUSA.tif'                                   # dominant soil texture class map
MISSING_VAL = -9999.0

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Names/order of the soil-moisture statistic bands stored in each
# WLDAS_SM_Profile_DOY_###.tif file, and the matching output band names
SM_BAND_NAMES  = ['SM_mean', 'SM_p5', 'SM_p95']
GSM_BAND_NAMES = ['GSM_mean', 'GSM_p5', 'GSM_p95']
RCI_BAND_NAMES = ['RCI_mean', 'RCI_p5', 'RCI_p95']

print('=' * 80)
print('SOIL-TEXTURE-SPECIFIC RCI CALCULATION (MEAN, P5, P95 - GRAVIMETRIC MOISTURE)')
print('=' * 80)

# ============================================================================
# Step 2: Bulk Density by Soil Texture Class (g/cm3)
# Source: Morris, L.A. and Lowery, R.F., 1988. Influence of site preparation
# on soil conditions affecting stand establishment and tree growth.
# Southern Journal of Applied Forestry, 12(3), pp.170-178.
# ============================================================================

BULK_DENSITY_BY_CLASS = {
    1: 1.75,
    2: 1.75,
    3: 1.70,
    4: 1.45,
    5: 1.42,
    6: 1.55,
    7: 1.65,
    8: 1.42,
    9: 1.50,
    10: 1.60,
    11: 1.40,
    12: 1.40,
    13: 1.20,
    14: 1.00,
    15: 1.80,
    16: 1.20,
}

# ============================================================================
# Step 3: RCI Equations by Soil Texture Class (Sullivan and Anderson, 2000)
#   RCI = exp(a + b * ln(% Moisture Content))
#   % Moisture Content here = gravimetric soil moisture x 100
#   Class 14 is a special case: RCI = 0 (e.g., water/non-soil)
# ============================================================================

RCI_COEFFICIENTS = {
    1:  {'a': 3.987,  'b': 0.815},
    2:  {'a': 12.542, 'b': -2.955},
    3:  {'a': 12.542, 'b': -2.955},
    4:  {'a': 11.936, 'b': -2.407},
    5:  {'a': 11.936, 'b': -2.407},
    6:  {'a': 15.506, 'b': -3.530},
    7:  {'a': 12.542, 'b': -2.955},
    8:  {'a': 15.506, 'b': -3.530},
    9:  {'a': 15.506, 'b': -3.530},
    10: {'a': 12.542, 'b': -2.955},
    11: {'a': 13.686, 'b': -2.705},
    12: {'a': 13.686, 'b': -2.705},
    13: {'a': 12.189, 'b': -1.942},
    14: None,  # RCI = 0
    15: {'a': 3.987,  'b': 0.815},
    16: {'a': 3.987,  'b': 0.815},
}

# ============================================================================
# Step 4: Function to Load a Multi-Band GeoTIFF File
# ============================================================================

def load_geotiff_multiband(filepath):
    """Load all bands of a GeoTIFF and return (bands_array[n,H,W], profile)"""
    try:
        with rasterio.open(filepath) as src:
            data = src.read()  # shape: (bands, H, W)
            profile = src.profile
        return data, profile
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return None, None

# ============================================================================
# Step 5: Load Soil Texture Map and Align to WLDAS Grid
# ============================================================================

def load_and_align_texture(texture_path, ref_profile):
    """
    Load the dominant soil texture class map and reproject/align it
    onto the WLDAS reference grid (same transform, CRS, shape) using
    nearest-neighbor resampling (texture is categorical data).
    """
    with rasterio.open(texture_path) as tex_src:
        if (tex_src.crs == ref_profile['crs'] and
                tex_src.transform == ref_profile['transform'] and
                tex_src.width == ref_profile['width'] and
                tex_src.height == ref_profile['height']):
            texture = tex_src.read(1)
        else:
            texture = np.full((ref_profile['height'], ref_profile['width']),
                               MISSING_VAL, dtype=np.float32)
            reproject(
                source=rasterio.band(tex_src, 1),
                destination=texture,
                src_transform=tex_src.transform,
                src_crs=tex_src.crs,
                src_nodata=MISSING_VAL,
                dst_transform=ref_profile['transform'],
                dst_crs=ref_profile['crs'],
                dst_nodata=MISSING_VAL,
                resampling=Resampling.nearest,
            )
    return texture

# ============================================================================
# Step 6: Build a Per-Pixel Bulk Density Array from the Texture Class Map
# ============================================================================

def build_bulk_density_array(texture_class):
    """
    Map each pixel's texture class to its bulk density (g/cm3).
    Pixels with an unrecognized class get NaN (excluded downstream).
    """
    bd = np.full(texture_class.shape, np.nan, dtype=np.float32)
    for cls, bd_val in BULK_DENSITY_BY_CLASS.items():
        bd[texture_class == cls] = bd_val
    return bd

# ============================================================================
# Step 7: Function to Convert Volumetric to Gravimetric Soil Moisture
# ============================================================================

def volumetric_to_gravimetric(volumetric_sm, bulk_density):
    """
    Convert volumetric soil moisture to gravimetric soil moisture.
    Formula: Gravimetric SM = Volumetric SM / Bulk Density

    Args:
        volumetric_sm: Volumetric soil moisture (m3/m3 fraction), array
        bulk_density:  Bulk density (g/cm3), array (per-pixel, from texture class)

    Returns:
        Gravimetric soil moisture (fraction, kg/kg)
    """
    with np.errstate(divide='ignore', invalid='ignore'):
        gsm = volumetric_sm / bulk_density
    return gsm

# ============================================================================
# Step 8: Function to Calculate Texture-Specific RCI from Gravimetric SM
# ============================================================================

def calculate_rci_by_texture(gravimetric_sm, texture_class):
    """
    Calculate Rating Cone Index (RCI) per pixel using soil-texture-class
    specific empirical equations (Sullivan and Anderson, 2000):

        RCI = exp(a + b * ln(% Moisture Content))

    where % Moisture Content = gravimetric soil moisture x 100.

    Args:
        gravimetric_sm: array of gravimetric soil moisture (fraction, 0-1+)
        texture_class:  array of dominant soil texture class codes (1-16)

    Returns:
        RCI array (psi); pixels with class 14 or missing/invalid class -> 0
    """
    pct_moisture = gravimetric_sm * 100.0
    rci = np.zeros_like(pct_moisture, dtype=np.float32)

    safe_moisture = np.where(pct_moisture > 0, pct_moisture, np.nan)
    ln_moisture = np.log(safe_moisture)

    for cls, coeff in RCI_COEFFICIENTS.items():
        mask = (texture_class == cls)
        if not np.any(mask):
            continue
        if coeff is None:  # class 14 -> RCI = 0
            rci[mask] = 0.0
        else:
            exponent = coeff['a'] + coeff['b'] * ln_moisture[mask]
            rci_vals = np.exp(exponent)
            rci_vals = np.nan_to_num(rci_vals, nan=0.0)
            rci[mask] = rci_vals

    valid_classes = np.isin(texture_class, list(RCI_COEFFICIENTS.keys()))
    rci[~valid_classes] = 0.0

    return rci

# ============================================================================
# Step 9: Main Processing Function for a Single Day of Year
# ============================================================================

def process_doy(doy, input_dir, output_dir, texture_class_ref, bulk_density_ref):
    """
    Process a single day of year:
      1. Load the 3-band WLDAS_SM_Profile_DOY_###.tif file
         (band 1 = SM_mean, band 2 = SM_p5, band 3 = SM_p95)
      2. For each of the 3 bands: convert volumetric -> gravimetric moisture
         using per-pixel bulk density, then compute RCI using texture-specific
         equations
      3. Write the 3 gravimetric SM results into a single 3-band GeoTIFF
      4. Write the 3 RCI results into a single 3-band GeoTIFF
    """
    doy_str = str(doy).zfill(3)
    print(f"Processing DOY {doy_str}...", end=' ')

    filename = f'WLDAS_SM_Profile_DOY_{doy_str}.tif'
    filepath = os.path.join(input_dir, filename)

    if not os.path.exists(filepath):
        alt_patterns = [
            f'WLDAS_SM_Profile_DOY_{doy_str}*.tif',
            f'wldas_sm_profile_doy_{doy_str}*.tif',
            f'WLDAS_SM_Profile_DOY_{doy_str.lstrip("0")}*.tif',
        ]
        found = False
        for pattern in alt_patterns:
            matches = glob.glob(os.path.join(input_dir, pattern))
            if matches:
                filepath = matches[0]
                found = True
                break
        if not found:
            print(f"\n  WARNING: file not found: {filename}")
            return None

    sm_bands, profile_ref = load_geotiff_multiband(filepath)
    if sm_bands is None:
        print(f"\n  ERROR loading {filepath}")
        return None

    if sm_bands.shape[0] < 3:
        print(f"\n  ERROR: expected 3 bands (mean, p5, p95) in {filepath}, "
              f"found {sm_bands.shape[0]}")
        return None

    texture_class = texture_class_ref
    bulk_density = bulk_density_ref

    rci_bands = np.zeros_like(sm_bands[:3], dtype=np.float32)
    gsm_bands = np.zeros_like(sm_bands[:3], dtype=np.float32)

    for i in range(3):
        volumetric_sm = sm_bands[i]

        # ---- Convert volumetric -> gravimetric using per-pixel bulk density ----
        gravimetric_sm = volumetric_to_gravimetric(volumetric_sm, bulk_density)
        gsm_bands[i] = gravimetric_sm

        # ---- Calculate RCI using texture-specific equations ----
        rci_bands[i] = calculate_rci_by_texture(gravimetric_sm, texture_class)

    # ---- Statistics (based on the mean-SM band, index 0) ----
    sm_mean_band = sm_bands[0]
    valid_mask = (sm_mean_band > 0) & (sm_mean_band < 1)
    stats = {
        'doy': doy,
        'doy_str': doy_str,
        'sm_mean_mean': np.mean(sm_mean_band[valid_mask]) if np.any(valid_mask) else np.nan,
        'gsm_mean_mean': np.nanmean(gsm_bands[0][valid_mask]) if np.any(valid_mask) else np.nan,
        'rci_mean_mean': np.mean(rci_bands[0][valid_mask]) if np.any(valid_mask) else np.nan,
        'rci_p5_mean': np.mean(rci_bands[1][valid_mask]) if np.any(valid_mask) else np.nan,
        'rci_p95_mean': np.mean(rci_bands[2][valid_mask]) if np.any(valid_mask) else np.nan,
    }

    # ---- Common 3-band output profile ----
    out_profile = profile_ref.copy()
    out_profile.update(count=3, dtype=rasterio.float32, nodata=MISSING_VAL)

    # ---- Export: single 3-band Gravimetric SM GeoTIFF ----
    output_gsm = os.path.join(output_dir, f'WLDAS_SM_Gravimetric_Profile_DOY_{doy_str}.tif')
    gsm_export = np.nan_to_num(gsm_bands, nan=MISSING_VAL).astype(rasterio.float32)
    with rasterio.open(output_gsm, 'w', **out_profile) as dst:
        for i in range(3):
            dst.write(gsm_export[i], i + 1)
            dst.set_band_description(i + 1, GSM_BAND_NAMES[i])

    # ---- Export: single 3-band RCI GeoTIFF ----
    output_rci = os.path.join(output_dir, f'WLDAS_RCI_Profile_DOY_{doy_str}.tif')
    with rasterio.open(output_rci, 'w', **out_profile) as dst:
        for i in range(3):
            dst.write(rci_bands[i].astype(rasterio.float32), i + 1)
            dst.set_band_description(i + 1, RCI_BAND_NAMES[i])

    print("Exported")

    return {
        'doy': doy,
        'doy_str': doy_str,
        'rci_bands': rci_bands,
        'gsm_bands': gsm_bands,
        'profile': out_profile,
        'statistics': stats,
    }

# ============================================================================
# Step 10: Execute Processing for All Days
# ============================================================================

print('\n' + '=' * 80)
print('PROCESSING SOIL MOISTURE PROFILE FILES')
print('=' * 80 + '\n')

doy_range = range(315, 367)  # modify range as needed, e.g. range(1, 367)

# Load a reference WLDAS profile from the first DOY to align the texture
# map and build the per-pixel bulk density array once (reused every day)
first_doy_str = str(doy_range[0]).zfill(3)
ref_sm_path = os.path.join(INPUT_DIR, f'WLDAS_SM_Profile_DOY_{first_doy_str}.tif')
with rasterio.open(ref_sm_path) as ref_src:
    ref_profile = ref_src.profile

texture_class_ref = load_and_align_texture(TEXTURE_TIF, ref_profile)
bulk_density_ref = build_bulk_density_array(texture_class_ref)

results = []
for doy in doy_range:
    result = process_doy(doy, INPUT_DIR, OUTPUT_DIR, texture_class_ref, bulk_density_ref)
    if result is not None:
        results.append(result)

print(f'\nProcessed {len(results)} days successfully\n')

# ============================================================================
# Step 11: Create Summary Statistics File
# ============================================================================

print('Creating summary statistics file...')
summary_file = os.path.join(OUTPUT_DIR, 'WLDAS_Soil_Profile_RCI_Statistics.csv')

with open(summary_file, 'w') as f:
    f.write('DOY,SM_Mean_Mean,Gravimetric_SM_Mean_Mean,RCI_Mean_Mean,RCI_P5_Mean,RCI_P95_Mean\n')
    for result in results:
        s = result['statistics']
        f.write(f"{s['doy_str']},{s['sm_mean_mean']:.6f},{s['gsm_mean_mean']:.6f},"
                f"{s['rci_mean_mean']:.4f},{s['rci_p5_mean']:.4f},{s['rci_p95_mean']:.4f}\n")

print(f'Summary statistics saved to: {summary_file}\n')

# ============================================================================
# Step 12: Create Visualization
# ============================================================================

print('Creating visualization plots...')

doys = [r['statistics']['doy'] for r in results]
rci_mean_series = [r['statistics']['rci_mean_mean'] for r in results]
rci_p5_series = [r['statistics']['rci_p5_mean'] for r in results]
rci_p95_series = [r['statistics']['rci_p95_mean'] for r in results]

fig, ax = plt.subplots(figsize=(14, 7))

ax.plot(doys, rci_mean_series, 'r-', linewidth=2, label='RCI (Mean SM)')
ax.plot(doys, rci_p5_series, 'g--', linewidth=1.5, label='RCI (5th Percentile SM)')
ax.plot(doys, rci_p95_series, 'b--', linewidth=1.5, label='RCI (95th Percentile SM)')
ax.fill_between(doys, rci_p5_series, rci_p95_series, alpha=0.15, color='gray')
ax.set_xlabel('Day of Year', fontsize=12, fontweight='bold')
ax.set_ylabel('Rating Cone Index (psi)', fontsize=12, fontweight='bold')
ax.set_title('Annual Soil Profile RCI Cycle (Mean, P5, P95 - Texture-Specific, '
             'Gravimetric SM, Sullivan & Anderson 2000)', fontsize=13, fontweight='bold')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)
ax.set_xlim(0, 366)

plt.tight_layout()
plt.savefig(os.path.join(OUTPUT_DIR, 'WLDAS_Annual_Cycle_RCI_MeanP5P95.png'), dpi=300, bbox_inches='tight')
print(f'Annual cycle plot saved to: '
      f'{os.path.join(OUTPUT_DIR, "WLDAS_Annual_Cycle_RCI_MeanP5P95.png")}\n')

print('=' * 80)
print('PROCESSING COMPLETE')
print('=' * 80)
