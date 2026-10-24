// Shapes of the static files written by scripts/fetch-bridges.ts and
// scripts/fetch-counters.ts and read by the site.

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
