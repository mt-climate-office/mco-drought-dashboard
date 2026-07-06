/**
 * Montana Mesonet Soil Moisture Plugin for D³ Dashboard (OpenLayers version)
 * Loads soil moisture anomaly data from the Montana Mesonet network
 * at three sensor depths, displayed as circle markers with time series popups.
 */

const FGB_BASE = 'https://data.climate.umt.edu/drought-indicators/fgb/current_soil_moisture_anom_';
const PLOT_BASE = 'https://data.climate.umt.edu/drought-indicators/plots/';
const FGB_LIB  = 'https://unpkg.com/flatgeobuf@3.22.0/dist/flatgeobuf-geojson.min.js';

const DEPTHS = [
  { key: 'shallow', name: 'Shallow', range: '0–10 cm',   label: 'Shallow (0–10 cm)',   fgb: 'shallow.fgb', plot: 'Shallow' },
  { key: 'middle',  name: 'Middle',  range: '10–50 cm',  label: 'Middle (10–50 cm)',   fgb: 'middle.fgb',  plot: 'Middle'  },
  { key: 'deep',    name: 'Deep',    range: '50–100 cm', label: 'Deep (50–100 cm)',    fgb: 'deep.fgb',    plot: 'Deep'    },
];

const TIP_TEXT = 'Soil moisture anomaly from the Montana Mesonet network. ' +
  'Stations show current conditions relative to historical averages. ' +
  'Colors follow the standard drought classification scale. ' +
  'Click a station to view a time series of soil moisture percentiles.';

// Module state
let activeDepth = 'shallow';
let markerLayer = null;
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
      const val = f.properties.anom;
      f.properties._name = name;
      f.properties._val = val;
      f.properties._plotUrl = PLOT_BASE + stationId + '_' + depth.plot + '_current.png';
    });

    // Pre-compute styles by fillColor
    var mesoStyleCache = {};
    var mesoFeatures = new ol.format.GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' });
    mesoFeatures.forEach(f => {
      var c = f.get('fillColor') || '#888';
      if (!mesoStyleCache[c]) {
        mesoStyleCache[c] = new ol.style.Style({
          image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: c }),
            stroke: new ol.style.Stroke({ color: '#000', width: 0.8 })
          })
        });
      }
    });

    markerLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features: mesoFeatures }),
      style: function(feature) {
        return mesoStyleCache[feature.get('fillColor') || '#888'] || null;
      },
      updateWhileAnimating: true,
      updateWhileInteracting: true,
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
    var valText = '';
    var v = hit.get('_val');
    if (v != null && !isNaN(v)) valText = ': ' + parseFloat(v).toFixed(2);
    if (tooltipEl) tooltipEl.innerHTML = hit.get('_name') + valText;
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
  var val = hit.get('_val');
  var valStr = (val != null && !isNaN(val)) ? ' (Anomaly: ' + parseFloat(val).toFixed(2) + ')' : '';
  document.getElementById('flow-panel-title').textContent = name;
  document.getElementById('flow-panel-sub').textContent = 'Soil Moisture \u2014 ' + depth.label + valStr;
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
  // The plugin lives INSIDE the Station Data section as a state-specific
  // sub-block, right below the CONUS-scale GHCN and USGS controls. This
  // keeps station-related data co-located instead of scattering it across
  // its own top-level section.
  const stationBody = sidebar.querySelector('#sec-station');
  if (!stationBody) return;

  // Container — one node so deactivate can remove it atomically. Retains
  // `data-sec="sec-mt-soil"` so the activation toast anchor still works.
  sectionBodyEl = document.createElement('div');
  sectionBodyEl.id = 'sec-mt-soil';
  sectionBodyEl.className = 'plugin-highlight';
  sectionBodyEl.setAttribute('data-sec', 'sec-mt-soil');
  sectionBodyEl.style.cssText =
    'margin-top:12px;padding-top:10px;border-top:1px solid var(--border);';

  // Sub-heading styled like the "Meteorological Drought Metrics" and
  // "Streamflow" sub-labels already inside #sec-station.
  const subLabel = document.createElement('div');
  subLabel.style.cssText =
    'font-size:0.62rem;font-weight:600;text-transform:uppercase;' +
    'letter-spacing:0.06em;color:var(--text-dim);margin-bottom:4px;' +
    'display:flex;align-items:center;gap:6px;';
  subLabel.innerHTML =
    'Montana Mesonet ' +
    '<span class="info-tip" tabindex="0" data-tip="mt-soil">&#9432;</span>';
  sectionBodyEl.appendChild(subLabel);

  // Add/Remove toggle button — styled to match #ghcn-btn / #usgs-btn
  const btnRow = document.createElement('div');
  btnRow.style.marginBottom = '6px';
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'mesonet-btn';
  toggleBtn.type = 'button';
  toggleBtn.innerHTML = '<span>Mesonet Soil Moisture</span>';
  btnRow.appendChild(toggleBtn);
  sectionBodyEl.appendChild(btnRow);

  // Divider between the layer toggle and the plugin-management controls
  const divider = document.createElement('hr');
  divider.style.cssText = 'border:none;border-top:1px solid var(--border);margin:8px 0;';
  sectionBodyEl.appendChild(divider);

  // Depth selector (hidden until enabled)
  const strip = document.createElement('div');
  strip.className = 'depth-strip';
  strip.style.display = 'none';
  DEPTHS.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'depth-btn' + (d.key === activeDepth ? ' active' : '');
    // Name on the first line, depth range on the second (matches the SMI selector).
    btn.innerHTML = d.name + '<br><span class="ts-btn-sub">' + d.range + '</span>';
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

  // Wire button to toggle layer, depth strip, and styling
  toggleBtn.addEventListener('click', async () => {
    const mesoLeg = document.getElementById('mesonet-legend');
    const isOn = toggleBtn.classList.contains('is-on');
    if (!isOn) {
      strip.style.display = '';
      await loadDepthLayer(_map);
      toggleBtn.classList.add('is-on');
      if (mesoLeg && window.showLegendEl) window.showLegendEl(mesoLeg);
      else if (mesoLeg) mesoLeg.style.display = 'block';
      if (_helpers.stackRightLegends) _helpers.stackRightLegends();
    } else {
      strip.style.display = 'none';
      if (markerLayer) { _map.removeLayer(markerLayer); markerLayer = null; }
      toggleBtn.classList.remove('is-on');
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

  // Insert as the last child of Station Data (below the CONUS-scale toggles)
  stationBody.appendChild(sectionBodyEl);

  // Wire info-tip on the sub-label to the shared portal
  const tipEl = subLabel.querySelector('.info-tip');
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
  sectionBodyEl.addEventListener('animationend', () => {
    sectionBodyEl.classList.remove('plugin-highlight');
  });
}

// ── Public API ───────────────────────────────────────────────────
export async function activate(map, sidebar, helpers) {
  _map = map;
  _helpers = helpers || {};
  await ensureFGB();
  injectSidebar(sidebar);
  // Expand the Station Data section so the newly-added plugin sub-block is
  // visible without the user having to hunt for it.
  const stationLabel = sidebar.querySelector('[data-sec="sec-station"]');
  const stationBody = sidebar.querySelector('#sec-station');
  if (stationLabel && stationLabel.classList.contains('sec-collapsed')) {
    stationLabel.classList.remove('sec-collapsed');
    if (stationBody) stationBody.classList.remove('sec-collapsed');
  }
  // Smooth-scroll the sidebar so the newly-added Mesonet sub-block is in view.
  // Wait a frame so the just-applied expand/insert has laid out and the
  // element's offsetTop is accurate.
  requestAnimationFrame(() => {
    const scroller = sidebar.classList.contains('sidebar-inner')
      ? sidebar
      : sidebar.querySelector('.sidebar-inner') || sidebar;
    if (sectionBodyEl && scroller) {
      const targetTop = Math.max(0, sectionBodyEl.offsetTop - 12);
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        scroller.scrollTop = targetTop;
      }
    }
  });
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
  if (sectionBodyEl && sectionBodyEl.parentNode) sectionBodyEl.remove();
  sectionBodyEl = null;
  dataCache = {};
  activeDepth = 'shallow';
  _map = null;
}
