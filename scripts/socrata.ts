// Small client for data.seattle.gov (Socrata SODA). No key needed at our volume.
// Timestamps there are "floating": Seattle local time with no offset.

const BASE = "https://data.seattle.gov/resource";
const PAGE = 50_000;

export async function soql<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, $limit: String(PAGE), $offset: String(offset) });
    const res = await fetch(`${BASE}/${dataset}.json?${q}`);
    if (!res.ok) throw new Error(`${dataset}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Today's date in Seattle as YYYY-MM-DD. */
export function seattleToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

/** YYYY-MM-DD shifted by n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD. */
export const dayOfWeek = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const isWeekend = (day: string) => [0, 6].includes(dayOfWeek(day));
