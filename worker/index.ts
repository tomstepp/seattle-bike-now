// Cloudflare Worker: serves the static site, refreshes traffic on a cron, and
// serves the latest snapshot at /api/traffic. The TomTom key never leaves here.
import { SegmentIndex } from "../src/match";
import sharedData from "./data/shared-segments.json";
import { buildSnapshot, fetchTiles, type SharedSegments } from "./traffic";

interface Env {
  ASSETS: Fetcher;
  TRAFFIC: KVNamespace;
  TOMTOM_KEY: string;
}

const data = sharedData as SharedSegments;
const SNAPSHOT_KEY = "traffic-now";

async function refresh(env: Env): Promise<void> {
  const { buffers, failed } = await fetchTiles(env.TOMTOM_KEY, data);
  // Keep the last good snapshot if TomTom is down.
  if (buffers.length === 0) throw new Error(`all ${failed} tile requests failed`);
  const snapshot = buildSnapshot(new SegmentIndex(data.segments), data.zoom, buffers, failed);
  await env.TRAFFIC.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  console.log(`traffic: ${Object.keys(snapshot.segments).length} segments, ${buffers.length} tiles, ${failed} failed`);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/traffic") {
      const body = await env.TRAFFIC.get(SNAPSHOT_KEY);
      if (!body) return Response.json({ error: "no traffic yet" }, { status: 503 });
      return new Response(body, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(refresh(env));
  },
} satisfies ExportedHandler<Env>;
