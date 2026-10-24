// Public bike repair stands (tools on a post, often with a pump) from
// OpenStreetMap: public/data/repair.json. The city doesn't publish these.
// Public Overpass servers are often busy, so this tries a few with backoff.
import { mkdir, writeFile } from "node:fs/promises";
import type { RepairFile, RepairStation } from "../src/data-types";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
// Seattle plus the 10-mile ring the map can pan to.
const BBOX = "47.35,-122.64,47.88,-122.02";
const QUERY = `[out:json][timeout:60];nwr["amenity"="bicycle_repair_station"](${BBOX});out center tags;`;
const ATTEMPTS = 6;

interface Element {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const yesNo = (v: string | undefined) => (v === undefined ? null : v === "yes");

async function overpass(): Promise<Element[]> {
  let wait = 5_000;
  for (let i = 0; i < ATTEMPTS; i++) {
    const url = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "seattle-bike-now/0.1" },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { elements: Element[] }).elements;
    } catch (err) {
      console.warn(`${url}: ${(err as Error).message}; retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
  throw new Error("all Overpass attempts failed");
}

async function main() {
  const stations: RepairStation[] = [];
  for (const e of await overpass()) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const t = e.tags ?? {};
    stations.push({
      lng: Math.round(lng * 1e5) / 1e5,
      lat: Math.round(lat * 1e5) / 1e5,
      name: t.name ?? t.operator ?? null,
      pump: yesNo(t["service:bicycle:pump"]),
      tools: yesNo(t["service:bicycle:tools"]),
      hours: t.opening_hours ?? null,
    });
  }
  const out: RepairFile = { generatedAt: new Date().toISOString(), stations };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/repair.json", JSON.stringify(out));
  console.log(`wrote ${stations.length} repair stations`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
