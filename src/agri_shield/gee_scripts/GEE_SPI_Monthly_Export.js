// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import CHIRPS Daily Precipitation (approx 5.5km native resolution)
// CHIRPS is the gold-standard satellite precipitation dataset for Africa
var dataset = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('precipitation');

// -----------------------------------------------------------------
// Aggregate Daily Precipitation into Monthly Totals
// -----------------------------------------------------------------

// Generate a flat list of months to iterate over
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));

// 1. Create an ImageCollection of Monthly Precipitation Totals
var monthlyImages = ee.ImageCollection.fromImages(
    monthsList.map(function (n) {
        var start = startDate.advance(n, 'month');
        var end = start.advance(1, 'month');

        // Filter the original daily collection for this specific month
        var filtered = dataset.filterDate(start, end);
        var count = filtered.size();

        // Sum the daily rainfall to get the total monthly precipitation (mm)
        var composite = ee.Image(ee.Algorithms.If(
            count.gt(0),
            filtered.sum().rename('Precipitation')
                .set('system:time_start', start.millis())
                .set('Year', start.get('year'))
                .set('Month', start.get('month'))
                .set('has_data', 1),
            ee.Image().set('has_data', 0) // Dummy Image for empty months
        ));

        return composite;
    })
);

// Filter out any months that had no imagery natively
var validMonthlyImages = monthlyImages.filter(ee.Filter.eq('has_data', 1));

// -----------------------------------------------------------------
// Calculate Long-Term Monthly Mean and Standard Deviation (1-Month SPI proxy)
// -----------------------------------------------------------------
// To calculate 1-Month SPI (Standardized Precipitation Anomaly), we need the historical average 
// and standard deviation of precipitation for each specific calendar month (Jan-Dec).
var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var monthMean = monthImages.mean().rename('Precip_mean');

        // Calculate the historical standard deviation of rainfall for this month
        var monthStdDev = monthImages.reduce(ee.Reducer.stdDev()).rename('Precip_std');

        return monthMean.addBands(monthStdDev).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate Standardized Precipitation Anomaly (Z-Score)
// -----------------------------------------------------------------

// Map over the original collection to compute the SPI-1 proxy for each month
// Formula: Z = (Precipitation - Mean) / Standard_Deviation

var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');

    // Extract the specific mean and standard deviation for this calendar month
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());

    var precip = img.select('Precipitation');
    var mean = monthLtm.select('Precip_mean');
    var std = monthLtm.select('Precip_std');

    // Z-Score calculation execution
    // .max(0.001) on the Standard Deviation to prevent division by zero in months where it almost never rains (e.g. July)
    var spi = precip.subtract(mean)
        .divide(std.max(0.001))
        .rename('SPI_1');

    // Calculate spatial mean over the Region of Interest
    var stats = spi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 5566,       // CHIRPS from UCSB is natively ~5.5km
        maxPixels: 1e13,
        tileScale: 16      // Splitting calculation into chunks explicitly 
    });

    // Format Date gracefully 
    var d = ee.Date(img.get('system:time_start'));
    var dateStr = d.format('YYYY-MM');

    // Return as a Feature
    return ee.Feature(null, {
        'Date': dateStr,
        'Year': img.get('Year'),
        'Month': img.get('Month'),
        'SPI_1_Mean': stats.get('SPI_1')
    });
});

// Extra precaution to clear out potentially null stat limits
finalStats = finalStats.filter(ee.Filter.notNull(['SPI_1_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

// Add ROI to the map
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

// Print the first 10 results to the console to verify
print('Preview of CHIRPS 1-Month SPI stats:', finalStats.limit(10));

// Create a chart for visual confirmation before downloading
var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['SPI_1_Mean']
})
    .setOptions({
        title: 'CHIRPS (5.5km) 1-Month SPI Time Series (2000 - 2025)',
        vAxis: {
            title: 'SPI (Z-Score)',
            // Standard SPI thresholds usually range from -3 to +3
            viewWindow: { min: -3.5, max: 3.5 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'blue', lineWidth: 2, name: '1-Month SPI' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV (can be opened in Excel)
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_CHIRPS_SPI_1_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'SPI_1_Mean']
});
