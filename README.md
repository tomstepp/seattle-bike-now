# Seattle Bike Now

Riding conditions for Seattle bike commuters: weather, drawbridge odds, street closures, rider counts, bike crashes, and live car traffic on the streets bikes share. Racks, repair stands and hills can be turned on from the map key. See [PLAN.md](PLAN.md) for the full plan.

## Run locally

```bash
npm install
npm run data        # bike network, bridge odds, rider counts -> public/data/ (+ worker/data/)
npm run build       # the worker serves dist/
npm run dev:worker  # Cloudflare Worker on :8787 (cron + /api/traffic)
npm run dev         # Vite on :5173, proxies /api to the worker
```

Secrets, both gitignored:
- `.dev.vars`: `TOMTOM_KEY=...` for the worker.
- `.env`: optional `VITE_TOMTOM_KEY=...` turns on a dev-only "show all TomTom traffic" toggle. It is never read in production builds.

Tests: `npm test` (Vitest: traffic matching, bridge and counter stats, Seattle time and area, the worker's handlers). `npm run deploy` runs them first.

Trigger a refresh locally with `curl "localhost:8787/__scheduled?cron=*/10+*+*+*+*"`, and measure CPU per refresh with `npm run bench`.

## Architecture

One Cloudflare Worker ([worker/index.ts](worker/index.ts)):
- **Cron, every 10 min:** fetches the 93 z14 TomTom flow tiles that touch a shared bike segment, matches them ([src/match.ts](src/match.ts)), and writes one snapshot to KV.
- **`/api/traffic`:** serves that snapshot, so visitor traffic never multiplies TomTom calls.
- **Everything else:** static assets from `dist/`.

## Data

- [SDOT Bike Facilities FeatureServer](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer): layer 2 (Existing Bike Facilities) and layer 1 (Multi-use Trails, Seattle only)
- [TomTom Traffic Flow vector tiles](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/vector-flow-tiles) (relative flow)
- [SDOT Drawbridge Status](https://data.seattle.gov/d/gm8h-9449): opening log, published about daily. `npm run data:bridges` turns the last year into per-hour odds of an opening (weekday vs. weekend). There is no live feed.
- SDOT bike counters on data.seattle.gov (Fremont Bridge, 2nd Ave, Burke-Gilman, Spokane St, 12th Ave S, I-90 trail, Thomas St), published monthly. `npm run data:counters` writes 30-day averages, year-over-year change and weekly totals. Counter locations are approximate; the datasets carry none.
- [SDOT Street Closures](https://data.seattle.gov/d/ium9-iqtc): permitted non-construction closures (block parties, play streets, farmers markets, café streets), fetched live by the browser.
- [SDOT Street Use permits](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SU_Permit_Data_Model_Relationships/FeatureServer/2): construction whose permit closes, reroutes or narrows a bike lane, fetched live and kept only where the work area runs along a mapped lane. Permits span weeks; crews may not work every day.
- [SDOT Collisions](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Collisions_All_Years_1/FeatureServer): crashes involving a bike over five years, grouped by location (`npm run data:collisions`).
- [SDOT Bicycle Racks](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Bicycle_Racks_(Active)/FeatureServer) (`npm run data:racks`) and OpenStreetMap `amenity=bicycle_repair_station` via Overpass (`npm run data:repair`; public Overpass servers are often busy, so it retries).
- Hills: each bike facility's `SEGKEY` joins to [Seattle Streets](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_Streets_1/FeatureServer) `COMPKEY` for `SLOPE_PCT`, added by `npm run data:sdot`.
- [National Weather Service](https://www.weather.gov/documentation/services-web-api) hourly forecast and alerts, fetched by the browser (no key).
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
