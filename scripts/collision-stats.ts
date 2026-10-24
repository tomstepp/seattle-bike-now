// Groups individual crash records by location. Pure, so it can be tested.
import type { CollisionPlace } from "../src/data-types";

export interface CollisionRecord {
  location: string; // "FREMONT AVE N AND N 34TH ST" or "X BETWEEN Y AND Z"
  lng: number;
  lat: number;
  day: string; // YYYY-MM-DD
  injuries: number;
  serious: number;
  fatal: number;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** One place per location string, crashes oldest first. */
export function groupCollisions(records: CollisionRecord[]): CollisionPlace[] {
  const byLocation = new Map<string, CollisionRecord[]>();
  for (const r of records) byLocation.set(r.location, [...(byLocation.get(r.location) ?? []), r]);
  return [...byLocation].map(([location, list]) => ({
    location,
    // Records at one location share a point, give or take geocoding noise.
    lng: round5(list.reduce((n, r) => n + r.lng, 0) / list.length),
    lat: round5(list.reduce((n, r) => n + r.lat, 0) / list.length),
    crashes: list
      .map((r) => [r.day, r.injuries, r.serious, r.fatal] as CollisionPlace["crashes"][number])
      .sort((a, b) => a[0].localeCompare(b[0])),
  }));
}
