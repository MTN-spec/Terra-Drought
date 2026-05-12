// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries as in other scripts
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import FLDAS (Famine Early Warning Systems Network Land Data Assimilation System)
// We select 'Evap_tavg' (Evapotranspiration rate).
// Native resolution is approx 11km.
var dataset = ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('Evap_tavg');

// -----------------------------------------------------------------
// FLDAS is already aggregated monthly!
// -----------------------------------------------------------------

var monthlyET = dataset.map(function (img) {
    var d = ee.Date(img.get('system:time_start'));
    var year = d.get('year');
    var month = d.get('month');

    // The native unit of Evap_tavg in FLDAS is kg/m^2/s (which is equivalent to mm/s).
    // To get total monthly ET in mm, we must multiply by the number of seconds in that specific month.
    // We can calculate the number of days in the month using ee.Date difference.
    var nextMonth = d.advance(1, 'month');
    var daysInMonth = nextMonth.difference(d, 'day');
    var secondsInMonth = daysInMonth.multiply(24 * 60 * 60);

    // Convert rate (mm/s) to total (mm/month)
    var etTotal = img.multiply(secondsInMonth)
        .rename('ET_Mean_mm')
        .set('system:time_start', d.millis())
        .set('Year', year)
        .set('Month', month);

    return etTotal;
});

// -----------------------------------------------------------------
// Calculate spatial mean over the Region of Interest
// -----------------------------------------------------------------

var finalStats = monthlyET.map(function (img) {
    var stats = img.reduceRegion({
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
        'ET_Mean_mm': stats.get('ET_Mean_mm')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['ET_Mean_mm']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------
 
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'blue' }, 'Binga District');

print('Preview of FLDAS ET stats (First 10 months):', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['ET_Mean_mm']
})
    .setOptions({
        title: 'FLDAS (11km) Total Monthly Evapotranspiration Time Series (2000 - 2025)',
        vAxis: {
            title: 'ET (mm/month)',
            viewWindow: { min: 0 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'blue', lineWidth: 2, name: 'Evapotranspiration (mm)' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_FLDAS_ET_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'ET_Mean_mm']
});
