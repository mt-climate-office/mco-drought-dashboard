/**
 * Montana Mesonet Soil Moisture Plugin for D³ Dashboard (OpenLayers version)
 * Loads soil moisture anomaly data from the Montana Mesonet network
 * at three sensor depths, displayed as circle markers with time series popups.
 */

const FGB_BASE = 'https://data.climate.umt.edu/drought-indicators/fgb/current_soil_moisture_anom_';
const PLOT_BASE = 'https://data.climate.umt.edu/drought-indicators/plots/';
const FGB_LIB  = 'https://unpkg.com/flatgeobuf@3.22.0/dist/flatgeobuf-geojson.min.js';

const DEPTHS = [
  { key: 'shallow', label: 'Shallow (0-4")',  fgb: 'shallow.fgb', plot: 'Shallow' },
  { key: 'middle',  label: 'Middle (8-20")',   fgb: 'middle.fgb',  plot: 'Middle'  },
  { key: 'deep',    label: 'Deep (28-40")',    fgb: 'deep.fgb',    plot: 'Deep'    },
];

const TIP_TEXT = 'Soil moisture anomaly from the Montana Mesonet network. ' +
  'Stations show current conditions relative to historical averages. ' +
  'Colors follow the standard drought classification scale. ' +
  'Click a station to view a time series of soil moisture percentiles.';

// Module state
let activeDepth = 'shallow';
let markerLayer = null;
let sectionLabelEl = null;
let sectionBodyEl = null;
let dataCache = {};
let _fgbLoaded = false;
let _map = null;
let _helpers = {};

// ── FlatGeoBuf loader ────────────────────────────────────────────
async function ensureFGB() {
  if (_fgbLoaded || window.flatgeobuf) { _fgbLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = FGB_LIB;
    s.onload = () => { _fgbLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load FlatGeoBuf library'));
    document.head.appendChild(s);
  });
}

// ── Data loading ─────────────────────────────────────────────────
async function fetchDepthData(depthKey) {
  if (dataCache[depthKey]) return dataCache[depthKey];

  const depth = DEPTHS.find(d => d.key === depthKey);
  const url = FGB_BASE + depth.fgb;
  const resp = await fetch(url);
  const features = [];

  for await (const f of flatgeobuf.deserialize(resp.body)) {
    features.push(f);
  }

  const geojson = { type: 'FeatureCollection', features };
  dataCache[depthKey] = geojson;
  return geojson;
}

// ── Layer rendering (OpenLayers) ─────────────────────────────────
async function loadDepthLayer(map) {
  if (markerLayer) {
    map.removeLayer(markerLayer);
    markerLayer = null;
  }

  _helpers.showSpinner();
  try {
    const geojson = await fetchDepthData(activeDepth);
    const depth = DEPTHS.find(d => d.key === activeDepth);

    // Add tooltip and plot URL as properties
    geojson.features.forEach(f => {
      const name = f.properties.name || f.properties.NAME || 'Unknown Station';
      const stationId = f.properties.station || '';
      f.properties._name = name;
      f.properties._plotUrl = PLOT_BASE + stationId + '_' + depth.plot + '_current.png';
    });

    markerLayer = new ol.layer.Vector({
      source: new ol.source.Vector({
        features: new ol.format.GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' })
      }),
      style: function(feature) {
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: feature.get('fillColor') || '#888' }),
            stroke: new ol.style.Stroke({ color: '#000', width: 0.8 })
          })
        });
      },
      zIndex: 50
    });

    map.addLayer(markerLayer);

    // Hover tooltip
    map.on('pointermove', _onPointerMove);

    // Click to show plot
    map.on('click', _onMarkerClick);

    if (_helpers.ensureLayerStack) _helpers.ensureLayerStack();
  } finally {
    _helpers.hideSpinner();
  }
}

// Pointer move handler for tooltips
function _onPointerMove(e) {
  if (e.dragging) return;
  const hit = _map.forEachFeatureAtPixel(e.pixel, function(feature, layer) {
    if (layer === markerLayer) return feature;
  });
  const tooltipEl = document.querySelector('.county-tooltip');
  const tooltipOverlay = _map.getOverlays().getArray().find(o => o.getElement() === tooltipEl);
  if (hit && hit.get('_name')) {
    if (tooltipEl) tooltipEl.innerHTML = hit.get('_name');
    if (tooltipOverlay) tooltipOverlay.setPosition(e.coordinate);
    _map.getTargetElement().style.cursor = 'pointer';
  } else {
    if (tooltipOverlay) tooltipOverlay.setPosition(undefined);
  }
}

// Click handler for station plots
function _onMarkerClick(e) {
  const hit = _map.forEachFeatureAtPixel(e.pixel, function(feature, layer) {
    if (layer === markerLayer) return feature;
  });
  if (!hit) return;

  const name = hit.get('_name') || 'Unknown Station';
  const plotUrl = hit.get('_plotUrl');
  const depth = DEPTHS.find(d => d.key === activeDepth);

  if (!plotUrl) return;

  // Open in the flow panel (same as HHP)
  document.getElementById('flow-panel-title').textContent = name;
  document.getElementById('flow-panel-sub').textContent = 'Soil Moisture \u2014 ' + depth.label;
  const content = document.getElementById('flow-panel-content');
  content.innerHTML = '';
  const img = document.createElement('img');
  img.src = plotUrl + '?cacheBust=' + Date.now();
  img.alt = 'Soil moisture time series for ' + name;
  img.onerror = function() {
    content.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">Plot not available for this station</div>';
  };
  content.appendChild(img);
  document.getElementById('flow-panel').classList.add('visible');
}

// ── Sidebar injection ────────────────────────────────────────────
function injectSidebar(sidebar) {
  const overlaysLabel = sidebar.querySelector('[data-sec="sec-overlays"]');
  if (!overlaysLabel) return;

  // Section label
  sectionLabelEl = document.createElement('div');
  sectionLabelEl.className = 'section-label plugin-highlight';
  sectionLabelEl.setAttribute('data-sec', 'sec-mt-soil');
  sectionLabelEl.style.cssText = '--i:3.5';
  sectionLabelEl.innerHTML =
    'Montana Mesonet ' +
    '<span class="info-tip" tabindex="0" data-tip="mt-soil">&#9432;</span>' +
    '<span class="caret">&#9660;</span>';

  // Section body
  sectionBodyEl = document.createElement('div');
  sectionBodyEl.className = 'section-body';
  sectionBodyEl.id = 'sec-mt-soil';

  // Enable checkbox
  const enableLabel = document.createElement('label');
  enableLabel.className = 'custom-check';
  enableLabel.style.marginBottom = '6px';
  enableLabel.innerHTML = '<input type="checkbox" id="mt-soil-chk"> Soil Moisture Anomaly';
  sectionBodyEl.appendChild(enableLabel);

  // Depth selector (hidden until enabled)
  const strip = document.createElement('div');
  strip.className = 'depth-strip';
  strip.style.display = 'none';
  DEPTHS.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'depth-btn' + (d.key === activeDepth ? ' active' : '');
    btn.textContent = d.label;
    btn.dataset.depth = d.key;
    btn.addEventListener('click', () => {
      if (d.key === activeDepth) return;
      activeDepth = d.key;
      strip.querySelectorAll('.depth-btn').forEach(b => b.classList.toggle('active', b.dataset.depth === activeDepth));
      loadDepthLayer(_map);
    });
    strip.appendChild(btn);
  });
  sectionBodyEl.appendChild(strip);

  // Wire checkbox to toggle layer and depth strip
  const chk = enableLabel.querySelector('input');
  chk.addEventListener('change', async () => {
    const mesoLeg = document.getElementById('mesonet-legend');
    if (chk.checked) {
      strip.style.display = '';
      await loadDepthLayer(_map);
      if (mesoLeg && window.showLegendEl) window.showLegendEl(mesoLeg);
      else if (mesoLeg) mesoLeg.style.display = 'block';
      if (_helpers.stackRightLegends) _helpers.stackRightLegends();
    } else {
      strip.style.display = 'none';
      if (markerLayer) { _map.removeLayer(markerLayer); markerLayer = null; }
      if (mesoLeg) mesoLeg.style.display = 'none';
      if (_helpers.stackRightLegends) _helpers.stackRightLegends();
    }
  });

  // Remove plugin button
  const removeBtn = document.createElement('button');
  removeBtn.textContent = '\u2715 Remove Montana Plugin';
  removeBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px 10px;font-size:0.7rem;font-family:var(--font-display);background:var(--overlay-hover-sm);color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius-md);cursor:pointer;transition:var(--transition);';
  removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = 'var(--accent-hover)'; removeBtn.style.color = 'var(--text-primary)'; });
  removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'var(--overlay-hover-sm)'; removeBtn.style.color = 'var(--text-muted)'; });
  removeBtn.addEventListener('click', () => {
    if (_helpers.removePlugin) _helpers.removePlugin();
  });
  sectionBodyEl.appendChild(removeBtn);

  // CONUS revert button
  const revertBtn = document.createElement('button');
  revertBtn.textContent = '\u2190 Back to CONUS';
  revertBtn.style.cssText = 'margin-top:4px;width:100%;padding:6px 10px;font-size:0.7rem;font-family:var(--font-display);background:var(--overlay-hover-sm);color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius-md);cursor:pointer;transition:var(--transition);';
  revertBtn.addEventListener('mouseenter', () => { revertBtn.style.background = 'var(--accent-hover)'; revertBtn.style.color = 'var(--text-primary)'; });
  revertBtn.addEventListener('mouseleave', () => { revertBtn.style.background = 'var(--overlay-hover-sm)'; revertBtn.style.color = 'var(--text-muted)'; });
  revertBtn.addEventListener('click', () => {
    if (_helpers.removePlugin) _helpers.removePlugin();
    const sel = document.getElementById('state-select');
    const label = sel.parentElement.querySelector('div');
    if (label) label.textContent = 'CONUS (default)';
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
  });
  sectionBodyEl.appendChild(revertBtn);

  // Insert before overlays
  overlaysLabel.parentNode.insertBefore(sectionLabelEl, overlaysLabel);
  overlaysLabel.parentNode.insertBefore(sectionBodyEl, overlaysLabel);

  // Wire collapsible
  sectionLabelEl.addEventListener('click', (e) => {
    if (e.target.closest('.info-tip')) return;
    const collapsed = sectionBodyEl.classList.toggle('sec-collapsed');
    sectionLabelEl.classList.toggle('sec-collapsed', collapsed);
  });

  // Wire info-tip to portal
  const tipEl = sectionLabelEl.querySelector('.info-tip');
  const portal = document.getElementById('info-tip-portal');
  if (tipEl && portal) {
    const show = () => {
      portal.innerHTML = TIP_TEXT;
      const rect = tipEl.getBoundingClientRect();
      const sidebarEl = document.getElementById('sidebar');
      const sidebarRight = sidebarEl ? sidebarEl.getBoundingClientRect().right : 290;
      portal.style.left = (sidebarRight + 10) + 'px';
      portal.style.top = Math.max(10, rect.top - 10) + 'px';
      portal.style.display = 'block';
    };
    const hide = () => { portal.style.display = 'none'; };
    tipEl.addEventListener('mouseenter', show);
    tipEl.addEventListener('mouseleave', hide);
    tipEl.addEventListener('focus', show);
    tipEl.addEventListener('blur', hide);
  }

  // Remove pulse after animation
  sectionLabelEl.addEventListener('animationend', () => {
    sectionLabelEl.classList.remove('plugin-highlight');
  });
}

// ── Public API ───────────────────────────────────────────────────
export async function activate(map, sidebar, helpers) {
  _map = map;
  _helpers = helpers || {};
  await ensureFGB();
  injectSidebar(sidebar);
}

export function deactivate(map, sidebar) {
  // Remove event listeners
  if (_map) {
    _map.un('pointermove', _onPointerMove);
    _map.un('click', _onMarkerClick);
  }
  if (markerLayer) {
    map.removeLayer(markerLayer);
    markerLayer = null;
  }
  // Hide mesonet legend
  const mesoLeg = document.getElementById('mesonet-legend');
  if (mesoLeg) mesoLeg.style.display = 'none';
  if (_helpers.stackRightLegends) _helpers.stackRightLegends();
  if (sectionLabelEl && sectionLabelEl.parentNode) sectionLabelEl.remove();
  if (sectionBodyEl && sectionBodyEl.parentNode) sectionBodyEl.remove();
  sectionLabelEl = null;
  sectionBodyEl = null;
  dataCache = {};
  activeDepth = 'shallow';
  _map = null;
}
