// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import CHIRPS Daily Precipitation (approx 5.5km native resolution)
var dataset = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('precipitation');

// -----------------------------------------------------------------
// Aggregate Daily Precipitation into 3-Month Rolling Totals
// -----------------------------------------------------------------

// Generate a flat list of months to iterate over
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));

// 1. Create an ImageCollection of 3-Month Rolling Precipitation Totals
var monthlyImages = ee.ImageCollection.fromImages(
    monthsList.map(function (n) {
        n = ee.Number(n);

        // The current month we are evaluating
        var currentMonthStart = startDate.advance(n, 'month');

        // SPI-3 looks back 2 months BEFORE the current month, plus the current month.
        // e.g., if evaluating March, it sums Jan + Feb + March.
        var rollingStart = startDate.advance(n.subtract(2), 'month');
        var rollingEnd = currentMonthStart.advance(1, 'month');

        // Filter the original daily collection for this specific 3-month window
        var filtered = dataset.filterDate(rollingStart, rollingEnd);
        var count = filtered.size();

        // We only compute SPI-3 if we actually have 3 months of historical data available in the timeline
        // So we skip the first 2 months of the year 2000 (n < 2)
        var isValid = count.gt(0).and(n.gte(2));

        // Sum the daily rainfall to get the total 3-month precipitation (mm)
        var composite = ee.Image(ee.Algorithms.If(
            isValid,
            filtered.sum().rename('Precipitation_3M')
                .set('system:time_start', currentMonthStart.millis())
                .set('Year', currentMonthStart.get('year'))
                .set('Month', currentMonthStart.get('month'))
                .set('has_data', 1),
            ee.Image().set('has_data', 0) // Dummy Image for empty months or months 1 & 2
        ));

        return composite;
    })
);

// Filter out any months that had no imagery natively (Including Jan/Feb 2000)
var validMonthlyImages = monthlyImages.filter(ee.Filter.eq('has_data', 1));

// -----------------------------------------------------------------
// Calculate Long-Term Monthly Mean and Standard Deviation for SPI-3
// -----------------------------------------------------------------
var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var monthMean = monthImages.mean().rename('Precip_3M_mean');

        // Calculate the historical standard deviation of the 3-month rolling rainfall for this month
        var monthStdDev = monthImages.reduce(ee.Reducer.stdDev()).rename('Precip_3M_std');

        return monthMean.addBands(monthStdDev).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate Standardized Precipitation Anomaly (Z-Score) for SPI-3
// -----------------------------------------------------------------

var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');

    // Extract the specific 3M mean and standard deviation for this calendar month
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());

    var precip = img.select('Precipitation_3M');
    var mean = monthLtm.select('Precip_3M_mean');
    var std = monthLtm.select('Precip_3M_std');

    // Z-Score calculation execution
    var spi = precip.subtract(mean)
        .divide(std.max(0.001))
        .rename('SPI_3');

    // Calculate spatial mean over the Region of Interest
    var stats = spi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 5566,       // CHIRPS from UCSB is natively ~5.5km
        maxPixels: 1e13,
        tileScale: 16
    });

    var d = ee.Date(img.get('system:time_start'));
    var dateStr = d.format('YYYY-MM');

    return ee.Feature(null, {
        'Date': dateStr,
        'Year': img.get('Year'),
        'Month': img.get('Month'),
        'SPI_3_Mean': stats.get('SPI_3')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['SPI_3_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

print('Preview of CHIRPS 3-Month SPI stats:', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['SPI_3_Mean']
})
    .setOptions({
        title: 'CHIRPS (5.5km) 3-Month SPI Time Series (2000 - 2025)',
        vAxis: {
            title: 'SPI-3 (Z-Score)',
            viewWindow: { min: -3.5, max: 3.5 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'darkblue', lineWidth: 2, name: '3-Month SPI' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_CHIRPS_SPI_3_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'SPI_3_Mean']
});
