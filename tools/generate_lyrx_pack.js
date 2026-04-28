#!/usr/bin/env node
/**
 * Generate the full D3 ArcGIS Layer Pack (.lyrx) — one CIM document
 * containing every variable × timescale × ref-period combination, plus
 * SNODAS, organized into a nested group hierarchy.
 *
 * The COG URLs reference data2.climate.umt.edu/.../latest/ via VSICURL,
 * so layers stay in sync with new data automatically — no need to
 * re-run this script unless VAR_CONFIG, breaks, or the URL pattern changes.
 *
 * Run:    node tools/generate_lyrx_pack.js
 * Output: docs/lyrx/d3_full_layer_pack.lyrx
 */

const fs = require('fs');
const path = require('path');

/* ── Constants mirrored from docs/index.html ─────────────────────── */
const USDM_BREAKS = [-999, -2.0, -1.5, -1.2, -0.8, -0.5, 0.5, 0.8, 1.2, 1.5, 2.0, 999];
const USDM_COLORS = ['#730000','#E60000','#FFAA00','#FCD37F','#FFFF00','#FFFFFF',
                     '#82FCF9','#32E1FA','#325CFE','#4030E3','#303B83'];
const PCTILE_BREAKS = [-999, 0.02, 0.05, 0.10, 0.20, 0.30, 0.70, 0.80, 0.90, 0.95, 0.98, 999];

const TS_FULL = {
  '15d':'15 Days','30d':'30 Days','45d':'45 Days','60d':'60 Days',
  '90d':'90 Days','120d':'120 Days','180d':'180 Days','365d':'1 Year',
  '730d':'2 Years','wy':'Water Year','ytd':'Year to Date'
};

const PERIODS = [
  { key:'rolling-30', label:'Rolling 30-yr Baseline' },
  { key:'full',       label:'Full Period of Record' }
];

const GRIDMET_DIR = 'https://data2.climate.umt.edu/gridmet/derived/conus_drought/latest';
const SNODAS_DIR  = 'https://data2.climate.umt.edu/snodas/latest/cogs';

const PALETTES = {
  brbg:    ['#8C510A','#D8B365','#F5F5F5','#5AB4AC','#01665E'],
  viridis: ['#440154','#3B528B','#21908C','#5DC863','#FDE725'],
  bluered: ['#053061','#92C5DE','#F7F7F7','#F4A582','#67001F']
};

/* gridMET-derived variables */
const VARS = [
  { key:'spi',           label:'SPI',                              prefix:'spi_',           classify:true,  breaks:USDM_BREAKS,   colors:USDM_COLORS, reversed:false, description:'Standardized Precipitation Index. Negative values = drier than normal; positive = wetter.' },
  { key:'spei',          label:'SPEI',                             prefix:'spei_',          classify:true,  breaks:USDM_BREAKS,   colors:USDM_COLORS, reversed:false, description:'Standardized Precipitation Evapotranspiration Index.' },
  { key:'eddi',          label:'EDDI',                             prefix:'eddi_',          classify:true,  breaks:USDM_BREAKS,   colors:USDM_COLORS, reversed:true,  description:'Evaporative Demand Drought Index. Positive = anomalously high evaporative demand.' },
  { key:'svpdi',         label:'SVPDI',                            prefix:'svpdi_',         classify:true,  breaks:USDM_BREAKS,   colors:USDM_COLORS, reversed:true,  description:'Standardized Vapor Pressure Deficit Index.' },
  { key:'precip-pctile', label:'Precipitation — Percentile',        prefix:'precip-pctile_', classify:true,  breaks:PCTILE_BREAKS, colors:USDM_COLORS, reversed:false, description:'Precipitation as a percentile of the historical distribution.' },
  { key:'vpd-pctile',    label:'VPD — Percentile',                  prefix:'vpd-pctile_',    classify:true,  breaks:PCTILE_BREAKS, colors:USDM_COLORS, reversed:true,  description:'VPD as a percentile.' },
  { key:'tmax-pctile',   label:'Tmax — Percentile',                 prefix:'tmax-pctile_',   classify:true,  breaks:PCTILE_BREAKS, colors:USDM_COLORS, reversed:true,  description:'Daily maximum temperature percentile.' },
  { key:'precip-pon',    label:'Precipitation — % of Normal',       prefix:'precip-pon_',    dynamic:true,   dMin:0,    dMax:200, palette:'brbg',    reversed:false, description:'Precipitation as a percentage of the long-term normal.' },
  { key:'precip-dev',    label:'Precipitation — Departure (in)',    prefix:'precip-dev_',    dynamic:true,   dMin:-5,   dMax:5,   palette:'brbg',    reversed:false, description:'Precipitation departure from normal.' },
  { key:'precip-in',     label:'Precipitation — Accumulation (in)', prefix:'precip-mm_',     dynamic:true,   dMin:0,    dMax:20,  palette:'viridis', reversed:true,  description:'Total accumulated precipitation.' },
  { key:'vpd-pon',       label:'VPD — % of Normal',                 prefix:'vpd-pon_',       dynamic:true,   dMin:50,   dMax:150, palette:'brbg',    reversed:true,  description:'VPD as a percentage of normal.' },
  { key:'vpd-dev',       label:'VPD — Departure',                   prefix:'vpd-dev_',       dynamic:true,   dMin:-5,   dMax:5,   palette:'brbg',    reversed:true,  description:'VPD departure from normal.' },
  { key:'tmax-dev',      label:'Tmax — Departure (°F)',             prefix:'tmax-dev_',      dynamic:true,   dMin:-10,  dMax:10,  palette:'bluered', reversed:false, description:'Daily maximum temperature departure.' }
];

/* SNODAS — no timescale or reference period */
const SNODAS_LAYERS = [
  { label:'SWE Standardized (SNODAS)', file:'zig_swe_standardized.tif', classify:true, breaks:USDM_BREAKS, colors:USDM_COLORS, reversed:false, description:'Standardized snow water equivalent anomaly from SNODAS, processed by the Montana Climate Office using a Zero-Inflated Gamma distribution.' },
  { label:'SWE Current (SNODAS, in)',  file:'snodas_swe.tif',           dynamic:true,  dMin:0, dMax:30, palette:'viridis', reversed:true, description:'Current snow water equivalent in inches.' }
];

/* ── CIM helpers ────────────────────────────────────────────────── */
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return {
    type: 'CIMRGBColor',
    values: [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16), 100]
  };
}

function makeStretchColorizer(cfg) {
  const pal = PALETTES[cfg.palette] || PALETTES.viridis;
  const colors = cfg.reversed ? pal.slice().reverse() : pal;
  const segments = [];
  for (let i = 0; i < colors.length - 1; i++) {
    segments.push({
      type: 'CIMLinearContinuousColorRamp',
      colorSpace: { type:'CIMICCColorSpace', url:'Default RGB' },
      fromColor: hexToRgb(colors[i]),
      toColor:   hexToRgb(colors[i+1])
    });
  }
  return {
    type: 'CIMRasterStretchColorizer',
    resamplingType: 'BilinearInterpolation',
    stretchType: 'MinimumMaximum',
    statsType: 'Dataset',
    gammaValue: 1,
    minPercent: 0.25,
    maxPercent: 0.25,
    useCustomMinMax: true,
    customStretchMin: cfg.dMin,
    customStretchMax: cfg.dMax,
    colorRamp: { type: 'CIMMultipartColorRamp', colorRamps: segments }
  };
}

function makeClassifyColorizer(cfg) {
  const colors = cfg.reversed ? cfg.colors.slice().reverse() : cfg.colors;
  const breaks = cfg.breaks;
  const labelFmt = cfg.labelFmt || (v => Number.isInteger(v) ? String(v) : v.toFixed(2));
  const classBreaks = [];
  for (let i = 0; i < colors.length; i++) {
    classBreaks.push({
      type: 'CIMRasterClassBreak',
      upperBound: breaks[i+1],
      label: labelFmt(breaks[i+1]),
      color: hexToRgb(colors[i])
    });
  }
  return {
    type: 'CIMRasterClassifyColorizer',
    resamplingType: 'NearestNeighbor',
    field: 'Value',
    minimumBreak: breaks[0],
    classBreaks,
    showInAscendingOrder: true,
    noDataColor: { type: 'CIMRGBColor', values: [0, 0, 0, 0] }
  };
}

function makeColorizer(cfg) {
  return cfg.dynamic ? makeStretchColorizer(cfg) : makeClassifyColorizer(cfg);
}

function makeRasterLayer(name, uRI, dir, file, cfg, description) {
  // ArcGIS Pro 3.x reads remote COGs when the full /vsicurl/<https-url>
  // path is given as the dataset (with an empty workspace). Splitting into
  // workspace + filename causes Pro to try resolving the URL as a folder
  // workspace, which fails with a broken-data-source indicator.
  const fullVsi = '/vsicurl/' + dir + '/' + file;
  return {
    type: 'CIMRasterLayer',
    name,
    uRI,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    description: description || '',
    layerType: 'Operational',
    showLegends: true,
    visibility: false,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: true,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    dataConnection: {
      type: 'CIMStandardDataConnection',
      workspaceConnectionString: '',
      workspaceFactory: 'Raster',
      dataset: fullVsi,
      datasetType: 'esriDTRasterDataset'
    },
    colorizer: makeColorizer(cfg)
  };
}

function makeGroupLayer(name, uRI, layerURIs, description) {
  return {
    type: 'CIMGroupLayer',
    name,
    uRI,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    description: description || '',
    layerType: 'Operational',
    showLegends: true,
    visibility: false,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: true,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    layers: layerURIs
  };
}

const safeId = s => s.replace(/[^a-z0-9]/gi, '_').toLowerCase();
const cimPath = name => 'CIMPATH=Map/' + safeId(name) + '.xml';

/* ── Build the document ─────────────────────────────────────────── */
function build() {
  const layerDefinitions = [];
  const variableGroupURIs = [];

  VARS.forEach(cfg => {
    const periodGroupURIs = [];
    PERIODS.forEach(p => {
      const tsLayerURIs = [];
      Object.keys(TS_FULL).forEach(ts => {
        const layerName = TS_FULL[ts];
        const uRI = cimPath(cfg.key + '_' + ts + '_' + p.key);
        const file = cfg.prefix + ts + '_' + p.key + '.tif';
        layerDefinitions.push(makeRasterLayer(layerName, uRI, GRIDMET_DIR, file, cfg, cfg.description));
        tsLayerURIs.push(uRI);
      });
      const periodURI = cimPath(cfg.key + '_' + p.key + '_group');
      layerDefinitions.push(makeGroupLayer(p.label, periodURI, tsLayerURIs));
      periodGroupURIs.push(periodURI);
    });
    const varURI = cimPath(cfg.key + '_group');
    layerDefinitions.push(makeGroupLayer(cfg.label, varURI, periodGroupURIs, cfg.description));
    variableGroupURIs.push(varURI);
  });

  // SNODAS group (no timescale / period)
  const snodasChildURIs = [];
  SNODAS_LAYERS.forEach(s => {
    const uRI = cimPath('snodas_' + s.file.replace('.tif', ''));
    layerDefinitions.push(makeRasterLayer(s.label, uRI, SNODAS_DIR, s.file, s, s.description));
    snodasChildURIs.push(uRI);
  });
  const snodasGroupURI = cimPath('snodas_group');
  layerDefinitions.push(makeGroupLayer('SNODAS — Snow Water Equivalent', snodasGroupURI, snodasChildURIs));
  variableGroupURIs.push(snodasGroupURI);

  // Root group
  const rootURI = cimPath('d3_drought_data_root');
  layerDefinitions.push(makeGroupLayer(
    'D³ — Drought Data Dashboard',
    rootURI,
    variableGroupURIs,
    'Operational drought-monitoring layers from the Montana Climate Office. ' +
    'Data hosted at data2.climate.umt.edu and referenced via VSICURL; ' +
    'values automatically update as new COGs publish to the /latest/ folder.'
  ));

  return {
    type: 'CIMLayerDocument',
    version: '3.1.0',
    build: 41685,
    layers: [rootURI],
    layerDefinitions,
    metadata: null
  };
}

/* ── Entry point ─────────────────────────────────────────────────── */
const out = build();
const outDir = path.resolve(__dirname, '../docs/lyrx');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'd3_full_layer_pack.lyrx');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
const rasterCount = out.layerDefinitions.filter(l => l.type === 'CIMRasterLayer').length;
const groupCount  = out.layerDefinitions.filter(l => l.type === 'CIMGroupLayer').length;
console.log('Wrote ' + outPath);
console.log('  ' + sizeKB + ' KB · ' + rasterCount + ' raster layers · ' + groupCount + ' groups');
