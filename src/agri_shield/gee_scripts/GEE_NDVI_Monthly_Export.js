// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
  .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
  .geometry();

// Define the time period
var startDate = '2000-01-01';
var endDate = '2025-12-31';

// Import the MODIS 16-Day NDVI Product (250m native resolution)
var dataset = ee.ImageCollection("MODIS/061/MOD13Q1")
  .filterBounds(roi)
  .filterDate(startDate, endDate)
  .select('NDVI');

// -----------------------------------------------------------------
// Aggregate 16-Day data into Monthly Composites
// -----------------------------------------------------------------
var years = ee.List.sequence(2000, 2025);
var months = ee.List.sequence(1, 12);

// Map over years and months to calculate stats
var monthlyStats = ee.FeatureCollection(years.map(function (y) {
  return months.map(function (m) {
    // Filter the 16-day collection to the specific month and year
    var filtered = dataset
      .filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month'));

    var imgCount = filtered.size();

    // Create a monthly maximum value composite (MVC) to remove clouds
    // We multiply by 0.0001 right here so we don't have to scale it later!
    var monthlyComposite = filtered.max().multiply(0.0001);

    // Calculate spatial statistics over the Binga ROI
    var stats = ee.Algorithms.If(
      imgCount.gt(0),
      monthlyComposite.reduceRegion({
        reducer: ee.Reducer.mean()
          .combine({ reducer2: ee.Reducer.min(), sharedInputs: true })
          .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
        geometry: roi,
        scale: 250,        // Using native 250m resolution
        maxPixels: 1e13,
        tileScale: 16,     // Splitting calculation into smaller chunks to prevent memory errors 
        bestEffort: true
      }),
      // Fallback if no imagery is available for that month
      ee.Dictionary({ 'NDVI_mean': null, 'NDVI_min': null, 'NDVI_max': null })
    );

    stats = ee.Dictionary(stats);
    var dateStr = ee.String(ee.Number(y).format('%04d')).cat('-').cat(ee.String(ee.Number(m).format('%02d')));

    return ee.Feature(null, {
      'Date': dateStr,
      'Year': y,
      'Month': m,
      'NDVI_Mean': stats.get('NDVI_mean'),
      'NDVI_Min': stats.get('NDVI_min'),
      'NDVI_Max': stats.get('NDVI_max')
    });
  });
}).flatten());

// Filter out any potential empty features
var finalStats = monthlyStats.filter(ee.Filter.notNull(['NDVI_Mean']));

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
