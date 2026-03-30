# MCO Drought Dashboard

An interactive web dashboard for visualizing drought conditions and water availability across the continental United States, built by the [Montana Climate Office](https://climate.umt.edu).

**Live site:** [drought.climate.umt.edu](https://drought.climate.umt.edu)

## Features

- **Interactive map** with smooth pan/zoom across the continental US, powered by OpenLayers with WebGL tile rendering
- **Cloud Optimized GeoTIFF (COG) rendering** — raster data loaded via HTTP Range requests, no server-side tile generation needed
- **15 drought and climate variables** including SPI, SPEI, EDDI, SVPDI, precipitation, VPD, temperature, and streamflow
- **Multiple timescales**: 15-day through 730-day, Water Year, and Year-to-Date
- **Two reference periods**: Rolling 30-year baseline and full period of record (1979–present)
- **Convergence of Evidence tool** — composite multiple drought indices (any combination of SPI, SPEI, EDDI, SVPDI at different timescales) using median or mean, computed on the fly per pixel
- **Point query** — click anywhere to inspect exact raster values; convergence mode shows all individual index values plus the composite
- **Interpolation toggle** — switch between nearest-neighbor (crisp grid cells) and bilinear (smooth) rendering
- **Overlays**: state and county boundaries, tribal nations, U.S. Drought Monitor (weekly), USGS stream gauges, HHP streamflow basins
- **Basemap options**: CartoDB Light, Dark, and Voyager; Esri Satellite and NatGeo Topo
- **Dark, light, and high-contrast themes**
- **Export**: download the current map view as a high-resolution PNG with title band, legend, and attribution
- **Share**: generate a URL that captures the current variable, timescale, reference period, zoom state, and theme
- **Responsive design**: sidebar collapses on mobile devices
- **State plugins**: extensible plugin system for state-specific data (e.g., Montana Mesonet soil moisture)

## Data Variables

| Variable | Description | Scale Type |
|----------|-------------|------------|
| SPI | Standardized Precipitation Index | USDM classified |
| SPEI | Standardized Precipitation-Evapotranspiration Index | USDM classified |
| EDDI | Evaporative Demand Drought Index | USDM classified (reversed) |
| SVPDI | Standardized Vapor Pressure Deficit Index | USDM classified (reversed) |
| Precipitation — % of Normal | Percent of long-term normal | Diverging centered at 100% |
| Precipitation — Departure | Departure from normal (inches) | Diverging centered at 0 |
| Precipitation — Percentile | Historical percentile | Classified |
| Precipitation — Accumulation | Raw accumulated precipitation (inches) | Sequential |
| VPD — % of Normal | Vapor pressure deficit percent of normal | Diverging centered at 100% |
| VPD — Departure | VPD departure from normal | Diverging |
| VPD — Percentile | VPD historical percentile | Classified |
| Max Temperature — Percentile | Daily max temperature percentile | Classified |
| Max Temperature — Departure | Temperature departure (°F) | Diverging |
| HHP Streamflow Basins | Machine-learning streamflow percentiles | Vector overlay |

## Data Source

Raster data is served as Cloud Optimized GeoTIFFs (COGs) from:
```
https://mco-gridmet.s3.us-west-2.amazonaws.com/derived/conus_drought_web/latest/
```

File naming convention: `{variable}_{timescale}_{period}.tif`
- Example: `spi_30d_rolling-30.tif`
- Resolution: ~4 km (gridMET grid, 1386 × 584 pixels)
- Format: Int16, DEFLATE compressed, with internal overviews
- NoData: -9999
- Values are stored as centesimal integers (multiply by 0.01 for actual values)

## Architecture

### Rendering Pipeline

The dashboard uses **OpenLayers** with `ol/source/GeoTIFF` and `ol/layer/WebGLTile` for raster rendering. COGs are loaded via HTTP Range requests — only the tiles visible at the current zoom level are fetched. Color mapping is performed entirely in WebGL shaders using style expressions.

### Convergence of Evidence

The convergence tool supports two architectures depending on the number of selected layers:

- **2–3 layers**: Multi-source `GeoTIFF` with WebGL `['case']` expressions for per-pixel compositing
- **4+ layers**: Full rasters loaded via `geotiff.js`, composite computed in JavaScript, served as `ol/source/DataTile` tiles with a simple single-band color expression

This hybrid approach works around WebGL shader complexity limits while providing true median/mean computation for any number of indices.

### Export

Screenshots are captured by compositing OpenLayers' WebGL canvas layers with a custom title band and footer legend, rendered to a high-resolution PNG.

## Related

This dashboard is the frontend visualization layer for the data pipeline at:
[mt-climate-office/mco-drought-conus](https://github.com/mt-climate-office/mco-drought-conus)

## Usage

This is a static web application — no build step or package installation required.

**Serve locally** (recommended):
```bash
cd docs
python -m http.server 8000
```
Then open `http://localhost:8000/`.

**Static hosting:**
Deploy the `docs/` directory to any static file host (GitHub Pages, Netlify, S3, etc.).

## Project Structure

```
docs/
├── index.html          # Main dashboard (OpenLayers + inline JS)
├── styles.css          # Extracted CSS
├── plugins/
│   └── mt.js           # Montana Mesonet soil moisture plugin
└── legacy/
    └── index.html      # Archived Leaflet version
```

## Dependencies

All dependencies are loaded from CDN — no installation required.

| Library | Purpose |
|---------|---------|
| [OpenLayers](https://openlayers.org/) | Interactive map with WebGL tile rendering |
| [geotiff.js](https://geotiffjs.github.io/) | Cloud Optimized GeoTIFF decoding |
| [chroma.js](https://gka.github.io/chroma.js/) | Color scales and palette generation |
| [topojson](https://github.com/topojson/topojson) | State and county boundary overlays |

## Contact

**Montana Climate Office**
University of Montana
[https://climate.umt.edu](https://climate.umt.edu)
