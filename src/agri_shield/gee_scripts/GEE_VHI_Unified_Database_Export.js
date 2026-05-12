// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import both Datasets for VHI (VHI mathematically requires both NDVI and LST)
var ndviDataset = ee.ImageCollection("MODIS/061/MOD13Q1").filterBounds(roi).filterDate(startDate, endDate).select('NDVI');
var lstDataset = ee.ImageCollection("MODIS/061/MOD11A2").filterBounds(roi).filterDate(startDate, endDate).select('LST_Day_1km');

// -----------------------------------------------------------------
// Aggregate into unified Monthly Composites
// -----------------------------------------------------------------
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));

// 1. Create a unified ImageCollection
var monthlyImages = ee.ImageCollection.fromImages(
    monthsList.map(function (n) {
        var start = startDate.advance(n, 'month');
        var end = start.advance(1, 'month');

        // Process NDVI
        var filteredNdvi = ndviDataset.filterDate(start, end);
        var countNdvi = filteredNdvi.size();
        var ndviImg = ee.Image(ee.Algorithms.If(
            countNdvi.gt(0),
            filteredNdvi.max().multiply(0.0001).rename('NDVI'),
            ee.Image().rename('NDVI')
        ));

        // Process LST
        var filteredLst = lstDataset.filterDate(start, end);
        var countLst = filteredLst.size();
        var lstImg = ee.Image(ee.Algorithms.If(
            countLst.gt(0),
            filteredLst.mean().multiply(0.02).subtract(273.15).rename('LST'),
            ee.Image().rename('LST')
        ));

        // Ensure both datasets had data for this month
        var hasData = ee.Algorithms.If(countNdvi.gt(0).and(countLst.gt(0)), 1, 0);

        return ndviImg.addBands(lstImg)
            .set('system:time_start', start.millis())
            .set('Year', start.get('year'))
            .set('Month', start.get('month'))
            .set('has_data', hasData);
    })
);

// Filter out months missing either NDVI or LST data natively
var validMonthlyImages = monthlyImages.filter(ee.Filter.eq('has_data', 1));

// -----------------------------------------------------------------
// Calculate Long-Term Monthly Statistics for Both
// -----------------------------------------------------------------
var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var ndviMin = monthImages.select('NDVI').min().rename('NDVI_min');
        var ndviMax = monthImages.select('NDVI').max().rename('NDVI_max');
        var ndviRange = ndviMax.subtract(ndviMin).rename('NDVI_range');

        var lstMin = monthImages.select('LST').min().rename('LST_min');
        var lstMax = monthImages.select('LST').max().rename('LST_max');
        var lstRange = lstMax.subtract(lstMin).rename('LST_range');

        return ndviMin.addBands([ndviMax, ndviRange, lstMin, lstMax, lstRange]).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate ONLY VHI Perfectly Aligned
// -----------------------------------------------------------------
var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());

    // Step 1: Calculate VCI (required for VHI formula)
    var vci = img.select('NDVI').subtract(monthLtm.select('NDVI_min'))
        .divide(monthLtm.select('NDVI_range').max(0.0001))
        .multiply(100);

    // Step 2: Calculate TCI (required for VHI formula)
    var tci = monthLtm.select('LST_max').subtract(img.select('LST'))
        .divide(monthLtm.select('LST_range').max(0.01))
        .multiply(100);

    // Step 3: Calculate VHI = 0.5 * VCI + 0.5 * TCI
    var vhi = vci.multiply(0.5).add(tci.multiply(0.5)).rename('VHI');

    // Calculate spatial mean over the Region of Interest
    var stats = vhi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 1000,
        maxPixels: 1e13,
        tileScale: 16
    });

    var d = ee.Date(img.get('system:time_start'));
    var dateStr = d.format('YYYY-MM');

    // Return ONLY Date, Year, Month, and VHI
    return ee.Feature(null, {
        'Date': dateStr,
        'Year': img.get('Year'),
        'Month': img.get('Month'),
        'VHI_Mean': stats.get('VHI')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['VHI_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

print('Preview of VHI Database (First 10 months):', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['VHI_Mean']
})
    .setOptions({
        title: 'Agricultural Drought Index (VHI) Time Series (2000 - 2025)',
        vAxis: { title: 'Index Value (%)', viewWindow: { min: 0, max: 100 } },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'green', lineWidth: 2, name: 'VHI (Health Index)' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export ONLY VHI Database to CSV
// -----------------------------------------------------------------
Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_VHI_Drought_Database_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'VHI_Mean']
});
