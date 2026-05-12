// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries as in other scripts
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import TerraClimate
// Native resolution is approx 4.6km.
var dataset = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select(['tmax', 'tmin']); // using tmax and tmin from TerraClimate (note: the earth engine snippet catalog lists them as tmmx and tmmn but let's see. The RH script I corrected to tmmx and tmmn to be safe).

// Actuall the official bands are tmmx and tmmn
var dataset_corrected = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select(['tmmx', 'tmmn']);

// -----------------------------------------------------------------
// TerraClimate is already aggregated monthly!
// -----------------------------------------------------------------

var monthlyTemp = dataset_corrected.map(function (img) {
    // TerraClimate temperature variables have a scale factor of 0.1
    var tmax = img.select('tmmx').multiply(0.1); // Max Temp in C
    var tmin = img.select('tmmn').multiply(0.1); // Min Temp in C

    // Calculate Mean Temperature
    var tmean = tmax.add(tmin).divide(2).rename('Temp_Mean_C');

    var d = ee.Date(img.get('system:time_start'));
    return tmean.set('system:time_start', d.millis())
        .set('Year', d.get('year'))
        .set('Month', d.get('month'));
});

// -----------------------------------------------------------------
// Calculate spatial mean over the Region of Interest
// -----------------------------------------------------------------

var finalStats = monthlyTemp.map(function (img) {
    var stats = img.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi,
        scale: 4638.3,      // TerraClimate native resolution is ~4.6km
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
        'Temp_Mean_C': stats.get('Temp_Mean_C')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['Temp_Mean_C']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'orange' }, 'Binga District');

print('Preview of TerraClimate Temp stats (First 10 months):', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['Temp_Mean_C']
})
    .setOptions({
        title: 'TerraClimate (4.6km) Monthly Mean Temperature (2000 - 2025)',
        vAxis: {
            title: 'Temperature (°C)',
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'orange', lineWidth: 2, name: 'Mean Temperature (°C)' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_TerraClimate_Temp_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'Temp_Mean_C']
});
