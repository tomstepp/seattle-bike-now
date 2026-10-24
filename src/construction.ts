// Construction that may affect bike lanes, from SDOT's street-use permits
// (updated daily, CORS-enabled, so the browser fetches it directly). A permit
// covers a span of dates and crews may only work some of those days, so this
// means "may be affected", not "closed right now".
import { bestSegment, type SegmentIndex } from "./match";

const QUERY =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SU_Permit_Data_Model_Relationships/FeatureServer/2/query";

// IMPACT_BIKE_LANE values that mean riders lose the lane, worst first.
const IMPACTS: [value: string, label: string][] = [
  ["Closed", "closed"],
  ["Closed to Public", "closed"],
  ["Rerouted", "rerouted"],
  ["Intermittent Closure", "closed at times"],
  ["Intermittently Closed to Public", "closed at times"],
  ["Partially Closed & Accessible", "narrowed"],
];
const SEVERITY = new Map(IMPACTS.map(([v], i) => [v, i]));
const LABEL = new Map(IMPACTS);
// Descriptions are free text, sometimes a paragraph; long ones fall back to the permit type.
const MAX_DESCRIPTION = 40;

export interface Construction {
  permit: string;
  address: string;
  work: string; // "Utility Infrastructure"
  impact: string; // "closed", "rerouted", …
  workDays: string | null; // "Weekdays Only"
  end: string; // YYYY-MM-DD
  lines: [number, number][][];
  lane: string; // the bike lane's street, once matched
}

interface Feature {
  properties: {
    PERMIT_NUMBER: string;
    ADDRESS: string | null;
    PERMIT_TYPE_ALIAS: string | null;
    USE_DESCRIPTION: string | null;
    IMPACT_BIKE_LANE: string;
    WORK_DAYS: string | null;
    USE_END_DATE: number;
  };
  geometry: { type: "LineString"; coordinates: [number, number][] } | { type: "MultiLineString"; coordinates: [number, number][][] } | null;
}

// Dates are stored as midnight UTC of the calendar day, so read them in UTC (in
// Seattle time they'd land on the day before).
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Issued permits in effect today that close, reroute or narrow a bike lane, one per permit. */
export async function fetchConstruction(today: string): Promise<Omit<Construction, "lane">[]> {
  const params = new URLSearchParams({
    where: `USE_START_DATE <= DATE '${today}' AND USE_END_DATE >= DATE '${today}' AND PERMIT_STATUS = 'Issued' AND IMPACT_BIKE_LANE IN (${IMPACTS.map(([v]) => `'${v}'`).join(",")})`,
    outFields: "PERMIT_NUMBER,ADDRESS,PERMIT_TYPE_ALIAS,USE_DESCRIPTION,IMPACT_BIKE_LANE,WORK_DAYS,USE_END_DATE",
    outSR: "4326",
    resultRecordCount: "2000",
    f: "geojson",
  });
  const res = await fetch(`${QUERY}?${params}`);
  if (!res.ok) throw new Error(`construction: HTTP ${res.status}`);
  const features = ((await res.json()) as { features?: Feature[] }).features ?? [];

  // A permit can have several uses (work areas); merge them, keeping the worst impact and latest end.
  const byPermit = new Map<string, Omit<Construction, "lane">>();
  for (const f of features) {
    if (!f.geometry) continue;
    const p = f.properties;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const desc = p.USE_DESCRIPTION?.trim() ?? "";
    const item = {
      permit: p.PERMIT_NUMBER,
      address: (p.ADDRESS ?? "").replace(/\s+/g, " ").trim(),
      work: desc && desc.length <= MAX_DESCRIPTION ? desc : (p.PERMIT_TYPE_ALIAS ?? "Construction"),
      impact: p.IMPACT_BIKE_LANE,
      workDays: p.WORK_DAYS,
      end: isoDay(p.USE_END_DATE),
      lines,
    };
    const prev = byPermit.get(p.PERMIT_NUMBER);
    if (!prev) {
      byPermit.set(p.PERMIT_NUMBER, item);
      continue;
    }
    prev.lines.push(...lines);
    if (SEVERITY.get(item.impact)! < SEVERITY.get(prev.impact)!) prev.impact = item.impact;
    if (item.end > prev.end) prev.end = item.end;
  }
  return [...byPermit.values()].map((c) => ({ ...c, impact: LABEL.get(c.impact) ?? c.impact }));
}

/**
 * Permits flag bike-lane impact even on streets with no bike lane, so keep only
 * work areas running along a mapped lane (same 15 m test as the traffic matching).
 * `lanes` maps segment id to its street name.
 */
export function onBikeLanes(
  permits: Omit<Construction, "lane">[],
  index: SegmentIndex,
  lanes: Map<string, string>,
): Construction[] {
  const out: Construction[] = [];
  for (const c of permits) {
    const hit = bestSegment(index, c.lines);
    if (hit) out.push({ ...c, lane: lanes.get(hit) ?? "" });
  }
  return out;
}
