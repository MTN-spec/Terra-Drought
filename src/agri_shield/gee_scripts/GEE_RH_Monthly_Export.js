// Define your Region of Interest (ROI)
// Using Binga District, Zimbabwe from FAO GAUL boundaries as in other scripts
var roi = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filter(ee.Filter.eq('ADM2_NAME', 'Binga'))
    .geometry();

// Define the time period
var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Import TerraClimate (Monthly Climate and Climatic Water Balance for Global Terrestrial Surfaces)
// We select 'vap' (Actual vapor pressure) and 'tmmn'/'tmmx' to calculate Relative Humidity.
// Native resolution is approx 4.6km.
var dataset = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE")
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .select(['vap', 'tmmx', 'tmmn']);

// -----------------------------------------------------------------
// TerraClimate is already aggregated monthly!
// -----------------------------------------------------------------

var monthlyRH = dataset.map(function (img) {
    // TerraClimate variables have scale factors:
    // vap: 0.001 (kPa)
    // tmax: 0.1 (degrees C)
    // tmin: 0.1 (degrees C)

    var vap = img.select('vap').multiply(0.001);   // Actual Vapor Pressure (ea) in kPa
    var tmax = img.select('tmmx').multiply(0.1); // Max Temp in C
    var tmin = img.select('tmmn').multiply(0.1); // Min Temp in C

    // Calculate Mean Temperature
    var tmean = tmax.add(tmin).divide(2);

    // Calculate Saturation Vapor Pressure (es) using Tetens formula
    // es(T) = 0.6108 * exp( (17.27 * T) / (T + 237.3) )
    var es_tmax = tmax.expression(
        '0.6108 * exp((17.27 * T) / (T + 237.3))', { 'T': tmax }
    );
    var es_tmin = tmin.expression(
        '0.6108 * exp((17.27 * T) / (T + 237.3))', { 'T': tmin }
    );

    // Mean Saturation Vapor Pressure (es)
    var es = es_tmax.add(es_tmin).divide(2);

    // Calculate Relative Humidity (RH)
    // RH = 100 * (ea / es)
    var rh = vap.divide(es).multiply(100).rename('RH_Mean');

    // Cap RH at 100% in case of minor calculation anomalies
    rh = rh.where(rh.gt(100), 100);

    var d = ee.Date(img.get('system:time_start'));
    return rh.set('system:time_start', d.millis())
        .set('Year', d.get('year'))
        .set('Month', d.get('month'));
});

// -----------------------------------------------------------------
// Calculate spatial mean over the Region of Interest
// -----------------------------------------------------------------

var finalStats = monthlyRH.map(function (img) {
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
        'RH_Mean_Percent': stats.get('RH_Mean')
    });
});

finalStats = finalStats.filter(ee.Filter.notNull(['RH_Mean_Percent']));

// -----------------------------------------------------------------
// Visualization & Printing
// -----------------------------------------------------------------

Map.centerObject(roi, 9);
Map.addLayer(roi, { color: 'green' }, 'Binga District');

print('Preview of TerraClimate RH stats (First 10 months):', finalStats.limit(10));

var chart = ui.Chart.feature.byFeature({
    features: finalStats,
    xProperty: 'Date',
    yProperties: ['RH_Mean_Percent']
})
    .setOptions({
        title: 'TerraClimate (4.6km) Monthly Relative Humidity Time Series (2000 - 2025)',
        vAxis: {
            title: 'Relative Humidity (%)',
            viewWindow: { min: 0, max: 100 }
        },
        hAxis: { title: 'Date' },
        series: {
            0: { color: 'green', lineWidth: 2, name: 'Relative Humidity (%)' }
        }
    });
print(chart);

// -----------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------

Export.table.toDrive({
    collection: finalStats,
    description: 'Binga_TerraClimate_RH_2000_2025',
    folder: 'GEE_Exports',
    fileFormat: 'CSV',
    selectors: ['Date', 'Year', 'Month', 'RH_Mean_Percent']
});
