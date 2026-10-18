# TerrainTrafficabilityExplorer
Link to the Application: https://rci-nwus.projects.earthengine.app/view/drivemud

Link to the Source Code: https://github.com/krasouli/TerrainTrafficabilityExplorer/tree/main

Link to the Google Earth ENgine Assets:  https://crushftp.dri.edu/?u=Me784PuX&p=ZyGRJ62U

This repository contains the source code and Google Earth Engine assets required to install, rebuild, and publish the Terrain Trafficability Explorer application. The app is designed to visualize and analyze climatological daily terrain trafficability conditions using Google Earth Engine, with emphasis on soil moisture, soil temperature, snow depth, gravimetric soil moisture, and Rating Cone Index (RCI).
Repository structure
The repository is organized into two primary folders:

•	App/ — contains the main Google Earth Engine JavaScript source code for the application, including the user interface, map layers, legends, charts, layer selectors, and trafficability logic. The main application entry point is MainSourceCode.js.

•	GoogleEngineAssets/ — contains scripts to download Google Earth Engine assets, which are also accessible from here: https://crushftp.dri.edu/?u=Me784PuX&p=ZyGRJ62U

•	Scripts/ — contains preparation scripts and supporting preprocessing workflows used to generate the climatological datasets consumed by the app.

# Data assets
The GoogleEngineAssets/ folder includes or documents the asset-generation workflows for the following daily climatological datasets for all days of year (DOY 001–366):

•	Soil moisture at four soil layers.

•	Soil temperature for the top 10 cm soil layer.

•	Snow depth.

•	Gravimetric soil moisture for the full 2 m soil profile.

•	Rating Cone Index (RCI) derived from gravimetric soil moisture and soil texture.

•	Soil texture maps representing 16 soil classes used in the RCI calculations.

These assets are intended to be uploaded to a Google Earth Engine project as image assets or image collections, depending on the chosen implementation. The main app expects these precomputed climatological layers to already exist in the configured Earth Engine asset paths.

# Preprocessing workflows
The preprocessing JavaScript files in Scripts/ are used to download, derive, and export the daily climatological layers required by the application. These scripts support the following tasks:

1.	Calculation of daily climatological soil moisture for four soil layers.

2.	Calculation of daily climatological soil temperature for the upper 10 cm.

3.	Calculation of daily climatological snow depth.

4.	Computation of gravimetric soil moisture for the integrated 2 m soil profile from layer-specific soil moisture data.

5.	Computation of RCI values from gravimetric soil moisture and soil texture classes using the adopted empirical equations.

6.	Preparation and export of soil texture maps for the 16 soil texture classes used by the app.

Before rebuilding the app, all required assets should be regenerated or verified in Earth Engine so the application can access the expected datasets without path or naming conflicts.

# Requirements
To rebuild and deploy the app, the following are required:

•	A Google Earth Engine account with access to the target Earth Engine project.

•	Permissions to create and read assets in the selected Earth Engine project.

•	Access to the Earth Engine Code Editor or Earth Engine JavaScript API environment.

•	The scripts in App/ and Scripts/ copied into the Earth Engine Code Editor or linked through repository integration.

# How to install and regenerate the app
## 1. Prepare the Earth Engine assets
Open the preprocessing scripts in the GoogleEngineAssets/ folder and run them in the Google Earth Engine Code Editor in the intended order. These scripts should be used to regenerate the daily climatological datasets and export them into the target Earth Engine project asset space.

During this step, verify the following:

•	Asset names follow the naming conventions expected by the app.

•	The exported assets cover all 366 days of year where applicable.

•	Spatial resolution, extent, and projection are consistent across variables.

•	Soil texture maps and derived RCI layers align spatially with the climatological soil moisture, soil temperature, and snow depth layers.

If the asset paths differ from the original project, update the path definitions in MainSourceCode.js before launching the application.

## 2. Configure the main application script
Open App/MainSourceCode.js in the Earth Engine Code Editor. Review and update the asset path variables near the top of the script so they point to the correct Earth Engine project and asset names. These path variables typically reference the daily climatological maps for:

•	Soil moisture layers

•	Soil temperature

•	Frozen soils

•	Snow depth

•	Snow sinkage

•	Gravimetric soil moisture

•	RCI.

Also review any configuration settings related to map defaults, region of interest, visualization ranges, legends, layer labels, and chart behavior.

## 3. Run and test the application
After all asset paths are updated, run MainSourceCode.js in the Earth Engine Code Editor. Confirm that the following components load correctly:

•	Base map and application panels.

•	Variable and layer selectors.

•	Daily climatological raster layers.

•	Legends and symbology.

•	Time-series charts.

•	Trafficability outputs and Go/No-Go logic, if included in the configured version.

If any layer does not render, verify the asset path, band naming, and projection consistency.

## 4. Publish the Earth Engine app
Once the application is functioning as expected in the Code Editor:

1.	Click Apps in the Earth Engine Code Editor.

2.	Create a new app from MainSourceCode.js.

3.	Set the app title, description, and sharing permissions.

4.	Publish the app and test the deployed URL.

If the app is being regenerated for a new Earth Engine project or account, make sure the published app has access to all referenced assets.

# Notes on RCI generation
RCI in this application is derived from gravimetric soil moisture for the full soil profile together with soil texture information from the 16-class soil texture map. The preprocessing scripts calculate gravimetric soil moisture from layer-specific climatological soil moisture inputs, then apply the selected empirical RCI equations by soil texture class. Because the RCI computation depends on both soil moisture and texture alignment, any updates to either input dataset should be followed by regeneration of the RCI assets.

# Recommended verification checklist
Before publishing or re-publishing the app, verify the following:

•	All daily climatological assets exist for DOY 001–366.

•	Asset names in Earth Engine exactly match the names referenced in MainSourceCode.js.

•	All variables are aligned to the same spatial grid.

•	RCI values render correctly and correspond to the expected soil texture classes.

•	Layer labels, legends, and chart titles are consistent with the displayed variable.

•	The app loads successfully for multiple dates and variables without missing assets.

# Typical workflow summary
1.	Regenerate climatological assets using the preprocessing scripts in Scripts/.

2.	Upload or export the resulting datasets to the target Google Earth Engine project.

3.	Update asset path definitions in App/MainSourceCode.js.

4.	Run and validate the app in the Earth Engine Code Editor.

5.	Publish or re-publish the Terrain Trafficability Explorer as a Google Earth Engine App.

# Suggested citation or acknowledgment text
If this repository is distributed with a manuscript, report, or application release, the following short description may be adapted:

The Terrain Trafficability Explorer is a Google Earth Engine application for visualizing daily climatological terrain conditions and derived trafficability indicators, including soil moisture, soil temperature, snow depth, gravimetric soil moisture, and Rating Cone Index (RCI), supported by preprocessing workflows for climatological asset generation and texture-based RCI estimation.

# Citation: 

Rasouli K., D. McEvoy, C. Albano, J. Ammatelli, M. Hausner, 2026. Terrain Trafficability Explorer: An Interactive Google Earth Engine Application for Assessing Seasonal Ground Trafficability Across the Western United States, Desert Research Institute (DRI), Reno, Nevada, September, 2026.
