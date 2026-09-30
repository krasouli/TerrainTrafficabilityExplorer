"""
Extract TEXTURE variable from LIS NoahMP input netCDF and save as GeoTIFF.

TEXTURE has dims (soiltypes, north_south, east_west) - it stores the
fractional area of each of the 16 soil texture classes per grid cell
(similar to LANDCOVER/SURFACETYPE). This script:
  1) Computes the dominant soil texture class (argmax over soiltypes) -> single-band GeoTIFF
  2) Optionally writes all 16 soiltype fraction layers as a multi-band GeoTIFF

Requires: netCDF4 (or xarray), numpy, rasterio
    pip install netCDF4 xarray numpy rasterio
"""

import numpy as np
import xarray as xr
import rasterio
from rasterio.transform import from_origin

# ---------------------------------------------------------------------
# 1. User settings
# ---------------------------------------------------------------------
nc_file      = "lis_input.noahmp36_wrldprismclim.nc"
out_dominant = "TEXTURE_dominant.tif"
out_stack    = "TEXTURE_allclasses.tif"   # multi-band, one per soil type
missing_val  = -9999.0

# ---------------------------------------------------------------------
# 2. Open dataset and pull TEXTURE, lat, lon
# ---------------------------------------------------------------------
ds = xr.open_dataset(nc_file, decode_cf=False)  # keep raw scale/offset as attrs

texture = ds["TEXTURE"].values          # shape (soiltypes, north_south, east_west)
lat     = ds["lat"].values              # shape (north_south, east_west)
lon     = ds["lon"].values              # shape (north_south, east_west)

texture = np.where(texture == missing_val, np.nan, texture)

n_classes, ny, nx = texture.shape
print(f"TEXTURE shape: {texture.shape}")

# ---------------------------------------------------------------------
# 3. Build geotransform from lat/lon (assumes regular grid, north-up)
# ---------------------------------------------------------------------
res_x = float(lon[0, 1] - lon[0, 0])
res_y = float(lat[0, 0] - lat[1, 0])   # positive if row 0 is northernmost

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
dom_idx = np.argmax(tex_filled, axis=0) + 1   # class index 1-16
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
# 5. (Optional) Save all 16 soil-type fraction layers as multi-band GeoTIFF
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

ds.close()
