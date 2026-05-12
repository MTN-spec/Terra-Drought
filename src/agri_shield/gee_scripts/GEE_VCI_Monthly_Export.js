// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import the MODIS 16-Day NDVI Product (250m native resolution)
var dataset = ee.ImageCollection("MODIS/061/MOD13Q1")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select('NDVI');

// -----------------------------------------------------------------
// Aggregate 16-Day data into Monthly Composites (Optimized)
// -----------------------------------------------------------------

// Generate a flat list of months to iterate over (avoids nested List mapping)
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));

// 1. Create an ImageCollection of Monthly Composites first
var monthlyImages = ee.ImageCollection.fromImages(
    monthsList.map(function (n) {
        var start = startDate.advance(n, 'month');
        var end = start.advance(1, 'month');

        // Filter the original collection for this month
        var filtered = dataset.filterDate(start, end);
        var count = filtered.size();

        // We use an If only to prevent multiplying an empty image
        var composite = ee.Image(ee.Algorithms.If(
            count.gt(0),
            filtered.max().multiply(0.0001).rename('NDVI')
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
// Calculate Long-Term Monthly Minimum and Maximum NDVI
// -----------------------------------------------------------------
// To calculate VCI, we need the long-term min/max for each specific calendar month (Jan-Dec).
var months = ee.List.sequence(1, 12);
var ltmStats = ee.ImageCollection.fromImages(
    months.map(function (m) {
        var monthImages = validMonthlyImages.filter(ee.Filter.eq('Month', m));

        var monthMin = monthImages.min().rename('NDVI_min');
        var monthMax = monthImages.max().rename('NDVI_max');

        // Calculate the difference (NDVI_max - NDVI_min) to avoid doing it per-image later
        var range = monthMax.subtract(monthMin).rename('NDVI_range');

        return monthMin.addBands(monthMax).addBands(range).set('Month', m);
    })
);

// -----------------------------------------------------------------
// Calculate VCI securely
// -----------------------------------------------------------------

// Map over the original collection again to compute VCI for each month
var finalStats = validMonthlyImages.map(function (img) {
    var m = img.get('Month');

    // Extract the specific min, max, and range for this specific calendar month
    var monthLtm = ee.Image(ltmStats.filter(ee.Filter.eq('Month', m)).first());
    var ndviMin = monthLtm.select('NDVI_min');
    var ndviRange = monthLtm.select('NDVI_range');

    // VCI Formula: 100 * (NDVI - NDVI_min) / (NDVI_max - NDVI_min)
    // We use .max(0.0001) on the range to absolutely prevent division by zero in homogeneous pixels
    var vci = img.select('NDVI').subtract(ndviMin)
        .divide(ndviRange.max(0.0001))
        .multiply(100)
        .rename('VCI');

    // Calculate spatial mean over the Region of Interest
    var stats = vci.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 250,        // Using native 250m resolution
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
        'VCI_Mean': stats.get('VCI')
    });
});

// Extra precaution to clear out potentially null stat limits
finalStats = finalStats.filter(ee.Filter.notNull(['VCI_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

// Add ROI to the map
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

// Print the first 10 results to the console to verify
print('Preview of MODIS 250m VCI stats (First 10 months):', finalStats.limit(10));

// Create a chart for visual confirmation before downloading
var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['VCI_Mean']
})
    .setOptions({
        title: 'MODIS (MOD13Q1 - 250m) Monthly VCI Time Series (2000 - 2025)',
        vAxis: {
            title: 'VCI (%)',
            viewWindow: { min: 0, max: 100 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'orange', lineWidth: 2, name: 'Mean VCI' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV (can be opened in Excel)
// -----------------------------------------------------------------

// This will create a task in the "Tasks" tab on the right panel.
Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_MODIS_MOD13Q1_VCI_2000_2025_250m',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'VCI_Mean']
});
