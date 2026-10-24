# Seattle Bike Now — Project Plan

_Source: Tom's Google Doc "Seattle Bike Commute Hub — Project Plan" (Oct 23, 2026). Vision, Features, Data sources and Architecture sections._

## Vision

One public page that answers "how's biking in Seattle right now, and how will my commute go?" It lives on tomstepp.com as a fun build and a showcase, and Claude Code does most of the typing.

What it is: a Seattle bike commute hub. It maps the city's bike network, shows live car traffic on the roads bikes share, and pairs that with the day's riding conditions and ridership.

Who it's for: Seattle bike commuters and the curious, with Tom as user #1.

Framing: a commute hub, not a "stress map." The language stays neutral and practical: protected vs. shared road, traffic moving vs. backed up, good vs. wet riding.

Why it's different: no Seattle page combines live traffic with the bike network at the segment level. Route planners already exist and miss Tom's greenway-first priorities, so routing is out of scope.

Goals for Tom: learn new tech (vector maps, edge workers, scheduled data pipelines, PWAs) and build something people actually check.

## Features by phase

Phase 1 is the first-weekend MVP; each later phase stands on its own, so the site is shippable after any of them.

### Phase 1 — Live map (MVP)

Seattle bike network drawn by facility type: trails, protected, buffered, painted, climbing lanes, greenways, sharrows.

Live car traffic shown only where bikes share or sit next to traffic (painted lanes, sharrows, climbing lanes). Protected lanes, trails and greenways stay their facility color.

Traffic labels in plain terms: moving freely, slowing, backed up, plus current car speed.

"Updated X min ago" stamp and a simple legend.

### Phase 2 — Riding conditions panel

Now and next 3 hours: rain chance and timing, temperature, wind speed and direction.

Sunrise, sunset and daylight for today, with whether the evening ride home is after dark.

One-line summary: good riding, bring fenders, cold start, ride home in the dark.

### Phase 3 — Ridership pulse

Today's counts from SDOT's permanent bike counters (Fremont Bridge and others), shown as markers on the map.

Compared with a typical day of the same weekday and similar weather.

### Phase 4 — Rush hour replay

Traffic snapshots stored every 10–15 minutes during commute windows.

Time slider to replay a morning or evening, plus a "typical Tuesday at 5:30" view built from history.

### Phase 5 — My commute

Save a commute by drawing it or uploading a GPX. No accounts at first; it's stored in the browser.

Breakdown of the route: share on trails, protected lanes and greenways vs. shared roads, and live traffic on the shared parts.

Optional morning push notification with conditions for that route (installable PWA).

### Later ideas

Bike-share vehicle feeds to show where shared bikes and scooters move.

A small model predicting today's ridership from weather.

SDOT construction and closure notices on bike routes.

Seasonal daylight chart for planning winter commutes.

## Data sources

Everything in Phases 1–4 runs on free, public data; TomTom is the only one that needs a key.

| Data | Source | Format and access | Cost / limits | Used in |
|---|---|---|---|---|
| Bike network by facility type | SDOT Existing Bike Facilities | GeoJSON, CSV, ArcGIS FeatureServer; refreshed daily | Free, public | Phase 1 |
| Multi-use trails | SDOT Multi-use Trails | GeoJSON, ArcGIS FeatureServer | Free, public | Phase 1 |
| Live car traffic | TomTom Traffic Flow vector tiles | Protobuf vector tiles, speed relative to free-flow | 50,000 free tile requests/day; check terms on storing snapshots | Phases 1, 4, 5 |
| Bike counts | SDOT bike counters on data.seattle.gov | Socrata API: JSON, CSV | Free, public | Phase 3 |
| Weather forecast | National Weather Service API (api.weather.gov) | JSON, hourly forecast by grid point | Free, no key | Phase 2 |
| Sunrise, sunset, daylight | Computed in the browser (e.g. the SunCalc library) | No API needed | Free | Phase 2 |
| Basemap | A free vector basemap (OpenFreeMap or Protomaps, to evaluate) | Vector tiles for MapLibre | Free | Phase 1 |
Strava and Ride with GPS are out: Strava's API only lets apps show a user's data to that same user, and Ride with GPS only exposes a user's own library.

## Architecture

A static site plus one scheduled edge worker: the worker fetches traffic once every 10 minutes and serves the same cached result to every visitor, which keeps the TomTom key private and the tile budget flat.


The build step does the slow geometry work once; the worker only refreshes traffic and counters; the page reads cached files and the weather API directly.

Front end: Vite + TypeScript, MapLibre GL JS, deployed as static files (Cloudflare Pages, or wherever tomstepp.com lives).

Build step: a Python or Node script that downloads SDOT data, classifies segments, and precomputes which TomTom road pieces sit along each shared segment. Output: simplified GeoJSON or a PMTiles file.

Edge worker: a Cloudflare Worker on a cron trigger. It fetches TomTom flow tiles over Seattle, decodes them, joins them to the shared segments, and writes one traffic-now JSON. It also fetches the counter data and caches it.

Storage: KV or R2 for the latest results; D1 (SQLite) for Phase 4 snapshots, if TomTom's terms allow storing them.

Phase 5: a service worker and Web Push turn the page into an installable app with morning notifications.

Free-tier budget (approximate): Seattle is roughly 40 tiles at zoom 13, so a 10-minute refresh is about 5,800 tile requests a day. Even zoom 14 (roughly 135 tiles) stays near 19,000, well under the 50,000 free.

New tech for Tom: MapLibre and vector tiles, PMTiles, protobuf decoding, edge workers with cron, D1, service workers and Web Push.
