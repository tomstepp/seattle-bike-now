# Seattle Bike Now

Seattle's bike network with live car traffic on the streets bikes share. See [PLAN.md](PLAN.md) for the full plan.

## Run locally

```bash
npm install
npm run data        # SDOT bike network -> public/data/ and worker/data/
npm run build       # the worker serves dist/
npm run dev:worker  # Cloudflare Worker on :8787 (cron + /api/traffic)
npm run dev         # Vite on :5173, proxies /api to the worker
```

Secrets, both gitignored:
- `.dev.vars`: `TOMTOM_KEY=...` for the worker.
- `.env`: optional `VITE_TOMTOM_KEY=...` turns on a dev-only "show all TomTom traffic" toggle. It is never read in production builds.

Trigger a refresh locally with `curl "localhost:8787/__scheduled?cron=*/10+*+*+*+*"`, and measure CPU per refresh with `npm run bench`.

## Architecture

One Cloudflare Worker ([worker/index.ts](worker/index.ts)):
- **Cron, every 10 min:** fetches the 93 z14 TomTom flow tiles that touch a shared bike segment, matches them ([src/match.ts](src/match.ts)), and writes one snapshot to KV.
- **`/api/traffic`:** serves that snapshot, so visitor traffic never multiplies TomTom calls.
- **Everything else:** static assets from `dist/`.

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
