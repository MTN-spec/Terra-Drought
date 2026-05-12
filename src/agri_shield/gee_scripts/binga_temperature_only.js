/**
 * Google Earth Engine Script: Binga District Temperature CSV Export (2000-2025)
 * 
 * Target: Binga District, Zimbabwe
 * Output: Monthly Average Temperature (Celsius) exported as a CSV to Google Drive.
 */

// 1. DEFINE PARAMETERS
var district = 'Binga';
var country = 'Zimbabwe';
var start = '2000-01-01';
var end = '2025-12-31';

// 2. DEFINE AREA OF INTEREST (AOI)
var aoi = ee.FeatureCollection("FAO/GAUL/2015/level2")
  .filter(ee.Filter.and(
    ee.Filter.eq('ADM0_NAME', country),
    ee.Filter.eq('ADM2_NAME', district)
  ));

// Visualize area on the map
Map.centerObject(aoi, 9);
Map.addLayer(aoi, {color: 'FF0000'}, 'Binga District');

// 3. LOAD TEMPERATURE DATA (ERA5-Land Monthly)
var tempCol = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
  .filterDate(start, end)
  .select('temperature_2m');

// 4. PROCESS: Convert Kelvin to Celsius and calculate District Mean per Month
var monthlyFeatures = tempCol.map(function(image) {
  // Convert K to C
  var celsius = image.subtract(273.15).rename('temp_celsius');
  
  // Calculate average for the district
  var stats = celsius.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi.geometry(),
    scale: 11132, // ERA5-Land native resolution is ~0.1 deg (~11km)
    maxPixels: 1e9
  });
  
  // Create a result feature
  var date = ee.Date(image.get('system:time_start'));
  return ee.Feature(null, stats)
    .set('year', date.get('year'))
    .set('month', date.get('month'))
    .set('system:time_start', image.get('system:time_start'));
});

// 5. PRINT PREVIEW (To ensure it's working before downloading)
print('Preview of first few months:', monthlyFeatures.limit(5));

// 6. EXPORT TO GOOGLE DRIVE (CSV)
// Note: This will create a Task in the 'Tasks' tab on the right.
Export.table.toDrive({
  collection: monthlyFeatures,
  description: 'Binga_Temperature_2000_2025',
  fileFormat: 'CSV',
  selectors: ['year', 'month', 'temp_celsius']
});

print('STEP TO DOWNLOAD:');
print('1. Look at the right-hand panel.');
print('2. Click the "Tasks" tab.');
print('3. Click "RUN" next to Binga_Temperature_2000_2025.');
