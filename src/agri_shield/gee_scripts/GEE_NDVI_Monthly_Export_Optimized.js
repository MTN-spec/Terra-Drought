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
        // We set 'has_data' to easily filter them out later
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

// Filter out any months that had no imagery natively (No more If statements)
var validMonthlyImages = monthlyImages.filter(ee.Filter.eq('has_data', 1));

// 2. Map over the valid ImageCollection to calculate statistics reliably
var finalStats = validMonthlyImages.map(function (img) {
    // Calculate spatial statistics over the Binga ROI
    var stats = img.reduceRegion({
        reducer: ee.Reducer.mean()
            .combine({ reducer2: ee.Reducer.min(), sharedInputs: true })
            .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
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
        'NDVI_Mean': stats.get('NDVI_mean'),
        'NDVI_Min': stats.get('NDVI_min'),
        'NDVI_Max': stats.get('NDVI_max')
    });
});

// Extra precaution to clear out potentially null stat objects limits
finalStats = finalStats.filter(ee.Filter.notNull(['NDVI_Mean']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

// Add ROI to the map
Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'red' }, 'Binga District');

// Print the first 10 results to the console to verify
print('Preview of MODIS 250m NDVI stats (First 10 months):', finalStats.limit(10));

// Create a chart for visual confirmation before downloading
var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['NDVI_Mean', 'NDVI_Min', 'NDVI_Max']
})
    .setOptions({
        title: 'MODIS (MOD13Q1 - 250m) Monthly NDVI Time Series (2000 - 2025)',
        vAxis: { title: 'NDVI' },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'green', lineWidth: 2, name: 'Mean' },
            1: { color: 'red', lineWidth: 1, name: 'Min', lineDashStyle: [4, 4] },
            2: { color: 'blue', lineWidth: 1, name: 'Max', lineDashStyle: [4, 4] }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV (can be opened in Excel)
// -----------------------------------------------------------------

// This will create a task in the "Tasks" tab on the right panel.
Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_MODIS_MOD13Q1_NDVI_2000_2025_250m',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'NDVI_Mean', 'NDVI_Min', 'NDVI_Max']
});
