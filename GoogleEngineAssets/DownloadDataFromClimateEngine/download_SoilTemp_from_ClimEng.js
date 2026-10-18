// Load the WLDAS collection
var wldas = ee.ImageCollection("projects/climate-engine-pro/assets/ce-wldas/daily");

// Apply filters for the time period
var wldasFiltered = wldas.filterDate('1980-01-01', '2023-12-31');

// Select the correct Soil Temperature band
var soilMoisture = wldasFiltered.select('SoilTemp_tavg_1');

// Print collection info
print('Collection size:', wldasFiltered.size());

// Function to add day-of-year information as a property (not a band)
function addDoyProperty(image) {
  var date = image.date();
  var doy = date.getRelative('day', 'year').add(1); // DOY from 1 to 366
  return image.set('doy', doy);
}

// Add DOY as a property to all images
var soilMoistureWithDoy = soilMoisture.map(addDoyProperty);

// Create a list of day-of-year values (1 to 366)
var doyList = ee.List.sequence(1, 366);

// Function to calculate mean soil moisture for each day of year
function getMeanForDoy(doy) {
  doy = ee.Number(doy);
  var filtered = soilMoistureWithDoy.filter(ee.Filter.eq('doy', doy));
  
  var meanImage = filtered.mean().rename('SoilTemp_tavg_1');
  
  // Add doy as a property to the resulting image
  return meanImage.set('doy', doy);
}

// Map the function across all days of year
var climatologyCollection = ee.ImageCollection.fromImages(
  doyList.map(getMeanForDoy)
);

print('Daily climatology collection created');
print('Climatology collection size:', climatologyCollection.size());

// Define export region
var exportRegion = ee.Geometry.Rectangle([-125, 25, -103, 50]);

// BATCH EXPORT: Export each day of year as a separate image to avoid memory limits
// Create a list of all export tasks
var exportTasks = [];

for (var i = 1; i <= 366; i++) {
  var doy = i;
  var dailyClim = climatologyCollection
    .filter(ee.Filter.eq('doy', doy))
    .first();
  
  // Format day number with leading zeros (001-366)
  var doyStr = (doy < 10 ? '00' : doy < 100 ? '0' : '') + doy;
  
  // Create export task for each day of year
  var task = Export.image.toDrive({
    image: dailyClim,
    description: 'WLDAS_SoilTemp1_DOY_' + doyStr,
    fileNamePrefix: 'WLDAS_SoilTemp1_DOY_' + doyStr,
    folder: 'GEE_WLDAS_Climatology',
    scale: 1113,
    maxPixels: 1e13,
    region: exportRegion,
    crs: 'EPSG:4326'
  });
  
  exportTasks.push(task);
}

print('Created ' + exportTasks.length + ' export tasks');
print('Go to the Tasks panel (on the right) and click RUN for each task to start exporting');
