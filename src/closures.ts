// Street closures from SDOT Street Use permits: block parties, play streets,
// farmers markets and café streets. SDOT updates them daily and the dataset is
// CORS-enabled, so the browser fetches this week's closures directly.
// Construction closures aren't published there.

const URL_BASE = "https://data.seattle.gov/resource/ium9-iqtc.json";
const DAYS_AHEAD = 7;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface Closure {
  permit: string;
  type: string; // "Block Party", "Play Street", "Farmers Market", …
  street: string; // "PHINNEY AVE N"
  from: string;
  to: string;
  start: string; // YYYY-MM-DD
  end: string;
  hours: (string | null)[]; // by weekday, Sunday first: "2:30PM-6PM" or null
  coords: [number, number][];
}

interface Row {
  permit_number: string;
  permit_type: string;
  start_date: string;
  end_date: string;
  street_on: string;
  street_from: string;
  street_to: string;
  line_string?: { type: "LineString"; coordinates: [number, number][] };
  [weekday: string]: unknown;
}

/** YYYY-MM-DD shifted by n days. */
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function fetchClosures(today: string): Promise<Closure[]> {
  const q = new URLSearchParams({
    $where: `end_date >= '${today}' AND start_date <= '${addDays(today, DAYS_AHEAD)}'`,
    $limit: "1000",
  });
  const res = await fetch(`${URL_BASE}?${q}`);
  if (!res.ok) throw new Error(`closures: HTTP ${res.status}`);
  return ((await res.json()) as Row[])
    .filter((r) => r.line_string?.coordinates.length)
    .map((r) => ({
      permit: r.permit_number,
      type: r.permit_type,
      street: r.street_on,
      from: r.street_from,
      to: r.street_to,
      start: r.start_date.slice(0, 10),
      end: r.end_date.slice(0, 10),
      hours: WEEKDAYS.map((d) => (typeof r[d] === "string" ? (r[d] as string) : null)),
      coords: r.line_string!.coordinates,
    }));
}

/** The closure's hours on a given day ("2:30PM-6PM", or "all day"), or null if it's open. */
export function hoursOn(c: Closure, day: string): string | null {
  if (day < c.start || day > c.end) return null;
  // No weekday hours at all means the permit covers whole days.
  if (c.hours.every((h) => h === null)) return "all day";
  return c.hours[new Date(`${day}T00:00:00Z`).getUTCDay()];
}

/** Days in the coming week (today first) when the closure is in effect. */
export const daysThisWeek = (c: Closure, today: string) =>
  Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)).filter((d) => hoursOn(c, d) !== null);
