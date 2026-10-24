// Daily bike counts from SDOT's permanent counters, summarized for the site:
// public/data/counters.json. SDOT publishes these monthly.
import { mkdir, writeFile } from "node:fs/promises";
import type { CounterStats, CountersFile } from "../src/data-types";
import { addDays, dayOfWeek, seattleToday, soql } from "./socrata";

interface Counter {
  dataset: string;
  name: string;
  time: string; // timestamp column
  bikes: string[]; // bike columns to add up (excludes pedestrians)
  // Approximate: datasets carry no coordinates, placed from their descriptions.
  lng: number;
  lat: number;
}

// Counters still reporting in 2026. Out-of-service ones are left out.
const COUNTERS: Counter[] = [
  { dataset: "65db-xm6k", name: "Fremont Bridge", time: "date", bikes: ["fremont_bridge_nb", "fremont_bridge_sb"], lng: -122.3497, lat: 47.6474 },
  { dataset: "avwm-i8ym", name: "2nd Ave cycle track", time: "date", bikes: ["bicyclists_northbound", "bicyclists_southbound"], lng: -122.3368, lat: 47.6045 },
  { dataset: "2z5v-ecg8", name: "Burke-Gilman at NE 70th", time: "date", bikes: ["bike_north", "bike_south"], lng: -122.2668, lat: 47.6807 },
  { dataset: "upms-nr8w", name: "Spokane St Bridge", time: "date", bikes: ["east", "west"], lng: -122.3532, lat: 47.5711 },
  { dataset: "m2yw-err8", name: "12th Ave S", time: "time", bikes: ["_12th_ave_s_south_of_s_lane_1", "_12th_ave_s_south_of_s_lane_2"], lng: -122.3171, lat: 47.5967 },
  { dataset: "u38e-ybnc", name: "I-90 trail (Mountains to Sound)", time: "date", bikes: ["bike_east", "bike_west"], lng: -122.2878, lat: 47.5893 },
  { dataset: "t8i6-tipf", name: "Thomas St overpass", time: "time", bikes: ["bicyclist_northbound", "bicyclist_southbound"], lng: -122.3602, lat: 47.6209 },
];

// Two years back: one year of trend plus last year's comparison window.
const HISTORY_DAYS = 2 * 365 + 7;

async function daily(c: Counter): Promise<Map<string, number>> {
  const since = addDays(seattleToday(), -HISTORY_DAYS);
  const rows = await soql<Record<string, string>>(c.dataset, {
    $select: [`date_trunc_ymd(${c.time}) AS day`, ...c.bikes.map((b, i) => `sum(${b}) AS b${i}`)].join(", "),
    $where: `${c.time} >= '${since}T00:00:00'`,
    $group: "day",
    $order: "day",
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const n = c.bikes.reduce((sum, _, i) => sum + Number(r[`b${i}`] ?? 0), 0);
    // A zero day is a counter outage, not a day nobody rode.
    if (n > 0) out.set(r.day.slice(0, 10), n);
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function summarize(c: Counter, days: Map<string, number>): CounterStats | null {
  const sorted = [...days.keys()].sort();
  if (sorted.length < 30) return null;
  const lastDay = sorted[sorted.length - 1];

  const window = (end: string) => {
    const xs: number[] = [];
    for (let d = addDays(end, -29); d <= end; d = addDays(d, 1)) if (days.has(d)) xs.push(days.get(d)!);
    return xs;
  };
  const recent = window(lastDay);
  const lastYear = window(addDays(lastDay, -364)); // 52 weeks: same weekdays
  // Only compare when last year's window is mostly complete.
  const changeVsLastYear = lastYear.length >= 20 ? Math.round((avg(recent) / avg(lastYear) - 1) * 100) / 100 : null;

  let record = { day: sorted[0], count: 0 };
  for (const [day, count] of days) if (count > record.count) record = { day, count };

  // 52 full weeks (Mon–Sun) ending with the last complete week.
  let weekEnd = lastDay;
  while (dayOfWeek(weekEnd) !== 0) weekEnd = addDays(weekEnd, -1);
  // Weeks with outage days are scaled up from the days counted; mostly-dark weeks are null.
  const weekly: (number | null)[] = [];
  for (let w = 51; w >= 0; w--) {
    const end = addDays(weekEnd, -7 * w);
    const xs: number[] = [];
    for (let d = addDays(end, -6); d <= end; d = addDays(d, 1)) if (days.has(d)) xs.push(days.get(d)!);
    weekly.push(xs.length >= 4 ? Math.round(avg(xs) * 7) : null);
  }

  return {
    id: c.dataset,
    name: c.name,
    lng: c.lng,
    lat: c.lat,
    lastDay,
    avgPerDay30: Math.round(avg(recent)),
    changeVsLastYear,
    record,
    weekly,
  };
}

async function main() {
  const counters: CounterStats[] = [];
  for (const c of COUNTERS) {
    const stats = summarize(c, await daily(c));
    if (!stats) {
      console.warn(`${c.name}: not enough recent data, skipped`);
      continue;
    }
    counters.push(stats);
    console.log(
      `${c.name}: ${stats.avgPerDay30}/day through ${stats.lastDay}, vs last year ${stats.changeVsLastYear}, record ${stats.record.count} on ${stats.record.day}`,
    );
  }
  counters.sort((a, b) => b.avgPerDay30 - a.avgPerDay30);
  const out: CountersFile = { generatedAt: new Date().toISOString(), counters };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/counters.json", JSON.stringify(out));
  console.log(`wrote ${counters.length} counters`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
