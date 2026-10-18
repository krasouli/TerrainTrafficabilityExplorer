// Load the WLDAS collection
var wldas = ee.ImageCollection("projects/climate-engine-pro/assets/ce-wldas/daily");

// Apply filters for the time period
var wldasFiltered = wldas.filterDate('1980-01-01', '2023-12-31');

// Select the four soil moisture layers
var layerNames = ['SoilMoist_tavg_0', 'SoilMoist_tavg_1', 'SoilMoist_tavg_2', 'SoilMoist_tavg_3'];
var soilMoistureLayers = wldasFiltered.select(layerNames);

// Print collection info
print('Collection size:', wldasFiltered.size());

// Depth-weighting configuration (cm): 0-10, 10-40, 40-100, 100-200
var layerThickness = [10, 30, 60, 100];
var totalDepth = layerThickness.reduce(function(a, b) { return a + b; }, 0);

// Function to compute depth-weighted profile average soil moisture for one image
function computeProfileAverage(image) {
  var profileAvg = image.expression(
    '(b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) / total', {
      'b1': image.select('SoilMoist_tavg_0'),
      'b2': image.select('SoilMoist_tavg_1'),
      'b3': image.select('SoilMoist_tavg_2'),
      'b4': image.select('SoilMoist_tavg_3'),
      'w1': layerThickness[0],
      'w2': layerThickness[1],
      'w3': layerThickness[2],
      'w4': layerThickness[3],
      'total': totalDepth
    }
  ).rename('SM_profile');

  return profileAvg.copyProperties(image, image.propertyNames());
}

// Apply depth-weighting to every image in the collection
var profileAverageCollection = soilMoistureLayers.map(computeProfileAverage);

// Function to add day-of-year information as a property (not a band)
function addDoyProperty(image) {
  var date = image.date();
  var doy = date.getRelative('day', 'year').add(1); // DOY from 1 to 366
  return image.set('doy', doy);
}

// Add DOY as a property to all profile-average images
var profileAverageWithDoy = profileAverageCollection.map(addDoyProperty);

// Create a list of day-of-year values (1 to 366)
var doyList = ee.List.sequence(1, 366);

// Combined reducer: mean + 5th/95th percentiles in a single pass
var combinedReducer = ee.Reducer.mean().combine({
  reducer2: ee.Reducer.percentile([5, 95]),
  sharedInputs: true
});

// Function to calculate mean, p5, and p95 profile-average soil moisture for each DOY
function getStatsForDoy(doy) {
  doy = ee.Number(doy);
  var filtered = profileAverageWithDoy.filter(ee.Filter.eq('doy', doy));

  // Reduce across all years for this DOY -> bands: SM_profile_mean, SM_profile_p5, SM_profile_p95
  var statsImage = filtered.reduce(combinedReducer);

  // Explicitly select and rename bands to guarantee order: mean, p5, p95
  var climImage = statsImage.select(
    ['SM_profile_mean', 'SM_profile_p5', 'SM_profile_p95'],
    ['SM_mean', 'SM_p5', 'SM_p95']
  );

  // Add doy as a property to the resulting image
  return climImage.set('doy', doy);
}

// Map the function across all days of year
var climatologyCollection = ee.ImageCollection.fromImages(
  doyList.map(getStatsForDoy)
);

print('Daily profile-average climatology collection created');
print('Climatology collection size:', climatologyCollection.size());

// Define export region
var exportRegion = ee.Geometry.Rectangle([-125, 25, -103, 50]);

// BATCH EXPORT: Export each day of year as a separate 3-band image to avoid memory limits
var exportTasks = [];

// for (var i = 1; i <= 366; i++) {
for (var i = 139; i <= 139; i++) {
  var doy = i;
  var dailyClim = climatologyCollection
    .filter(ee.Filter.eq('doy', doy))
    .first();

  // Format day number with leading zeros (001-366)
  var doyStr = (doy < 10 ? '00' : doy < 100 ? '0' : '') + doy;

  // Create export task for each day of year (3 bands: mean, p5, p95 of profile-average SM)
  var task = Export.image.toDrive({
    image: dailyClim,
    description: 'WLDAS_SM_Profile_DOY_' + doyStr,
    fileNamePrefix: 'WLDAS_SM_Profile_DOY_' + doyStr,
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