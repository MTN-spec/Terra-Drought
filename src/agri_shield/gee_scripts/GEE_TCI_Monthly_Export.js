// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time same as the NDVI analysis we have stored in the drive folder of datasets 
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import the MODIS 8-Day Land Surface Temperature (LST) Product (1km native resolution)
// MOD11A2 is an 8-day composite of LST_Day_1km.
var dataset = ee.ImageCollection("MODIS/061/MOD11A2")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('LST_Day_1km');

// -----------------------------------------------------------------
// Aggregate 8-Day LST data into Monthly Composites
// -----------------------------------------------------------------

// Generate a flat list of months to iterate over
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));

// 1. Create an ImageCollection of Monthly Mean Composites
var monthlyImages = ee.ImageCollection.fromImages(
    monthsList.map(function (n) {
        var start = startDate.advance(n, 'month');
        var end = start.advance(1, 'month');

        // Filter the original LST collection for this month
        var filtered = dataset.filterDate(start, end);
        var count = filtered.size();

        // We use an If only to prevent multiplying an empty image
        // Note: MODIS LST is stored as Kelvin multiplied by 0.02
        // We multiply by 0.02 and subtract 273.15 to convert to Celsius
        var composite = ee.Image(ee.Algorithms.If(
            count.gt(0),
            filtered.mean().multiply(0.02).subtract(273.15).rename('LST')
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
// Calculate Long-Term Monthly Minimum and Maximum LST (Celsius)
// -----------------------------------------------------------------
// To calculate TCI, we need the long-term min/max for each specific calendar month (Jan-Dec).
var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var monthMin = monthImages.min().rename('LST_min');
        var monthMax = monthImages.max().rename('LST_max');

        // Calculate the difference (LST_max - LST_min) for the denominator
        var range = monthMax.subtract(monthMin).rename('LST_range');

        return monthMin.addBands(monthMax).addBands(range).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate TCI securely
// -----------------------------------------------------------------

// Map over the original collection again to compute TCI for each month
// CRÍTICAL DIFFERENCE: TCI formula is inversed compared to VCI
// High LST = Drought (Low TCI) | Low LST = Good Conditions (High TCI)
// TCI Formula = 100 * (LST_max - LST) / (LST_max - LST_min)

var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');

    // Extract the specific max and range for this specific calendar month
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());
    var lstMax = monthLtm.select('LST_max');
    var lstRange = monthLtm.select('LST_range');

    // Inverse Formula execution
    // .max(0.01) on the range to absolutely prevent division by zero for homogeneous pixels
    var tci = lstMax.subtract(img.select('LST'))
        .divide(lstRange.max(0.01))
        .multiply(100)
        .rename('TCI');

    // Calculate spatial mean over the Region of Interest
    var stats = tci.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 1000,       // LST from MODIS is natively 1km
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
        'TCI_Mean': stats.get('TCI')
    });
});

// Extra precaution to clear out potentially null stat limits
finalStats = finalStats.filter(ee.Filter.notNull(['TCI_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

// Add ROI to the map
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

// Print the first 10 results to the console to verify
print('Preview of MODIS 1km TCI stats (First 10 months):', finalStats.limit(10));

// Create a chart for visual confirmation before downloading
var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['TCI_Mean']
})
    .setOptions({
        title: 'MODIS (MOD11A2 - 1km) Monthly TCI Time Series (2000 - 2025)',
        vAxis: {
            title: 'TCI (%)',
            viewWindow: { min: 0, max: 100 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'purple', lineWidth: 2, name: 'Mean TCI' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV (can be opened in Excel)
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_MODIS_MOD11A2_TCI_2000_2025_1km',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'TCI_Mean']
});
