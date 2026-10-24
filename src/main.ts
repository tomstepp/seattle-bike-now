import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import { SEPARATED, SHARED, TRAFFIC, trafficFor, type FacilityStyle } from "./facilities";
import { matchTraffic, SegmentIndex, type FlowPiece, type SegmentTraffic } from "./match";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_KEY as string | undefined;
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

let segmentIndex: SegmentIndex | null = null;
const matched = new Map<string, SegmentTraffic>();

function addBikeLayers(network: BikeNetwork) {
  map.addSource("bike", { type: "geojson", data: network, promoteId: "id" });
  segmentIndex = new SegmentIndex(
    network.features.filter((f) => !f.properties.separated).map((f) => ({ id: f.properties.id, coords: f.geometry.coordinates })),
  );

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

  map.on("click", (e) => {
    // Lines are a few px wide; give clicks and taps some slack.
    const pad = 6;
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ];
    const hit = map.queryRenderedFeatures(box).find((f) => f.source === "bike");
    if (!hit) return;
    const p = hit.properties as BikeFeature["properties"];
    const style = SEPARATED[p.facility as keyof typeof SEPARATED] ?? SHARED[p.facility as keyof typeof SHARED];
    const t = matched.get(p.id);
    const traffic = p.separated
      ? ""
      : t
        ? `<br>Car traffic: ${trafficFor(t.level).label.toLowerCase()} (${Math.round(t.level * 100)}% of free-flow speed)`
        : TOMTOM_KEY
          ? "<br>No car traffic data here"
          : "";
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${p.street || "Unnamed"}</strong><br>${style?.label ?? p.facility}${traffic}`)
      .addTo(map);
  });
}

// Raw TomTom flow, drawn under the bike network and hidden unless the debug
// toggle is on; the layer must stay in the style so its tiles load for matching.
// Local dev only: the key is in the bundle. The scheduled worker replaces this.
const RAW_OPACITY = 0.55;
function addTrafficLayer() {
  if (!TOMTOM_KEY) return;
  map.addSource("traffic", {
    type: "vector",
    tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${TOMTOM_KEY}`],
    // Lower zooms drop minor streets; z14 detail is overzoomed beyond that.
    minzoom: 12,
    maxzoom: 14,
  });
  const firstBike = map.getStyle().layers.find((l) => l.id.startsWith("bike-"))?.id;
  map.addLayer(
    {
      id: "traffic-raw",
      type: "line",
      source: "traffic",
      "source-layer": "Traffic flow",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "step",
          ["get", "traffic_level"],
          TRAFFIC[2].color,
          TRAFFIC[1].min,
          TRAFFIC[1].color,
          TRAFFIC[0].min,
          TRAFFIC[0].color,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 3],
        "line-opacity": 0,
      },
    },
    firstBike,
  );
  let dirty = false;
  map.on("sourcedata", (e) => {
    if (e.sourceId === "traffic" && e.isSourceLoaded) dirty = true;
  });
  map.on("idle", () => {
    if (!dirty) return;
    dirty = false;
    applyMatches();
    markUpdated();
  });
}

function applyMatches() {
  if (!segmentIndex) return;
  const pieces: FlowPiece[] = [];
  for (const f of map.querySourceFeatures("traffic", { sourceLayer: "Traffic flow" })) {
    const level = f.properties.traffic_level;
    if (typeof level !== "number" || f.properties.road_closure) continue;
    const g = f.geometry;
    if (g.type === "LineString") pieces.push({ coords: g.coordinates as [number, number][], level });
    else if (g.type === "MultiLineString") for (const c of g.coordinates) pieces.push({ coords: c as [number, number][], level });
  }
  // Merge so segments panned out of view keep their last reading.
  for (const [id, t] of matchTraffic(segmentIndex, pieces)) {
    matched.set(id, t);
    map.setFeatureState({ source: "bike", id }, { level: t.level });
  }
}

let updatedAt: Date | null = null;
function markUpdated() {
  updatedAt = new Date();
  renderStamp();
}
function renderStamp() {
  const el = document.getElementById("updated")!;
  if (!TOMTOM_KEY) {
    el.textContent = "Traffic off: add VITE_TOMTOM_KEY to .env";
    return;
  }
  if (!updatedAt) {
    el.textContent = "Loading traffic…";
    return;
  }
  const mins = Math.floor((Date.now() - updatedAt.getTime()) / 60000);
  el.textContent = `Traffic updated ${mins < 1 ? "just now" : `${mins} min ago`}`;
}
setInterval(renderStamp, 30_000);

function renderLegend() {
  const row = (s: FacilityStyle) => {
    const dash = s.dash ? `background: repeating-linear-gradient(90deg, ${s.color} 0 6px, transparent 6px 10px)` : `background: ${s.color}`;
    return `<li><span class="swatch" style="${dash}"></span>${s.label}</li>`;
  };
  document.getElementById("legend")!.innerHTML = `
    <h2>Separated from cars</h2>
    <ul>${Object.values(SEPARATED).map((s) => row(s!)).join("")}</ul>
    <h2>Shared with cars</h2>
    <ul>${Object.values(SHARED).map((s) => row(s!)).join("")}</ul>
    ${
      TOMTOM_KEY
        ? `<h2>Car traffic</h2><ul>${TRAFFIC.map((t) => row({ label: t.label, color: t.color })).join("")}</ul>`
        : ""
    }
    ${TOMTOM_KEY ? `<label class="toggle"><input type="checkbox" id="raw-toggle"> Show all TomTom traffic</label>` : ""}
    <p class="note">Seattle city limits only. Data: SDOT, TomTom.</p>`;
  document.getElementById("raw-toggle")?.addEventListener("change", (e) => {
    map.setPaintProperty("traffic-raw", "line-opacity", (e.target as HTMLInputElement).checked ? RAW_OPACITY : 0);
  });
}

const networkPromise: Promise<BikeNetwork> = fetch("/data/bike-network.geojson").then((r) => r.json());

map.on("load", async () => {
  addBikeLayers(await networkPromise);
  addTrafficLayer();
  renderLegend();
  renderStamp();
});
