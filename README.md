# TerrainTrafficabilityExplorer
Link to the Application: https://rci-nwus.projects.earthengine.app/view/drivemud

This repository contains the source code and Google Earth Engine assets required to install, rebuild, and publish the Terrain Trafficability Explorer application. The app is designed to visualize and analyze climatological daily terrain trafficability conditions using Google Earth Engine, with emphasis on soil moisture, soil temperature, snow depth, gravimetric soil moisture, and Rating Cone Index (RCI).
Repository structure
The repository is organized into two primary folders:
•	App/ — contains the main Google Earth Engine JavaScript source code for the application, including the user interface, map layers, legends, charts, layer selectors, and trafficability logic. The main application entry point is MainSourceCode.js.
•	GoogleEngineAssets/ — contains the Google Earth Engine asset 
•	Scripts/ — contains preparation scripts and supporting preprocessing workflows used to generate the climatological datasets consumed by the app.
Data assets
The GoogleEngineAssets/ folder includes or documents the asset-generation workflows for the following daily climatological datasets for all days of year (DOY 001–366):
•	Soil moisture at four soil layers.
•	Soil temperature for the top 10 cm soil layer.
•	Snow depth.
•	Gravimetric soil moisture for the full 2 m soil profile.
•	Rating Cone Index (RCI) derived from gravimetric soil moisture and soil texture.
•	Soil texture maps representing 16 soil classes used in the RCI calculations.
These assets are intended to be uploaded to a Google Earth Engine project as image assets or image collections, depending on the chosen implementation. The main app expects these precomputed climatological layers to already exist in the configured Earth Engine asset paths.
Preprocessing workflows
The preprocessing JavaScript files in Scripts/ are used to download, derive, and export the daily climatological layers required by the application. These scripts support the following tasks:
1.	Calculation of daily climatological soil moisture for four soil layers.
2.	Calculation of daily climatological soil temperature for the upper 10 cm.
3.	Calculation of daily climatological snow depth.
4.	Computation of gravimetric soil moisture for the integrated 2 m soil profile from layer-specific soil moisture data.
5.	Computation of RCI values from gravimetric soil moisture and soil texture classes using the adopted empirical equations.
6.	Preparation and export of soil texture maps for the 16 soil texture classes used by the app.
Before rebuilding the app, all required assets should be regenerated or verified in Earth Engine so the application can access the expected datasets without path or naming conflicts.
Requirements
To rebuild and deploy the app, the following are required:
•	A Google Earth Engine account with access to the target Earth Engine project.
•	Permissions to create and read assets in the selected Earth Engine project.
•	Access to the Earth Engine Code Editor or Earth Engine JavaScript API environment.
•	The scripts in App/ and Scripts/ copied into the Earth Engine Code Editor or linked through repository integration.
How to install and regenerate the app
1. Prepare the Earth Engine assets
Open the preprocessing scripts in the GoogleEngineAssets/ folder and run them in the Google Earth Engine Code Editor in the intended order. These scripts should be used to regenerate the daily climatological datasets and export them into the target Earth Engine project asset space.
During this step, verify the following:
•	Asset names follow the naming conventions expected by the app.
•	The exported assets cover all 366 days of year where applicable.
•	Spatial resolution, extent, and projection are consistent across variables.
•	Soil texture maps and derived RCI layers align spatially with the climatological soil moisture, soil temperature, and snow depth layers.
If the asset paths differ from the original project, update the path definitions in MainSourceCode.js before launching the application.
2. Configure the main application script
Open App/MainSourceCode.js in the Earth Engine Code Editor. Review and update the asset path variables near the top of the script so they point to the correct Earth Engine project and asset names. These path variables typically reference the daily climatological maps for:
•	Soil moisture layers
•	Soil temperature
•	Frozen soils
•	Snow depth
•	Snow sinkage
•	Gravimetric soil moisture
•	RCI.
Also review any configuration settings related to map defaults, region of interest, visualization ranges, legends, layer labels, and chart behavior.
3. Run and test the application
After all asset paths are updated, run MainSourceCode.js in the Earth Engine Code Editor. Confirm that the following components load correctly:
•	Base map and application panels.
•	Variable and layer selectors.
•	Daily climatological raster layers.
•	Legends and symbology.
•	Time-series charts.
•	Trafficability outputs and Go/No-Go logic, if included in the configured version.
If any layer does not render, verify the asset path, band naming, and projection consistency.
4. Publish the Earth Engine app
Once the application is functioning as expected in the Code Editor:
1.	Click Apps in the Earth Engine Code Editor.
2.	Create a new app from MainSourceCode.js.
3.	Set the app title, description, and sharing permissions.
4.	Publish the app and test the deployed URL.
If the app is being regenerated for a new Earth Engine project or account, make sure the published app has access to all referenced assets.
Notes on RCI generation
RCI in this application is derived from gravimetric soil moisture for the full soil profile together with soil texture information from the 16-class soil texture map. The preprocessing scripts calculate gravimetric soil moisture from layer-specific climatological soil moisture inputs, then apply the selected empirical RCI equations by soil texture class. Because the RCI computation depends on both soil moisture and texture alignment, any updates to either input dataset should be followed by regeneration of the RCI assets.
Recommended verification checklist
Before publishing or re-publishing the app, verify the following:
•	All daily climatological assets exist for DOY 001–366.
•	Asset names in Earth Engine exactly match the names referenced in MainSourceCode.js.
•	All variables are aligned to the same spatial grid.
•	RCI values render correctly and correspond to the expected soil texture classes.
•	Layer labels, legends, and chart titles are consistent with the displayed variable.
•	The app loads successfully for multiple dates and variables without missing assets.
Typical workflow summary
1.	Regenerate climatological assets using the preprocessing scripts in Scripts/.
2.	Upload or export the resulting datasets to the target Google Earth Engine project.
3.	Update asset path definitions in App/MainSourceCode.js.
4.	Run and validate the app in the Earth Engine Code Editor.
5.	Publish or re-publish the Terrain Trafficability Explorer as a Google Earth Engine App.
Suggested citation or acknowledgment text
If this repository is distributed with a manuscript, report, or application release, the following short description may be adapted:
The Terrain Trafficability Explorer is a Google Earth Engine application for visualizing daily climatological terrain conditions and derived trafficability indicators, including soil moisture, soil temperature, snow depth, gravimetric soil moisture, and Rating Cone Index (RCI), supported by preprocessing workflows for climatological asset generation and texture-based RCI estimation.
Citation: 
Rasouli K., D. McEvoy, C. Albano, J. Ammatelli, M. Hausner, 2026. Terrain Trafficability Explorer: An Interactive Google Earth Engine Application for Assessing Seasonal Ground Trafficability Across the Western United States, Desert Research Institute (DRI), Reno, Nevada, September, 2026.
			
More information:
-----------------
The application is based on four primary data streams: (1) soil texture classes from LIS input files and derived georeferenced GeoTIFFs, (2) WLDAS daily soil moisture fields for four vertical layers, (3) WLDAS daily soil temperature fields, and (4) WLDAS daily snow depth. LIS Noah-MP input uses a 16-class soil texture map (STATSGO+FAO blended) with dimensions soiltypes × north_south × east_west, reprojected to a 0.01° (~1 km) grid for WLDAS domains via LIS preprocessing. The dominant soil texture class per grid cell is computed by taking the argmax over the 16-class texture fractions and saved as TEXTURE_dominant.tif, then cropped and reprojected to the WLDAS western United States extent as soiltexture_NWUSA.tif.
WLDAS soil moisture data are available as climatological GeoTIFFs in the form WLDAS_SM_DOY_###.tif, WLDAS_SM2_DOY_###.tif, WLDAS_SM3_DOY_###.tif, and WLDAS_SM4_DOY_###.tif, corresponding to four depth ranges (e.g., 0–10, 10–40, 40–100, 100–200 cm) and daily time steps over a climatological year (DOY 001–366). Spatial resolution is 0.01° (~1 km), matching the WLDAS Noah-MP grid, and temporal resolution is daily, allowing the construction of annual cycles of depth-integrated soil moisture and RCI.

Table 1.	Key soil classes used in the WLDAS dataset and associated RCI equation for each soil texture. θg denotes gravimetric soil moisture content in kg/kg or percent.
Soil Class	Soil Texture (USDA)	Soil Texture 
(USCS)	RCI Equation (Sullivan et al. 1997)	Bulk Density (g/cm3)
1	SAND	SP—few different particle sizes, little or no fines	RCI = exp [3.987 + 0.815 ln(θg)]	1.75
2	LOAMY SAND	SM—Silty gravels, gravel–sand–silt mixtures	RCI = exp [12.542-2.955 ln(θg)]	1.75
3	SANDY LOAM	SM—Silty gravels, gravel–sand–silt mixtures	RCI = exp [12.542-2.955 ln(θg)]	1.7
4	SILT LOAM	ML—Inorganic silts, slight to no plasticity	RCI = exp [11.936-2.407 ln(θg)]	1.45
5	SILT	ML—Inorganic silts, slight to no plasticity	RCI = exp [11.936-2.407 ln(θg)]	1.42
6	LOAM	CL—Inorganic clays, low to mod. plasticity	RCI = exp [15.506-3.530 ln(θg)]	1.55
7	SANDY CLAY LOAM	SC—Clayey gravels, gravel–sand–clay mixtures	RCI = exp [12.542-2.955 ln(θg)]	1.65
8	SILTY CLAY LOAM	CL—Inorganic clays, low to mod. plasticity	RCI = exp [15.506-3.530 ln(θg)]	1.42
9	CLAY LOAM	CL—Inorganic clays, low to mod. plasticity	RCI = exp [15.506-3.530 ln(θg)]	1.5
10	SANDY CLAY	SC—Clayey gravels, gravel–sand–clay mixtures	RCI = exp [12.542-2.955 ln(θg)]	1.6
11	SILTY CLAY	CH—Inorganic clays, high plasticity, fat clays	RCI = exp [13.686-2.705 ln(θg)]	1.4
12	CLAY	CH—Inorganic clays, high plasticity, fat clays	RCI = exp [13.686-2.705 ln(θg)]	1.4
13	ORGANIC MATERIAL	OH—Organic clays, high plasticity, fat clays	RCI = exp [12.189 -1.942 ln(θg)]	1.2
14	WATER		RCI =0	1
15	BEDROCK		RCI = exp [3.987 + 0.815 ln(θg)]	1.8
16	OTHER (land-ice)		RCI = exp [3.987 + 0.815 ln(θg)]	1.2

We converted volumetric soil water content to gravimetric soil moisture content. 

The workflow proceeds in three stages. First, WLDAS input NetCDF files are called from Climate Engine (Huntington et al., 2017) to Google Earth Engine and their climatological daily maps of soil moisture at four layers, soil temperature at the top 10 cm layer, and snow depth for each day of year are calculated using Google Cloud Computing. The soil texture variable is extracted, and missing values are handled, terrain-aligned latitude/longitude grids define affine transforms, and TEXTURE_dominant.tif is generated and optionally stacked into 16-band soil texture fraction GeoTIFFs. Second, TEXTURE_dominant.tif is cropped and reprojected to the WLDAS soil moisture extent using the WLDAS GeoTIFFs as reference. The nearest-neighbor resampling preserves categorical texture codes, producing soiltexture_NWUSA.tif with dominant texture classes.
Third, for each day of year, the four WLDAS soil moisture layers are ingested, alternative naming patterns are resolved via globbing, and depth-weighted average soil moisture is computed across all layers. The soil texture raster is aligned to the WLDAS grid once, then reused across days as a reference array of texture class codes. For each pixel, the application identifies the texture class (1–16) and applies the corresponding RCI equation derived from Sullivan et al. (1997) (Table 1). RCI is computed as exp(a + b× ln(θg)) for classes with defined coefficients, with class 14 treated as RCI = 0 to represent non-soil or water surfaces.

Core Functions. Key functions include load_geotiff() for reading WLDAS and texture GeoTIFFs and returning data arrays with metadata; load_and_align_texture() for reprojecting the soil texture map onto the WLDAS grid using nearest-neighbor resampling and LIS/WLDAS coordinate reference system definitions; The function calculate_weighted_average_moisture() applies depth-weighted aggregation across the four soil layers; and calculate_rci_by_texture() evaluates the texture-specific RCI equations per pixel. The RCI coefficients are stored in a mapping of texture class IDs (1–16) to parameters a and b. For each class, the function computes ln(θg) while safely handling zero and nodata values, then calculates RCI via exp(a + b× ln(θg)). Pixels whose texture class is 14 or outside 1–16 are assigned RCI = 0. Masks are used to apply each class’s equation to only the corresponding subset of pixels, enabling efficient vectorized computation for large grids.

Data Description Within Functions. Within the processing loop, the application operates on daily climatological soil moisture GeoTIFFs for day of year (DOY) ranges (e.g., 1–366), ensuring that each day’s four layers correspond to the same spatial grid and coordinate reference system. The depth-weighted moisture function assumes volumetric soil moisture values between 0 and 1, and valid pixel masks exclude values outside this range when computing statistics. The soil texture raster is assumed to contain integer codes 1–16 representing STATSGO+FAO-derived texture classes used in LIS Noah-MP runs and was accessed from the website https://portal.nccs.nasa.gov/datashare/WLDAS_css/wldas_domain/. Asset paths are parameterized in the configuration section (INPUT_DIR, OUTPUT_DIR, TEXTURE_TIF) so that users can point the application to different climatology folders or texture maps. The script automatically creates the output directory, writes daily GeoTIFFs and a summary CSV, and generates annual cycle plots of profile-average soil moisture and RCI time series.
Visualizations. Users can toggle between climatological mean, dry (5th percentile), and wet (95th percentile) soil-moisture and RCI conditions, adjust the RCI threshold used for the Go/No-Go rule, and click anywhere on the map to generate a full annual time series of RCI, gravimetric soil moisture, snow depth, and soil temperature at that location. The tool is designed to support field logistics planning, off-road mobility assessment, and seasonal terrain-access predictability.

How to Use This Tool. The following steps need to be taken to visualize and analyze the soil strength and trafficability (Figure 1):
1. Move the date slider to pick a day of the year (1–366).
2. Choose a display layer: RCI (mean/dry/wet), Gravimetric Soil Moisture (mean/dry/wet), Snow Depth, Soil Temperature, Frozen Soil, or Go/No-Go.
3. Set the RCI threshold (psi) and pick which RCI percentile (mean, 5th, or 95th) drives the Go/No-Go classification.
4. Click “Show Go/No-Go Map” for the full trafficability map.
5. Click any point on the map (or enter manually the latitude and longitude of interest) to plot a full 366-day climatology of RCI, soil moisture, snow depth, soil temperature, and Go/No-Go at that location.
Go/No-Go Rule. The rule for Go (passable terrain) and No-Go (impassable terrain) is as follows: GO if soil is frozen (≤ 0 ℃), OR if the selected RCI percentile exceeds the threshold AND snow depth is below 0.20 m. Otherwise, No-Go. Upon selecting a point of interest, a five-panel figure shows daily soil profile average RCI, soil moisture, soil temperature, snow depth, and Go/NoGo status as continuous time series, with shaded areas highlighting seasonal wetness and associated reductions in cone index (Figure 2). These plots provide intuitive insight into how soil strength varies across the hydrological year for the western United States.



