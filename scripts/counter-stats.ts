// Summarizes one counter's daily totals for the site. Pure, so it can be tested.
import type { CounterStats } from "../src/data-types";
import { addDays, dayOfWeek } from "./socrata";

export interface CounterInfo {
  dataset: string;
  name: string;
  lng: number;
  lat: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(c: CounterInfo, days: Map<string, number>): CounterStats | null {
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
