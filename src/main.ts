import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import { SEPARATED, SHARED, TRAFFIC, type FacilityStyle } from "./facilities";

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

// ["match", ["get", "facility"], "trail", "#..", ..., fallback]
function matchFacility<T>(
  styles: Partial<Record<string, FacilityStyle>>,
  pick: (s: FacilityStyle) => T,
  fallback: T,
): ExpressionSpecification {
  const pairs = Object.entries(styles).flatMap(([k, s]) => [k, pick(s!)]);
  return ["match", ["get", "facility"], ...pairs, fallback] as unknown as ExpressionSpecification;
}

const lineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 4, 18, 8];

function addBikeLayers() {
  map.addSource("bike", { type: "geojson", data: "/data/bike-network.geojson" });

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
          "line-color": s!.color,
          "line-width": lineWidth,
          ...(s!.dash ? { "line-dasharray": s!.dash } : {}),
        },
      });
    }
  }

  map.on("click", (e) => {
    const hit = map.queryRenderedFeatures(e.point).find((f) => f.source === "bike");
    if (!hit) return;
    const p = hit.properties as { facility: string; street: string };
    const style = SEPARATED[p.facility as keyof typeof SEPARATED] ?? SHARED[p.facility as keyof typeof SHARED];
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${p.street || "Unnamed"}</strong><br>${style?.label ?? p.facility}`)
      .addTo(map);
  });
}

// Raw TomTom flow, drawn under the bike network. Local dev only: the key is in
// the bundle. Step 4 replaces this with traffic matched to shared segments.
function addTrafficLayer() {
  if (!TOMTOM_KEY) return;
  map.addSource("traffic", {
    type: "vector",
    tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${TOMTOM_KEY}`],
    minzoom: 0,
    maxzoom: 22,
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
        "line-opacity": 0.55,
      },
    },
    firstBike,
  );
  map.on("sourcedata", (e) => {
    if (e.sourceId === "traffic" && e.isSourceLoaded) markUpdated();
  });
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
    <p class="note">Seattle city limits only. Data: SDOT, TomTom.</p>`;
}

map.on("load", () => {
  addBikeLayers();
  addTrafficLayer();
  renderLegend();
  renderStamp();
});
