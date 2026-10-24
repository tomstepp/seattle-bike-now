import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import { SEPARATED, SHARED, TRAFFIC, trafficFor, type FacilityStyle } from "./facilities";
import type { TrafficSnapshot } from "../worker/traffic";
import {
  bridgeChance,
  bridgeChart,
  chanceClass,
  changeText,
  renderBridges,
  renderRiders,
  renderUnavailable,
  renderWeather,
  sparkline,
} from "./conditions";
import type { BridgesFile, CountersFile } from "./data-types";
import { formatDay } from "./seattle-time";
import { fetchAlerts, fetchHourly } from "./weather";

// Raw TomTom tiles are a dev-only debugging aid. In production builds DEV is
// false, so the key is never read and never lands in the bundle.
const DEBUG_TOMTOM_KEY = import.meta.env.DEV ? (import.meta.env.VITE_TOMTOM_KEY as string | undefined) : undefined;
const REFRESH_MS = 2 * 60_000;
const WEATHER_REFRESH_MS = 15 * 60_000;
// Bridge odds change on the hour; re-check often enough to roll over promptly.
const BRIDGE_REFRESH_MS = 5 * 60_000;
const SEATTLE: [number, number] = [-122.3321, 47.6162];

// Vite's pre-bundling breaks MapLibre's relative worker lookup; point at it directly.
maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: SEATTLE,
  zoom: 12,
  minZoom: 10,
  maxBounds: [
    [-122.55, 47.45],
    [-122.1, 47.8],
  ],
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
if (import.meta.env.DEV) Object.assign(window, { map });

const lineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 4, 18, 8];

// Shared segments take the color of matched car traffic; unmatched ones keep their facility grey.
const trafficColor = (fallback: string): ExpressionSpecification => [
  "case",
  ["==", ["typeof", ["feature-state", "level"]], "number"],
  ["step", ["feature-state", "level"], TRAFFIC[2].color, TRAFFIC[1].min, TRAFFIC[1].color, TRAFFIC[0].min, TRAFFIC[0].color],
  fallback,
];

interface BikeFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { id: string; facility: string; separated: boolean; street: string };
}
interface BikeNetwork {
  type: "FeatureCollection";
  features: BikeFeature[];
}

let snapshot: TrafficSnapshot | null = null;

function addBikeLayers(network: BikeNetwork) {
  map.addSource("bike", { type: "geojson", data: network, promoteId: "id" });

  // MapLibre can't data-drive line-dasharray, so one layer per dashed facility.
  for (const [group, styles, separated] of [
    ["separated", SEPARATED, true],
    ["shared", SHARED, false],
  ] as const) {
    for (const [facility, s] of Object.entries(styles)) {
      map.addLayer({
        id: `bike-${group}-${facility}`,
        type: "line",
        source: "bike",
        filter: ["all", ["==", ["get", "facility"], facility], ["==", ["get", "separated"], separated]],
        layout: { "line-cap": s!.dash ? "butt" : "round", "line-join": "round" },
        paint: {
          "line-color": separated ? s!.color : trafficColor(s!.color),
          "line-width": lineWidth,
          ...(s!.dash ? { "line-dasharray": s!.dash } : {}),
        },
      });
    }
  }
}

// Bridge and counter markers. Colors match the sidebar's odds bands.
const BRIDGE_COLORS = { likely: "#f472b6", possible: "#f9a8d4", unlikely: "#71717a" };
const COUNTER_COLOR = "#fafaf9";

let bridges: BridgesFile | null = null;
let counters: CountersFile | null = null;

function bridgeFeatures(file: BridgesFile) {
  return {
    type: "FeatureCollection" as const,
    features: file.bridges.map((b) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [b.lng, b.lat] },
      properties: { id: b.id, odds: chanceClass(bridgeChance(b)) },
    })),
  };
}

function addMarkerLayers() {
  if (bridges) {
    map.addSource("bridges", { type: "geojson", data: bridgeFeatures(bridges) });
    map.addLayer({
      id: "bridges",
      type: "circle",
      source: "bridges",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 8],
        "circle-color": ["match", ["get", "odds"], "likely", BRIDGE_COLORS.likely, "possible", BRIDGE_COLORS.possible, BRIDGE_COLORS.unlikely],
        "circle-stroke-color": "#0c0c0e",
        "circle-stroke-width": 2,
      },
    });
  }
  if (counters) {
    map.addSource("counters", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: counters.counters.map((c) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
          properties: { id: c.id },
        })),
      },
    });
    map.addLayer({
      id: "counters",
      type: "circle",
      source: "counters",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
        "circle-color": "#0c0c0e",
        "circle-stroke-color": COUNTER_COLOR,
        "circle-stroke-width": 2,
      },
    });
  }
}

const popup = (lngLat: maplibregl.LngLatLike, html: string) =>
  new maplibregl.Popup({ closeButton: false, maxWidth: "260px" }).setLngLat(lngLat).setHTML(html).addTo(map);

map.on("click", (e) => {
  // Lines and dots are a few px wide; give clicks and taps some slack.
  const pad = 6;
  const box: [maplibregl.PointLike, maplibregl.PointLike] = [
    [e.point.x - pad, e.point.y - pad],
    [e.point.x + pad, e.point.y + pad],
  ];
  const hits = map.queryRenderedFeatures(box);
  // Markers sit on top of the network, so they win.
  const bridgeHit = hits.find((f) => f.source === "bridges");
  const counterHit = hits.find((f) => f.source === "counters");
  const bikeHit = hits.find((f) => f.source === "bike");

  // The Fremont counter sits on the Fremont Bridge, so both can be hit at once.
  const parts: string[] = [];
  let at: maplibregl.LngLatLike | null = null;
  if (bridgeHit) {
    const b = bridges!.bridges.find((x) => x.id === bridgeHit.properties.id)!;
    const p = bridgeChance(b);
    at = [b.lng, b.lat];
    parts.push(
      `<strong>${b.name} Bridge</strong><br>${Math.round(p * 100)}% chance of an opening this hour<br>${bridgeChart(b)}${b.openingsPerDay} openings a day, usually ${b.medianMinutes} min`,
    );
  }
  if (counterHit) {
    const c = counters!.counters.find((x) => x.id === counterHit.properties.id)!;
    at ??= [c.lng, c.lat];
    parts.push(
      `<strong>${c.name} counter</strong><br>${c.avgPerDay30.toLocaleString("en-US")} riders/day ${changeText(c)}<br>${sparkline(c.weekly)}<br>30 days through ${formatDay(c.lastDay)}`,
    );
  }
  if (at) {
    popup(at, parts.join("<hr>"));
  } else if (bikeHit) {
    const p = bikeHit.properties as BikeFeature["properties"];
    const style = SEPARATED[p.facility as keyof typeof SEPARATED] ?? SHARED[p.facility as keyof typeof SHARED];
    const level = snapshot?.segments[p.id];
    const traffic = p.separated
      ? ""
      : level !== undefined
        ? `<br>Car traffic: ${trafficFor(level).label.toLowerCase()} (${Math.round(level * 100)}% of free-flow speed)`
        : snapshot
          ? "<br>No car traffic data here"
          : "";
    popup(e.lngLat, `<strong>${p.street || "Unnamed"}</strong><br>${style?.label ?? p.facility}${traffic}`);
  }
});
for (const layer of ["bridges", "counters"]) {
  map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
}

function refreshBridges() {
  if (!bridges) return;
  renderBridges(bridges);
  (map.getSource("bridges") as maplibregl.GeoJSONSource | undefined)?.setData(bridgeFeatures(bridges));
}

async function loadWeather() {
  try {
    const [hours, alerts] = await Promise.all([fetchHourly(), fetchAlerts().catch(() => [])]);
    renderWeather(hours, alerts);
  } catch (err) {
    console.warn("weather unavailable", err);
    renderUnavailable("weather", "the forecast");
  }
}

// Latest snapshot from the worker (/api/traffic), refreshed every few minutes.
async function loadTraffic() {
  try {
    const res = await fetch("/api/traffic");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as TrafficSnapshot;
    // Segments that dropped out of the new snapshot go back to their facility color.
    for (const id of Object.keys(snapshot?.segments ?? {})) {
      if (!(id in next.segments)) map.removeFeatureState({ source: "bike", id }, "level");
    }
    for (const [id, level] of Object.entries(next.segments)) map.setFeatureState({ source: "bike", id }, { level });
    snapshot = next;
  } catch (err) {
    console.warn("traffic unavailable", err);
  }
  renderStamp();
}

function renderStamp() {
  const el = document.getElementById("updated")!;
  if (!snapshot) {
    el.textContent = "Traffic unavailable right now";
    return;
  }
  const mins = Math.floor((Date.now() - Date.parse(snapshot.updatedAt)) / 60000);
  el.textContent = `Traffic updated ${mins < 1 ? "just now" : `${mins} min ago`}`;
}
setInterval(renderStamp, 30_000);

// Dev only: TomTom's own tiles under the bike network, for spot-checking matches.
const RAW_OPACITY = 0.55;
function addRawTrafficLayer() {
  if (!DEBUG_TOMTOM_KEY) return;
  map.addSource("traffic-raw", {
    type: "vector",
    tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${DEBUG_TOMTOM_KEY}`],
    minzoom: 12,
    maxzoom: 14,
  });
  const firstBike = map.getStyle().layers.find((l) => l.id.startsWith("bike-"))?.id;
  map.addLayer(
    {
      id: "traffic-raw",
      type: "line",
      source: "traffic-raw",
      "source-layer": "Traffic flow",
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": ["step", ["get", "traffic_level"], TRAFFIC[2].color, TRAFFIC[1].min, TRAFFIC[1].color, TRAFFIC[0].min, TRAFFIC[0].color],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 3],
        "line-opacity": RAW_OPACITY,
      },
    },
    firstBike,
  );
}

function renderLegend() {
  const row = (s: FacilityStyle) => {
    const dash = s.dash ? `background: repeating-linear-gradient(90deg, ${s.color} 0 6px, transparent 6px 10px)` : `background: ${s.color}`;
    return `<li><span class="swatch" style="${dash}"></span>${s.label}</li>`;
  };
  const dot = (color: string, ring = false) =>
    `<span class="dot" style="${ring ? `border-color:${color}` : `background:${color}`}"></span>`;
  document.querySelector("#legend .body")!.innerHTML = `
    <h2>Separated from cars</h2>
    <ul>${Object.values(SEPARATED).map((s) => row(s!)).join("")}</ul>
    <h2>Shared with cars</h2>
    <ul>${Object.values(SHARED).map((s) => row(s!)).join("")}</ul>
    <h2>Car traffic</h2>
    <ul>${TRAFFIC.map((t) => row({ label: t.label, color: t.color })).join("")}</ul>
    <h2>Markers</h2>
    <ul>
      <li>${dot(BRIDGE_COLORS.likely)}Drawbridge, opening likely this hour</li>
      <li>${dot(BRIDGE_COLORS.unlikely)}Drawbridge, opening unlikely</li>
      <li>${dot(COUNTER_COLOR, true)}Bike counter</li>
    </ul>
    ${DEBUG_TOMTOM_KEY ? `<label class="toggle"><input type="checkbox" id="raw-toggle"> Show all TomTom traffic (dev)</label>` : ""}
    <p class="note">Seattle city limits only. Data: SDOT, TomTom, NWS.</p>`;
  document.getElementById("raw-toggle")?.addEventListener("change", (e) => {
    map.setLayoutProperty("traffic-raw", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none");
  });
}

// Sections marked data-open="desktop" start open on wide screens; after that,
// each viewer's own open/closed choice is remembered.
function initSections() {
  const wide = matchMedia("(min-width: 700px)").matches;
  for (const el of document.querySelectorAll<HTMLDetailsElement>(".sections details")) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`open:${el.id}`);
    } catch {}
    el.open = saved !== null ? saved === "1" : wide && el.dataset.open === "desktop";
    el.addEventListener("toggle", () => {
      try {
        localStorage.setItem(`open:${el.id}`, el.open ? "1" : "0");
      } catch {}
    });
  }
}
initSections();

const getJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });
const networkPromise = getJson<BikeNetwork>("/data/bike-network.geojson");
const bridgesPromise = getJson<BridgesFile>("/data/bridges.json")
  .then((f) => {
    bridges = f;
    renderBridges(f);
  })
  .catch((err) => (console.warn("bridges unavailable", err), renderUnavailable("bridges", "bridge data")));
const countersPromise = getJson<CountersFile>("/data/counters.json")
  .then((f) => {
    counters = f;
    renderRiders(f);
  })
  .catch((err) => (console.warn("counters unavailable", err), renderUnavailable("riders", "rider counts")));

loadWeather();
setInterval(loadWeather, WEATHER_REFRESH_MS);

map.on("load", async () => {
  addBikeLayers(await networkPromise);
  addRawTrafficLayer();
  await Promise.all([bridgesPromise, countersPromise]);
  addMarkerLayers();
  refreshBridges();
  setInterval(refreshBridges, BRIDGE_REFRESH_MS);
  renderLegend();
  await loadTraffic();
  setInterval(loadTraffic, REFRESH_MS);
});
