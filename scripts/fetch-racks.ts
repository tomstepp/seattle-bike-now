// SDOT's in-service bike racks: public/data/racks.json, as compact
// [lng, lat, capacity] rows. The site only loads this when racks are turned on.
import { mkdir, writeFile } from "node:fs/promises";
import type { RacksFile } from "../src/data-types";

const QUERY =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Bicycle_Racks_(Active)/FeatureServer/0/query";
const PAGE = 2000;

interface ArcFeature {
  attributes: { RACK_CAPACITY: number | null };
  geometry?: { x: number; y: number };
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

async function main() {
  const racks: RacksFile["racks"] = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: "CURRENT_STATUS = 'INSVC'",
      outFields: "RACK_CAPACITY",
      outSR: "4326",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });
    const res = await fetch(`${QUERY}?${params}`);
    if (!res.ok) throw new Error(`racks: HTTP ${res.status}`);
    const page = (await res.json()) as { features?: ArcFeature[]; error?: unknown };
    if (!page.features) throw new Error(`racks: ${JSON.stringify(page.error)}`);
    for (const f of page.features) {
      if (f.geometry) racks.push([round5(f.geometry.x), round5(f.geometry.y), f.attributes.RACK_CAPACITY ?? 0]);
    }
    if (page.features.length < PAGE) break;
  }
  const out: RacksFile = { generatedAt: new Date().toISOString(), racks };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/racks.json", JSON.stringify(out));
  const spaces = racks.reduce((n, r) => n + r[2], 0);
  console.log(`wrote ${racks.length} racks, ${spaces} bike spaces`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
