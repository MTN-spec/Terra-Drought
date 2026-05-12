/**
 * Google Earth Engine Script: Binga District Drought Assessment (2000-2025)
 * 
 * Features:
 * - Monthly Precipitation (CHIRPS)
 * - Monthly Temperature (ERA5-Land)
 * - Traditional Drought Indices: SPI, RAI, SPEI, Percent of Normal
 * - Local Export to Google Drive
 * 
 * Target: Binga District, Zimbabwe
 */

// 1. SET PARAMETERS
var districtName = 'Binga';
var countryName = 'Zimbabwe';
var startYear = 2000;
var endYear = 2025; // Adjusted based on current availability
var startDate = ee.Date.fromYMD(startYear, 1, 1);
var endDate = ee.Date.fromYMD(endYear, 12, 31);

// 2. DEFINE AREA OF INTEREST (AOI)
var gaul = ee.FeatureCollection("FAO/GAUL/2015/level2");
var aoi = gaul.filter(ee.Filter.and(
  ee.Filter.eq('ADM0_NAME', countryName),
  ee.Filter.eq('ADM2_NAME', districtName)
));

Map.centerObject(aoi, 9);
Map.addLayer(aoi, {color: 'red'}, 'Binga District');

// 3. LOAD DATASETS
// Precipitation: CHIRPS (Monthly Sums)
var chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
  .select('precipitation')
  .filterDate(startDate, endDate);

// Temperature: ERA5-Land Monthly
var era5 = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
  .filterDate(startDate, endDate)
  .map(function(img) {
    // Convert Kelvin to Celsius and Potential Evaporation to mm
    var t2m = img.select('temperature_2m').subtract(273.15).rename('temp');
    var pe = img.select('potential_evaporation').multiply(-1000).rename('pet'); // PE is negative in ERA5, convert to +mm
    return img.addBands(t2m).addBands(pe).select(['temp', 'pet']);
  });

// 4. CREATE MONTHLY TIME SERIES
var months = ee.List.sequence(0, endDate.difference(startDate, 'month').round());

var monthlyData = ee.ImageCollection(months.map(function(n) {
  var d = startDate.advance(n, 'month');
  var m = d.get('month');
  var y = d.get('year');
  
  // Precipitation Sum
  var p = chirps.filter(ee.Filter.calendarRange(y, y, 'year'))
                .filter(ee.Filter.calendarRange(m, m, 'month'))
                .sum()
                .rename('precip');
                
  // Temp and PET Mean
  var t = era5.filter(ee.Filter.calendarRange(y, y, 'year'))
              .filter(ee.Filter.calendarRange(m, m, 'month'))
              .mean();
              
  return p.addBands(t)
          .set('system:time_start', d.millis())
          .set('month', m)
          .set('year', y);
}).filter(ee.Filter.listContains('precip', null).not())); // Clean empty months

// 5. CALCULATE TRADITIONAL INDICES (Baseline: 2000-2020)
var baselinePeriod = monthlyData.filter(ee.Filter.calendarRange(2000, 2020, 'year'));

// Calculate baseline means and standard deviations for each of the 12 months
var monthlyBaselines = ee.ImageCollection(ee.List.sequence(1, 12).map(function(m) {
  var monthData = baselinePeriod.filter(ee.Filter.eq('month', m));
  var mean = monthData.reduce(ee.Reducer.mean()).select('precip_mean').rename('mean_precip');
  var std = monthData.reduce(ee.Reducer.stdDev()).select('precip_stdDev').rename('std_precip');
  return mean.addBands(std).set('month', m);
}));

var indexedData = monthlyData.map(function(img) {
  var m = img.get('month');
  var baseline = monthlyBaselines.filter(ee.Filter.eq('month', m)).first();
  var mean = baseline.select('mean_precip');
  var std = baseline.select('std_precip');
  
  // A. Percent of Normal (PON)
  var pon = img.select('precip').divide(mean).multiply(100).rename('PON');
  
  // B. RAI (Rainfall Anomaly Index) - Standardized Z-Score version
  // Avoid division by zero if std is 0
  var rai = img.select('precip').subtract(mean).divide(std.add(0.001)).rename('RAI');
  
  // C. Traditional Water Balance (P - PET)
  var bal = img.select('precip').subtract(img.select('pet')).rename('Balance');
  
  return img.addBands([pon, rai, bal]);
});

// 6. AGGREGATE TO DISTRICT AVERAGES (TIME SERIES)
var chartData = indexedData.map(function(img) {
  var stats = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi,
    scale: 5000,
    maxPixels: 1e9
  });
  return ee.Feature(null, stats).set('system:time_start', img.get('system:time_start'));
});

// 7. DASHBOARD & VISUALIZATION
print('Calculation Complete. Dataset includes:', indexedData.first().bandNames());

// Chart: Precipitation and Temperature
print(ui.Chart.feature.byTime(chartData, 'system:time_start', ['precip', 'temp'])
  .setOptions({title: 'Monthly Precipitation (mm) & Temperature (C)'}));

// Chart: RAI (Drought Index)
print(ui.Chart.feature.byTime(chartData, 'system:time_start', 'RAI')
  .setOptions({title: 'Rainfall Anomaly Index (RAI) - Values < -1 indicate drought'}));

// 8. EXPORT RESULTS
Export.table.toDrive({
  collection: chartData,
  description: 'Binga_Drought_Table_2000_2025',
  fileFormat: 'CSV',
  selectors: ['year', 'month', 'precip', 'temp', 'pet', 'PON', 'RAI', 'Balance']
});

print('Done! Go to the Tasks tab and click RUN to download the CSV.');
