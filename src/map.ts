// The map: basemap, bike network with live traffic, markers, popups and the map key.
// Loaded as its own chunk so the sidebar can show before MapLibre (most of the
// page's JavaScript) has downloaded.
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { TrafficSnapshot } from "../worker/traffic";
import { daysThisWeek, hoursOn, type Closure } from "./closures";
import type { Construction } from "./construction";
import { bridgeChance, bridgeChart, chanceClass, changeText, severityText, sparkline } from "./conditions";
import { crashesFor, crashWindow, onCrashWindow } from "./crashes";
import type { BikeNetwork, BridgesFile, CollisionSpot, CollisionsFile, CountersFile, RacksFile, RepairFile } from "./data-types";
import { esc, streetCase } from "./format";
import { formatDayYear, seattleDate } from "./seattle-time";
import { SEPARATED, SHARED, TRAFFIC, trafficFor, type FacilityStyle } from "./facilities";
import { initLocate } from "./locate";
import { NEAR_BOUNDS } from "./seattle-area";
import { formatDay } from "./seattle-time";

// Raw TomTom tiles are a dev-only debugging aid. In production builds DEV is
// false, so the key is never read and never lands in the bundle.
const DEBUG_TOMTOM_KEY = import.meta.env.DEV ? (import.meta.env.VITE_TOMTOM_KEY as string | undefined) : undefined;
const REFRESH_MS = 2 * 60_000;
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
  maxBounds: NEAR_BOUNDS,
  attributionControl: { compact: true },
});
// The compact attribution starts expanded; collapse it to its ⓘ button (tap to expand).
map.once("load", () => {
  document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
initLocate(map);
if (import.meta.env.DEV) Object.assign(window, { map });

const lineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 4, 18, 8];

// Shared segments take the color of matched car traffic; unmatched ones keep their facility grey.
const trafficColor = (fallback: string): ExpressionSpecification => [
  "case",
  ["==", ["typeof", ["feature-state", "level"]], "number"],
  ["step", ["feature-state", "level"], TRAFFIC[2].color, TRAFFIC[1].min, TRAFFIC[1].color, TRAFFIC[0].min, TRAFFIC[0].color],
  fallback,
];

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

// City limits on land, under the bike network. Dashed like a map border.
const CITY_LIMITS_COLOR = "#d6d3d1";
function addCityLimits() {
  map.addSource("city-limits", { type: "geojson", data: "/data/city-limits.geojson" });
  map.addLayer({
    id: "city-limits",
    type: "line",
    source: "city-limits",
    layout: { "line-join": "round" },
    paint: {
      "line-color": CITY_LIMITS_COLOR,
      "line-opacity": 0.55,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 2.5],
      "line-dasharray": [4, 2],
    },
  });
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

// Permitted street closures: a wide orange band under the bike lanes. Today's are
// solid; later this week, faint.
const CLOSURE_COLOR = "#fb923c";
let closures: Closure[] = [];

function addClosureLayer(list: Closure[]) {
  closures = list;
  const today = seattleDate();
  map.addSource("closures", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: list
        .map((c, i) => ({ c, i, days: daysThisWeek(c, today) }))
        .filter(({ days }) => days.length)
        .map(({ c, i, days }) => ({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: c.coords },
          properties: { i, today: days[0] === today },
        })),
    },
  });
  map.addLayer(
    {
      id: "closures",
      type: "line",
      source: "closures",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": CLOSURE_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 15, 12],
        "line-opacity": ["case", ["get", "today"], 0.6, 0.25],
      },
    },
    firstBikeLayer(),
  );
}

// Construction that may affect a bike lane: a dashed band, so it reads apart from
// the solid event closures.
const CONSTRUCTION_COLOR = "#f97316";
let construction: Construction[] = [];

function addConstructionLayer(list: Construction[]) {
  construction = list;
  map.addSource("construction", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: list.map((c, i) => ({
        type: "Feature" as const,
        geometry: { type: "MultiLineString" as const, coordinates: c.lines },
        properties: { i },
      })),
    },
  });
  map.addLayer(
    {
      id: "construction",
      type: "line",
      source: "construction",
      layout: { "line-join": "round" },
      paint: {
        "line-color": CONSTRUCTION_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 15, 12],
        "line-opacity": 0.7,
        "line-dasharray": [1, 0.6],
      },
    },
    firstBikeLayer(),
  );
}

// Bike crashes, one dot per location, bigger with more crashes, for the chosen time window.
const CRASH_COLOR = "#fde047";
let collisions: CollisionsFile | null = null;
let crashSpots: CollisionSpot[] = [];
let crashSince = "";

function crashFeatures() {
  ({ spots: crashSpots, since: crashSince } = crashesFor(collisions!, crashWindow()));
  return {
    type: "FeatureCollection" as const,
    features: crashSpots.map((s, i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
      properties: { i, crashes: s.crashes },
    })),
  };
}

const crashSize: ExpressionSpecification = ["interpolate", ["linear"], ["get", "crashes"], 1, 2.5, 3, 5, 7, 8];

function addCrashLayer(file: CollisionsFile) {
  collisions = file;
  map.addSource("crashes", { type: "geojson", data: crashFeatures() });
  onCrashWindow(() => (map.getSource("crashes") as maplibregl.GeoJSONSource).setData(crashFeatures()));
  map.addLayer(
    {
      id: "crashes",
      type: "circle",
      source: "crashes",
      paint: {
        // Zoom has to be the outer interpolate; crash count scales within each stop.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["*", 0.6, crashSize],
          15,
          ["*", 1.4, crashSize],
        ],
        "circle-color": CRASH_COLOR,
        "circle-opacity": ["case", [">", ["get", "crashes"], 1], 0.9, 0.45],
        "circle-stroke-color": "#0c0c0e",
        "circle-stroke-width": 1,
      },
    },
    // Under the bridge and counter markers.
    map.getLayer("bridges") ? "bridges" : undefined,
  );
}

// Off by default, and their data only downloads the first time they're turned on.
const RACK_COLOR = "#5eead4";
const REPAIR_COLOR = "#a3e635";
let racks: RacksFile | null = null;
let repair: RepairFile | null = null;

async function addRackLayer() {
  racks = (await (await fetch("/data/racks.json")).json()) as RacksFile;
  map.addSource("racks", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: racks.racks.map(([lng, lat, spaces]) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { spaces },
      })),
    },
  });
  map.addLayer(
    {
      id: "racks",
      type: "circle",
      source: "racks",
      paint: {
        // ~3,800 racks: pinpricks zoomed out, real dots up close.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1, 13, 2, 17, 5],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, 1],
        "circle-color": RACK_COLOR,
        "circle-stroke-color": "#0c0c0e",
      },
    },
    map.getLayer("crashes") ? "crashes" : undefined,
  );
}

async function addRepairLayer() {
  repair = (await (await fetch("/data/repair.json")).json()) as RepairFile;
  map.addSource("repair", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: repair.stations.map((st, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [st.lng, st.lat] },
        properties: { i },
      })),
    },
  });
  map.addLayer({
    id: "repair",
    type: "circle",
    source: "repair",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
      "circle-color": REPAIR_COLOR,
      "circle-stroke-color": "#0c0c0e",
      "circle-stroke-width": 2,
    },
  });
}

// Hills: recolor the bike network by block grade, over the facility and traffic colors.
// Off-street trails have no block grade and stay as they are.
export const SLOPES = [
  { label: "Flat (under 5%)", min: 0, color: "#57534e" },
  { label: "Moderate (5–7%)", min: 5, color: "#fdba74" },
  { label: "Steep (8–11%)", min: 8, color: "#f97316" },
  { label: "Very steep (12%+)", min: 12, color: "#dc2626" },
] as const;

function addHillLayer() {
  map.addLayer(
    {
      id: "hills",
      type: "line",
      source: "bike",
      filter: ["has", "slope"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["step", ["get", "slope"], SLOPES[0].color, SLOPES[1].min, SLOPES[1].color, SLOPES[2].min, SLOPES[2].color, SLOPES[3].min, SLOPES[3].color],
        // A touch wider than the lanes so it fully covers them.
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 5, 18, 9],
      },
    },
  );
  // Keep markers above the hill colors.
  for (const id of ["crashes", "racks", "bridges", "counters", "repair"]) if (map.getLayer(id)) map.moveLayer(id);
}

const firstBikeLayer = () => map.getStyle().layers.find((l) => l.id.startsWith("bike-"))?.id;

// Layers the viewer can turn on and off from the map key. Choices are remembered.
interface Toggle {
  key: string;
  label: string;
  swatch: string;
  layers: string[];
  on: boolean;
  /** Adds the layer the first time it's turned on. */
  load?: () => Promise<void> | void;
}
const swatchDot = (color: string, ring = false) =>
  `<span class="dot" style="${ring ? `border-color:${color}` : `background:${color}`}"></span>`;
const TOGGLES: Toggle[] = [
  { key: "closures", label: "Street closures", swatch: `<span class="swatch wide" style="background:${CLOSURE_COLOR}"></span>`, layers: ["closures"], on: true },
  {
    key: "construction",
    label: "Construction on bike lanes",
    swatch: `<span class="swatch wide" style="background: repeating-linear-gradient(90deg, ${CONSTRUCTION_COLOR} 0 5px, transparent 5px 8px)"></span>`,
    layers: ["construction"],
    on: true,
  },
  { key: "crashes", label: "Bike crashes", swatch: swatchDot(CRASH_COLOR), layers: ["crashes"], on: true },
  { key: "bridges", label: "Drawbridges", swatch: swatchDot("#f472b6"), layers: ["bridges"], on: true },
  { key: "counters", label: "Bike counters", swatch: swatchDot("#fafaf9", true), layers: ["counters"], on: true },
  { key: "racks", label: "Bike racks", swatch: swatchDot(RACK_COLOR), layers: ["racks"], on: false, load: addRackLayer },
  { key: "repair", label: "Repair stands", swatch: swatchDot(REPAIR_COLOR), layers: ["repair"], on: false, load: addRepairLayer },
  {
    key: "hills",
    label: "Hills",
    swatch: `<span class="swatch" style="background: linear-gradient(90deg, ${SLOPES.map((x) => x.color).join(", ")})"></span>`,
    layers: ["hills"],
    on: false,
    load: addHillLayer,
  },
];

function toggleOn(t: Toggle): boolean {
  try {
    const saved = localStorage.getItem(`layer:${t.key}`);
    if (saved !== null) return saved === "1";
  } catch {}
  return t.on;
}

const loading = new Map<string, Promise<void>>();

async function applyToggle(t: Toggle, on: boolean) {
  if (on && t.load && !t.layers.every((id) => map.getLayer(id))) {
    if (!loading.has(t.key)) loading.set(t.key, Promise.resolve(t.load()));
    try {
      await loading.get(t.key);
    } catch (err) {
      console.warn(`${t.key} unavailable`, err);
      loading.delete(t.key);
      return;
    }
  }
  for (const id of t.layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

const isOn = (key: string) => (document.querySelector<HTMLInputElement>(`#layers [data-toggle="${key}"]`)?.checked ?? false);

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
  const crashHit = hits.find((f) => f.source === "crashes");
  const closureHit = hits.find((f) => f.source === "closures");
  const workHit = hits.find((f) => f.source === "construction");
  const rackHit = hits.find((f) => f.source === "racks");
  const repairHit = hits.find((f) => f.source === "repair");

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
  } else if (repairHit && repair) {
    const st = repair.stations[repairHit.properties.i as number];
    const has = [st.pump && "pump", st.tools && "tools"].filter(Boolean).join(" and ");
    popup(
      [st.lng, st.lat],
      `<strong>Bike repair stand</strong>${st.name ? `<br>${esc(st.name)}` : ""}${has ? `<br>Has ${has}` : ""}${st.hours ? `<br>Open ${esc(st.hours)}` : ""}<br><span class="sub">© OpenStreetMap contributors</span>`,
    );
  } else if (rackHit) {
    const spaces = rackHit.properties.spaces as number;
    popup(e.lngLat, `<strong>Bike rack</strong>${spaces ? `<br>${spaces} bike ${spaces === 1 ? "space" : "spaces"}` : ""}`);
  } else if (crashHit) {
    const s = crashSpots[crashHit.properties.i as number];
    popup(
      [s.lng, s.lat],
      `<strong>${esc(streetCase(s.location))}</strong><br>${s.crashes} bike ${s.crashes === 1 ? "crash" : "crashes"} since ${formatDayYear(crashSince)}<br>${severityText(s)}<br>Most recent ${formatDayYear(s.last)}`,
    );
  } else if (workHit) {
    const c = construction[workHit.properties.i as number];
    popup(
      e.lngLat,
      `<strong>Construction: bike lane ${esc(c.impact)}</strong>${c.lane ? `<br>${esc(streetCase(c.lane))}` : ""}<br>${esc(c.work)}${
        c.workDays ? `, ${esc(c.workDays.toLowerCase())}` : ""
      }<br>Permit runs until ${formatDayYear(c.end)}<br><span class="sub">${esc(streetCase(c.address))} · ${esc(c.permit)}</span>`,
    );
  } else if (closureHit) {
    const c = closures[closureHit.properties.i as number];
    const today = seattleDate();
    const when = daysThisWeek(c, today)
      .map((d) => `${d === today ? "Today" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${hoursOn(c, d)}`)
      .join("<br>");
    popup(
      e.lngLat,
      `<strong>${esc(streetCase(c.street))} closed</strong><br>${esc(streetCase(c.from))} to ${esc(streetCase(c.to))}<br>${esc(c.type)}<br>${when}`,
    );
  } else if (bikeHit) {
    const p = bikeHit.properties as BikeNetwork["features"][number]["properties"];
    const style = SEPARATED[p.facility as keyof typeof SEPARATED] ?? SHARED[p.facility as keyof typeof SHARED];
    const level = snapshot?.segments[p.id];
    const traffic = p.separated
      ? ""
      : level !== undefined
        ? `<br>Car traffic: ${trafficFor(level).label.toLowerCase()} (${Math.round(level * 100)}% of free-flow speed)`
        : snapshot
          ? "<br>No car traffic data here"
          : "";
    const grade = p.slope !== undefined ? `<br>${p.slope}% grade` : "";
    popup(e.lngLat, `<strong>${p.street || "Unnamed"}</strong><br>${style?.label ?? p.facility}${grade}${traffic}`);
  }
});
for (const layer of ["bridges", "counters", "crashes", "closures", "construction", "racks", "repair"]) {
  map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
}

// Marker colors follow the hour, like the sidebar.
function refreshBridgeMarkers() {
  if (bridges) (map.getSource("bridges") as maplibregl.GeoJSONSource | undefined)?.setData(bridgeFeatures(bridges));
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

const keyRow = (s: FacilityStyle) => {
  const dash = s.dash ? `background: repeating-linear-gradient(90deg, ${s.color} 0 6px, transparent 6px 10px)` : `background: ${s.color}`;
  return `<li><span class="swatch" style="${dash}"></span>${s.label}</li>`;
};

// What each layer looks like, shown in the map key only while that layer is on.
const LAYER_KEYS: Record<string, () => string> = {
  construction: () =>
    `<li><span class="swatch wide" style="background: repeating-linear-gradient(90deg, ${CONSTRUCTION_COLOR} 0 5px, transparent 5px 8px)"></span>Construction may affect lane</li>`,
  closures: () => `<li><span class="swatch wide" style="background:${CLOSURE_COLOR}"></span>Street closed today</li>
    <li><span class="swatch wide" style="background:${CLOSURE_COLOR}; opacity:0.3"></span>Closed later this week</li>`,
  crashes: () => `<li>${swatchDot(CRASH_COLOR)}Bike crashes (bigger = more)</li>`,
  bridges: () => `<li>${swatchDot(BRIDGE_COLORS.likely)}Drawbridge, opening likely this hour</li>
    <li>${swatchDot(BRIDGE_COLORS.unlikely)}Drawbridge, opening unlikely</li>`,
  counters: () => `<li>${swatchDot(COUNTER_COLOR, true)}Bike counter</li>`,
  racks: () => `<li>${swatchDot(RACK_COLOR)}Bike rack</li>`,
  repair: () => `<li>${swatchDot(REPAIR_COLOR)}Repair stand</li>`,
};

/** Map key: lanes and traffic always, plus whichever layers are on. Re-rendered on every switch. */
function renderKey() {
  const on = TOGGLES.filter((t) => isOn(t.key));
  const extras = on.map((t) => LAYER_KEYS[t.key]?.() ?? "").join("");
  const hills = on.some((t) => t.key === "hills");
  document.querySelector("#legend .body")!.innerHTML = `
    ${
      hills
        ? `<h2>Hills (bike lanes by grade)</h2>
           <ul>${SLOPES.map((x) => keyRow({ label: x.label, color: x.color })).join("")}</ul>
           <p class="note">Each block's average grade, from SDOT. Trails aren't graded and keep their lane color.</p>`
        : ""
    }
    <h2>Separated from cars</h2>
    <ul>${Object.values(SEPARATED).map((s) => keyRow(s!)).join("")}</ul>
    <h2>Shared with cars</h2>
    <ul>${Object.values(SHARED).map((s) => keyRow(s!)).join("")}</ul>
    <h2>Car traffic on shared lanes</h2>
    <ul>${TRAFFIC.map((t) => keyRow({ label: t.label, color: t.color })).join("")}</ul>
    <h2>Also on the map</h2>
    <ul>
      ${extras}
      <li><span class="swatch" style="background: repeating-linear-gradient(90deg, ${CITY_LIMITS_COLOR} 0 8px, transparent 8px 12px); opacity: 0.7"></span>Seattle city limits</li>
    </ul>
    <p class="note">Seattle city limits only. Data: SDOT, TomTom, NWS, OpenStreetMap.</p>`;
}

/** Layers: one switch per optional layer. */
function renderLayers() {
  const status = () => {
    const n = TOGGLES.filter((t) => isOn(t.key)).length;
    document.querySelector("#layers .status")!.textContent = `${n} of ${TOGGLES.length} on`;
  };
  document.querySelector("#layers .body")!.innerHTML = `
    <ul class="toggles">
      ${TOGGLES.map((t) => `<li><label class="toggle"><input type="checkbox" data-toggle="${t.key}"${toggleOn(t) ? " checked" : ""}>${t.swatch}${t.label}</label></li>`).join("")}
    </ul>
    ${DEBUG_TOMTOM_KEY ? `<label class="toggle"><input type="checkbox" id="raw-toggle"> Show all TomTom traffic (dev)</label>` : ""}
    <p class="note">Racks, repair stands and hills load when first turned on.</p>`;
  for (const input of document.querySelectorAll<HTMLInputElement>("#layers [data-toggle]")) {
    const t = TOGGLES.find((x) => x.key === input.dataset.toggle)!;
    input.addEventListener("change", () => {
      applyToggle(t, input.checked);
      renderKey();
      status();
      try {
        localStorage.setItem(`layer:${t.key}`, input.checked ? "1" : "0");
      } catch {}
    });
  }
  document.getElementById("raw-toggle")?.addEventListener("change", (e) => {
    map.setLayoutProperty("traffic-raw", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none");
  });
  status();
}

export interface MapInputs {
  network: Promise<BikeNetwork>;
  bridges: Promise<BridgesFile | null>;
  counters: Promise<CountersFile | null>;
  collisions: Promise<CollisionsFile | null>;
  closures: Promise<Closure[] | null>;
  construction: Promise<Construction[] | null>;
  onMapClick: () => void;
}

export function startMap(inputs: MapInputs) {
  map.on("click", inputs.onMapClick);
  // The sidebar's crash list asks the map to show a spot.
  window.addEventListener("focus-map", (e) => {
    const { lng, lat } = (e as CustomEvent<{ lng: number; lat: number }>).detail;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) });
    inputs.onMapClick();
  });
  map.on("load", async () => {
    addCityLimits();
    addBikeLayers(await inputs.network);
    addRawTrafficLayer();
    [bridges, counters] = await Promise.all([inputs.bridges, inputs.counters]);
    addMarkerLayers();
    setInterval(refreshBridgeMarkers, BRIDGE_REFRESH_MS);
    const [crashFile, closureList] = await Promise.all([inputs.collisions, inputs.closures]);
    if (crashFile) addCrashLayer(crashFile);
    if (closureList) addClosureLayer(closureList);
    const work = await inputs.construction;
    if (work) addConstructionLayer(work);
    renderLayers();
    renderKey();
    for (const t of TOGGLES) applyToggle(t, toggleOn(t));
    await loadTraffic();
    setInterval(loadTraffic, REFRESH_MS);
  });
}
