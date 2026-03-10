# MCO Drought Dashboard

An interactive web dashboard for visualizing drought conditions and water availability across the continental United States, built by the [Montana Climate Office](https://climate.umt.edu).

<!-- Screenshot placeholder: add a screenshot of the dashboard here -->

## Features

- **Interactive map** with pan/zoom across the continental US
- **12 drought and water variable groups** including SPI, SPEI, EDDI, SVPDI, precipitation, VPD, temperature, and streamflow
- **Multiple timescales**: 15-day through 730-day, Water Year, and Year-to-Date
- **Basemap options**: CartoDB Light, Dark, and Voyager; Esri Satellite
- **Overlays**: state and county boundaries, USGS stream gauges, HHP streamflow basins
- **Export**: download the current map view as a PNG screenshot
- **Responsive design**: sidebar collapses on mobile devices

## Data Variables

| Variable | Description |
|----------|-------------|
| SPI | Standardized Precipitation Index |
| SPEI | Standardized Precipitation-Evapotranspiration Index |
| EDDI | Evaporative Demand Drought Index |
| SVPDI | Standardized Vapor Pressure Deficit Index |
| Precipitation | Accumulated precipitation |
| VPD | Vapor Pressure Deficit |
| Temperature | Air temperature |
| Streamflow | Streamflow percentiles and anomalies |

Data is served from `https://data.climate.umt.edu/share/conus_drought_web/`.

## Related

This dashboard is the frontend visualization layer for the data pipeline at:
[mt-climate-office/mco-drought-conus](https://github.com/mt-climate-office/mco-drought-conus)

## Usage

This is a single-file static web application — no build step or package installation required.

**Option 1 — Open directly in a browser:**
```
open docs/index.html
```

**Option 2 — Serve locally** (recommended, avoids browser CORS restrictions):
```bash
# Python
python -m http.server 8000

# Node.js
npx serve .
```
Then navigate to `http://localhost:8000/docs/`.

**Option 3 — Static hosting:**
Deploy the `docs/` directory to any static file host (GitHub Pages, Netlify, S3, etc.).

## Dependencies

All dependencies are loaded from CDN — no installation required.

| Library | Purpose |
|---------|---------|
| [Leaflet.js](https://leafletjs.com/) | Interactive map |
| [georaster](https://github.com/GeoTIFF/georaster) | Raster data rendering |
| [chroma.js](https://gka.github.io/chroma.js/) | Color scales |
| [topojson](https://github.com/topojson/topojson) | Boundary overlays |
| [html2canvas](https://html2canvas.hertzen.com/) | PNG export |

## Contact

**Montana Climate Office**
University of Montana
[https://climate.umt.edu](https://climate.umt.edu)
