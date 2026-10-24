// Turns one bridge's opening log into per-hour odds. Pure, so it can be tested.
import type { BridgeStats } from "../src/data-types";
import { addDays, isWeekend } from "./socrata";

// One opening is sometimes logged as several open/close pairs while the span
// settles; pairs this close together count as one opening.
const MERGE_MINUTES = 3;

export interface BridgeRow {
  entityid: string;
  entityname: string;
  opendatetime: string; // "2026-10-19T14:05:00.000", Seattle time
  closedatetime?: string;
  latitude: string;
  longitude: string;
}

// Floating timestamp -> minutes since epoch; only differences matter here.
const minutes = (t: string) => Date.parse(`${t.slice(0, 16)}Z`) / 60_000;

/** Openings for one bridge, rows sorted by open time. */
export function bridgeStats(list: BridgeRow[]): BridgeStats {
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
  return {
    id: list[0].entityid,
    name: list[0].entityname,
    lng: Number(list[0].longitude),
    lat: Number(list[0].latitude),
    firstLogged,
    lastLogged,
    openingsPerDay: Math.round((events.length / (days.weekday + days.weekend)) * 10) / 10,
    medianMinutes: durations[durations.length >> 1],
    weekday: share("weekday"),
    weekend: share("weekend"),
  };
}
