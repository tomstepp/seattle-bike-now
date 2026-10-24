// Shapes of the static files in public/data/, written by scripts/ and read by the site.

export interface BikeFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { id: string; facility: string; separated: boolean; street: string; slope?: number };
}

export interface BikeNetwork {
  type: "FeatureCollection";
  features: BikeFeature[];
}

export interface BridgeStats {
  id: string;
  name: string;
  lng: number;
  lat: number;
  firstLogged: string; // YYYY-MM-DD, Seattle time
  lastLogged: string;
  openingsPerDay: number;
  medianMinutes: number;
  // Share of days with at least one opening starting in each hour (0–23), 0–1.
  weekday: number[];
  weekend: number[];
}

export interface BridgesFile {
  generatedAt: string;
  bridges: BridgeStats[];
}

export interface CounterStats {
  id: string;
  name: string;
  lng: number;
  lat: number;
  lastDay: string; // last day with counts, YYYY-MM-DD
  avgPerDay30: number; // average over the last 30 days with counts
  changeVsLastYear: number | null; // same 30 days a year earlier, as a fraction (+0.12 = 12% more)
  record: { day: string; count: number };
  weekly: (number | null)[]; // weekly totals, oldest first, last 52 full weeks; null = counter mostly offline
}

export interface CountersFile {
  generatedAt: string;
  counters: CounterStats[];
}

/** One crash: date, people injured, seriously injured, killed. */
export type Crash = [day: string, injuries: number, serious: number, fatal: number];

/** Every crash at one location (an intersection or a block). */
export interface CollisionPlace {
  location: string;
  lng: number;
  lat: number;
  crashes: Crash[];
}

export interface CollisionsFile {
  generatedAt: string;
  since: string; // YYYY-MM-DD
  through: string; // newest crash in SDOT's records
  places: CollisionPlace[];
}

/** A location's crashes within one time window, for the map and sidebar. */
export interface CollisionSpot {
  location: string;
  lng: number;
  lat: number;
  crashes: number;
  injuries: number;
  serious: number; // serious injuries
  fatal: number;
  last: string; // most recent crash, YYYY-MM-DD
}

export interface RacksFile {
  generatedAt: string;
  racks: [lng: number, lat: number, capacity: number][];
}

export interface RepairStation {
  lng: number;
  lat: number;
  name: string | null;
  // What the stand has, from OpenStreetMap tags where mappers recorded them.
  pump: boolean | null;
  tools: boolean | null;
  hours: string | null;
}

export interface RepairFile {
  generatedAt: string;
  stations: RepairStation[];
}
