// Crashes involving someone on a bike over the last five years, grouped by
// location (an intersection or a block): public/data/collisions.json.
// SDOT's collision records lag by a few months.
import { mkdir, writeFile } from "node:fs/promises";
import type { CollisionsFile } from "../src/data-types";
import { groupCollisions, type CollisionRecord } from "./collision-stats";
import { addDays, seattleToday } from "./socrata";

const QUERY =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Collisions_All_Years_1/FeatureServer/0/query";
const YEARS = 5;
const PAGE = 2000;
const seattleDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

interface ArcFeature {
  attributes: {
    LOCATION: string | null;
    INCDATE: number | null;
    INJURIES: number | null;
    SERIOUSINJURIES: number | null;
    FATALITIES: number | null;
  };
  geometry?: { x: number; y: number };
}

async function main() {
  const since = addDays(seattleToday(), -365 * YEARS);
  const records: CollisionRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: `PEDCYLCOUNT > 0 AND INCDATE >= DATE '${since}'`,
      outFields: "LOCATION,INCDATE,INJURIES,SERIOUSINJURIES,FATALITIES",
      outSR: "4326",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });
    const res = await fetch(`${QUERY}?${params}`);
    if (!res.ok) throw new Error(`collisions: HTTP ${res.status}`);
    const page = (await res.json()) as { features?: ArcFeature[]; error?: unknown };
    if (!page.features) throw new Error(`collisions: ${JSON.stringify(page.error)}`);
    for (const f of page.features) {
      const a = f.attributes;
      if (!f.geometry || !a.LOCATION || !a.INCDATE) continue;
      records.push({
        location: a.LOCATION,
        lng: f.geometry.x,
        lat: f.geometry.y,
        // INCDATE is midnight Seattle time, stored as a UTC instant.
        day: seattleDay.format(new Date(a.INCDATE)),
        injuries: a.INJURIES ?? 0,
        serious: a.SERIOUSINJURIES ?? 0,
        fatal: a.FATALITIES ?? 0,
      });
    }
    if (page.features.length < PAGE) break;
  }

  const places = groupCollisions(records);
  const out: CollisionsFile = {
    generatedAt: new Date().toISOString(),
    since,
    through: records.reduce((m, r) => (r.day > m ? r.day : m), ""),
    places,
  };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/collisions.json", JSON.stringify(out));
  console.log(`wrote ${records.length} bike crashes at ${places.length} locations, ${since}..${out.through}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
