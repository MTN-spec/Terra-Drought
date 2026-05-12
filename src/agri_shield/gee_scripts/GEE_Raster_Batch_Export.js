// =================================================================
// GEE SCRIPT: EXPORT MONTHLY RASTER IMAGES (GEOTIFF) 
// Example Variable: Vegetation Health Index (VHI)
// =================================================================

// 1. Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// -----------------------------------------------------------------
// CRITICAL: LIMIT THE TIME PERIOD!
// Exporting 25 years = 312 images. 
// For this experiment, let's just export ONE year (e.g., 2019, a known drought year)
// -----------------------------------------------------------------
var targetYear = 2019;
var startDate = ee.Date.fromYMD(targetYear, 1, 1);
var endDate = ee.Date.fromYMD(targetYear, 12, 31);

// -----------------------------------------------------------------
// Calculate the Variable (Example: VHI)
// (This is a simplified version of your VHI calculation specifically for image export)
// -----------------------------------------------------------------

var dataset = ee.ImageCollection('MODIS/061/MOD13Q1')
    .filterBounds(roi)
    .filterDate('2000-01-01', '2025-12-31');

// Monthly aggregation function (reused from your previous scripts)
var months = ee.List.sequence(1, 12);
var monthlyImages = ee.ImageCollection.fromImages(
    ee.List.sequence(2000, 2024).map(function (y) {
        return months.map(function (m) {
            var filtered = dataset.filter(ee.Filter.calendarRange(y, y, 'year'))
                .filter(ee.Filter.calendarRange(m, m, 'month'));
            return ee.Algorithms.If(
                filtered.size().gt(0),
                filtered.mean().set('Year', y).set('Month', m).set('system:time_start', ee.Date.fromYMD(y, m, 1).millis()),
                null
            );
        });
    }).flatten()
).filter(ee.Filter.notNull(['Year']));

// Calculate historical Min/Max (LTM)
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = monthlyImages.filter(ee.Filter.eq('Month', m));
        var ndviMin = monthImages.select('NDVI').min().rename('NDVI_min');
        var ndviMax = monthImages.select('NDVI').max().rename('NDVI_max');
        return ndviMin.addBands(ndviMax).set('Month', m);
    })
);

// Calculate VHI for the TARGET YEAR only
var targetYearImages = monthlyImages.filter(ee.Filter.eq('Year', targetYear));

var vhiImages = targetYearImages.map(function (img) {
    var m = img.get('Month');
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());

    // TCI and VCI approximation for export
    var currentNDVI = img.select('NDVI');
    var ndviMin = monthLtm.select('NDVI_min');
    var ndviMax = monthLtm.select('NDVI_max');

    var vci = currentNDVI.subtract(ndviMin)
        .divide(ndviMax.subtract(ndviMin).max(0.0001))
        .multiply(100).rename('VCI');

    // Assuming TCI = VCI for this quick raster export experiment 
    // (To get true VHI you need the LST calculation, but this provides a normalized index for mapping)
    var vhi = vci.multiply(0.5).add(vci.multiply(0.5)).rename('VHI_Approx');

    // Convert to visually useful format (8-bit integer, 0-100)
    var vhiExport = vhi.uint8().clip(roi);

    var d = ee.Date(img.get('system:time_start'));
    var dateStr = d.format('YYYY_MM');

    return vhiExport.set('system:time_start', d.millis())
        .set('Date', dateStr)
        .set('Filename', ee.String('Binga_VHI_').cat(dateStr));
});

// -----------------------------------------------------------------
// Visualization (Preview on the Map)
// -----------------------------------------------------------------
Map.centerObject(roi, 9);
var vhiPalette = ['red', 'orange', 'yellow', 'green', 'darkgreen'];

// Add purely the August (dry season peak) image to the map as an example
var augImage = ee.Image(vhiImages.filter(ee.Filter.eq('Month', 8)).first());
Map.addLayer(augImage, { min: 0, max: 100, palette: vhiPalette }, 'VHI - August 2019');

// -----------------------------------------------------------------
// EXPORTING THE RASTERS TO GOOGLE DRIVE
// -----------------------------------------------------------------
// Because GEE won't let you export an entire ImageCollection at once easily with a simple command,
// we use a client-side function to loop through the 12 months and create 12 export tasks.

var size = vhiImages.size().getInfo();
var list = vhiImages.toList(size);

print("Generating " + size + " Export Tasks. Go to the 'Tasks' tab to run them.");

for (var i = 0; i < size; i++) {
    var img = ee.Image(list.get(i));
    var filename = img.get('Filename').getInfo();

    Export.image.toDrive({
        image: img,
        description: filename,           // This is the Task Name in GEE
        folder: 'GEE_Binga_Rasters',     // Name of the folder in your Google Drive
        fileNamePrefix: filename,        // The output file name (e.g. Binga_VHI_2019_08.tif)
        region: roi,
        scale: 250,                      // Resolution in meters (MODIS is 250m)
        crs: 'EPSG:4326',                // Standard WGS84 Projection for QGIS
        maxPixels: 1e13
    });
}
