"""
Extract TEXTURE variable from LIS NoahMP input netCDF, save as GeoTIFF,
and additionally crop TEXTURE_dominant.tif to the extent of a reference
raster (WLDAS_SM_DOY_078.tif) to produce soiltexture_NWUSA.tif.

Requires: netCDF4 (or xarray), numpy, rasterio
    pip install netCDF4 xarray numpy rasterio
"""

import numpy as np
import xarray as xr
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds

# ---------------------------------------------------------------------
# 1. User settings
# ---------------------------------------------------------------------
nc_file       = "lis_input.noahmp36_wrldprismclim.nc"
out_dominant  = "TEXTURE_dominant.tif"
out_stack     = "TEXTURE_allclasses.tif"   # multi-band, one per soil type
ref_raster    = "WLDAS_SM_DOY_078.tif"     # reference raster to crop to
out_cropped   = "soiltexture_NWUSA.tif"
missing_val   = -9999.0

# ---------------------------------------------------------------------
# 2. Open dataset and pull TEXTURE, lat, lon
# ---------------------------------------------------------------------
ds = xr.open_dataset(nc_file, decode_cf=False)

texture = ds["TEXTURE"].values          # shape (soiltypes, north_south, east_west)
lat     = ds["lat"].values
lon     = ds["lon"].values

texture = np.where(texture == missing_val, np.nan, texture)
n_classes, ny, nx = texture.shape
print(f"TEXTURE shape: {texture.shape}")

# ---------------------------------------------------------------------
# 3. Build geotransform from lat/lon (assumes regular grid, north-up)
# ---------------------------------------------------------------------
res_x = float(lon[0, 1] - lon[0, 0])
res_y = float(lat[0, 0] - lat[1, 0])

xmin = float(lon[0, 0]) - res_x / 2.0
ymax = float(lat[0, 0]) + res_y / 2.0

transform = from_origin(xmin, ymax, res_x, res_y)
crs = "EPSG:4326"

# ---------------------------------------------------------------------
# 4. Dominant soil texture class (argmax across soiltypes dimension)
# ---------------------------------------------------------------------
valid_mask = ~np.isnan(texture).all(axis=0)
dominant = np.full((ny, nx), missing_val, dtype=np.float32)

tex_filled = np.nan_to_num(texture, nan=-np.inf)
dom_idx = np.argmax(tex_filled, axis=0) + 1
dominant[valid_mask] = dom_idx[valid_mask]

with rasterio.open(
    out_dominant, "w",
    driver="GTiff",
    height=ny, width=nx,
    count=1, dtype=rasterio.float32,
    crs=crs, transform=transform,
    nodata=missing_val,
    compress="lzw",
) as dst:
    dst.write(dominant, 1)
    dst.set_band_description(1, "Dominant soil texture class (1-16)")

print(f"Saved dominant texture class map -> {out_dominant}")

# ---------------------------------------------------------------------
# 5. Save all 16 soil-type fraction layers as multi-band GeoTIFF
# ---------------------------------------------------------------------
texture_out = np.where(np.isnan(texture), missing_val, texture).astype(np.float32)

with rasterio.open(
    out_stack, "w",
    driver="GTiff",
    height=ny, width=nx,
    count=n_classes, dtype=rasterio.float32,
    crs=crs, transform=transform,
    nodata=missing_val,
    compress="lzw",
) as dst:
    for i in range(n_classes):
        dst.write(texture_out[i, :, :], i + 1)
        dst.set_band_description(i + 1, f"Soil texture class {i+1}")

print(f"Saved all soil texture fraction layers -> {out_stack}")

# ---------------------------------------------------------------------
# 6. Crop TEXTURE_dominant.tif to the extent/grid of the reference raster
#    (WLDAS_SM_DOY_078.tif) using reproject() for both same-CRS and
#    different-CRS cases -- avoids from_bounds() inconsistency errors.
# ---------------------------------------------------------------------
with rasterio.open(out_dominant) as src, rasterio.open(ref_raster) as ref:
    ref_crs       = ref.crs
    ref_transform = ref.transform
    ref_width     = ref.width
    ref_height    = ref.height

    cropped = np.full((ref_height, ref_width), missing_val, dtype=np.float32)

    reproject(
        source=rasterio.band(src, 1),
        destination=cropped,
        src_transform=src.transform,
        src_crs=src.crs,
        src_nodata=missing_val,
        dst_transform=ref_transform,
        dst_crs=ref_crs,
        dst_nodata=missing_val,
        resampling=Resampling.nearest,
    )

    with rasterio.open(
        out_cropped, "w",
        driver="GTiff",
        height=ref_height, width=ref_width,
        count=1, dtype=rasterio.float32,
        crs=ref_crs, transform=ref_transform,
        nodata=missing_val,
        compress="lzw",
    ) as dst:
        dst.write(cropped, 1)
        dst.set_band_description(1, "Dominant soil texture class (1-16), cropped to NWUSA WLDAS extent")

print(f"Saved cropped soil texture map -> {out_cropped}")

ds.close()
