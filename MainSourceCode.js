// ============================================================================
// Google Earth Engine: RCI (Mean/Dry/Wet) + Snow Depth + Snow Sinkage +
// Soil Temperature - Trafficability Tool - Single Consolidated Control Panel
// Units:
//   - RCI: psi
//   - Gravimetric Soil Moisture: fraction (kg/kg)
//   - SnowDepth: meters
//   - SnowSinkage: meters (computed from Sturm et al., 2010;2021 densification model)
//   - SoilTemp1_C: Celsius (converted from Kelvin)
//
// ============================================================================
function buildMainApp() {
var map = ui.Map();
map.setCenter(-110, 40, 6);
map.setOptions('SATELLITE');

// ============================================================================
// Default thresholds and asset paths
// ============================================================================

var DEFAULT_RCI_THRESHOLD = 50;       // psi
var DEFAULT_SNOW_THRESHOLD_M = 0.20;  // m
var DEFAULT_SINKAGE_THRESHOLD_M = 0.20; // m
var DEFAULT_FROZEN_THRESHOLD_C = 0;   // degC

// RCI and Gravimetric SM assets each have 3 bands: [mean, p5 (dry), p95 (wet)]
var RCI_BASE_PATH   = 'projects/rci-nwus/assets/WLDAS_RCI_Profile_DOY_';
var GSM_BASE_PATH   = 'projects/rci-nwus/assets/WLDAS_SM_Gravimetric_Profile_DOY_';
var SNOW_BASE_PATH  = 'projects/rci-nwus/assets/WLDAS_SnowDepth_DOY_';
var SOILT_BASE_PATH = 'projects/rci-nwus/assets/WLDAS_SoilTemp1_DOY_';

var DISPLAY_REGION = ee.Geometry.Rectangle([-125, 25, -103, 50], null, false);
var DISPLAY_SCALE = 1113;


// ============================================================================
// Anchor palettes, each expanded to exactly 10 colors to match the 10 bins
// (11 edges) now used for every continuous layer. Since classification maps
// bin index -> color 1:1 (no linear interpolation), having exactly 10
// distinct anchor colors avoids any resampling-induced duplication.
// ============================================================================

var rciPalette = ['darkred', 'red', 'orangered', 'orange', 'gold',
                   'yellow', 'yellowgreen', 'lightgreen', 'green', 'darkgreen'];

var gsmPalette = ['8c510a', 'a6611a', 'bf812d', 'dfc27d', 'f6e8c3',
                   'c7eae5', '80cdc1', '35978f', '01665e', '003c30'];

var snowPalette = ['081d58', '253494', '225ea8', '1d91c0', '41b6c4',
                    '7fcdbb', 'c7e9b4', 'edf8b1', 'ffffcc', 'ffffff'];

var soilTempPalette = ['081d58', '225ea8', '41b6c4', '7fcdbb', 'ffffbf',
                        'fee090', 'fdae61', 'f46d43', 'd73027', 'a50026'];

var sinkagePalette = ['ffffcc', 'ffeda0', 'c7e9b4', '7fcdbb', '41b6c4',
                       '1d91c0', '225ea8', '253494', '0c2c84', '081d58'];

var frozenViz = {min: 0, max: 1, palette: ['8c510a', '00ffff']};
var goNoGoViz = {min: 0, max: 1, palette: ['red', 'green']};

// ============================================================================
// Dynamic palette generation: resample any anchor palette (of arbitrary
// length) to exactly numBins colors by evenly sampling along the anchor
// palette's index range. Used as a fallback if an anchor palette's length
// ever differs from the number of bins actually returned by getCustomEdges().
// ============================================================================

function generatePaletteForBins(numBins, anchorPalette) {
  var colors = [];
  for (var i = 0; i < numBins; i++) {
    var t = (numBins === 1) ? 0 : i / (numBins - 1);
    var idx = Math.round(t * (anchorPalette.length - 1));
    colors.push(anchorPalette[idx]);
  }
  return colors;
}

// ============================================================================
// Discrete classification: buckets each pixel of image.select(bandName)
// into an integer bin index [0, numBins-1] based on the provided edges
// array (length numBins+1). This replaces a continuous linear min/max
// stretch so that the rendered map color for a pixel is determined by
// which custom bin it falls into, NOT by its proportional position between
// a global min and max. This is what makes the map colors match the
// legend swatches exactly, bin-for-bin.
// ============================================================================

function classifyToBins(image, bandName, edges) {
  var band = image.select(bandName);
  var numBins = edges.length - 1;

  // Start with bin 0 assigned everywhere; pixels below edges[0] also fall
  // here since gte(edges[0]) will be false for them and remain unclassified
  // by subsequent bins, but we explicitly clamp below via the first bin.
  var classified = ee.Image(0).rename(bandName + '_bin');

  for (var i = 0; i < numBins; i++) {
    var lo = edges[i];
    var hi = edges[i + 1];
    var inBin = (i === numBins - 1)
      ? band.gte(lo)                    // last bin: include the upper edge (>= lo)
      : band.gte(lo).and(band.lt(hi));  // all other bins: [lo, hi)
    classified = classified.where(inBin, i);
  }

  // Pixels below the first edge are clamped into bin 0 (lowest bin)
  var belowFirst = band.lt(edges[0]);
  classified = classified.where(belowFirst, 0);

  return classified.set({'edges': edges});
}

// ============================================================================
// Snow Sinkage (Sturm et al., 2010; 2021, J. Hydrometeorology)
// ============================================================================
//
// Model:
//   rho_h(DOY) = (rho_max - rho_0) * [1 - exp(-k1*SnowDepth_cm - k2*DOY)] + rho_0
//   Snow Sinkage (m) = SnowDepth_m * [1 - (rho_h(DOY) / rho_f)]
//   rho_f = min(0.917, 0.519 + 0.0023*P) * 1000   (kg/m3), P = ground pressure (kPa)
//
// DOY convention (Sturm et al., 2010): snow-season day count restarts at
// Oct 1 = -92 ... Dec 31 = -1, Jan 1 = 1 (no zero). Standard DOY (1-366,
// Jan1=1) is converted via: if standardDOY >= 274 -> sturmDOY = standardDOY - 366
// else sturmDOY = standardDOY.
// ============================================================================

var SNOW_CLASSES = {
  'Alpine':   {rhoMax: 0.5975, rho0: 0.2237, k1: 0.0012, k2: 0.0038},
  'Maritime': {rhoMax: 0.5979, rho0: 0.2578, k1: 0.0010, k2: 0.0038},
  'Prairie':  {rhoMax: 0.5940, rho0: 0.2332, k1: 0.0016, k2: 0.0031},
  'Tundra':   {rhoMax: 0.3630, rho0: 0.2425, k1: 0.0029, k2: 0.0049},
  'Taiga':    {rhoMax: 0.2170, rho0: 0.2170, k1: 0.0000, k2: 0.0000}
};
var SNOW_CLASS_NAMES = Object.keys(SNOW_CLASSES);

// Ground pressure options (kPa) -> descriptive labels
var GROUND_PRESSURE_OPTIONS = {
  '15 kPa (Over-snow tracked vehicle)': 15,
  '100 kPa (Over-snow heavy vehicle)': 100,
  '210 kPa (Over-snow Battle tank)': 210,
  '350 kPa (Heavy vehicle)': 350,
  '700 kPa (Heavy vehicle II)': 700
};
var GROUND_PRESSURE_LABELS = Object.keys(GROUND_PRESSURE_OPTIONS);

function standardDoyToSturmDoy(doy) {
  return (doy >= 274) ? (doy - 366) : doy;
}

// rho_f in kg/m3 given ground pressure P (kPa)
function finalSnowDensityKgM3(pressureKPa) {
  return Math.min(0.917, 0.519 + 0.0023 * pressureKPa) * 1000;
}

// Compute snow sinkage (m) as an ee.Image, given SnowDepth (m) band,
// day of year (standard convention), snow class name, and ground pressure (kPa).
function computeSnowSinkage(snowDepthImageM, doy, snowClassName, pressureKPa) {
  var cls = SNOW_CLASSES[snowClassName];
  var sturmDoy = standardDoyToSturmDoy(doy);

  var snowDepthCm = snowDepthImageM.multiply(100);

  var exponent = snowDepthCm.multiply(-cls.k1).subtract(sturmDoy * cls.k2);
//  var rhoH = ee.Image(cls.rhoMax - cls.rho0)
//    .multiply(ee.Image(1).subtract(exponent.exp()))
//    .add(cls.rho0)
//    .rename('SnowDensity_frac');
    
//  var rhoF = finalSnowDensityKgM3(pressureKPa); // kg/m3 (scalar)
//  var rho0_kgm3 = cls.rho0 * 1000;              // fractional density -> kg/m3

//  var sinkageM = snowDepthImageM.multiply(1 - (rho0_kgm3 / rhoF)).rename('SnowSinkage_m');

  var rhoH = ee.Image(cls.rhoMax - cls.rho0)
    .multiply(ee.Image(1).subtract(exponent.exp()))
    .add(cls.rho0)
    .rename('SnowDensity_frac');

  var rhoF = finalSnowDensityKgM3(pressureKPa); // kg/m3 (scalar)

  // Convert rhoH from fractional density -> kg/m3 (image, replaces rho0_kgm3 scalar)
  var rhoH_kgm3 = rhoH.multiply(1000).rename('SnowDensity_kgm3');

  // Sinkage using time/pressure-evolved density (rhoH) instead of static initial density
  var sinkageM = snowDepthImageM
    .multiply(ee.Image(1).subtract(rhoH_kgm3.divide(rhoF)))
    .rename('SnowSinkage_m');
// -------------------------------------------------------------------------
  return sinkageM.set({
    'snowClass': snowClassName,
    'groundPressureKPa': pressureKPa,
    'rho_f_kgm3': rhoF
  });
}

// ============================================================================
// Layer registry: maps the dropdown label to its band name, anchor palette,
// and whether it uses a fixed binary legend (Frozen / GoNoGo) or a dynamic
// discrete classification (everything else). The 'palette' field here is
// the ANCHOR palette; the actual colors used for both the map classification
// and the legend are derived per-band from getCustomEdges() via
// generatePaletteForBins() (used only as a length-mismatch fallback).
// ============================================================================

var LAYER_REGISTRY = {
  'RCI - Mean':                       {band: 'RCI_mean', palette: rciPalette, units: 'psi', fixed: false},
  'RCI - Dry Soil (5%)':         {band: 'RCI_p5',   palette: rciPalette, units: 'psi', fixed: false},
  'RCI - Wet Soil (95%)':        {band: 'RCI_p95',  palette: rciPalette, units: 'psi', fixed: false},
  'Frozen/Unfrozen Soil':             {band: 'Frozen',   palette: null,       units: '',    fixed: true, viz: frozenViz},
  'Snow Depth':                       {band: 'SnowDepth',palette: snowPalette,units: 'm',   fixed: false},
  'Snow Sinkage':                     {band: 'SnowSinkage_m', palette: sinkagePalette, units: 'm', fixed: false, isSinkage: true},
  'Gravimetric Soil Moisture - Mean': {band: 'GSM_mean', palette: gsmPalette, units: 'kg/kg', fixed: false},
  'Gravimetric Soil Moisture - Dry Year':  {band: 'GSM_p5',   palette: gsmPalette, units: 'kg/kg', fixed: false},
  'Gravimetric Soil Moisture - Wet Year':  {band: 'GSM_p95',  palette: gsmPalette, units: 'kg/kg', fixed: false},
  'Soil Temperature':                 {band: 'SoilTemp1_C', palette: soilTempPalette, units: 'degC', fixed: false},
  'Go/NoGo':                          {band: 'GoNoGo',   palette: null,       units: '',    fixed: true, viz: goNoGoViz}
};

var LAYER_NAMES = Object.keys(LAYER_REGISTRY);

// Percentile options used only to pick which RCI band drives Go/NoGo
var GONOGO_PERCENTILE_OPTIONS = {
  'Mean': 'RCI_mean',
  '5th Percentile (Dry Year)': 'RCI_p5',
  '95th Percentile (Wet Year)': 'RCI_p95'
};

// ============================================================================
// Custom bin edges per band (11 edges -> 10 bins for all five continuous
// layers). Used for BOTH the discrete map classification (classifyToBins)
// and the legend rendering, so both are always in exact agreement.
// ============================================================================

function getCustomEdges(bandName, minVal, maxVal) {
  switch (bandName) {
    case 'GSM_mean':
      return [0.00, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.37, Math.max(0.45, maxVal)];
    case 'GSM_p5':
      return [0.00, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.37, Math.max(0.45, maxVal)];
    case 'GSM_p95':
      return [0.00, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.37, Math.max(0.45, maxVal)];

    case 'SnowDepth':
      return [0, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.45, 0.60, 0.90, Math.max(1.50, maxVal)];

    case 'SnowSinkage_m':
      return [0, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.45, 0.60, 0.90, Math.max(1.50, maxVal)];

    case 'SoilTemp1_C':
      return [-10, -5, 0, 2, 5, 10, 15, 20, 25, 30, Math.max(35, maxVal)];

    case 'RCI_mean':
      return [0, 1, 10, 20, 30, 50, 200, 300, 500, 1000, Math.round(maxVal)];
    case 'RCI_p5':
      return [0, 1, 10, 20, 30, 50, 200, 300, 500, 1000, Math.round(maxVal)];
    case 'RCI_p95':
      return [0, 1, 10, 20, 30, 50, 200, 300, 500, 1000, Math.round(maxVal)];

    default:
      var step = (maxVal - minVal) / 10;
      var edges = [];
      for (var i = 0; i <= 10; i++) { edges.push(minVal + i * step); }
      return edges;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function pad(num) {
  return ('00' + num).slice(-3);
}

function doyToDateString(doy) {
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  var dayCount = 0;
  for (var m = 0; m < daysInMonth.length; m++) {
    if (doy <= dayCount + daysInMonth[m]) {
      return monthNames[m] + ' ' + (doy - dayCount);
    }
    dayCount += daysInMonth[m];
  }
  return 'Dec 31';
}

function generateXAxisTicks() {
  var ticks = [];
  for (var doy = 1; doy <= 366; doy += 32) {
    ticks.push({v: doy, f: doyToDateString(doy)});
  }
  return ticks;
}

// ============================================================================
// Load daily assets: RCI (3 bands), Gravimetric SM (3 bands), Snow, Soil Temp
// ============================================================================

function getDailyAssets(doy) {
  var doyStr = pad(doy);

  var rci = ee.Image(RCI_BASE_PATH + doyStr)
    .select([0, 1, 2])
    .rename(['RCI_mean', 'RCI_p5', 'RCI_p95']);

  var gsm = ee.Image(GSM_BASE_PATH + doyStr)
    .select([0, 1, 2])
    .rename(['GSM_mean', 'GSM_p5', 'GSM_p95']);

  var snow = ee.Image(SNOW_BASE_PATH + doyStr)
    .select([0]).rename('SnowDepth');

  var soilTempK = ee.Image(SOILT_BASE_PATH + doyStr).select([0]);
  var soilTempC = soilTempK.subtract(273.15).rename('SoilTemp1_C');

  return ee.Image.cat([rci, gsm, snow, soilTempC]);
}

// ============================================================================
// Customizable Go/No-Go rule engine
// ============================================================================
//
// Four conditions, each independently user-toggleable and threshold-adjustable:
//   1. Soil Temperature <= tempThreshold  (frozen soil)          [default 0 degC]
//   2. Snow Depth       <  snowThreshold                          [default 0.20 m]
//   3. Snow Sinkage     <  sinkageThreshold                       [default 0.20 m]
//   4. RCI (selected percentile) > rciThreshold                   [default 50 psi]
//
// The user selects which conditions are active (checkboxes) and how they are
// combined: 'AND' (all active conditions must be true) or 'OR' (any active
// condition being true is sufficient) for GO.
// ============================================================================

function evaluateGoNoGo(image, rules) {
  var soilTemp = image.select('SoilTemp1_C');
  var snow = image.select('SnowDepth');
  var sinkage = image.select('SnowSinkage_m');
  var rciSelected = image.select('RCI_selected');

  var conditions = [];

  if (rules.useTemp) {
    conditions.push(soilTemp.lte(rules.tempThreshold));
  }
  if (rules.useSnow) {
    conditions.push(snow.lt(rules.snowThreshold));
  }
  if (rules.useSinkage) {
    conditions.push(sinkage.lt(rules.sinkageThreshold));
  }
  if (rules.useRci) {
    conditions.push(rciSelected.gt(rules.rciThreshold));
  }

  if (conditions.length === 0) {
    return ee.Image(0).rename('GoNoGo');
  }

  var combined = conditions[0];
  for (var i = 1; i < conditions.length; i++) {
    combined = (rules.combineMode === 'AND')
      ? combined.and(conditions[i])
      : combined.or(conditions[i]);
  }

  return combined.rename('GoNoGo');
}

function describeGoNoGoRule(rules, goNoGoBandLabel) {
  var parts = [];
  if (rules.useTemp) {
    parts.push('Soil Temp \u2264 ' + rules.tempThreshold + ' degC');
  }
  if (rules.useSnow) {
    parts.push('Snow Depth < ' + rules.snowThreshold + ' m');
  }
  if (rules.useSinkage) {
    parts.push('Snow Sinkage < ' + rules.sinkageThreshold + ' m');
  }
  if (rules.useRci) {
    parts.push('RCI[' + goNoGoBandLabel + '] > ' + rules.rciThreshold + ' psi');
  }
  if (parts.length === 0) {
    return 'No active conditions selected - defaulting to No-Go.';
  }
  var joiner = ' ' + rules.combineMode + ' ';
  return 'GO if ' + parts.join(joiner);
}

// ============================================================================
// Build the full daily image: adds Frozen, SnowSinkage, and GoNoGo bands,
// using the user-selected RCI percentile band, snow class, ground pressure,
// and the full customizable Go/No-Go rule set.
// ============================================================================

function buildTrafficabilityImage(doy, rciBandForGoNoGo, snowClassName, pressureKPa, rules) {
  var base = getDailyAssets(doy);

  var soilTemp = base.select('SoilTemp1_C');
  var snow = base.select('SnowDepth');
  var rciSelected = base.select(rciBandForGoNoGo).rename('RCI_selected');

  var snowSinkage = computeSnowSinkage(snow, doy, snowClassName, pressureKPa);

  var frozen = soilTemp.lte(DEFAULT_FROZEN_THRESHOLD_C).rename('Frozen');

  var withExtra = base.addBands([frozen, snowSinkage, rciSelected]);
  var go = evaluateGoNoGo(withExtra, rules);

  return withExtra.addBands([go]).set('doy', doy);
}

// ============================================================================
// Dynamic min/max computation (still needed to define bin edges that scale
// with the actual data range for a given day/region) plus construction of
// the DISCRETE CLASSIFIED image and its matching palette. This replaces the
// old continuous-stretch getDynamicVisParams(): instead of handing back a
// {min, max, palette} for a linear gradient, it hands back a classified
// image (integer bin indices) and a palette with exactly one color per bin,
// so map.addLayer() renders discrete, legend-matching colors.
// ============================================================================

function getClassifiedLayer(image, bandName, anchorPalette, callback) {
  var stats = image.select(bandName).reduceRegion({
    reducer: ee.Reducer.minMax(),
    geometry: DISPLAY_REGION,
    scale: DISPLAY_SCALE,
    bestEffort: true,
    maxPixels: 1e13
  });

  stats.evaluate(function(result) {
    var minVal = 0;
    var maxVal = 1;

    if (result) {
      var lo = result[bandName + '_min'];
      var hi = result[bandName + '_max'];
      if (lo !== null && lo !== undefined) { minVal = lo; }
      if (hi !== null && hi !== undefined) { maxVal = hi; }
      if (minVal === maxVal) { maxVal = minVal + 0.0001; }
    }

    var edges = getCustomEdges(bandName, minVal, maxVal);
    var numBins = edges.length - 1;
    var stretchedPalette = generatePaletteForBins(numBins, anchorPalette);

    var classifiedImage = classifyToBins(image, bandName, edges);
    var classViz = {min: 0, max: numBins - 1, palette: stretchedPalette};

    callback(classifiedImage, classViz, {min: minVal, max: maxVal}, edges, stretchedPalette);
  });
}

// ============================================================================
// Legend helpers
// ============================================================================

function makeLegendRow(color, name) {
  var colorBox = ui.Label('', {
    backgroundColor: color, padding: '8px', margin: '0 0 4px 0', border: '1px solid #ccc'
  });
  var description = ui.Label(name, {margin: '0 0 4px 6px', fontSize: '10px'});
  return ui.Panel({widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal')});
}

// Discrete binned legend. vizParams.palette is expected to already be sized
// to numBins (via generatePaletteForBins()); if not, it is resampled here
// as a safety fallback so the legend never errors on a length mismatch.
// Because the map now uses classifyToBins() with this exact same edges
// array and this exact same palette, the legend and map are guaranteed to
// match color-for-color and bin-for-bin.
function makeBinnedLegend(title, vizParams, customEdges, note) {
  var panel = ui.Panel();
  panel.add(ui.Label(title, {fontSize: '12px', fontWeight: 'bold', margin: '0 0 6px 0'}));

  var edges = customEdges;
  var numBins = edges.length - 1;

  var colors = (vizParams.palette.length === numBins)
    ? vizParams.palette
    : generatePaletteForBins(numBins, vizParams.palette);

  for (var b = numBins - 1; b >= 0; b--) {
    var lo = edges[b];
    var hi = edges[b + 1];
    var color = colors[b];

    var colorBox = ui.Label({
      style: {
        backgroundColor: color,
        padding: '8px',
        margin: '0 6px 2px 0'
      }
    });

    var rangeLabel = ui.Label({
      value: lo.toFixed(2) + ' - ' + hi.toFixed(2),
      style: {fontSize: '10px', margin: '0 0 2px 0'}
    });

    panel.add(ui.Panel({
      widgets: [colorBox, rangeLabel],
      layout: ui.Panel.Layout.Flow('horizontal')
    }));
  }

  if (note) {
    panel.add(ui.Label(note, {fontSize: '10px', color: '#444', margin: '4px 0 0 0'}));
  }

  return panel;
}

function updateLegend(layerLabel, customEdges, stretchedPalette, rules, goNoGoBandLabel) {
  legendContainer.clear();
  var meta = LAYER_REGISTRY[layerLabel];

  if (meta.fixed) {
    if (meta.band === 'Frozen') {
      legendContainer.add(ui.Label('Frozen Soil', {fontSize: '12px', fontWeight: 'bold', margin: '0 0 6px 0'}));
      legendContainer.add(makeLegendRow('#8c510a', 'Not frozen (> 0 degC)'));
      legendContainer.add(makeLegendRow('#00ffff', 'Frozen (<= 0 degC)'));
    } else if (meta.band === 'GoNoGo') {
      legendContainer.add(ui.Label('Trafficability', {fontSize: '12px', fontWeight: 'bold', margin: '0 0 6px 0'}));
      legendContainer.add(makeLegendRow('red', 'No-Go'));
      legendContainer.add(makeLegendRow('green', 'Go'));
      legendContainer.add(ui.Label(
        describeGoNoGoRule(rules, goNoGoBandLabel),
        {fontSize: '10px', fontWeight: 'bold', backgroundColor: '#eaffea', padding: '4px', margin: '6px 0 0 0'}
      ));
    }
    return;
  }

  var unitLabel = meta.units ? (' (' + meta.units + ')') : '';

  var sinkageNote = null;
  if (meta.isSinkage) {
    sinkageNote = 'Snow class: ' + snowClassSelect.getValue() +
      ' | Ground pressure: ' + groundPressureSelect.getValue();
  }

  legendContainer.add(makeBinnedLegend(
    layerLabel + unitLabel,
    {palette: stretchedPalette},
    customEdges,
    sinkageNote
  ));
}

// ============================================================================
// Single fixed left-side control panel
// ============================================================================

var leftPanel = ui.Panel({
  style: {
    width: '360px',
    height: '820px',
    padding: '10px',
    position: 'top-left',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    border: '2px solid #333',
    maxHeight: '100%',
    stretch: 'vertical'
  }
});

leftPanel.add(ui.Label('Terrain Trafficability Explorer', {
  fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', margin: '0 0 6px 0'
}));
leftPanel.add(ui.Label('Daily Go/No-Go Terrain Trafficability from Soil moisture/Temperature, Snow Depth, and Snow Sinkage.', {
  fontSize: '10px', color: '#666', margin: '0 0 10px 0'
}));
leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '2px 0 8px 0'}));

function collapsible(title, content) {
  var open = false;
  content.style().set('shown', false);
  var header = ui.Button({label: '\u25b8  ' + title,
                          style: {stretch: 'horizontal', margin: '2px 0', color: '444444'}});
  header.onClick(function() {
    open = !open;
    content.style().set('shown', open);
    header.setLabel((open ? '\u25be  ' : '\u25b8  ') + title);
  });
  return ui.Panel([header, content]);
}
function note(text, bold, top) {
  return ui.Label(text, {fontSize: '11px', margin: (top ? '6px' : '1px') + ' 0 0 4px',
                         fontWeight: bold ? 'bold' : 'normal'});
}

var helpContent = ui.Panel([
  note('Terrain Trafficability Explorer', true, true),
  note('Terrain Trafficability Explorer is an interactive Google Earth' +
  ' Engine application for assessing seasonal ground trafficability' +
  ' across the western US. It combines a texture-based Rating' +
  ' Cone Index (RCI), computed from Western Land Data Assimilation System' +
  ' (WLDAS) climatological soil moisture and per-texture-class bulk density,' +
  ' with snow depth, snow sinkage, and soil temperature to classify daily' +
  ' Go/No-Go mobility conditions for any day of the year (DOY 1-366).'),
  note(' Link to Western Land Data Assimilation System data:' +
  ' https://portal.nccs.nasa.gov/datashare/WLDAS_css/wldas_domain/'),
  note('Users can toggle between climatological mean, dry (5th percentile)' +
  ' , and wet (95th percentile) soil-moisture and RCI conditions, select a' +
  ' snow class and vehicle ground pressure to compute Snow Sinkage (Sturm' +
  ' et al., 2010), fully customize the Go/No-Go rule (which conditions are' +
  ' active, their thresholds, and whether they combine with AND or OR),' +
  ' and click anywhere on the map to generate a full annual time series of' +
  ' RCI, gravimetric soil moisture, snow depth, snow sinkage, soil' +
  ' temperature, and Go/No-Go at that location.'),
  note('How to Use This Tool', true, true),
  note('1. Move the Date slider to pick a day of year (1-366).'),
  note('2. Choose a Display Layer: RCI (mean/dry/wet), Gravimetric Soil' +
  ' Moisture (mean/dry/wet), Snow Depth, Snow Sinkage, Soil Temperature,' +
  ' Frozen Soil, or Go/No-Go.'),
  note('3. Select a Snow Class and Ground Pressure to compute Snow Sinkage.'),
  note('4. In the Go/No-Go Rule Builder, check which conditions are active' +
  ' (Soil Temperature, Snow Depth, Snow Sinkage, RCI), set each threshold,' +
  ' and choose AND (all active conditions must hold) or OR (any one is' +
  ' sufficient) to combine them.'),
  note('5. Click "Show Go/No-Go Map" for the full trafficability map.'),
  note('6. Click any point on the map (or type Lat/Lon) to plot a full' +
  ' 365-day climatology of RCI, soil moisture, snow depth (with snow' +
  ' sinkage on a secondary axis), soil temperature, and Go/No-Go at that' +
  ' location.'),
   note('Snow Sinkage model (Sturm et al., 2010):', true, true),
   note('Snow Sinkage (m) = SnowDepth (m) * [1 - (rho_0 / rho_f)], where' +
  ' rho_0 is the snow-class initial density and rho_f = min(0.917,' +
  ' 0.519 + 0.0023*P) * 1000 kg/m3, with P the selected vehicle ground' +
  ' pressure (kPa).')//,
   //note('Discrete Classified Map Rendering:', true, true),
   //note('All continuous layers (RCI, Gravimetric Soil Moisture, Snow Depth,' +
  //' Snow Sinkage, Soil Temperature) are displayed as discrete classified' +
  //' maps: each pixel is assigned to one of 10 custom bins and colored with' +
  //' exactly the corresponding legend color, instead of a continuous' +
  //' min/max gradient stretch. This guarantees the map colors always match' +
  //' the legend swatches exactly.')
]);

leftPanel.add(collapsible('Help', helpContent));
// ---- Day slider ----
leftPanel.add(ui.Label('Select Date (Jan 1 - Dec 31):', {fontSize: '12px', fontWeight: 'bold', margin: '5px 0'}));
var daySlider = ui.Slider({
  min: 1, max: 366, value: 1, step: 1,
  onChange: function(value) { updateMapLayer(); },
  style: {width: '100%', padding: '5px 0'}
});
leftPanel.add(daySlider);
var dayDisplay = ui.Label('Jan 1 (DOY: 001)', {fontSize: '11px', color: '#666', margin: '3px 0 10px 0'});
leftPanel.add(dayDisplay);

// ---- Percentile used for RCI condition ----
leftPanel.add(ui.Label('RCI Percentile for Go/No-Go:', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));
var percentileSelect = ui.Select({
  items: Object.keys(GONOGO_PERCENTILE_OPTIONS),
  value: 'Mean',
  onChange: function() { updateMapLayer(); },
  style: {width: '100%', margin: '3px 0 10px 0'}
});
leftPanel.add(percentileSelect);

// ---- Snow class selector (Sturm et al., 2010) ----
leftPanel.add(ui.Label('Snow Class (Sturm et al., 2010):', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));
var snowClassSelect = ui.Select({
  items: SNOW_CLASS_NAMES,
  value: 'Alpine',
  onChange: function() { updateMapLayer(); },
  style: {width: '100%', margin: '3px 0 10px 0'}
});
leftPanel.add(snowClassSelect);

// ---- Ground pressure / vehicle selector ----
leftPanel.add(ui.Label('Vehicle Ground Pressure:', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));
var groundPressureSelect = ui.Select({
  items: GROUND_PRESSURE_LABELS,
  value: '100 kPa (Over-snow heavy vehicle)',
  onChange: function() { updateMapLayer(); },
  style: {width: '100%', margin: '3px 0 10px 0'}
});
leftPanel.add(groundPressureSelect);

// ============================================================================
// Go/No-Go Rule Builder (fully customizable): checkboxes to enable each
// condition, textboxes for thresholds, and an AND/OR combination selector.
// ============================================================================

leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '5px 0 5px 0'}));
leftPanel.add(ui.Label('Go/No-Go Rule Builder:', {fontSize: '13px', fontWeight: 'bold', margin: '3px 0 6px 0'}));

function makeRuleRow(checkboxLabel, defaultChecked, defaultValue, unitLabel) {
  var checkbox = ui.Checkbox({label: checkboxLabel, value: defaultChecked,
    onChange: function() { updateMapLayer(); },
    style: {fontSize: '11px', margin: '2px 4px 2px 0'}});
  var textbox = ui.Textbox({value: String(defaultValue),
    onChange: function() { updateMapLayer(); },
    style: {width: '70px', margin: '0 4px'}});
  var unit = ui.Label(unitLabel, {fontSize: '10px', color: '#666', margin: '4px 0 0 0'});
  var row = ui.Panel({
    widgets: [checkbox, textbox, unit],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {margin: '2px 0'}
  });
  return {row: row, checkbox: checkbox, textbox: textbox};
}

var tempRule = makeRuleRow('Soil Temp \u2264', false, DEFAULT_FROZEN_THRESHOLD_C, 'degC');
leftPanel.add(tempRule.row);

var snowRule = makeRuleRow('Snow Depth <', false, DEFAULT_SNOW_THRESHOLD_M, 'm');
leftPanel.add(snowRule.row);

var sinkageRule = makeRuleRow('Snow Sinkage <', false, DEFAULT_SINKAGE_THRESHOLD_M, 'm');
leftPanel.add(sinkageRule.row);

var rciRule = makeRuleRow('RCI[selected] >', true, DEFAULT_RCI_THRESHOLD, 'psi');
leftPanel.add(rciRule.row);

leftPanel.add(ui.Label('Combine Active Conditions With:', {fontSize: '11px', fontWeight: 'bold', margin: '6px 0 3px 0'}));
var combineModeSelect = ui.Select({
  items: ['OR', 'AND'],
  value: 'OR',
  onChange: function() { updateMapLayer(); },
  style: {width: '100%', margin: '0 0 8px 0'}
});
leftPanel.add(combineModeSelect);

function getCurrentRules() {
  var tempThreshold = parseFloat(tempRule.textbox.getValue());
  if (isNaN(tempThreshold)) { tempThreshold = DEFAULT_FROZEN_THRESHOLD_C; }

  var snowThreshold = parseFloat(snowRule.textbox.getValue());
  if (isNaN(snowThreshold)) { snowThreshold = DEFAULT_SNOW_THRESHOLD_M; }

  var sinkageThreshold = parseFloat(sinkageRule.textbox.getValue());
  if (isNaN(sinkageThreshold)) { sinkageThreshold = DEFAULT_SINKAGE_THRESHOLD_M; }

  var rciThreshold = parseFloat(rciRule.textbox.getValue());
  if (isNaN(rciThreshold)) { rciThreshold = DEFAULT_RCI_THRESHOLD; }

  return {
    useTemp: tempRule.checkbox.getValue(),
    tempThreshold: tempThreshold,
    useSnow: snowRule.checkbox.getValue(),
    snowThreshold: snowThreshold,
    useSinkage: sinkageRule.checkbox.getValue(),
    sinkageThreshold: sinkageThreshold,
    useRci: rciRule.checkbox.getValue(),
    rciThreshold: rciThreshold,
    combineMode: combineModeSelect.getValue()
  };
}

// ---- Layer to display on the map ----
leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '5px 0 5px 0'}));
leftPanel.add(ui.Label('Display Layer:', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));
var layerSelect = ui.Select({
  items: LAYER_NAMES,
  value: 'Go/NoGo',
  onChange: function() { updateMapLayer(); },
  style: {width: '100%', margin: '3px 0 10px 0'}
});
leftPanel.add(layerSelect);

leftPanel.add(ui.Button({
  label: 'Show Go/No-Go Map',
  onClick: function() { layerSelect.setValue('Go/NoGo', true); },
  style: {margin: '3px 0 10px 0', width: '100%'}
}));

var statusLabel = ui.Label('Initializing...', {fontSize: '10px', color: '#666', margin: '3px 0'});

// ============================================================================
// Map update
// ============================================================================

var currentLayer = null;

function updateMapLayer() {
  try {
    var doy = daySlider.getValue();
    var doyStr = pad(doy);
    var dateStr = doyToDateString(doy);
    var layerLabel = layerSelect.getValue();
    var meta = LAYER_REGISTRY[layerLabel];

    var goNoGoBandLabel = percentileSelect.getValue();
    var goNoGoBandName = GONOGO_PERCENTILE_OPTIONS[goNoGoBandLabel];

    var snowClassName = snowClassSelect.getValue();
    var pressureKPa = GROUND_PRESSURE_OPTIONS[groundPressureSelect.getValue()];

    var rules = getCurrentRules();

    dayDisplay.setValue(dateStr + ' (DOY: ' + doyStr + ')');

    if (currentLayer !== null) {
      try { map.layers().remove(currentLayer); } catch (e) {}
    }

    var dailyImage = buildTrafficabilityImage(doy, goNoGoBandName, snowClassName, pressureKPa, rules);

    if (meta.fixed) {
      currentLayer = map.addLayer(dailyImage.select(meta.band), meta.viz, layerLabel + ' ' + dateStr, true);
      updateLegend(layerLabel, null, meta.viz.palette, rules, goNoGoBandLabel);
      statusLabel.setValue('Loaded ' + layerLabel + ' for ' + dateStr);
      return;
    }

    statusLabel.setValue('Computing classification for ' + layerLabel + '...');
    getClassifiedLayer(dailyImage, meta.band, meta.palette, function(classifiedImage, classViz, stats, edges, stretchedPalette) {
      if (currentLayer !== null) {
        try { map.layers().remove(currentLayer); } catch (e) {}
      }
      currentLayer = map.addLayer(classifiedImage, classViz, layerLabel + ' ' + dateStr, true);
      updateLegend(layerLabel, edges, stretchedPalette, rules, goNoGoBandLabel);
      statusLabel.setValue('Loaded ' + layerLabel + ' for ' + dateStr +
        ' | data min=' + stats.min.toFixed(3) + ', max=' + stats.max.toFixed(3) +
        ' | ' + (edges.length - 1) + ' bins (classified)');
    });

  } catch (e) {
    statusLabel.setValue('Error loading date: ' + e.message.slice(0, 60));
    print('Error loading layer:', e);
  }
}

// ============================================================================
// Point click / coordinate entry for time series
// ============================================================================

leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '5px 0 5px 0'}));
leftPanel.add(ui.Label('Click on Map to Extract Time Series:', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));

var clickButton = ui.Button({
  label: 'Activate Click Mode ( Wait ~20s after click)',
  onClick: function() {
    statusLabel.setValue('Click on map to select a point...');
    clickButton.setDisabled(true);
    clickButton.setLabel('Click Mode Active');
    map.onClick(handleMapClick);
  },
  style: {margin: '3px 0', width: '100%', backgroundColor: '#4CAF50', color: 'black'}
});
leftPanel.add(clickButton);

var selectedPoint = null;
var chartPanel = null;

function handleMapClick(coordinates) {
  try {
    selectedPoint = ee.Geometry.Point([coordinates.lon, coordinates.lat]);
    statusLabel.setValue('Point selected. Extracting time series...');
    map.unlisten();
    clickButton.setDisabled(false);
    clickButton.setLabel('Activate Click Mode');
    extractTimeSeriesAtPoint(selectedPoint);
  } catch (e) {
    statusLabel.setValue('Error processing click');
    print('Error in handleMapClick:', e);
  }
}

leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '5px 0 5px 0'}));
leftPanel.add(ui.Label('Or Enter Coordinates:', {fontSize: '12px', fontWeight: 'bold', margin: '3px 0'}));

var latPanel = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '5px 0'}});
latPanel.add(ui.Label('Latitude:', {width: '80px'}));
var latInput = ui.Textbox({placeholder: 'e.g., 40.0'});
latInput.style().set({width: '120px'});
latPanel.add(latInput);
leftPanel.add(latPanel);

var lonPanel = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '3px 0'}});
lonPanel.add(ui.Label('Longitude:', {width: '80px'}));
var lonInput = ui.Textbox({placeholder: 'e.g., -110.0'});
lonInput.style().set({width: '120px'});
lonPanel.add(lonInput);
leftPanel.add(lonPanel);

leftPanel.add(ui.Button({
  label: 'Extract Time Series',
  onClick: function() {
    try {
      var lat = parseFloat(latInput.getValue());
      var lon = parseFloat(lonInput.getValue());
      if (isNaN(lat) || isNaN(lon)) {
        statusLabel.setValue('Invalid coordinates');
        return;
      }
      selectedPoint = ee.Geometry.Point([lon, lat]);
      statusLabel.setValue('Processing time series for ' + lat.toFixed(2) + ', ' + lon.toFixed(2));
      extractTimeSeriesAtPoint(selectedPoint);
    } catch (e) {
      statusLabel.setValue('Error processing coordinates');
      print('Error in submitCoordButton:', e);
    }
  },
  style: {margin: '3px 0', width: '100%', backgroundColor: '#2196F3', color: 'black'}
}));

// ============================================================================
// Time series extraction (uses the currently selected RCI percentile, snow
// class, ground pressure, and the full customizable Go/No-Go rule set;
// Snow Depth and Snow Sinkage are charted together on a secondary axis).
// Note: time series values are the raw continuous values (not classified),
// since charts should show actual magnitudes, not bin indices.
// ============================================================================

function extractTimeSeriesAtPoint(point) {
  try {
    var pointCoords = point.coordinates().getInfo();
    var pointLat = pointCoords[1];
    var pointLon = pointCoords[0];

    var goNoGoBandLabel = percentileSelect.getValue();
    var goNoGoBandName = GONOGO_PERCENTILE_OPTIONS[goNoGoBandLabel];

    var snowClassName = snowClassSelect.getValue();
    var groundPressureLabel = groundPressureSelect.getValue();
    var pressureKPa = GROUND_PRESSURE_OPTIONS[groundPressureLabel];

    var rules = getCurrentRules();

    var features = [];
    for (var doy = 1; doy <= 366; doy++) {
      var dailyImage = buildTrafficabilityImage(doy, goNoGoBandName, snowClassName, pressureKPa, rules);

      var vals = dailyImage.reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: point,
        scale: 1113,
        bestEffort: true
      });

      features.push(ee.Feature(null, {
        'Day': doy,
        'Date': doyToDateString(doy),
        'RCI(mean \u03b8g)': vals.get('RCI_mean'),
        'RCI(5% \u03b8g: Dry Year)': vals.get('RCI_p5'),
        'RCI(95% \u03b8g: Wet Year)': vals.get('RCI_p95'),
        'mean \u03b8g': vals.get('GSM_mean'),
        '5% \u03b8g: Dry Year': vals.get('GSM_p5'),
        '95% \u03b8g: Wet Year': vals.get('GSM_p95'),
        'Snow Depth': vals.get('SnowDepth'),
        'Snow Sinkage': vals.get('SnowSinkage_m'),
        'Soil Temperature': vals.get('SoilTemp1_C'),
        'Frozen': vals.get('Frozen'),
        'Go': vals.get('GoNoGo')
      }));
    }

    var timeSeries = ee.FeatureCollection(features);

    if (chartPanel !== null) {
      try { map.remove(chartPanel); } catch (e) {}
    }

    var rciChart = ui.Chart.feature.byFeature(timeSeries, 'Day', ['RCI(mean \u03b8g)', 'RCI(5% \u03b8g: Dry Year)', 'RCI(95% \u03b8g: Wet Year)'])
      .setChartType('LineChart')
      .setOptions({
        title: 'Daily Climatological RCI - Lat: ' + pointLat.toFixed(4) + ', Lon: ' + pointLon.toFixed(4),
        hAxis: {ticks: generateXAxisTicks()},
        vAxis: {title: 'RCI (psi)', minValue: 0},
        series: {0: {color: '#2ca02c'}, 1: {color: '#d62728'}, 2: {color: '#1f77b4'}},
        pointSize: 1
      });

    var gsmChart = ui.Chart.feature.byFeature(timeSeries, 'Day', ['mean \u03b8g', '5% \u03b8g: Dry Year', '95% \u03b8g: Wet Year'])
      .setChartType('LineChart')
      .setOptions({
        title: 'Daily Climatological Gravimetric Soil Moisture',
        hAxis: {ticks: generateXAxisTicks()},
        vAxis: {title: '\u03b8g (kg/kg)', minValue: 0},
        series: {0: {color: '#2ca02c', lineWidth: 2}, 1: {color: '#d62728'}, 2: {color: '#1f77b4'}}
      });

    var snowSinkageChart = ui.Chart.feature.byFeature(timeSeries, 'Day', ['Snow Depth', 'Snow Sinkage'])
      .setChartType('LineChart')
      .setOptions({
        title: 'Daily Climatological Snow Depth and Snow Sinkage (' +
               snowClassName + ' snow, ' + groundPressureLabel + ')',
        hAxis: {ticks: generateXAxisTicks()},
        vAxes: {
          0: {title: 'Snow Depth (m)', minValue: 0},
          1: {title: 'Snow Sinkage (m)', minValue: 0}
        },
        series: {
          0: {color: '#225ea8', lineWidth: 2, targetAxisIndex: 0},
          1: {color: '#d95f0e', lineWidth: 2, lineDashStyle: [4, 2], targetAxisIndex: 1}
        }
      });

    var tempChart = ui.Chart.feature.byFeature(timeSeries, 'Day', 'Soil Temperature')
      .setChartType('LineChart')
      .setOptions({
        title: 'Daily Climatological Soil Temperature',
        hAxis: {ticks: generateXAxisTicks()},
        vAxis: {title: 'Soil Temperature (degC)'},
        series: {0: {color: '#d73027', lineWidth: 2}},
        legend: 'none'
      });

    var goNoGoChart = ui.Chart.feature.byFeature(timeSeries, 'Day', 'Go')
      .setChartType('ColumnChart')
      .setOptions({
        title: 'Daily Climatological Go / No-Go (' + describeGoNoGoRule(rules, goNoGoBandLabel) + ')',
        hAxis: {ticks: generateXAxisTicks()},
        vAxis: {title: '0 = No-Go, 1 = Go', viewWindow: {min: 0, max: 1}},
        series: {0: {color: 'green',lineWidth: 0.5}},
        legend: 'none',
        bar: {groupWidth: '20%'}
      });

    chartPanel = ui.Panel({
      style: {
        width: '720px', height: '90%', position: 'top-right',
        backgroundColor: 'rgba(255, 255, 255, 0.98)', border: '2px solid #333',
        padding: '10px',  maxHeight: '90%', stretch: 'vertical'
      }
    });

    chartPanel.add(ui.Button({
      label: 'X',
      onClick: function() {
        try { map.remove(chartPanel); chartPanel = null; } catch (e) {}
      },
      style: {margin: '0 0 0 0', width: '8%'}
    }));
    chartPanel.add(ui.Label('Trafficability Time Series', {fontSize: '14px', fontWeight: 'bold', margin: '0 0 5px 0'}));

    chartPanel.add(ui.Label(
      'Latitude: ' + pointLat.toFixed(4) + ' | Longitude: ' + pointLon.toFixed(4) +
      ' | ' + describeGoNoGoRule(rules, goNoGoBandLabel),
      {fontSize: '10px', color: '#666', margin: '0 0 8px 0'}
    ));

    chartPanel.add(rciChart);
    chartPanel.add(gsmChart);
    chartPanel.add(snowSinkageChart);
    chartPanel.add(tempChart);
    chartPanel.add(goNoGoChart);



    map.add(chartPanel);
    statusLabel.setValue('Time series extracted');
  } catch (e) {
    statusLabel.setValue('Error extracting time series');
    print('Error in extractTimeSeriesAtPoint:', e);
  }
}

// ============================================================================
// Status label + legend section (folded into the same left panel)
// ============================================================================

leftPanel.add(ui.Label('', {height: '2px', backgroundColor: '#ddd', margin: '10px 0 10px 0'}));
leftPanel.add(statusLabel);

leftPanel.add(ui.Label('', {height: '1px', backgroundColor: '#ddd', margin: '8px 0 8px 0'}));
leftPanel.add(ui.Label('Legend:', {fontSize: '12px', fontWeight: 'bold', margin: '0 0 4px 0'}));
var legendContainer = ui.Panel();
leftPanel.add(legendContainer);

//Map.add(leftPanel);


// ============================================================================
// Initial load
// ============================================================================
updateMapLayer();
map.style().set('cursor', 'crosshair');
map.setControlVisibility({
  all: true,
  zoomControl: true,
  scaleControl: true,
  fullscreenControl: true,
  drawingToolsControl: false,
  layerList: true
});

// ------------------------------------------------------------------ map + panels
ui.root.clear();
ui.root.add(ui.SplitPanel({firstPanel: leftPanel, secondPanel: map}));



// ============================================================================
// Console output
// ============================================================================

print('========================================');
print('Trafficability Analysis Tool');
print('Layers: RCI (mean/dry/wet), Gravimetric SM (mean/dry/wet), Snow Depth,');
print('Snow Sinkage, Soil Temperature, Frozen/Unfrozen, Go/NoGo');
print('All continuous layers use DISCRETE CLASSIFICATION (10 custom bins),');
print('not a continuous linear stretch, so map colors always match the legend.');
print('Go/No-Go rule is fully customizable: toggle Soil Temperature, Snow');
print('Depth, Snow Sinkage, and RCI conditions on/off, set their thresholds,');
print('and combine active conditions with AND or OR logic in the left panel.');
print('========================================');
}


// ---------------------------------------------------------------------
// 2. Build login UI
// ---------------------------------------------------------------------
var messageLabel = ui.Label('', {color: 'red', margin: '8px 0 0 0'});

var passwordBox = ui.Textbox({
  placeholder: 'Enter password',
  style: {width: '220px'}
});

// Optional: press Enter to log in
passwordBox.onChange(function(value) {
  // onChange fires when Enter is pressed or focus changes
});

var loginButton = ui.Button({
  label: 'Login',
  onClick: function() {
    if (passwordBox.getValue() === 'frozensoil2026') {
      buildMainApp();
    } else {
      passwordBox.setValue('');
      messageLabel.setValue('Incorrect password');
    }
  }
});

var loginPanel = ui.Panel({
  widgets: [
    ui.Label('Protected App', {
      fontWeight: 'bold',
      fontSize: '18px',
      margin: '0 0 8px 0'
    }),
    ui.Label('Enter the password to continue.', {
      margin: '0 0 8px 0'
    }),
    passwordBox,
    loginButton,
    messageLabel
  ],
  layout: ui.Panel.Layout.flow('vertical'),
  style: {
    width: '300px',
    padding: '20px',
    position: 'top-center'
  }
});

// ---------------------------------------------------------------------
// 3. Show login FIRST, not main app
// ---------------------------------------------------------------------
ui.root.clear();
ui.root.setLayout(ui.Panel.Layout.absolute());
ui.root.add(loginPanel);
