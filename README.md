# Seattle Bike Now

Riding conditions for Seattle bike commuters: weather, drawbridge odds, street closures, rider counts, bike crashes, and live car traffic on the streets bikes share. Racks, repair stands and hills can be turned on from the map key. See [PLAN.md](PLAN.md) for the full plan.

## Run locally

```bash
npm install
npm run data        # bike network, bridge odds, rider counts -> public/data/
npm run dev         # Vite on :5173
```

Keys, in `.env` (gitignored; see `.env.example`):
- `VITE_TOMTOM_KEY`: live traffic. Also turns on a dev-only "show all TomTom traffic" toggle.
- `VITE_ORS_KEY`: bike routes and place search (free OpenRouteService account).

Both are bundled into the page by design.

Tests: `npm test` (Vitest: traffic matching, bridge and counter stats, Seattle time and area, route scoring and export). Every deploy runs them first.

## Architecture

A static site; everything live is fetched by the page itself.
- **Traffic:** every 10 minutes while the page is visible, it fetches the ~93 z14 TomTom flow tiles that touch a shared bike lane, matches them to lanes ([src/match.ts](src/match.ts), [src/traffic.ts](src/traffic.ts)) and colors the lanes. The TomTom key ships in the page, so restrict it to the site's domain in TomTom's dashboard.
- **Routes:** [OpenRouteService](https://openrouteservice.org) returns up to three bike routes with turn-by-turn steps ([src/ors.ts](src/ors.ts)). [src/route-score.ts](src/route-score.ts) judges each with this site's data (protected share, steep blocks, construction, closures, crashes, slow traffic, drawbridges); if every route hits a closed lane, it asks once more with those stretches as avoid areas. Routes export as GPX or a Google Maps link ([src/route-export.ts](src/route-export.ts)).
- **Saved commute and home screen:** home and work are kept on the device ([src/commute.ts](src/commute.ts)); the Route panel offers "To work" before noon and "To home" after. [public/manifest.webmanifest](public/manifest.webmanifest) makes the site installable, with "Ride to work" and "Ride home" shortcuts (`?go=work`, `?go=home`).
- **Weather, closures, construction:** NWS and SDOT, fetched live by the page.
- **Bridges, counters, crashes, racks, repair stands, bike network:** static files in `public/data/`, rebuilt by `npm run data`.

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
