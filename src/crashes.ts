// Which crashes to show: the last 3 months by default, or longer on request.
// Windows end at the newest crash in SDOT's records, which lag a few months
// behind today. Shared by the sidebar and the map.
import type { CollisionSpot, CollisionsFile } from "./data-types";

export const CRASH_WINDOWS = [
  { key: "3m", label: "3 months", months: 3 },
  { key: "1y", label: "1 year", months: 12 },
  { key: "5y", label: "5 years", months: 60 },
] as const;
export type CrashWindow = (typeof CRASH_WINDOWS)[number]["key"];
const DEFAULT: CrashWindow = "3m";
const STORAGE_KEY = "crash-window";
const EVENT = "crash-window";

/** The first day of a window ending at `through`. */
export function windowStart(through: string, months: number): string {
  const d = new Date(`${through}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Locations with crashes on or after `since`, worst first: most crashes, then deaths, then serious injuries. */
export function spotsSince(file: CollisionsFile, since: string): CollisionSpot[] {
  const spots: CollisionSpot[] = [];
  for (const p of file.places) {
    const crashes = p.crashes.filter(([day]) => day >= since);
    if (!crashes.length) continue;
    const sum = (i: 1 | 2 | 3) => crashes.reduce((n, c) => n + c[i], 0);
    spots.push({
      location: p.location,
      lng: p.lng,
      lat: p.lat,
      crashes: crashes.length,
      injuries: sum(1),
      serious: sum(2),
      fatal: sum(3),
      last: crashes[crashes.length - 1][0],
    });
  }
  return spots.sort((a, b) => b.crashes - a.crashes || b.fatal - a.fatal || b.serious - a.serious);
}

export function crashWindow(): CrashWindow {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (CRASH_WINDOWS.some((w) => w.key === saved)) return saved as CrashWindow;
  } catch {}
  return DEFAULT;
}

export function setCrashWindow(key: CrashWindow) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export const onCrashWindow = (fn: (key: CrashWindow) => void) =>
  window.addEventListener(EVENT, (e) => fn((e as CustomEvent<CrashWindow>).detail));

/** The spots and date range for a window. */
export function crashesFor(file: CollisionsFile, key: CrashWindow) {
  const w = CRASH_WINDOWS.find((x) => x.key === key)!;
  const since = windowStart(file.through, w.months);
  return { window: w, since, spots: spotsSince(file, since) };
}
