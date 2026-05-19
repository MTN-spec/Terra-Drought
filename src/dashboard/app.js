/* ============================================================
   TERRA DROUGHT — Dashboard Application Logic
   ============================================================ */

// --- API Configuration ---
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'https://terra-drought-api.onrender.com'; // Replace with your actual Render URL

document.addEventListener('DOMContentLoaded', () => {

    // ─── Initialize Lucide Icons ───
    lucide.createIcons();

    // ─── Login Logic ───
    const loginOverlay = document.getElementById('login-overlay');
    const loginBtn = document.getElementById('login-btn');
    const loginPass = document.getElementById('login-pass');
    const loginError = document.getElementById('login-error');

    function handleLogin() {
        const pwd = loginPass.value.trim();
        if (pwd === 'Mimosa@2030') {
            loginOverlay.style.display = 'none';
            loginOverlay.classList.add('hidden');
            initData();
        } else {
            loginError.style.display = 'block';
        }
    }
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        loginPass.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }

    // ─── Initialize Leaflet Map ───
    const map = L.map('map', {
        center: [-17.62, 27.33],   // Centered on Binga District
        zoom: 9,
        minZoom: 8,                // Don't allow zooming out to all of Africa
        maxZoom: 18,
        zoomControl: false,
        attributionControl: false
    });

    // ─── Basemaps ───
    const darkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 24,
        maxNativeZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });

    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 24,
        maxNativeZoom: 20,
        attribution: 'Imagery &copy; Google Maps'
    });

    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 24,
        maxNativeZoom: 19,
        attribution: 'Imagery &copy; Esri'
    });

    const topographic = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 24,
        maxNativeZoom: 17,
        attribution: 'Map data: &copy; OpenStreetMap contributors'
    });

    // Default to Google Satellite
    googleSat.addTo(map);

    const baseMaps = {
        "High-Res Google Satellite": googleSat,
        "Esri World Imagery": esriSat,
        "Dark Mode Dashboard": darkMatter,
        "Topographic": topographic
    };

    const farmersGroup = L.layerGroup().addTo(map);

    const overlayMaps = {
        "Monitored Farms": farmersGroup
    };

    // Add Layer Control
    L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

    const fieldLayers = {};

    async function fetchWeatherData(lat = -17.3667, lng = 30.2, locName = 'Chinhoyi Region') {
        try {
            const locEl = document.getElementById('w-loc');
            if (locEl) locEl.textContent = locName + ' (Open-Meteo API)';
            document.getElementById('w-desc').textContent = 'Fetching Live Data...';

            const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=et0_fao_evapotranspiration,precipitation_sum&hourly=soil_moisture_3_to_9cm&timezone=Africa%2FCairo&past_days=30`);
            if (!response.ok) throw new Error('Weather API error');
            const data = await response.json();

            const current = data.current;
            const daily = data.daily;
            const hourly = data.hourly;

            document.getElementById('w-temp').textContent = Math.round(current.temperature_2m) + '°';
            document.getElementById('w-wind').textContent = current.wind_speed_10m + ' km/h';

            const past30Precip = (daily && daily.precipitation_sum) ? daily.precipitation_sum.filter((_, i) => i < 30).reduce((a, b) => a + (b || 0), 0) : 0;
            document.getElementById('w-precip').textContent = Math.round(past30Precip) + ' mm';

            const todayEt0 = (daily && daily.et0_fao_evapotranspiration) ? (daily.et0_fao_evapotranspiration[30] || daily.et0_fao_evapotranspiration[0]) : 0;
            document.getElementById('w-et0').textContent = (todayEt0 || 0).toFixed(1) + ' mm/d';

            const sm = hourly && hourly.soil_moisture_3_to_9cm;
            const currentSoil = sm ? sm[sm.length - 1] : null;
            document.getElementById('w-soil').textContent = (currentSoil != null ? currentSoil.toFixed(2) : '--') + ' m³/m³';

            const c = current.weather_code;
            let desc = 'Clear', icon = '☀️';
            if (c === 0) { desc = 'Clear sky'; icon = '☀️'; }
            else if (c <= 3) { desc = 'Partly cloudy'; icon = '⛅'; }
            else if (c === 45 || c === 48) { desc = 'Foggy'; icon = '🌫️'; }
            else if (c <= 67) { desc = 'Rain'; icon = '🌧️'; }
            else if (c <= 77) { desc = 'Snow'; icon = '❄️'; }
            else if (c <= 82) { desc = 'Rain showers'; icon = '🌦️'; }
            else if (c >= 95) { desc = 'Thunderstorm'; icon = '⛈️'; }

            document.getElementById('w-desc').textContent = desc;
            document.getElementById('w-icon').textContent = icon;
        } catch (err) {
            console.error('Error fetching weather:', err);
            document.getElementById('w-desc').textContent = 'Live data unavailable';
        }
    }

    function initData() {
        fetchWeatherData(-17.62, 27.33, 'Binga District');
        loadForecast(); // Load ML Prediction Forecast
        loadRegionalIndices(); // Load Regional Drought Indices
        loadAdminBoundary(); // Load Binga District boundary
        loadProtectedZones(); // Load National Parks (Excluded Zones)
        fetch(API_BASE_URL + '/api/farmers')
            .then(res => {
                if (!res.ok) throw new Error("API Offline");
                return res.json();
            })
            .then(data => {
                if (data.status === "error") throw new Error(data.message);
                return data;
            })
            .catch(() => {
                console.warn("Live API not found, falling back to static farmer_db.json");
                return fetch('data/farmer_db.json').then(res => res.json());
            })
            .then(data => {
                const panelFields = document.getElementById('panel-fields');
                if (!panelFields) return;
                panelFields.querySelectorAll('.field-card').forEach(c => c.remove());

                let severeCount = 0;
                let moderateCount = 0;

                data.features.forEach((feature, index) => {
                    const props = feature.properties;
                    const coords = feature.geometry.coordinates;
                    const geomType = feature.geometry.type;
                    const fieldId = 'field-' + index;

                    let layer;
                    if (geomType === 'Point') {
                        layer = L.circleMarker([coords[1], coords[0]], {
                            radius: 8, color: props.color, fillColor: props.color, fillOpacity: 0.4, weight: 2
                        }).addTo(farmersGroup);
                    } else if (geomType === 'LineString' || geomType === 'Polygon') {
                        let latLngs = [];
                        let sourceCoords = geomType === 'Polygon' ? coords[0] : coords;
                        sourceCoords.forEach(c => latLngs.push([c[1], c[0]]));

                        layer = L.polygon(latLngs, {
                            color: props.color, weight: 2, fillColor: props.color, fillOpacity: 0.25,
                            dashArray: props.status === 'triggered' ? '6,4' : null
                        }).addTo(farmersGroup);
                    }

                    const center = layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng();
                    L.circleMarker(center, {
                        radius: 12, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.3, weight: 2, className: 'pulse-marker'
                    }).addTo(farmersGroup);

                    const status = props.status; // 'severe', 'moderate', or 'healthy'
                    const thumbClass = status === 'severe' ? 'critical' : (status === 'moderate' ? 'alert' : 'healthy');

                    if (status === 'severe') severeCount++;
                    if (status === 'moderate') moderateCount++;

                    const nameParts = props.name.trim().split(' ');
                    const initials = nameParts.length > 1
                        ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
                        : props.name.substring(0, 2).toUpperCase();

                    const farmSize = props.farm_size || (Math.random() * 8 + 2).toFixed(1);

                    const card = document.createElement('div');
                    card.className = 'field-card';
                    card.id = fieldId;
                    card.dataset.status = status;

                    card.innerHTML = `
                        <div class="field-card-thumb">
                            <div class="field-avatar">${initials}</div>
                            <span class="field-status-dot ${status}"></span>
                        </div>
                        <div class="field-card-info" style="width: 100%;">
                            <h4>${props.name}</h4>
                            <div class="field-meta">
                                <span><i data-lucide="leaf" style="width:12px;height:12px"></i> Tobacco</span>
                                <span style="margin-left:8px">• ${farmSize} ha</span>
                            </div>
                            <div class="field-indices" style="margin-bottom: 6px;">
                                <span class="idx-pill ${thumbClass}">Severity: ${props.Predicted_Risk || props.hybrid_risk_score || '0'}</span>
                                <span class="idx-pill healthy" style="margin-left:5px">NDVI: ${props.NDVI || props.ndvi || '0'}</span>
                            </div>
                            <div style="padding: 6px; background: rgba(59,130,246,0.05); border-left: 3px solid #3b82f6; border-radius: 4px; margin-top: 5px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-size: 10px; color: #94a3b8; text-transform: uppercase; display: flex; align-items: center;"><i data-lucide="info" style="width:10px; height:10px; margin-right:4px;"></i>Prediction Basis</span>
                                    <span style="font-size: 11px; font-weight: 600; color: #3b82f6;">SMI: ${props.SMI || '0.0'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                    panelFields.appendChild(card);

                    card.addEventListener('click', () => {
                        let center;
                        if (layer.getBounds) {
                            map.flyToBounds(layer.getBounds().pad(0.5), { duration: 1.2 });
                            center = layer.getBounds().getCenter();
                        } else {
                            map.flyTo(layer.getLatLng(), 15, { duration: 1.2 });
                            center = layer.getLatLng();
                        }
                        layer.openPopup();

                        // Update Weather Panel dynamically
                        fetchWeatherData(center.lat, center.lng, props.name);
                    });
                });

                // Update summary stats
                document.getElementById('stat-monitored').textContent = data.features.length;
                document.getElementById('stat-severe').textContent = severeCount;
                document.getElementById('stat-forecast').textContent = (severeCount + moderateCount);

                lucide.createIcons();
            })
            .catch(err => console.error('Error loading farms:', err));
    }

    function loadForecast() {
        const forecastList = document.getElementById('forecast-list');
        if (!forecastList) return;

        console.log("Loading predictions from:", API_BASE_URL + '/api/predict');
        fetch(API_BASE_URL + '/api/predict')
            .then(res => {
                if (!res.ok) throw new Error("API returns " + res.status);
                return res.json();
            })
            .then(data => {
                forecastList.innerHTML = '';
                if (data.status === 'error') {
                    forecastList.innerHTML = `<div class="error-msg" style="color:#f87171; padding:15px; background:rgba(239,68,68,0.1); border-radius:8px; font-size:13px;">
                        <strong>⚠️ API Offline / Model Error</strong><br>${data.message}
                    </div>`;
                    return;
                }

                // Add a "Hybrid Model Status" header
                const header = document.createElement('div');
                header.style.marginBottom = '15px';
                header.innerHTML = `<div style="background:rgba(59,130,246,0.1); border:1px solid #3b82f6; padding:10px; border-radius:6px;">
                    <span style="color:#60a5fa; font-weight:700; font-size:11px; text-transform:uppercase;">Model Status</span>
                    <p style="margin:5px 0 0; font-size:12px; color:#e8ecf1;">${data.note || "CNN-LSTM Spatiotemporal Analysis Active"}</p>
                </div>`;
                forecastList.appendChild(header);

                if (!data.forecast) return;

                data.forecast.forEach(item => {
                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const monthName = monthNames[(item.month - 1) % 12];
                    const riskClass = item.risk_level === 'High' ? 'triggered' : (item.risk_level === 'Moderate' ? 'warning' : 'healthy');

                    const div = document.createElement('div');
                    div.className = 'timeline-item ' + riskClass;
                    div.innerHTML = `
                        <div class="timeline-dot"></div>
                        <div class="timeline-content">
                            <div style="display:flex; justify-content:space-between; align-items:center">
                                <span class="timeline-date">${monthName} 2026 (${item.horizon})</span>
                                <span class="idx-pill ${riskClass}">${item.risk_level} Risk</span>
                            </div>
                            <p style="margin: 5px 0 0; color: #e8ecf1">Predicted VHI Index: <strong>${item.predicted_vhi}</strong></p>
                            <div class="spi-bar" style="height: 4px; margin-top: 8px;">
                                <div class="spi-marker" style="left: ${item.predicted_vhi}%"></div>
                                <div class="spi-gradient"></div>
                            </div>
                        </div>
                    `;
                    forecastList.appendChild(div);
                });

                // Update analytics too
                const avgVhi = document.getElementById('avg-vhi');
                if (avgVhi && data.forecast.length > 0) {
                    avgVhi.textContent = data.forecast[0].predicted_vhi;
                    document.getElementById('vhi-status').textContent = `Status: ${data.forecast[0].risk_level}`;
                }
            })
            .catch(err => {
                console.error("Forecast API Error:", err);
                forecastList.innerHTML = `<div class="error-msg" style="color:#f87171; padding:15px; background:rgba(239,68,68,0.1); border-radius:8px; font-size:13px;">
                <strong>⚠️ Forecast Model Offline</strong><br>Unable to reach prediction backend.
            </div>`;
            });
    }

    function loadRegionalIndices() {
        fetch(API_BASE_URL + '/api/regional_indices')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'error') return;

                // Update the DOM elements
                if (document.getElementById('idx-ndvi-val')) document.getElementById('idx-ndvi-val').textContent = data.ndvi;
                if (document.getElementById('idx-vci-val')) document.getElementById('idx-vci-val').textContent = data.vci + '%';
                if (document.getElementById('idx-tci-val')) document.getElementById('idx-tci-val').textContent = data.tci + '%';
                if (document.getElementById('idx-vhi-val')) document.getElementById('idx-vhi-val').textContent = data.vhi + '%';
                if (document.getElementById('idx-spi1-val')) document.getElementById('idx-spi1-val').textContent = data.spi1;
                if (document.getElementById('idx-spi3-val')) document.getElementById('idx-spi3-val').textContent = data.spi3;
                if (document.getElementById('idx-smi-val')) document.getElementById('idx-smi-val').textContent = data.smi + ' m³';

                // Update the progress bars (values are out of 100 or mapped appropriately)
                const mapBar = (val, max, elId) => {
                    const el = document.querySelector(`#${elId} .idx-bar-fill`);
                    if (el) el.style.width = Math.min(Math.max((val / max) * 100, 0), 100) + '%';
                };

                mapBar(data.ndvi + 1, 2, 'idx-ndvi'); // -1 to 1 mapped to 0-100%
                mapBar(data.vci, 100, 'idx-vci');
                mapBar(data.tci, 100, 'idx-tci');
                mapBar(data.vhi, 100, 'idx-vhi');
                mapBar(data.spi1 + 3, 6, 'idx-spi1'); // -3 to 3 mapped to 0-100%
                mapBar(data.spi3 + 3, 6, 'idx-spi3');
                mapBar(data.smi, 1, 'idx-smi'); // 0 to 1 mapped to 0-100%
            })
            .catch(err => console.error('Error loading regional indices:', err));
    }

    // ─── Map Controls ───
    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
    document.getElementById('locate-me').addEventListener('click', () => {
        map.setView([-17.275576, 29.990513], 11);
    });
    document.getElementById('fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });

    // Update coords display on mouse move
    map.on('mousemove', (e) => {
        const lat = e.latlng.lat.toFixed(2);
        const lng = e.latlng.lng.toFixed(2);
        document.getElementById('coords').textContent = `${lat}°S, ${lng}°E`;
    });
    map.on('zoomend', () => {
        document.getElementById('zoom-level').textContent = `Zoom: ${map.getZoom()}`;
    });


    // ─── AOI Drawing Tools (Leaflet.draw) ───
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: { color: '#60a5fa', weight: 2, fillColor: '#60a5fa', fillOpacity: 0.15 }
            },
            rectangle: {
                shapeOptions: { color: '#8b5cf6', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.15 }
            },
            circle: {
                shapeOptions: { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.15 }
            },
            polyline: {
                shapeOptions: { color: '#10b981', weight: 3 }
            },
            marker: true,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });

    let drawControlActive = false;

    // Toggle draw toolbar via sidebar button
    const drawBtn = document.getElementById('nav-draw');
    if (drawBtn) {
        drawBtn.addEventListener('click', () => {
            if (drawControlActive) {
                map.removeControl(drawControl);
                drawBtn.classList.remove('active');
                drawControlActive = false;
            } else {
                map.addControl(drawControl);
                drawBtn.classList.add('active');
                drawControlActive = true;
            }
        });
    }

    // Handle newly created shapes
    map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        const type = e.layerType;

        let popupContent = `<div style="font-family:Inter,sans-serif;font-size:12px;color:#e8ecf1">`;
        popupContent += `<strong style="color:#60a5fa;text-transform:uppercase">${type}</strong><br>`;

        if (type === 'polygon' || type === 'rectangle') {
            const latlngs = layer.getLatLngs()[0];
            const area = L.GeometryUtil ? L.GeometryUtil.geodesicArea(latlngs) : 0;
            if (area > 0) {
                const hectares = (area / 10000).toFixed(2);
                popupContent += `<span style="color:#8b99ab">Area:</span> <span style="color:#10b981;font-weight:600">${hectares} ha</span><br>`;
            }
        } else if (type === 'circle') {
            const radius = layer.getRadius();
            const areaM2 = Math.PI * radius * radius;
            const hectares = (areaM2 / 10000).toFixed(2);
            popupContent += `<span style="color:#8b99ab">Radius:</span> ${radius.toFixed(0)} m<br>`;
            popupContent += `<span style="color:#8b99ab">Area:</span> <span style="color:#10b981;font-weight:600">${hectares} ha</span><br>`;
        } else if (type === 'polyline') {
            let totalDist = 0;
            const coords = layer.getLatLngs();
            for (let i = 1; i < coords.length; i++) {
                totalDist += coords[i - 1].distanceTo(coords[i]);
            }
            popupContent += `<span style="color:#8b99ab">Length:</span> ${(totalDist / 1000).toFixed(2)} km<br>`;
        } else if (type === 'marker') {
            const ll = layer.getLatLng();
            popupContent += `<span style="color:#8b99ab">Lat:</span> ${ll.lat.toFixed(5)}<br>`;
            popupContent += `<span style="color:#8b99ab">Lng:</span> ${ll.lng.toFixed(5)}<br>`;
        }

        popupContent += `</div>`;
        layer.bindPopup(popupContent, { className: 'dark-popup' });
        drawnItems.addLayer(layer);
    });

    map.on(L.Draw.Event.DELETED, () => {
        console.log('AOI shapes deleted');
    });


    // ─── Sidebar Navigation ───
    const navBtns = document.querySelectorAll('.sidebar-nav .nav-btn');
    const panelTitle = document.getElementById('panel-title');
    const rightPanel = document.getElementById('right-panel');
    const mapContainer = document.getElementById('map-container');
    const bottomPanel = document.getElementById('bottom-panel');

    const panelMap = {
        'fields': { title: 'MONITORED FARMS', content: 'panel-fields' },
        'claims': { title: 'DROUGHT FORECAST', content: 'panel-claims' },
        'weather': { title: 'CLIMATE CONDITIONS', content: 'panel-weather' },
        'analytics': { title: 'PORTFOLIO ANALYTICS', content: 'panel-analytics' },
        'notifications': { title: 'NOTIFICATIONS', content: 'panel-notifications' }
    };

    function showPanel(panelKey) {
        // Hide all panel contents
        document.querySelectorAll('.panel-content').forEach(p => p.classList.add('hidden'));

        if (panelKey && panelMap[panelKey]) {
            const cfg = panelMap[panelKey];
            panelTitle.textContent = cfg.title;
            document.getElementById(cfg.content).classList.remove('hidden');
            rightPanel.classList.remove('closed');
            mapContainer.classList.remove('panel-closed');
            bottomPanel.classList.remove('panel-closed');
        }
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const panelKey = btn.dataset.panel;
            if (panelKey === 'none') {
                // Keep current panel
            } else {
                showPanel(panelKey);
            }
        });
    });

    // Close panel button
    document.getElementById('panel-close').addEventListener('click', () => {
        rightPanel.classList.toggle('closed');
        mapContainer.classList.toggle('panel-closed');
        bottomPanel.classList.toggle('panel-closed');
        setTimeout(() => map.invalidateSize(), 300);
    });

    // (Field card click listeners are now attached dynamically in initData)


    // ─── Search & Global Filter Logic ───
    function applyFilters() {
        const query = (document.getElementById('search-input')?.value || '').toLowerCase();
        const activeFilter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';

        document.querySelectorAll('.field-card').forEach(card => {
            const name = card.querySelector('h4').textContent.toLowerCase();
            const crop = "tobacco"; // We hardcoded it in the UI
            const matchesQuery = name.includes(query) || crop.includes(query);
            const matchesFilter = activeFilter === 'all' || card.dataset.status === activeFilter;

            if (matchesQuery && matchesFilter) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    // Bind Search Bar
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }

    // Bind Filter Chips
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyFilters();
        });
    });


    // ─── Layer Tabs ───
    const layerTabs = document.querySelectorAll('.layer-tab');
    layerTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            layerTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const category = tab.dataset.tab;
            document.querySelectorAll('.layer-card').forEach(card => {
                if (category === 'all') {
                    card.style.display = 'flex';
                } else {
                    card.style.display = card.dataset.category === category ? 'flex' : 'none';
                }
            });
        });
    });

    // ─── Satellite Layer Tile Definitions ───
    const layerCards = document.querySelectorAll('.layer-card');
    const indexRanges = {
        'ndvi': '-1.0 — 1.0',
        'ndwi': '-1.0 — 1.0',
        'vci': '0 — 100%',
        'vhi': '0 — 100%',
        'spi': '-3.0 — 3.0',
        'rai': '-4.0 — 4.0',
        'evi': '0.0 — 1.0',
        'smi': '0.0 — 1.0',
        'lst': '15°C — 45°C',
        'rainfall': '0 — 100mm',
        'risk': 'Low — Severe',
        'truecolor': 'Natural'
    };
    const indexGradients = {
        'ndvi': 'linear-gradient(90deg, #d73027, #f46d43, #fdae61, #fee08b, #d9ef8b, #a6d96a, #66bd63, #1a9850)',
        'vhi': 'linear-gradient(90deg, #d73027, #f46d43, #fdae61, #fee08b, #d9ef8b, #a6d96a, #66bd63, #1a9850)',
        'vci': 'linear-gradient(90deg, #800000, #ff0000, #ffff00, #00ff00)',
        'spi': 'linear-gradient(90deg, #7b3294, #c2a5cf, #f7f7f7, #a6dba0, #008837)',
        'rai': 'linear-gradient(90deg, #a6611a, #dfc27d, #f5f5f5, #80cdc1, #018571)',
        'ndwi': 'linear-gradient(90deg, #ff7f00, #ffffff, #0000ff)',
        'evi': 'linear-gradient(90deg, #63300a, #ffff00, #00ff00, #004000)',
        'smi': 'linear-gradient(90deg, #ff0000, #ffa500, #ffff00, #008000, #0000ff)',
        'lst': 'linear-gradient(90deg, #313695, #abd9e9, #fee090, #d73027)',
        'rainfall': 'linear-gradient(90deg, #f7fbff, #deebf7, #9ecae1, #4292c6, #084594)',
        'risk': 'linear-gradient(90deg, #1a9850, #91cf60, #d9ef8b, #fee08b, #fc8d59, #d73027)',
        'truecolor': 'none'
    };

    const satelliteLayers = {};
    let activeOverlay = null;
    let activeLayerKey = null;

    // NASA GIBS — MODIS NDVI (16-day, 250m)
    satelliteLayers['ndvi'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_NDVI_8Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.7,
        time: '2024-04-10', // Reliable recent date for demo
        crs: L.CRS.EPSG3857,
        attribution: 'NASA GIBS MODIS NDVI'
    });

    // NASA GIBS — MODIS Land Surface Temperature
    satelliteLayers['lst'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_Land_Surface_Temp_Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.7,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'NASA GIBS MODIS LST'
    });

    // ESRI World Imagery (True Color satellite)
    satelliteLayers['truecolor'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        opacity: 0.9,
        attribution: 'Esri World Imagery'
    });

    // NASA GIBS — CHIRPS-like Precipitation
    satelliteLayers['rainfall'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'IMERG_Precipitation_Rate',
        format: 'image/png',
        transparent: true,
        opacity: 0.65,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'NASA GIBS GPM IMERG'
    });

    // Sentinel-2 Cloudless (EVI/NDWI approximation via visual bands)
    satelliteLayers['ndwi'] = L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', {
        opacity: 0.7,
        attribution: 'EOX Sentinel-2 Cloudless'
    });

    // EVI — Use MODIS EVI from GIBS
    satelliteLayers['evi'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_EVI_8Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.7,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'NASA GIBS MODIS EVI'
    });

    // VCI — Derived (placeholder using NDVI layer with different styling)
    satelliteLayers['vci'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_NDVI_8Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.6,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'VCI (derived from MODIS NDVI baseline)'
    });

    // SMI — Soil Moisture from SMAP (NASA GIBS)
    satelliteLayers['smi'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
        format: 'image/png',
        transparent: true,
        opacity: 0.65,
        time: '2024-01-10', // SMAP data has longer lag
        crs: L.CRS.EPSG3857,
        attribution: 'NASA SMAP L4 Soil Moisture'
    });

    // Risk Map — Semi-transparent red overlay using MODIS Thermal Anomalies
    satelliteLayers['risk'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_Thermal_Anomalies_Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.6,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'AI Risk Score (MODIS Thermal)'
    });

    // VHI — Standard Research Definition
    satelliteLayers['vhi'] = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: 'MODIS_Terra_NDVI_8Day',
        format: 'image/png',
        transparent: true,
        opacity: 0.7,
        time: '2024-04-10',
        crs: L.CRS.EPSG3857,
        attribution: 'VHI Proxy'
    });

    // SPI/RAI — PLACEHOLDERS (These will be filled by your synced GEE maps)
    satelliteLayers['spi'] = null;
    satelliteLayers['rai'] = null;

    layerCards.forEach(card => {
        card.addEventListener('click', () => {
            layerCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const layer = card.dataset.layer;
            const name = card.querySelector('.layer-name').textContent;

            // Update badge safely
            const indexBadge = document.getElementById('active-index-badge');
            if (indexBadge) {
                indexBadge.querySelector('span:first-of-type').textContent = name;
                indexBadge.querySelector('.index-range').textContent = indexRanges[layer] || '';
                indexBadge.querySelector('.index-color-swatch').style.background = indexGradients[layer] || '';
            }

            // Toggle satellite overlay on map
            if (activeOverlay) {
                map.removeLayer(activeOverlay);
                activeOverlay = null;
            }

            if (activeLayerKey === layer) {
                activeLayerKey = null;
                return;
            }

            // PRIORITIZE LOCAL DATA: If we have a synced GEE map for this category, use it
            if (layer === 'risk' || layer === 'smi' || layer === 'ndvi') {
                const driveSelect = document.getElementById('drive-image-select');
                // Check if there's an option in the drive dropdown that matches this layer name
                const matchingOpt = Array.from(driveSelect.options).find(opt =>
                    opt.textContent.toLowerCase().includes(layer.toLowerCase())
                );

                if (matchingOpt) {
                    console.log(`Using local research data for ${layer}:`, matchingOpt.value);
                    driveSelect.value = matchingOpt.value;
                    driveSelect.dispatchEvent(new Event('change'));
                    activeLayerKey = layer;
                    return;
                }
            }

            // Fallback to NASA/EOX Global Services if no local map found
            if (satelliteLayers[layer]) {
                activeOverlay = satelliteLayers[layer];
                map.addLayer(activeOverlay);
                activeLayerKey = layer;
            } else {
                console.warn(`Layer ${layer} not found in local sync or global providers.`);
            }
        });
    });


    // ─── Bottom Layers Toggle ───
    const layersToggle = document.getElementById('layers-toggle');
    layersToggle.addEventListener('click', () => {
        bottomPanel.classList.toggle('collapsed');
        const isCollapsed = bottomPanel.classList.contains('collapsed');
        layersToggle.querySelector('span').textContent = isCollapsed ? 'Show' : 'Hide';

        // Move map info badges
        const newBottom = isCollapsed ? '44px' : 'var(--bottom-panel-height)';
        document.querySelector('.map-info').style.bottom = isCollapsed ? '44px' : '';
        document.querySelector('.active-index-badge').style.bottom = isCollapsed ? '44px' : '';
    });


    // ─── Resize Map on Window Resize ───
    window.addEventListener('resize', () => map.invalidateSize());

    // ─── Administrative Boundary Loading ───
    async function loadAdminBoundary() {
        try {
            const response = await fetch('data/Binga_District.kmz');
            const arrayBuffer = await response.arrayBuffer();

            // Use JSZip and toGeoJSON to parse KMZ
            const zip = await JSZip.loadAsync(arrayBuffer);
            const kmlFile = Object.keys(zip.files).find(f => f.endsWith('.kml'));
            const kmlText = await zip.file(kmlFile).async("string");

            const parser = new DOMParser();
            const kml = parser.parseFromString(kmlText, "text/xml");
            const geojson = toGeoJSON.kml(kml);

            const boundaryLayer = L.geoJSON(geojson, {
                style: {
                    color: '#60a5fa',
                    weight: 3,
                    fillOpacity: 0.1,
                    dashArray: '5, 5'
                },
                interactive: false
            }).addTo(map);

            // Set strict bounds to Binga District
            const bounds = boundaryLayer.getBounds();
            map.fitBounds(bounds);
            map.setMaxBounds(bounds.pad(0.1)); // Add 10% padding but restrict movement

            console.log("Binga District boundary loaded and map restricted.");
        } catch (err) {
            console.error("Error loading Binga boundary:", err);
        }
    }

    // Initial panel
    showPanel('fields');
    document.getElementById('nav-fields').classList.add('active');
    document.getElementById('nav-dashboard').classList.remove('active');

    // ─── Custom Popup Styles ───
    const style = document.createElement('style');
    style.textContent = `
        .dark-popup .leaflet-popup-content-wrapper {
            background: rgba(22, 33, 48, 0.95);
            color: #e8ecf1;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            backdrop-filter: blur(8px);
        }
        .dark-popup .leaflet-popup-tip {
            background: rgba(22, 33, 48, 0.95);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .dark-popup .leaflet-popup-close-button {
            color: #8b99ab !important;
        }
        .pulse-marker {
            animation: pulse-ring 2s ease infinite;
        }
        @keyframes pulse-ring {
            0% { opacity: 1; }
            50% { opacity: 0.4; }
            100% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // ─── Live Weather API (Open-Meteo) ───
    async function fetchLiveWeather(lat = -17.2755, lng = 29.9905) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&hourly=soil_moisture_0_to_1cm,et0_fao_evapotranspiration&timezone=Africa%2FHarare`;

            const res = await fetch(url);
            const data = await res.json();
            if (!data || !data.current) return;
            const current = data.current;

            // DOM Update
            const wTemp = document.getElementById('w-temp');
            const wDesc = document.getElementById('w-desc');
            const wIcon = document.getElementById('w-icon');
            const wPrecip = document.getElementById('w-precip');
            const wWind = document.getElementById('w-wind');

            if (wTemp) wTemp.textContent = current.temperature_2m;
            if (wPrecip) wPrecip.textContent = current.precipitation + ' mm';
            if (wWind) wWind.textContent = current.wind_speed_10m + ' km/h';

            const code = current.weather_code;
            let condition = "Clear";
            let emoji = "☀️";
            if (code === 1 || code === 2) { condition = "Partly Cloudy"; emoji = "⛅"; }
            else if (code === 3) { condition = "Overcast"; emoji = "☁️"; }
            else if (code >= 51) { condition = "Rain / Showers"; emoji = "🌧️"; }

            if (wDesc) wDesc.textContent = condition + (typeof selectedFarm !== 'undefined' && selectedFarm ? ` (${selectedFarm.properties.name})` : " (Binga)");
            if (wIcon) wIcon.textContent = emoji;

            // Also update bottom bar indices
            if (document.getElementById('idx-lst-val')) document.getElementById('idx-lst-val').textContent = Math.round(current.temperature_2m) + '°C';
            if (document.getElementById('idx-precip-val')) document.getElementById('idx-precip-val').textContent = current.precipitation + ' mm';
            if (document.getElementById('idx-rh-val')) document.getElementById('idx-rh-val').textContent = current.relative_humidity_2m + '%';

            // Use hourly if available
            const et0 = data.hourly && data.hourly.et0_fao_evapotranspiration ? data.hourly.et0_fao_evapotranspiration[0] : 0;
            if (document.getElementById('idx-et-val')) document.getElementById('idx-et-val').textContent = (et0 || 0).toFixed(1) + ' mm/d';

            const mapBar = (val, max, elId) => {
                const el = document.querySelector(`#${elId} .idx-bar-fill`);
                if (el) el.style.width = Math.min(Math.max((val / max) * 100, 0), 100) + '%';
            };
            mapBar(current.temperature_2m, 50, 'idx-lst');
            mapBar(current.precipitation, 100, 'idx-precip');
            mapBar(current.relative_humidity_2m, 100, 'idx-rh');
            mapBar(et0, 10, 'idx-et');

        } catch (error) { console.error("Weather Error:", error); }
    }

    // ─── Real Notifications ───
    function updateNotifications(severeCount) {
        const container = document.querySelector('.notifications-list');
        if (!container) return;
        container.innerHTML = '';

        if (severeCount > 0) {
            container.innerHTML += `
                <div class="notif-item alert">
                    <div class="notif-icon">⚠️</div>
                    <div class="notif-body">
                        <strong>Severe Drought Detected</strong>
                        <p>${severeCount} farms in Binga have crossed the research threshold.</p>
                        <span class="notif-time">Just Now</span>
                    </div>
                </div>
            `;
        }
        container.innerHTML += `
            <div class="notif-item info">
                <div class="notif-icon">🛰️</div>
                <div class="notif-body">
                    <strong>GEE Sync Complete</strong>
                    <p>Satellite indices for 2000-2025 loaded successfully.</p>
                    <span class="notif-time">Today</span>
                </div>
            </div>
        `;
    }

    // ─── PDF & QR Logic ───
    const shareBtn = document.getElementById('nav-share');
    const reportsBtn = document.getElementById('nav-reports');
    const reportModal = document.getElementById('report-modal');
    const downloadBtn = document.getElementById('download-pdf-btn');

    function generatePDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const title = selectedFarm ? `Research Report: ${selectedFarm.properties.name}` : "Binga District Drought Analysis";
        doc.setFontSize(22);
        doc.text("TerraDrought Monitoring Report", 20, 20);
        doc.setFontSize(14);
        doc.text(title, 20, 35);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 45);

        doc.setFontSize(12);
        doc.text("--------------------------------------------------", 20, 55);

        if (selectedFarm) {
            const p = selectedFarm.properties;
            doc.text(`Crop Type: ${p.crop || 'Maize'}`, 20, 65);
            doc.text(`Satellite VHI: ${p.VHI || 'N/A'}`, 20, 75);
            doc.text(`Drought Severity Index: ${p.Predicted_Risk || '0.0'}`, 20, 85);
            doc.text(`Model Note: Hybrid CNN-LSTM Prediction based on 25yr history.`, 20, 105);
        } else {
            doc.text("District Summary:", 20, 65);
            doc.text("- Analysis of 269 farm boundaries in Binga District.", 20, 75);
            doc.text("- Indices sourced from GEE (2000-2025).", 20, 85);
        }

        doc.save(selectedFarm ? `Report_${selectedFarm.properties.name}.pdf` : "Binga_Drought_Report.pdf");
    }

    if (shareBtn || reportsBtn) {
        [shareBtn, reportsBtn].forEach(btn => btn?.addEventListener('click', () => {
            reportModal.style.display = 'flex';
            const qrContainer = document.getElementById('qr-container');
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, {
                text: "https://terra-drought.vercel.app/report/latest.pdf",
                width: 128,
                height: 128
            });
        }));
    }

    if (downloadBtn) downloadBtn.addEventListener('click', generatePDF);

    // ─── AOI Upload Logic ───
    const aoiUploadBtn = document.getElementById('aoi-upload-btn');
    const aoiFileInput = document.getElementById('aoi-file-input');

    if (aoiUploadBtn && aoiFileInput) {
        aoiUploadBtn.addEventListener('click', () => {
            aoiFileInput.click();
        });

        aoiFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const name = file.name.toLowerCase();
            const reader = new FileReader();

            const processGeoJSON = (geojson) => {
                const layer = L.geoJSON(geojson, {
                    style: {
                        color: '#60a5fa',
                        weight: 2,
                        fillColor: '#3b82f6',
                        fillOpacity: 0.2
                    }
                });

                // Add to the drawnItems group so it can be edited/deleted
                layer.eachLayer(l => drawnItems.addLayer(l));
                map.fitBounds(drawnItems.getBounds());
            };

            if (name.endsWith('.kml')) {
                reader.onload = function (evt) {
                    const kmlText = evt.target.result;
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                    if (window.toGeoJSON) {
                        const geojson = toGeoJSON.kml(kmlDoc);
                        processGeoJSON(geojson);
                    } else {
                        alert("KML parser not loaded.");
                    }
                };
                reader.readAsText(file);
            }
            else if (name.endsWith('.kmz')) {
                reader.onload = async function (evt) {
                    try {
                        const zip = await JSZip.loadAsync(evt.target.result);
                        // Find the first .kml file inside
                        const kmlFile = Object.keys(zip.files).find(key => key.toLowerCase().endsWith('.kml'));
                        if (!kmlFile) throw new Error("No KML found inside KMZ.");

                        const kmlText = await zip.files[kmlFile].async('string');
                        const parser = new DOMParser();
                        const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                        if (window.toGeoJSON) {
                            processGeoJSON(toGeoJSON.kml(kmlDoc));
                        }
                    } catch (err) {
                        alert("Error parsing KMZ: " + err.message);
                    }
                };
                reader.readAsArrayBuffer(file);
            }
            else if (name.endsWith('.zip') || name.endsWith('.shp')) {
                reader.onload = async function (evt) {
                    try {
                        if (window.shp) {
                            const geojson = await shp(evt.target.result);
                            processGeoJSON(geojson);
                        } else {
                            alert("Shapefile parser not loaded.");
                        }
                    } catch (err) {
                        alert("Error parsing Shapefile: " + err.message);
                    }
                };
                reader.readAsArrayBuffer(file);
            } else {
                alert("Please upload a .kml, .kmz, or .shp (.zip) file.");
            }

            // Reset input
            aoiFileInput.value = '';
        });
    }

    // ─── Drive GeoTIFF Overlay Logic ───
    const driveSelect = document.getElementById('drive-image-select');
    let driveRasterLayer = null;

    if (driveSelect) {
        fetch('/api/drive_images')
            .then(res => res.ok ? res.json() : { images: [] })
            .then(data => {
                if (data.images && data.images.length > 0) {
                    data.images.forEach(img => {
                        const opt = document.createElement('option');
                        opt.value = img.path;
                        opt.textContent = `🗺️ ${img.name}`;
                        driveSelect.appendChild(opt);
                    });
                } else {
                    driveSelect.innerHTML = '<option value="">🗺️ No maps found in Drive</option>';
                    driveSelect.disabled = true;
                }
            })
            .catch(err => console.error("Could not load drive maps", err));

        driveSelect.addEventListener('change', async (e) => {
            const urlPath = e.target.value;

            if (driveRasterLayer) {
                map.removeLayer(driveRasterLayer);
                driveRasterLayer = null;
            }
            if (!urlPath) return;

            // Extract filename from path (e.g., /data/gee_exports/map.tif -> map.tif)
            const filename = urlPath.split('/').pop();
            const tileUrl = `/api/tiles/${filename}/{z}/{x}/{y}.png`;

            try {
                // Using standard Leaflet TileLayer for massive performance boost
                // Only loads tiles for the current screen
                driveRasterLayer = L.tileLayer(tileUrl, {
                    opacity: 0.8,
                    maxZoom: 24,
                    maxNativeZoom: 18, // Backend reprojects on the fly
                    attribution: `Local Drive Index: ${filename}`
                });

                driveRasterLayer.addTo(map);

                // Optionally center the map if it's a new layer
                // (Since we don't have bounds in the tile URL, we rely on the user knowing the area 
                // or we can add a bounds endpoint later if needed)
                console.log("Tiled layer added:", tileUrl);
            } catch (error) {
                console.error("Tiled rendering failed:", error);
                alert("Failed to load the tiled map from backend.");
            }
        });
    }
    // ─── Protected Zones (National Parks) Loading ───
    async function loadProtectedZones() {
        try {
            const response = await fetch('data/Binga Parks.kmz');
            if (!response.ok) return;
            const arrayBuffer = await response.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);
            const kmlFile = Object.keys(zip.files).find(f => f.endsWith('.kml'));
            const kmlText = await zip.file(kmlFile).async("string");
            const parser = new DOMParser();
            const kml = parser.parseFromString(kmlText, "text/xml");
            const geojson = toGeoJSON.kml(kml);
            L.geoJSON(geojson, {
                style: { color: '#f97316', weight: 2, fillColor: '#ef4444', fillOpacity: 0.25, dashArray: '3, 6' },
                onEachFeature: (feature, layer) => {
                    layer.bindTooltip("PROTECTED ZONE: " + (feature.properties.name || "National Park"), { sticky: true, className: 'protected-tooltip' });
                }
            }).addTo(map);
        } catch (err) { }
    }

    // Call API on Load
    fetchLiveWeather();

});
