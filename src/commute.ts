// A saved commute: home and work, kept on this device. The Route panel turns
// them into one-tap "To work" / "To home" rides, picked by time of day.
type LngLat = [number, number];

export interface Place {
  label: string;
  at: LngLat;
}

export interface Commute {
  home: Place;
  work: Place;
}

export type Direction = "work" | "home";

const STORAGE_KEY = "commute";
// Before noon you're probably heading in; after, heading home.
const NOON = 12;

export function loadCommute(): Commute | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Commute | null;
    return c?.home?.at && c?.work?.at ? c : null;
  } catch {
    return null;
  }
}

export function saveCommute(c: Commute | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export const directionFor = (seattleHour: number): Direction => (seattleHour < NOON ? "work" : "home");

export function commuteEnds(c: Commute, d: Direction): { from: Place; to: Place } {
  return d === "work" ? { from: c.home, to: c.work } : { from: c.work, to: c.home };
}

const same = (a: Place | null | undefined, b: Place) => !!a && a.at[0] === b.at[0] && a.at[1] === b.at[1];

/** Which commute direction these ends are, if either. */
export function directionOf(c: Commute, from: Place | null, to: Place | null): Direction | null {
  if (same(from, c.home) && same(to, c.work)) return "work";
  if (same(from, c.work) && same(to, c.home)) return "home";
  return null;
}

/** `?go=work` or `?go=home` (home-screen shortcuts). */
export function directionParam(search: string): Direction | null {
  const go = new URLSearchParams(search).get("go");
  return go === "work" || go === "home" ? go : null;
}
