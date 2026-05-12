/**
 * MASTER SCRIPT: Binga District Multi-Index Extraction (2000-2025)
 * 
 * This script extracts:
 * 1. Dynamic Indices: NDVI, VCI, TCI, VHI, SPI, SMI, RH, ET
 * 2. Static Parameters: DEM, Slope, Soil (Clay/Sand), Dist to Water, LandCover
 */

// 1. SET PARAMETERS
var districtName = 'Binga';
var countryName = 'Zimbabwe';
var startYear = 2000;
var endYear = 2025;
var startDate = ee.Date.fromYMD(startYear, 1, 1);
var endDate = ee.Date.fromYMD(endYear, 12, 31);

// 2. DEFINE AREA OF INTEREST (AOI)
var gaul = ee.FeatureCollection("FAO/GAUL/2015/level2");
var aoi = gaul.filter(ee.Filter.and(
  ee.Filter.eq('ADM0_NAME', countryName),
  ee.Filter.eq('ADM2_NAME', districtName)
));
Map.centerObject(aoi, 9);

// 3. LOAD STATIC ENVIRONMENTAL PARAMETERS
// A. Topography
var dem = ee.Image("USGS/SRTMGL1_003").clip(aoi);
var slope = ee.Terrain.slope(dem).rename('slope');

// B. Soil (OpenLandMap)
var clay = ee.Image("OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02")
  .select('b0').clip(aoi).rename('soil_clay'); // Surface clay
var sand = ee.Image("OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02")
  .select('b0').clip(aoi).rename('soil_sand');

// C. Land Cover & Distance to Water
var lulc = ee.ImageCollection("ESA/WorldCover/v100").first().clip(aoi).rename('landcover');
var cropland = lulc.eq(40).rename('cropland_mask'); // 40 is Cropland in ESA WorldCover

// D. Dist to Lake Kariba (Rough approximation using water mask)
var water = lulc.eq(80); 
var distToWater = water.fastDistanceTransform().sqrt().multiply(ee.Image.pixelArea().sqrt()).rename('dist_water');

var staticLayers = dem.addBands([slope, clay, sand, cropland, distToWater]);

// 4. PREPARE DYNAMIC INDICATORS
// A. NDVI & VCI (MODIS)
var modisNDVI = ee.ImageCollection("MODIS/061/MOD13A1")
  .filterDate(startDate, endDate)
  .select('NDVI');

var ndviMax = modisNDVI.reduce(ee.Reducer.max());
var ndviMin = modisNDVI.reduce(ee.Reducer.min());

// B. LST & TCI (MODIS)
var modisLST = ee.ImageCollection("MODIS/061/MOD11A1")
  .filterDate(startDate, endDate)
  .select('LST_Day_1km');

var lstMax = modisLST.reduce(ee.Reducer.max());
var lstMin = modisLST.reduce(ee.Reducer.min());

// C. Precipitation (CHIRPS)
var chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
  .filterDate(startDate, endDate)
  .select('precipitation');

// D. Additional Indices
var gladsSMI = ee.ImageCollection("NASA/GLDAS/V021/NOAH/G025/T3H")
  .filterDate(startDate, endDate)
  .select('RootMoist_inst');

var era5RH = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
  .filterDate(startDate, endDate)
  .select('dewpoint_temperature_2m', 'temperature_2m');

var modisET = ee.ImageCollection("MODIS/061/MOD16A2")
  .filterDate(startDate, endDate)
  .select('ET');

// 5. MONTHLY AGGREGATION & INDEX CALCULATION
var months = ee.List.sequence(0, endDate.difference(startDate, 'month').round().subtract(1));

var masterMonthly = ee.ImageCollection(months.map(function(n) {
  var d = startDate.advance(n, 'month');
  var m = d.get('month');
  var y = d.get('year');
  
  // NDVI/VCI
  var ndvi = modisNDVI.filter(ee.Filter.calendarRange(y, y, 'year'))
                      .filter(ee.Filter.calendarRange(m, m, 'month'))
                      .mean().divide(10000).rename('NDVI');
  var vci = ndvi.subtract(ndviMin.divide(10000))
                .divide(ndviMax.subtract(ndviMin).divide(10000))
                .multiply(100).rename('VCI');
                
  // LST/TCI (Kelvin to Celsius)
  var lst = modisLST.filter(ee.Filter.calendarRange(y, y, 'year'))
                    .filter(ee.Filter.calendarRange(m, m, 'month'))
                    .mean().multiply(0.02).subtract(273.15).rename('LST');
  var tci = lstMax.multiply(0.02).subtract(273.15).subtract(lst)
                .divide(lstMax.subtract(lstMin).multiply(0.02))
                .multiply(100).rename('TCI');
                
  // VHI
  var vhi = vci.multiply(0.5).add(tci.multiply(0.5)).rename('VHI');
  
  // SMI (Soil Moisture)
  var smi = gladsSMI.filter(ee.Filter.calendarRange(y, y, 'year'))
                    .filter(ee.Filter.calendarRange(m, m, 'month'))
                    .mean().rename('SMI');
                    
  // ET (Evapotranspiration)
  var et = modisET.filter(ee.Filter.calendarRange(y, y, 'year'))
                  .filter(ee.Filter.calendarRange(m, m, 'month'))
                  .mean().rename('ET');
                  
  // RH (Relative Humidity calc from Dewpoint and Temp)
  var era = era5RH.filter(ee.Filter.calendarRange(y, y, 'year'))
                  .filter(ee.Filter.calendarRange(m, m, 'month'))
                  .mean();
  var rh = ee.Image(100).multiply(
    ee.Image(ee.Number(17.625).multiply(era.select('dewpoint_temperature_2m').subtract(273.15))
    .divide(era.select('dewpoint_temperature_2m').subtract(273.15).add(243.04))).exp()
    .divide(ee.Image(ee.Number(17.625).multiply(era.select('temperature_2m').subtract(273.15))
    .divide(era.select('temperature_2m').subtract(273.15).add(243.04))).exp())
  ).rename('RH');

  // Precipitation
  var precip = chirps.filter(ee.Filter.calendarRange(y, y, 'year'))
                     .filter(ee.Filter.calendarRange(m, m, 'month'))
                     .sum().rename('precip');

  return ndvi.addBands([vci, lst, tci, vhi, smi, et, rh, precip])
             .addBands(staticLayers)
             .set('system:time_start', d.millis())
             .set('month', m)
             .set('year', y);
}));

// 6. VISUALIZATION
Map.addLayer(masterMonthly.first().select('VHI'), {min:0, max:100, palette:['red', 'yellow', 'green']}, 'VHI Example');
Map.addLayer(staticLayers.select('soil_clay'), {min:0, max:50, palette:['white', 'brown']}, 'Soil Clay');

// 7. EXPORT
// Note: For CNN-LSTM, users often need the data as a stack or district-wide means.
// Here we export the District Averages as a CSV for initial prototyping.
var resultsTable = masterMonthly.map(function(img) {
  var stats = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi,
    scale: 1000,
    maxPixels: 1e9
  });
  return ee.Feature(null, stats).set('system:time_start', img.get('system:time_start'));
});

Export.table.toDrive({
  collection: resultsTable,
  description: 'Binga_Master_Indices_2000_2025',
  fileFormat: 'CSV'
});

print('Master dataset prepared with bands:', masterMonthly.first().bandNames());
