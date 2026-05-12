// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import FLDAS (Famine Early Warning Systems Network Land Data Assimilation System)
// FLDAS is specifically designed for agricultural drought monitoring in data-sparse regions like Africa.
// We select 'SoilMoi00_10cm_tavg' (Soil Moisture at 0-10cm depth, average).
// Native resolution is approx 11km.
var dataset = ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('SoilMoi00_10cm_tavg');

// -----------------------------------------------------------------
// FLDAS is already aggregated monthly!
// -----------------------------------------------------------------
// Unlike CHIRPS or MODIS which are daily/8-day, FLDAS is already a monthly dataset.
// So we just need to standardize the dates and variable names.

var validMonthlyImages = dataset.map(function (img) {
    var d = ee.Date(img.get('system:time_start'));
    return img.rename('SoilMoisture')
        .set('system:time_start', d.millis())
        .set('Year', d.get('year'))
        .set('Month', d.get('month'));
});

// -----------------------------------------------------------------
// Calculate Long-Term Monthly Minimum and Maximum for SMI
// -----------------------------------------------------------------
// Soil Moisture Index (SMI) uses the exact same formula logic as VCI/TCI:
// SMI = 100 * (SoilMoisture_Current - SoilMoisture_Min) / (SoilMoisture_Max - SoilMoisture_Min)

var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var smMin = monthImages.select('SoilMoisture').min().rename('SM_min');
        var smMax = monthImages.select('SoilMoisture').max().rename('SM_max');
        var smRange = smMax.subtract(smMin).rename('SM_range');

        return smMin.addBands([smMax, smRange]).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate Soil Moisture Index (SMI) Percentage
// -----------------------------------------------------------------

var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');

    // Extract historical min/max/range for this calendar month
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());

    var currentSM = img.select('SoilMoisture');

    // SMI Formula: 100 * (Current - Min) / Range
    // Using .max(0.000001) to prevent division by zero in extraordinarily dry baseline months
    var smi = currentSM.subtract(monthLtm.select('SM_min'))
        .divide(monthLtm.select('SM_range').max(0.000001))
        .multiply(100)
        .rename('SMI_Mean');

    // Calculate spatial mean over the Region of Interest
    var stats = smi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 11132,      // FLDAS native resolution is ~11km
        maxPixels: 1e13,
        tileScale: 16
    });

    // Format Date 
    var d = ee.Date(img.get('system:time_start'));
    var dateStr = d.format('YYYY-MM');

    // Return as Feature
    return ee.Feature(null, {
        'Date': dateStr,
        'Year': img.get('Year'),
        'Month': img.get('Month'),
        'SMI_Mean': stats.get('SMI_Mean')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['SMI_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

print('Preview of FLDAS SMI stats (First 10 months):', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['SMI_Mean']
})
    .setOptions({
        title: 'FLDAS (11km) Soil Moisture Index Time Series (2000 - 2025)',
        vAxis: {
            title: 'SMI Value (%)',
            viewWindow: { min: 0, max: 100 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'brown', lineWidth: 2, name: 'SMI (Soil Moisture)' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_FLDAS_SMI_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'SMI_Mean']
});
