import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import { SEPARATED, SHARED, TRAFFIC, trafficFor, type FacilityStyle } from "./facilities";
import type { TrafficSnapshot } from "../worker/traffic";

// Raw TomTom tiles are a dev-only debugging aid. In production builds DEV is
// false, so the key is never read and never lands in the bundle.
const DEBUG_TOMTOM_KEY = import.meta.env.DEV ? (import.meta.env.VITE_TOMTOM_KEY as string | undefined) : undefined;
const REFRESH_MS = 2 * 60_000;
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
    const level = snapshot?.segments[p.id];
    const traffic = p.separated
      ? ""
      : level !== undefined
        ? `<br>Car traffic: ${trafficFor(level).label.toLowerCase()} (${Math.round(level * 100)}% of free-flow speed)`
        : snapshot
          ? "<br>No car traffic data here"
          : "";
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${p.street || "Unnamed"}</strong><br>${style?.label ?? p.facility}${traffic}`)
      .addTo(map);
  });
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
  document.getElementById("legend")!.innerHTML = `
    <h2>Separated from cars</h2>
    <ul>${Object.values(SEPARATED).map((s) => row(s!)).join("")}</ul>
    <h2>Shared with cars</h2>
    <ul>${Object.values(SHARED).map((s) => row(s!)).join("")}</ul>
    <h2>Car traffic</h2>
    <ul>${TRAFFIC.map((t) => row({ label: t.label, color: t.color })).join("")}</ul>
    ${DEBUG_TOMTOM_KEY ? `<label class="toggle"><input type="checkbox" id="raw-toggle"> Show all TomTom traffic (dev)</label>` : ""}
    <p class="note">Seattle city limits only. Data: SDOT, TomTom.</p>`;
  document.getElementById("raw-toggle")?.addEventListener("change", (e) => {
    map.setLayoutProperty("traffic-raw", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none");
  });
}

const networkPromise: Promise<BikeNetwork> = fetch("/data/bike-network.geojson").then((r) => r.json());

map.on("load", async () => {
  addBikeLayers(await networkPromise);
  addRawTrafficLayer();
  renderLegend();
  await loadTraffic();
  setInterval(loadTraffic, REFRESH_MS);
});
