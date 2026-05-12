// ============================================================================
// BINGA AGRICULTURAL DROUGHT DASHBOARD
// Analysis Period: 2000-2025 | Region: Binga District, Zimbabwe
// ============================================================================

// --- 1. INITIAL SETUP & VARIABLES ---
var mainMap = ui.Map();
mainMap.setOptions('SATELLITE');
mainMap.style().set('cursor', 'crosshair');

var districtName = 'Binga';
var bingaBoundary = ee.FeatureCollection("FAO/GAUL/2015/level2")
    .filterBounds(ee.Geometry.Point([27.33, -17.62]))
    .map(function (f) { return f.transform('EPSG:4326', 1); });

print('Found FAO Boundary:', bingaBoundary.size());

var FARM_ASSET_ID = 'projects/ee-mhandutakunda/assets/Binga_Farms';
var useDummyFarms = false;

var farms;
if (useDummyFarms) {
    var randomPoints = ee.FeatureCollection.randomPoints(bingaBoundary.geometry(), 10);
    farms = randomPoints.map(function (pt) {
        return ee.Feature(pt.buffer(1000)).set('Name', 'Dummy Farm ' + pt.id());
    });
} else {
    farms = ee.FeatureCollection(FARM_ASSET_ID).map(function (f) { return f.transform('EPSG:4326', 1); });
}

mainMap.addLayer(bingaBoundary, { color: 'white', fillColor: '00000000', width: 2 }, 'Binga Boundary');
mainMap.addLayer(farms, { color: 'yellow', fillColor: 'ffff0044' }, 'Farms');
mainMap.setCenter(27.33, -17.62, 9);

var startDate = ee.Date('2000-01-01');
var endDate = ee.Date('2025-12-31');

// Pre-calculate months list for iterative processing
var nMonths = endDate.difference(startDate, 'month').round();
var monthsList = ee.List.sequence(0, nMonths.subtract(1));
var months = ee.List.sequence(1, 12);

var appColors = {
    primary: '#1A237E', secondary: '#0277BD', success: '#2E7D32', danger: '#C62828',
    warning: '#F9A825', background: '#FAFAFA', surface: '#FFFFFF', text: '#212121', border: '#E0E0E0', textLight: '#757575'
};

var vizPalettes = {
    ndvi: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
    vhi: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
    spi: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'],
    et: ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'],
    rh: ['#f6eff7', '#d0d1e6', '#a6bddb', '#67a9cf', '#1c9099', '#016c59'],
    tci: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'], // Blue to Red
    smi: ['#92400e', '#fbbf24', '#3b82f6', '#1e40af'], // Brown to Blue (Dry to Wet)
    temp: ['#313695', '#abd9e9', '#ffffbf', '#fee090', '#d73027'] // Cold to Hot
};

// --- 2. DATA PROCESSING FUNCTIONS (Optimized for Farm/Point charting) ---

function getNDVI() {
    return ee.ImageCollection("MODIS/061/MOD13Q1").filterDate(startDate, endDate).select('NDVI')
        .map(function (img) {
            return img.multiply(0.0001).rename('NDVI')
                .set('system:time_start', img.get('system:time_start'))
                .set('Month', ee.Date(img.get('system:time_start')).get('month'));
        });
}

function getET() {
    return ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001").filterDate(startDate, endDate).select('Evap_tavg')
        .map(function (img) { return img.multiply(86400 * 30).rename('ET').set('system:time_start', img.get('system:time_start')); });
}

function getRH() {
    return ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE").filterDate(startDate, endDate).select(['vap', 'tmmx', 'tmmn'])
        .map(function (img) {
            var vap = img.select('vap').multiply(0.001);
            var tmax = img.select('tmmx').multiply(0.1);
            var tmin = img.select('tmmn').multiply(0.1);
            var es_tmax = tmax.expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { 'T': tmax });
            var es_tmin = tmin.expression('0.6108 * exp((17.27 * T) / (T + 237.3))', { 'T': tmin });
            var es = es_tmax.add(es_tmin).divide(2);
            var rh = vap.divide(es).multiply(100).rename('RH').min(100);
            return rh.set('system:time_start', img.get('system:time_start'));
        });
}

function getSMI() {
    return ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001").filterDate(startDate, endDate).select('SoilMoi00_10cm_tavg')
        .map(function (img) { return img.rename('SMI').set('system:time_start', img.get('system:time_start')); });
}

function getTEMP() {
    return ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE").filterDate(startDate, endDate).select(['tmmx', 'tmmn'])
        .map(function (img) {
            var tmax = img.select('tmmx').multiply(0.1);
            var tmin = img.select('tmmn').multiply(0.1);
            var tmean = tmax.add(tmin).divide(2).rename('TEMP');
            return tmean.set('system:time_start', img.get('system:time_start'));
        });
}

function getSPI(monthsRolling, name) {
    var chirpsDataset = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(startDate, endDate).select('precipitation');
    var monthlyPrecip = ee.ImageCollection.fromImages(monthsList.map(function (n) {
        n = ee.Number(n);
        var currentMonthStart = startDate.advance(n, 'month');
        var rollingStart = startDate.advance(n.subtract(monthsRolling - 1), 'month');
        var filtered = chirpsDataset.filterDate(rollingStart, currentMonthStart.advance(1, 'month'));
        var isValid = filtered.size().gt(0).and(n.gte(monthsRolling - 1));

        var sumImage = filtered.sum().rename('Precipitation')
            .set('system:time_start', currentMonthStart.millis())
            .set('Month', currentMonthStart.get('month'))
            .set('has_data', 1);

        return ee.Image(ee.Algorithms.If(isValid, sumImage, ee.Image(0).rename('Precipitation').set('has_data', 0)));
    })).filter(ee.Filter.eq('has_data', 1));

    var ltmPrecip = ee.ImageCollection.fromImages(months.map(function (m) {
        var monthImages = monthlyPrecip.filter(ee.Filter.eq('Month', m));
        var hasData = monthImages.size().gt(0);
        var mean = monthImages.mean().rename('Mean');
        var std = monthImages.reduce(ee.Reducer.stdDev()).rename('Std');
        return ee.Image(ee.Algorithms.If(hasData,
            mean.addBands(std).set('Month', m).set('exists', 1),
            ee.Image(0).rename('Mean').addBands(ee.Image(1).rename('Std')).set('Month', m).set('exists', 0)));
    }));

    return monthlyPrecip.map(function (img) {
        var monthLtm = ee.Image(ltmPrecip.filter(ee.Filter.eq('Month', img.get('Month'))).first());
        var spi = img.select('Precipitation').subtract(monthLtm.select('Mean')).divide(monthLtm.select('Std').max(0.001)).rename(name);
        return spi.set('system:time_start', img.get('system:time_start'));
    });
}

function getLST() {
    return ee.ImageCollection("MODIS/061/MOD11A2").filterDate(startDate, endDate).select('LST_Day_1km')
        .map(function (img) {
            return img.multiply(0.02).subtract(273.15).rename('LST')
                .set('system:time_start', img.get('system:time_start'))
                .set('Month', ee.Date(img.get('system:time_start')).get('month'));
        });
}

function getTCI() {
    var lst = getLST();
    var ltmLST = ee.ImageCollection.fromImages(months.map(function (m) {
        var monthImages = lst.filter(ee.Filter.eq('Month', m));
        var min = monthImages.min().rename('Min'), max = monthImages.max().rename('Max');
        return min.addBands(max).addBands(max.subtract(min).rename('Range')).set('Month', m);
    }));
    return lst.map(function (img) {
        var monthLtm = ee.Image(ltmLST.filter(ee.Filter.eq('Month', img.get('Month'))).first());
        var tci = monthLtm.select('Max').subtract(img.select('LST')).divide(monthLtm.select('Range').max(0.01)).multiply(100).rename('TCI');
        return tci.set('system:time_start', img.get('system:time_start'));
    });
}

function getVCI() {
    var ndvi = getNDVI();
    var ltmNDVI = ee.ImageCollection.fromImages(months.map(function (m) {
        var monthImages = ndvi.filter(ee.Filter.eq('Month', m));
        var min = monthImages.min().rename('Min'), max = monthImages.max().rename('Max');
        return min.addBands(max).addBands(max.subtract(min).rename('Range')).set('Month', m);
    }));
    return ndvi.map(function (img) {
        var monthLtm = ee.Image(ltmNDVI.filter(ee.Filter.eq('Month', img.get('Month'))).first());
        var vci = img.select('NDVI').subtract(monthLtm.select('Min')).divide(monthLtm.select('Range').max(0.0001)).multiply(100).rename('VCI');
        return vci.set('system:time_start', img.get('system:time_start'));
    });
}

function getVHI() {
    var vci = getVCI();
    var tci = getTCI();
    // Simple join on time
    var join = ee.Join.saveFirst('tci_match').apply({
        primary: vci, secondary: tci,
        condition: ee.Filter.maxDifference({ difference: 8 * 24 * 60 * 60 * 1000, leftField: 'system:time_start', rightField: 'system:time_start' })
    });
    return ee.ImageCollection(join).map(function (img) {
        var tciImg = ee.Image(ee.Algorithms.If(img.get('tci_match'), ee.Image(img.get('tci_match')), ee.Image(50).rename('TCI')));
        var vhi = img.select('VCI').multiply(0.5).add(tciImg.select('TCI').multiply(0.5)).rename('VHI');
        return vhi.round().toInt16().set('system:time_start', img.get('system:time_start'));
    });
}

// --- 3. DYNAMIC LEGEND & MAP VISUALIZATION ---

var legendPanel = ui.Panel({
    style: { position: 'bottom-right', padding: '8px 15px', backgroundColor: 'rgba(255, 255, 255, 0.9)' }
});

function createLegend(title, min, max, palette, unit) {
    legendPanel.clear();
    legendPanel.add(ui.Label(title, { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0' }));

    // Create a vertical gradient image
    var gradient = ee.Image.pixelLonLat().select('latitude');
    var legendImage = gradient.visualize({ min: 0, max: 100, palette: palette });

    var thumb = ui.Thumbnail({
        image: legendImage,
        params: { bbox: '0,0,10,100', dimensions: '15x150' },
        style: { padding: '1px', position: 'bottom-center' }
    });

    var labelsPanel = ui.Panel({
        widgets: [
            ui.Label(max + ' ' + unit, { margin: '4px 8px' }),
            ui.Label('', { stretch: 'vertical' }), // Spacer
            ui.Label(min + ' ' + unit, { margin: '4px 8px' })
        ],
        layout: ui.Panel.Layout.flow('vertical'),
        style: { height: '150px' }
    });

    var mainPanel = ui.Panel({
        widgets: [thumb, labelsPanel],
        layout: ui.Panel.Layout.flow('horizontal'),
        style: { margin: '0 0 4px 0' }
    });

    legendPanel.add(mainPanel);
}
mainMap.add(legendPanel);

function updateMapLayer(indexType) {
    mainMap.layers().reset();
    mainMap.addLayer(bingaBoundary, { color: 'black', fillColor: '00000000', width: 2 }, 'Binga Boundary');
    mainMap.addLayer(farms, { color: 'white', fillColor: 'ffffff44', width: 1 }, 'Farms');

    var recentStart = '2024-01-01'; var recentEnd = '2024-12-31';

    if (indexType === 'NDVI') {
        mainMap.addLayer(getNDVI().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0, max: 0.8, palette: vizPalettes.ndvi }, 'NDVI (2024)');
        createLegend('NDVI (Vegetation Index)', 0, 0.8, vizPalettes.ndvi, '');
    } else if (indexType === 'VCI') {
        mainMap.addLayer(getVCI().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0, max: 100, palette: vizPalettes.vhi }, 'VCI (2024)');
        createLegend('VCI (Vegetation Condition)', 0, 100, vizPalettes.vhi, '%');
    } else if (indexType === 'VHI') {
        mainMap.addLayer(getVHI().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0, max: 100, palette: vizPalettes.vhi }, 'VHI (2024)');
        createLegend('VHI (Vegetation Health)', 0, 100, vizPalettes.vhi, '%');
    } else if (indexType === 'TCI') {
        mainMap.addLayer(getTCI().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0, max: 100, palette: vizPalettes.tci }, 'TCI (2024)');
        createLegend('TCI (Temperature Condition)', 0, 100, vizPalettes.tci, '%');
    } else if (indexType === 'ET') {
        mainMap.addLayer(getET().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0, max: 150, palette: vizPalettes.et }, 'ET (2024)');
        createLegend('Evapotranspiration', 0, 150, vizPalettes.et, 'mm/mo');
    } else if (indexType === 'RH') {
        mainMap.addLayer(getRH().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 20, max: 80, palette: vizPalettes.rh }, 'RH (2024)');
        createLegend('Relative Humidity', 20, 80, vizPalettes.rh, '%');
    } else if (indexType === 'SPI-1') {
        mainMap.addLayer(getSPI(1, 'SPI_1').filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: -2, max: 2, palette: vizPalettes.spi }, 'SPI-1 (2024)');
        createLegend('SPI-1 (Precip Anomaly)', -2, 2, vizPalettes.spi, 'Z-Score');
    } else if (indexType === 'SPI-3') {
        mainMap.addLayer(getSPI(3, 'SPI_3').filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: -2, max: 2, palette: vizPalettes.spi }, 'SPI-3 (2024)');
        createLegend('SPI-3 (Precip Anomaly)', -2, 2, vizPalettes.spi, 'Z-Score');
    } else if (indexType === 'SMI') {
        mainMap.addLayer(getSMI().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 0.1, max: 0.4, palette: vizPalettes.smi }, 'SMI (2024)');
        createLegend('Soil Moisture Index', 0.1, 0.4, vizPalettes.smi, 'm³/m³');
    } else if (indexType === 'TEMP') {
        mainMap.addLayer(getTEMP().filterDate(recentStart, recentEnd).mean().clip(bingaBoundary), { min: 15, max: 35, palette: vizPalettes.temp }, 'TEMP (2024)');
        createLegend('Mean Temperature', 15, 35, vizPalettes.temp, '°C');
    }
}
// --- 4. UI INTERFACE (SIDEBAR) ---

var sectionTitleStyle = { fontSize: '14px', fontWeight: 'bold', color: appColors.text, margin: '12px 0 8px 8px' };
var cardStyle = { backgroundColor: appColors.surface, border: '1px solid ' + appColors.border, borderRadius: '4px', padding: '8px', margin: '8px' };

var sidebar = ui.Panel({ layout: ui.Panel.Layout.flow('vertical'), style: { width: '380px', backgroundColor: appColors.background, padding: '0px', border: '1px solid ' + appColors.border } });

var header = ui.Panel([
    ui.Label('Binga Farm Analytics', { fontSize: '20px', fontWeight: 'bold', color: appColors.surface, margin: '15px' }),
    ui.Label('Terra Drought Parametric Engine', { fontSize: '12px', color: '#E0E0E0', margin: '0 15px 15px 15px' })
], ui.Panel.Layout.flow('vertical'), { backgroundColor: appColors.primary, stretch: 'horizontal' });

sidebar.add(header);

var visCard = ui.Panel({ style: cardStyle });
visCard.add(ui.Label('1. Map Visualization', { fontWeight: 'bold', fontSize: '14px', margin: '0 0 8px 0' }));
var layerSelect = ui.Select({
    items: ['NDVI', 'VCI', 'TCI', 'VHI', 'ET', 'RH', 'SPI-1', 'SPI-3', 'SMI', 'TEMP'], value: 'NDVI', onChange: updateMapLayer, style: { width: '100%' }
});
visCard.add(ui.Label('Select a layer to display its spatial distribution and legend on the map.', { fontSize: '11px', color: appColors.textLight }));
visCard.add(layerSelect);
sidebar.add(visCard);

// --- Checkboxes ---
var tsCard = ui.Panel({ style: cardStyle });
tsCard.add(ui.Label('2. Time-Series Metrics', { fontWeight: 'bold', fontSize: '14px', margin: '0 0 8px 0' }));
tsCard.add(ui.Label('First click on a Farm on the map to select it. Then choose indices and run analysis.', { fontSize: '11px', color: appColors.textLight, margin: '0 0 8px 0' }));

var chkNDVI = ui.Checkbox({ label: 'NDVI (Vegetation Index)', value: true });
var chkVCI = ui.Checkbox({ label: 'VCI (Vegetation Condition)', value: false });
var chkVHI = ui.Checkbox({ label: 'VHI (Vegetation Health)', value: true });
var chkTCI = ui.Checkbox({ label: 'TCI (Temperature Index)', value: false });
var vegCard = ui.Panel([ui.Label('Vegetation & Health', { fontSize: '12px', fontWeight: 'bold', color: appColors.text, margin: '8px 0 4px 8px' }), chkNDVI, chkVCI, chkVHI, chkTCI], ui.Panel.Layout.flow('vertical'), { margin: '0' });

var chkET = ui.Checkbox({ label: 'ET (Evapotranspiration)', value: true });
var chkRH = ui.Checkbox({ label: 'RH (Relative Humidity)', value: false });
var chkSPI1 = ui.Checkbox({ label: 'SPI-1 (1-Month Drought)', value: false });
var chkSPI3 = ui.Checkbox({ label: 'SPI-3 (3-Month Drought)', value: false });
var chkSMI = ui.Checkbox({ label: 'SMI (Soil Moisture)', value: true });
var chkTEMP = ui.Checkbox({ label: 'TEMP (Mean Temperature)', value: true });
var cliCard = ui.Panel([ui.Label('Climate & Water', { fontSize: '12px', fontWeight: 'bold', color: appColors.text, margin: '12px 0 4px 8px' }), chkET, chkRH, chkSPI1, chkSPI3, chkSMI, chkTEMP], ui.Panel.Layout.flow('vertical'), { margin: '0' });

tsCard.add(vegCard);
tsCard.add(cliCard);
sidebar.add(tsCard);

var selectedFarmGeom = null;
var statusLabel = ui.Label('Waiting for farm selection...', { color: appColors.textLight, margin: '8px', fontSize: '12px', fontStyle: 'italic' });
sidebar.add(statusLabel);

// --- NEW: EXPORT MASTER TIFF CARD FOR DEPLOYED DOWNLOAD ---
var exportCard = ui.Panel({ style: cardStyle });
exportCard.add(ui.Label('3. Export Master ML Data', { fontWeight: 'bold', fontSize: '14px', margin: '0 0 8px 0' }));
exportCard.add(ui.Label('Choose Index to export as a 25-year TIFF stack:', { fontSize: '11px', color: appColors.textLight }));

var exportSelect = ui.Select({
    items: ['NDVI', 'VCI', 'TCI', 'VHI', 'ET', 'RH', 'SPI-1', 'SPI-3', 'SMI', 'TEMP'],
    value: 'VHI',
    style: { width: '100%' }
});
exportCard.add(exportSelect);

var downloadLinkPlaceholder = ui.Panel();
var btnExportTIFF = ui.Button({
    label: 'Generate TIFF Download Link',
    onClick: function () {
        statusLabel.setValue('⏳ Calculating Download URL for ' + exportSelect.getValue() + '...');
        var idx = exportSelect.getValue();
        var col;
        if (idx === 'NDVI') col = getNDVI();
        else if (idx === 'VCI') col = getVCI();
        else if (idx === 'VHI') col = getVHI();
        else if (idx === 'TCI') col = getTCI();
        else if (idx === 'ET') col = getET();
        else if (idx === 'RH') col = getRH();
        else if (idx === 'SPI-1') col = getSPI(1, 'SPI_1');
        else if (idx === 'SPI-3') col = getSPI(3, 'SPI_3');
        else if (idx === 'SMI') col = getSMI();
        else if (idx === 'TEMP') col = getTEMP();

        // Unmask to -9999 and cast to Int16 to prevent ArcGIS Pro rendering issues
        var exportImg = col.map(function (img) { return img.unmask(-9999).toInt16(); }).toBands();
        var url = exportImg.getDownloadURL({
            name: 'Binga_' + idx + '_Stack',
            scale: 2500, // Increased scale to 2.5km to stay under 50MB GEE App download limit
            region: bingaBoundary.geometry().bounds(), // Use bounds to avoid complex polygon clipping issues
            format: 'GeoTIFF'
        });

        downloadLinkPlaceholder.clear();
        downloadLinkPlaceholder.add(ui.Label('✅ Download ' + idx + ' Stack', { color: appColors.secondary, fontWeight: 'bold', margin: '4px 8px' }, url));
        statusLabel.setValue('✅ Link generated below.');
    },
    style: { stretch: 'horizontal' }
});
exportCard.add(btnExportTIFF);
exportCard.add(downloadLinkPlaceholder);
sidebar.add(exportCard);

// --- Run Analysis ---
var chartPanel = ui.Panel({ style: { padding: '8px', margin: '8px' } });

function runAnalysis() {
    if (!selectedFarmGeom) {
        statusLabel.setValue('⚠️ Please select a farm on the map first!');
        statusLabel.style().set('color', appColors.danger);
        return;
    }

    statusLabel.setValue('⏳ Fetching and processing data... (Charts will appear below)');
    statusLabel.style().set('color', appColors.warning);
    chartPanel.clear();

    chartPanel.add(ui.Label('Farm Analytics (2000-2025)', { fontWeight: 'bold', fontSize: '14px', color: appColors.primary }));

    // Use centroid for charts to avoid projection/intersection errors with complex polygons
    var chartRegion = selectedFarmGeom.centroid(1);

    if (chkNDVI.getValue()) chartPanel.add(ui.Chart.image.series(getNDVI(), chartRegion, ee.Reducer.mean(), 250).setOptions({ title: 'NDVI', vAxis: { title: 'NDVI' }, hAxis: { title: 'Date' }, colors: ['#2E7D32'], lineWidth: 1, pointSize: 0 }));
    if (chkVCI.getValue()) chartPanel.add(ui.Chart.image.series(getVCI(), chartRegion, ee.Reducer.mean(), 250).setOptions({ title: 'VCI', vAxis: { title: 'VCI (%)' }, hAxis: { title: 'Date' }, colors: ['#F9A825'], lineWidth: 1, pointSize: 0 }));
    if (chkVHI.getValue()) chartPanel.add(ui.Chart.image.series(getVHI(), chartRegion, ee.Reducer.mean(), 1000).setOptions({ title: 'VHI', vAxis: { title: 'VHI (%)' }, hAxis: { title: 'Date' }, colors: ['#8E24AA'], lineWidth: 1, pointSize: 0 }));
    if (chkTCI.getValue()) chartPanel.add(ui.Chart.image.series(getTCI(), chartRegion, ee.Reducer.mean(), 1000).setOptions({ title: 'TCI', vAxis: { title: 'TCI (%)' }, hAxis: { title: 'Date' }, colors: ['#C62828'], lineWidth: 1, pointSize: 0 }));
    if (chkET.getValue()) chartPanel.add(ui.Chart.image.series(getET(), chartRegion, ee.Reducer.mean(), 11132).setOptions({ title: 'Evapotranspiration', vAxis: { title: 'ET (mm)' }, hAxis: { title: 'Date' }, colors: ['#0277BD'], lineWidth: 1, pointSize: 0 }));
    if (chkRH.getValue()) chartPanel.add(ui.Chart.image.series(getRH(), chartRegion, ee.Reducer.mean(), 4638).setOptions({ title: 'Relative Humidity', vAxis: { title: 'RH (%)' }, hAxis: { title: 'Date' }, colors: ['#00ACC1'], lineWidth: 1, pointSize: 0 }));
    if (chkSPI1.getValue()) chartPanel.add(ui.Chart.image.series(getSPI(1, 'SPI_1'), chartRegion, ee.Reducer.mean(), 5566).setOptions({ title: 'SPI-1', vAxis: { title: 'Z-Score' }, hAxis: { title: 'Date' }, colors: ['#1A237E'], lineWidth: 1, pointSize: 0 }));
    if (chkSPI3.getValue()) chartPanel.add(ui.Chart.image.series(getSPI(3, 'SPI_3'), chartRegion, ee.Reducer.mean(), 5566).setOptions({ title: 'SPI-3', vAxis: { title: 'Z-Score' }, hAxis: { title: 'Date' }, colors: ['#283593'], lineWidth: 1, pointSize: 0 }));
    if (chkSMI.getValue()) chartPanel.add(ui.Chart.image.series(getSMI(), chartRegion, ee.Reducer.mean(), 11132).setOptions({ title: 'Soil Moisture', vAxis: { title: 'SMI (m³/m³)' }, hAxis: { title: 'Date' }, colors: ['#92400e'], lineWidth: 1, pointSize: 0 }));
    if (chkTEMP.getValue()) chartPanel.add(ui.Chart.image.series(getTEMP(), chartRegion, ee.Reducer.mean(), 4638).setOptions({ title: 'Mean Temperature', vAxis: { title: 'Temp (°C)' }, hAxis: { title: 'Date' }, colors: ['#d73027'], lineWidth: 1, pointSize: 0 }));

    // Generate direct CSV download links
    var downloadCard = ui.Panel({ style: { padding: '8px', margin: '8px 0 0 0', backgroundColor: appColors.surface, border: '1px solid ' + appColors.border, borderRadius: '4px' } });
    downloadCard.add(ui.Label('Download Data (CSV)', { fontWeight: 'bold', fontSize: '14px', margin: '0 0 8px 0' }));
    var linkStyle = { color: appColors.secondary, margin: '4px 8px', fontSize: '12px' };

    function addDownloadLink(collection, bandName, scale, labelName) {
        var fc = ee.FeatureCollection(collection.map(function (img) {
            var dict = img.reduceRegion({
                reducer: ee.Reducer.mean(),
                geometry: chartRegion, // Use centroid for CSV as well for speed/stability
                scale: scale,
                crs: 'EPSG:4326',
                maxPixels: 1e9
            });
            return ee.Feature(null, { Date: img.date().format('YYYY-MM-dd'), Value: dict.get(bandName) });
        }));
        var url = fc.getDownloadURL({ format: 'CSV', selectors: ['Date', 'Value'], filename: labelName + '_Data' });
        downloadCard.add(ui.Label('⬇️ Download ' + labelName, linkStyle, url));
    }

    if (chkNDVI.getValue()) addDownloadLink(getNDVI(), 'NDVI', 250, 'NDVI');
    if (chkVCI.getValue()) addDownloadLink(getVCI(), 'VCI', 250, 'VCI');
    if (chkVHI.getValue()) addDownloadLink(getVHI(), 'VHI', 1000, 'VHI');
    if (chkTCI.getValue()) addDownloadLink(getTCI(), 'TCI', 1000, 'TCI');
    if (chkET.getValue()) addDownloadLink(getET(), 'ET', 11132, 'Evapotranspiration');
    if (chkRH.getValue()) addDownloadLink(getRH(), 'RH', 4638, 'Relative_Humidity');
    if (chkSPI1.getValue()) addDownloadLink(getSPI(1, 'SPI_1'), 'SPI_1', 5566, 'SPI-1');
    if (chkSPI3.getValue()) addDownloadLink(getSPI(3, 'SPI_3'), 'SPI_3', 5566, 'SPI-3');
    if (chkSMI.getValue()) addDownloadLink(getSMI(), 'SMI', 11132, 'Soil_Moisture');
    if (chkTEMP.getValue()) addDownloadLink(getTEMP(), 'TEMP', 4638, 'Temperature');

    chartPanel.add(downloadCard);

    statusLabel.setValue('✅ Analysis complete! Scroll down to see charts and download links.');
    statusLabel.style().set('color', appColors.success);
}

var btnRun = ui.Button({
    label: '▶ RUN ANALYSIS',
    onClick: runAnalysis,
    style: { padding: '8px', margin: '8px 16px', color: appColors.success, border: '1px solid ' + appColors.success, stretch: 'horizontal' }
});

sidebar.add(btnRun);
sidebar.add(chartPanel);

var splitPanel = ui.SplitPanel({ firstPanel: sidebar, secondPanel: mainMap, orientation: 'horizontal' });
ui.root.clear();
ui.root.add(splitPanel);

// --- 5. CLICK HANDLER (FARM SELECTION)---
mainMap.onClick(function (coords) {
    var clickPoint = ee.Geometry.Point([coords.lon, coords.lat]);
    var clickedFarm = farms.filterBounds(clickPoint);

    clickedFarm.size().evaluate(function (count) {
        if (count === 0) {
            statusLabel.setValue('⚠️ Clicked outside any farm boundary. Please click on a white polygon.');
            statusLabel.style().set('color', appColors.danger);
            return;
        }
        // Fix: Explicitly transform and clean geometry to prevent projection errors
        selectedFarmGeom = clickedFarm.first().geometry().transform('EPSG:4326', 1);

        clickedFarm.first().get('Name').evaluate(function (name) {
            statusLabel.setValue('✅ Selected: ' + (name || 'Unnamed Farm') + '. Click "RUN ANALYSIS" to generate charts.');
            statusLabel.style().set('color', appColors.success);
        });

        var layers = mainMap.layers();
        var layersToRemove = [];
        for (var i = 0; i < layers.length(); i++) {
            if (layers.get(i).getName() === 'Selected Farm') { layersToRemove.push(layers.get(i)); }
        }
        layersToRemove.forEach(function (l) { mainMap.remove(l); });
        mainMap.addLayer(selectedFarmGeom, { color: 'cyan' }, 'Selected Farm');
    });
});

// Initialize first layer and center
updateMapLayer('NDVI');
mainMap.setCenter(27.33, -17.62, 9);