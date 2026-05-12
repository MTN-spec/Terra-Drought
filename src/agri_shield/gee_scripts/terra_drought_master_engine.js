/**
 * TERRA DROUGHT - UNIFIED ANALYTICS ENGINE (v2.0)
 * Bundled Intelligence for 12+ Drought Indices
 * 
 * Features:
 * - Multi-Index Selective Mapping (NDVI, VCI, TCI, VHI, RAI, SPI, SMI, LST, ET, RH, Precip)
 * - Instant Point-Analysis (Map Click -> 25-Year Time Series)
 * - Administrative Bounds Integration
 */

// 1. CONFIGURATION & AOI
var districtName = 'Binga';
var countryName = 'Zimbabwe';
var aoi = ee.FeatureCollection("FAO/GAUL/2015/level2")
  .filter(ee.Filter.eq('ADM0_NAME', countryName))
  .filter(ee.Filter.eq('ADM2_NAME', districtName));
var geometry = aoi.geometry();
Map.centerObject(aoi, 9);
Map.style().set('cursor', 'crosshair');

// 2. PALETTES & VIZ
var palettes = {
  veg: ['#ff0000', '#ffa500', '#ffff00', '#00ff00', '#006400'], // Red-Green
  anom: ['#67001f', '#d6604d', '#f7f7f7', '#4393c3', '#053061'], // Red-White-Blue
  temp: ['#313695', '#4575b4', '#abd9e9', '#ffffbf', '#fee090', '#f4a582', '#d73027'], // Blue-White-Red
  soil: ['#f4a582', '#f7f7f7', '#92c5de', '#2166ac', '#053061'], // Light Brown to Deep Blue
  precip: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'] // Light to Dark Blue
};

// ---------------------------------------------------------
// 3. INDEX LOGIC FACTORY
// ---------------------------------------------------------

var getIndex = {
  'NDVI (Vegetation Index)': function (y, m) {
    var img = ee.ImageCollection("MODIS/061/MOD13A1")
      .filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean().divide(10000).clip(aoi).select('NDVI');
    return { image: img, viz: { min: 0, max: 0.8, palette: palettes.veg }, label: 'NDVI', unit: 'Index' };
  },

  'VCI (Vegetation Condition)': function (y, m) {
    var coll = ee.ImageCollection("MODIS/061/MOD13A1").select('NDVI');
    var ltmMin = coll.filter(ee.Filter.calendarRange(m, m, 'month')).min();
    var ltmMax = coll.filter(ee.Filter.calendarRange(m, m, 'month')).max();
    var current = coll.filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month')).mean();
    var vci = current.subtract(ltmMin).divide(ltmMax.subtract(ltmMin).max(0.0001)).multiply(100).clip(aoi);
    return { image: vci, viz: { min: 0, max: 100, palette: palettes.veg }, label: 'VCI', unit: '%' };
  },

  'TCI (Thermal Condition)': function (y, m) {
    var coll = ee.ImageCollection("MODIS/061/MOD11A1").select('LST_Day_1km');
    var fMonth = ee.Filter.calendarRange(m, m, 'month');
    var lMin = coll.filter(fMonth).min();
    var lMax = coll.filter(fMonth).max();
    var current = coll.filter(ee.Filter.calendarRange(y, y, 'year')).filter(fMonth).mean();
    var tci = lMax.subtract(current).divide(lMax.subtract(lMin).max(0.01)).multiply(100).clip(aoi);
    return { image: tci, viz: { min: 0, max: 100, palette: palettes.veg }, label: 'TCI', unit: '%' };
  },

  'VHI (Vegetation Health)': function (y, m) {
    var nColl = ee.ImageCollection("MODIS/061/MOD13A1").select('NDVI');
    var lColl = ee.ImageCollection("MODIS/061/MOD11A1").select('LST_Day_1km');
    var fM = ee.Filter.calendarRange(m, m, 'month');
    var nMin = nColl.filter(fM).min(); var nMax = nColl.filter(fM).max();
    var lMin = lColl.filter(fM).min(); var lMax = lColl.filter(fM).max();
    var timeF = ee.Filter.and(ee.Filter.calendarRange(y, y, 'year'), fM);
    var vci = nColl.filter(timeF).mean().subtract(nMin).divide(nMax.subtract(nMin).max(0.001)).multiply(100);
    var tci = lMax.subtract(lColl.filter(timeF).mean()).divide(lMax.subtract(lMin).max(0.001)).multiply(100);
    var vhi = vci.multiply(0.5).add(tci.multiply(0.5)).clip(aoi);
    return { image: vhi, viz: { min: 0, max: 100, palette: palettes.veg }, label: 'VHI', unit: '%' };
  },

  'SPI (Precip Anomaly)': function (y, m) {
    var chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").select('precipitation');
    var fM = ee.Filter.calendarRange(m, m, 'month');
    var stats = chirps.filter(fM);
    var mean = stats.mean();
    var std = stats.reduce(ee.Reducer.stdDev());
    var current = chirps.filter(ee.Filter.calendarRange(y, y, 'year')).filter(fM).sum();
    var spi = current.subtract(mean).divide(std.max(0.01)).clip(aoi);
    return { image: spi, viz: { min: -3, max: 3, palette: palettes.anom }, label: 'SPI', unit: 'Z-Score' };
  },

  'SMI (Soil Moisture)': function (y, m) {
    var sm = ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001").select('SoilMoi00_10cm_tavg');
    var fM = ee.Filter.calendarRange(m, m, 'month');
    var lMin = sm.filter(fM).min(); var lMax = sm.filter(fM).max();
    var current = sm.filter(ee.Filter.calendarRange(y, y, 'year')).filter(fM).mean();
    var smi = current.subtract(lMin).divide(lMax.subtract(lMin).max(0.0001)).multiply(100).clip(aoi);
    return { image: smi, viz: { min: 0, max: 100, palette: palettes.soil }, label: 'SMI', unit: '%' };
  },

  'RH (Relative Humidity)': function (y, m) {
    var tc = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE").select(['vap', 'tmmx', 'tmmn'])
      .filter(ee.Filter.calendarRange(y, y, 'year')).filter(ee.Filter.calendarRange(m, m, 'month')).first();
    var ea = tc.select('vap').multiply(0.001);
    var tmax = tc.select('tmmx').multiply(0.1);
    var tmin = tc.select('tmmn').multiply(0.1);
    var es = tmax.expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { T: tmax })
      .add(tmin.expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { T: tmin })).divide(2);
    var rh = ea.divide(es).multiply(100).rename('RH').clip(aoi);
    return { image: rh, viz: { min: 20, max: 90, palette: palettes.soil }, label: 'RH', unit: '%' };
  },

  'LST (Surface Temp)': function (y, m) {
    var lst = ee.ImageCollection("MODIS/061/MOD11A1").select('LST_Day_1km')
      .filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean().multiply(0.02).subtract(273.15).clip(aoi);
    return { image: lst, viz: { min: 20, max: 45, palette: palettes.temp }, label: 'LST', unit: '°C' };
  },

  'ET (Evapotransp)': function (y, m) {
    var et = ee.ImageCollection("MODIS/061/MOD16A2").select('ET')
      .filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .mean().multiply(0.1).clip(aoi);
    return { image: et, viz: { min: 0, max: 50, palette: palettes.soil }, label: 'ET', unit: 'mm' };
  },

  'Precip (Monthly)': function (y, m) {
    var pr = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").select('precipitation')
      .filter(ee.Filter.calendarRange(y, y, 'year'))
      .filter(ee.Filter.calendarRange(m, m, 'month'))
      .sum().clip(aoi);
    return { image: pr, viz: { min: 0, max: 300, palette: palettes.precip }, label: 'Precip', unit: 'mm' };
  }
};

// ---------------------------------------------------------
// 4. UI INTERFACE DESIGN
// ---------------------------------------------------------

var panel = ui.Panel({ style: { width: '380px', padding: '15px' } });
panel.add(ui.Label('🛰️ Terra Drought Master Engine', { fontSize: '24px', fontWeight: 'bold', color: '#2C3E50' }));
panel.add(ui.Label('Comprehensive GIS Analytics for Parametric Insurance', { fontSize: '12px', color: '#95A5A6' }));

panel.add(ui.Label('1. Selector', { fontWeight: 'bold', margin: '15px 8px 4px 8px' }));
var indexSelect = ui.Select({ items: Object.keys(getIndex), value: 'VHI (Vegetation Health)', style: { width: '100%' } });
panel.add(ui.Label('Select Indicator:', { fontSize: '11px' })); panel.add(indexSelect);

var yearSlider = ui.Slider({ min: 2000, max: 2025, value: 2024, step: 1, style: { width: '100%' } });
panel.add(ui.Label('Year:', { fontSize: '11px' })); panel.add(yearSlider);

var monthSlider = ui.Slider({ min: 1, max: 12, value: 3, step: 1, style: { width: '100%' } });
panel.add(ui.Label('Month:', { fontSize: '11px' })); panel.add(monthSlider);

var runBtn = ui.Button({
  label: '🚀 LOAD INDEX MAP',
  onClick: function () {
    var y = yearSlider.getValue(); var m = monthSlider.getValue(); var idxKey = indexSelect.getValue();
    Map.layers().reset();
    Map.addLayer(aoi, { color: 'black' }, 'Binga Boundary', false);
    var result = getIndex[idxKey](y, m);
    if (result) {
      Map.addLayer(result.image, result.viz, result.label + ' ' + y + '-' + m);
      instructions.setValue('✅ Map Loaded for: ' + idxKey + '\n📍 CLICK ANY PIXEL for 25-year history.');
    }
  },
  style: { width: '100%', color: '#27AE60', fontWeight: 'bold' }
}); panel.add(runBtn);

panel.add(ui.Label('2. Point Analysis', { fontWeight: 'bold', margin: '15px 8px 4px 8px' }));
var instructions = ui.Label('Click map after loading index.', { fontSize: '12px', color: '#E67E22', whiteSpace: 'pre' });
panel.add(instructions);
var chartPanel = ui.Panel(); panel.add(chartPanel);
ui.root.insert(0, panel);

// ---------------------------------------------------------
// ---------------------------------------------------------
// 5. INTERACTIVE POINT ANALYTICS (MODULAR CHARTS)
// ---------------------------------------------------------

Map.onClick(function (coords) {
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  var idxKey = indexSelect.getValue();

  // Update Point Marker
  var layers = Map.layers();
  for (var i = 0; i < layers.length(); i++) { if (layers.get(i).getName() === 'Analysis Point') Map.remove(layers.get(i)); }
  Map.addLayer(point, { color: 'red' }, 'Analysis Point');

  chartPanel.clear();
  chartPanel.add(ui.Label('⌛ Processing ' + idxKey + ' time series...', { fontSize: '11px' }));

  var collection, label, color;
  var startDate = '2000-01-01';
  var endDate = '2026-01-01';

  // HELPER: Baseline stats for VCI/TCI/VHI
  var getBaselines = function (coll, band) {
    var months = ee.List.sequence(1, 12);
    return ee.ImageCollection.fromImages(months.map(function (m) {
      var monthColl = coll.filter(ee.Filter.calendarRange(m, m, 'month'));
      return monthColl.min().rename(band + '_min')
        .addBands(monthColl.max().rename(band + '_max'))
        .set('month', m);
    }));
  };

  if (idxKey.indexOf('NDVI') !== -1) {
    collection = ee.ImageCollection("MODIS/061/MOD13A1").filterDate(startDate, endDate).select('NDVI')
      .map(function (img) { return img.divide(10000).rename('val').set('system:time_start', img.get('system:time_start')) });
    label = 'NDVI'; color = '#27AE60';
  }
  else if (idxKey.indexOf('VCI') !== -1) {
    var ndviColl = ee.ImageCollection("MODIS/061/MOD13A1").filterDate(startDate, endDate).select('NDVI');
    var baselines = getBaselines(ndviColl, 'NDVI');
    collection = ndviColl.map(function (img) {
      var m = ee.Date(img.get('system:time_start')).get('month');
      var b = ee.Image(baselines.filter(ee.Filter.eq('month', m)).first());
      var vci = img.subtract(b.select('NDVI_min')).divide(b.select('NDVI_max').subtract(b.select('NDVI_min')).max(0.0001)).multiply(100);
      return vci.rename('val').set('system:time_start', img.get('system:time_start'));
    });
    label = 'VCI (%)'; color = '#27AE60';
  }
  else if (idxKey.indexOf('TCI') !== -1) {
    var lstColl = ee.ImageCollection("MODIS/061/MOD11A1").filterDate(startDate, endDate).select('LST_Day_1km');
    var baselines = getBaselines(lstColl, 'LST_Day_1km');
    collection = lstColl.map(function (img) {
      var m = ee.Date(img.get('system:time_start')).get('month');
      var b = ee.Image(baselines.filter(ee.Filter.eq('month', m)).first());
      var tci = b.select('LST_Day_1km_max').subtract(img).divide(b.select('LST_Day_1km_max').subtract(b.select('LST_Day_1km_min')).max(0.01)).multiply(100);
      return tci.rename('val').set('system:time_start', img.get('system:time_start'));
    });
    label = 'TCI (%)'; color = '#C0392B';
  }
  else if (idxKey.indexOf('VHI') !== -1) {
    var nColl = ee.ImageCollection("MODIS/061/MOD13A1").filterDate(startDate, endDate).select('NDVI');
    var lColl = ee.ImageCollection("MODIS/061/MOD11A1").filterDate(startDate, endDate).select('LST_Day_1km');
    var nBase = getBaselines(nColl, 'NDVI');
    var lBase = getBaselines(lColl, 'LST_Day_1km');
    collection = nColl.map(function (img) {
      var d = ee.Date(img.get('system:time_start'));
      var m = d.get('month');
      var nb = ee.Image(nBase.filter(ee.Filter.eq('month', m)).first());
      var lb = ee.Image(lBase.filter(ee.Filter.eq('month', m)).first());
      var lst = lColl.filterDate(d, d.advance(16, 'day')).mean();
      var vci = img.subtract(nb.select('NDVI_min')).divide(nb.select('NDVI_max').subtract(nb.select('NDVI_min')).max(0.0001)).multiply(100);
      var tci = lb.select('LST_Day_1km_max').subtract(lst).divide(lb.select('LST_Day_1km_max').subtract(lb.select('LST_Day_1km_min')).max(0.01)).multiply(100);
      return vci.multiply(0.5).add(tci.multiply(0.5)).rename('val').set('system:time_start', d.millis());
    });
    label = 'VHI (%)'; color = '#F1C40F';
  }
  else if (idxKey.indexOf('SMI') !== -1) {
    collection = ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001").filterDate(startDate, endDate).select('SoilMoi00_10cm_tavg')
      .map(function (img) { return img.rename('val').set('system:time_start', img.get('system:time_start')) });
    label = 'Soil Moisture'; color = '#D35400';
  }
  else if (idxKey.indexOf('Precip') !== -1 || idxKey.indexOf('SPI') !== -1) {
    collection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(startDate, endDate).select('precipitation')
      .map(function (img) { return img.rename('val').set('system:time_start', img.get('system:time_start')) });
    label = 'Precipitation (mm)'; color = '#2980B9';
  }
  else if (idxKey.indexOf('LST') !== -1) {
    collection = ee.ImageCollection("MODIS/061/MOD11A1").filterDate(startDate, endDate).select('LST_Day_1km')
      .map(function (img) { return img.multiply(0.02).subtract(273.15).rename('val').set('system:time_start', img.get('system:time_start')) });
    label = 'LST (°C)'; color = '#C0392B';
  }
  else if (idxKey.indexOf('RH') !== -1) {
    collection = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE").filterDate(startDate, endDate).select(['vap', 'tmmx', 'tmmn'])
      .map(function (img) {
        var ea = img.select('vap').multiply(0.001);
        var es = img.select('tmmx').multiply(0.1).expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { T: img.select('tmmx').multiply(0.1) })
          .add(img.select('tmmn').multiply(0.1).expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { T: img.select('tmmn').multiply(0.1) })).divide(2);
        return ea.divide(es).multiply(100).rename('val').set('system:time_start', img.get('system:time_start'));
      });
    label = 'RH (%)'; color = '#16A085';
  }
  else {
    collection = ee.ImageCollection("MODIS/061/MOD13A1").filterDate(startDate, endDate).select('NDVI')
      .map(function (img) { return img.divide(10000).rename('val').set('system:time_start', img.get('system:time_start')) });
    label = 'Value'; color = '#7F8C8D';
  }

  var chart = ui.Chart.image.series(collection, point, ee.Reducer.mean(), 1000)
    .setOptions({
      title: idxKey + ' (2000-2025) at Point',
      vAxis: { title: label }, hAxis: { title: 'Date', format: 'YYYY' },
      series: { 0: { color: color, lineWidth: 1.5, pointsVisible: false } },
      legend: { position: 'none' }, chartArea: { width: '85%', left: '12%' }
    });

  chartPanel.clear(); chartPanel.add(chart);
  instructions.setValue('📍 Analysis: ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4));
});

print('Terra Drought Interface v2.0 Initialized.');
