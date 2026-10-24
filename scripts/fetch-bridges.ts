// Turns SDOT's drawbridge opening log into "how likely is an opening this hour"
// per bridge: public/data/bridges.json. SDOT publishes the log about daily, so
// the site shows typical odds, not live status.
import { mkdir, writeFile } from "node:fs/promises";
import type { BridgesFile, BridgeStats } from "../src/data-types";
import { addDays, isWeekend, seattleToday, soql } from "./socrata";

const DATASET = "gm8h-9449"; // SDOT Drawbridge Status
const WINDOW_DAYS = 365;
// One opening is sometimes logged as several open/close pairs while the span
// settles; pairs this close together count as one opening.
const MERGE_MINUTES = 3;

interface Row {
  entityid: string;
  entityname: string;
  opendatetime: string; // "2026-10-19T14:05:00.000", Seattle time
  closedatetime?: string;
  latitude: string;
  longitude: string;
}

// Floating timestamp -> minutes since epoch; only differences matter here.
const minutes = (t: string) => Date.parse(`${t.slice(0, 16)}Z`) / 60_000;

async function main() {
  const since = addDays(seattleToday(), -WINDOW_DAYS);
  const rows = await soql<Row>(DATASET, {
    $where: `entitytype = 'Bridge' AND opendatetime >= '${since}T00:00:00'`,
    $order: "opendatetime",
  });

  const byBridge = new Map<string, Row[]>();
  for (const r of rows) byBridge.set(r.entityid, [...(byBridge.get(r.entityid) ?? []), r]);

  const bridges: BridgeStats[] = [];
  for (const [id, list] of byBridge) {
    // Merge split events.
    const events: { day: string; hour: number; mins: number }[] = [];
    let open = -Infinity;
    let close = -Infinity;
    let start = "";
    const flush = () => {
      if (start) events.push({ day: start.slice(0, 10), hour: Number(start.slice(11, 13)), mins: Math.max(close - open, 1) });
    };
    for (const r of list) {
      const o = minutes(r.opendatetime);
      const c = r.closedatetime ? minutes(r.closedatetime) : o + 1;
      if (o - close <= MERGE_MINUTES) {
        close = Math.max(close, c);
        continue;
      }
      flush();
      [open, close, start] = [o, c, r.opendatetime];
    }
    flush();

    // Days the bridge was being logged, split by day type.
    const firstLogged = list[0].opendatetime.slice(0, 10);
    const lastLogged = list[list.length - 1].opendatetime.slice(0, 10);
    const days = { weekday: 0, weekend: 0 };
    for (let d = firstLogged; d <= lastLogged; d = addDays(d, 1)) days[isWeekend(d) ? "weekend" : "weekday"]++;

    // Count each (day, hour) once: "was there at least one opening".
    const seen = new Set<string>();
    const hits = { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };
    for (const e of events) {
      const key = `${e.day}:${e.hour}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits[isWeekend(e.day) ? "weekend" : "weekday"][e.hour]++;
    }
    const share = (type: "weekday" | "weekend") =>
      hits[type].map((n) => (days[type] ? Math.round((n / days[type]) * 100) / 100 : 0));

    const durations = events.map((e) => e.mins).sort((a, b) => a - b);
    bridges.push({
      id,
      name: list[0].entityname,
      lng: Number(list[0].longitude),
      lat: Number(list[0].latitude),
      firstLogged,
      lastLogged,
      openingsPerDay: Math.round((events.length / (days.weekday + days.weekend)) * 10) / 10,
      medianMinutes: durations[durations.length >> 1],
      weekday: share("weekday"),
      weekend: share("weekend"),
    });
    console.log(
      `${list[0].entityname}: ${events.length} openings (${list.length} log rows), ${firstLogged}..${lastLogged}`,
    );
  }

  bridges.sort((a, b) => b.openingsPerDay - a.openingsPerDay);
  const out: BridgesFile = { generatedAt: new Date().toISOString(), bridges };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/bridges.json", JSON.stringify(out));
  console.log(`wrote ${bridges.length} bridges`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
