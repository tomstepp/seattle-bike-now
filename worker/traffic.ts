// One traffic refresh: fetch TomTom flow tiles, decode them, and match them to
// shared bike segments. Platform-neutral (just fetch), so the CPU benchmark
// can run the exact same code in Node.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { matchTraffic, SegmentIndex, type FlowPiece, type Segment } from "../src/match";

export interface SharedSegments {
  zoom: number;
  tiles: string[]; // "x/y"
  segments: Segment[];
}

export interface TrafficSnapshot {
  updatedAt: string;
  zoom: number;
  tiles: { requested: number; failed: number };
  // Segment id -> traffic_level (current / free-flow speed), 2 decimals.
  segments: Record<string, number>;
}

// Workers allow 6 connections waiting on headers at once.
const CONCURRENCY = 6;
const LAYER = "Traffic flow";

export async function fetchTiles(
  key: string,
  data: SharedSegments,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffers: { x: number; y: number; buf: ArrayBuffer }[]; failed: number }> {
  const queue = data.tiles.map((t) => t.split("/").map(Number) as [number, number]);
  const buffers: { x: number; y: number; buf: ArrayBuffer }[] = [];
  let failed = 0;
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [x, y] = next;
      const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${data.zoom}/${x}/${y}.pbf?key=${key}`;
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffers.push({ x, y, buf: await res.arrayBuffer() });
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { buffers, failed };
}

/** Decode + match: the CPU-bound part of a refresh. */
export function buildSnapshot(
  index: SegmentIndex,
  zoom: number,
  buffers: { x: number; y: number; buf: ArrayBuffer }[],
  failed: number,
): TrafficSnapshot {
  const pieces: FlowPiece[] = [];
  for (const { x, y, buf } of buffers) {
    const layer = new VectorTile(new PbfReader(buf)).layers[LAYER];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const level = feature.properties.traffic_level;
      if (typeof level !== "number" || feature.properties.road_closure) continue;
      const g = feature.toGeoJSON(x, y, zoom).geometry;
      if (g.type === "LineString") pieces.push({ coords: g.coordinates as [number, number][], level });
      else if (g.type === "MultiLineString") for (const c of g.coordinates) pieces.push({ coords: c as [number, number][], level });
    }
  }
  const segments: Record<string, number> = {};
  for (const [id, t] of matchTraffic(index, pieces)) segments[id] = Math.round(t.level * 100) / 100;
  return {
    updatedAt: new Date().toISOString(),
    zoom,
    tiles: { requested: buffers.length + failed, failed },
    segments,
  };
}
