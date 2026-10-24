# Seattle Bike Now

Seattle's bike network with live car traffic on the streets bikes share. See [PLAN.md](PLAN.md) for the full plan.

## Run locally

```bash
npm install
npm run data   # download SDOT bike network -> public/data/bike-network.geojson
npm run dev
```

Live traffic needs a free TomTom key: copy `.env.example` to `.env` and set `VITE_TOMTOM_KEY`.
For local development only: anything prefixed `VITE_` ends up in the browser bundle, so traffic
moves behind a scheduled worker before this is deployed.

## Data

- [SDOT Bike Facilities FeatureServer](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer): layer 2 (Existing Bike Facilities) and layer 1 (Multi-use Trails, Seattle only)
- [TomTom Traffic Flow vector tiles](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/vector-flow-tiles) (relative flow)
- Basemap: [OpenFreeMap](https://openfreemap.org) Dark

| SDOT `CATEGORY` | Facility | Group |
|---|---|---|
| BKF-OFFST, Multi-use Trails | trail | separated |
| BKF-PBL | protected | separated |
| BKF-NGW | greenway | separated |
| BKF-BBL | buffered | shared |
| BKF-BL | painted | shared |
| BKF-CLMB | climbing | shared |
| BKF-SHW | sharrow | shared |

Segments marked `UNDERCONS` (under construction) are left out.
