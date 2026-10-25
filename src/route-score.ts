// Judges a route with what this site knows that a router doesn't: how much is
// on protected lanes, steep blocks, construction and closures on the way, crash
// spots, slow car traffic on shared lanes, and drawbridges. Pure, so it can be tested.
import { distanceToLine, SAMPLE_METERS, segmentsAlong, type SegmentIndex } from "./match";

type LngLat = [number, number];

export interface LaneInfo {
  street: string;
  separated: boolean;
  slope?: number;
}

export interface ScoreContext {
  lanes: SegmentIndex; // every bike segment
  laneInfo: Map<string, LaneInfo>;
  traffic: Record<string, number> | null; // segment id -> level (current / free-flow speed)
  construction: { index: SegmentIndex; items: { lane: string; impact: string }[] }; // segment ids are item indexes
  closures: { index: SegmentIndex; items: { street: string; hours: string }[] }; // closed today
  crashes: { lng: number; lat: number; crashes: number }[];
  bridges: { name: string; lng: number; lat: number; chance: number }[];
}

export interface RouteScore {
  meters: number;
  protectedMeters: number; // trails, protected lanes, greenways
  sharedMeters: number; // painted, buffered, climbing lanes, sharrows
  steep: { street: string; slope: number }[]; // distinct blocks of 8%+
  slowTrafficMeters: number; // shared lanes where cars are slowing or backed up
  construction: { lane: string; impact: string }[];
  closures: { street: string; hours: string }[];
  constructionIndexes: number[]; // into ScoreContext.construction.items, same order
  closureIndexes: number[];
  crashes: number; // crashes within 25 m of the route
  bridges: { name: string; chance: number }[];
}

const STEEP = 8; // %
const SLOW_TRAFFIC = 0.75; // below "moving freely"
const CRASH_RADIUS_M = 25;
const BRIDGE_RADIUS_M = 60;

/** Distinct item indexes the route runs along in a lines index, in route order. */
function along(index: SegmentIndex, coords: LngLat[]): number[] {
  const seen: number[] = [];
  let run = 0;
  let last: string | null = null;
  for (const id of segmentsAlong(index, coords)) {
    // Two samples (~20 m) in a row, so crossing a closed street doesn't count.
    run = id !== null && id === last ? run + 1 : 1;
    last = id;
    if (id !== null && run >= 2 && !seen.includes(Number(id))) seen.push(Number(id));
  }
  return seen;
}

export function scoreRoute(coords: LngLat[], ctx: ScoreContext): RouteScore {
  const ids = segmentsAlong(ctx.lanes, coords);
  const score: RouteScore = {
    meters: ids.length * SAMPLE_METERS,
    protectedMeters: 0,
    sharedMeters: 0,
    steep: [],
    slowTrafficMeters: 0,
    construction: [],
    closures: [],
    constructionIndexes: [],
    closureIndexes: [],
    crashes: 0,
    bridges: [],
  };
  const steepSeen = new Set<string>();
  for (const id of ids) {
    const lane = id ? ctx.laneInfo.get(id) : undefined;
    if (!lane) continue;
    if (lane.separated) score.protectedMeters += SAMPLE_METERS;
    else {
      score.sharedMeters += SAMPLE_METERS;
      const level = ctx.traffic?.[id!];
      if (level !== undefined && level < SLOW_TRAFFIC) score.slowTrafficMeters += SAMPLE_METERS;
    }
    if ((lane.slope ?? 0) >= STEEP && !steepSeen.has(id!)) {
      steepSeen.add(id!);
      score.steep.push({ street: lane.street, slope: lane.slope! });
    }
  }
  // Steps off the lane network can still be steep; we only know grades for lane blocks.
  score.steep.sort((a, b) => b.slope - a.slope);

  score.constructionIndexes = along(ctx.construction.index, coords);
  score.closureIndexes = along(ctx.closures.index, coords);
  score.construction = score.constructionIndexes.map((i) => ctx.construction.items[i]);
  score.closures = score.closureIndexes.map((i) => ctx.closures.items[i]);
  score.crashes = ctx.crashes
    .filter((c) => distanceToLine([c.lng, c.lat], coords) <= CRASH_RADIUS_M)
    .reduce((n, c) => n + c.crashes, 0);
  score.bridges = ctx.bridges
    .filter((b) => distanceToLine([b.lng, b.lat], coords) <= BRIDGE_RADIUS_M)
    .map(({ name, chance }) => ({ name, chance }));
  return score;
}

/** Short labels for the routes that stand out, by index. */
export function labelRoutes(routes: { duration: number; ascent?: number; score: RouteScore }[]): string[] {
  const labels = routes.map(() => [] as string[]);
  if (routes.length < 2) return labels.map(() => "");
  const best = (key: (r: (typeof routes)[number]) => number) =>
    routes.reduce((bi, r, i) => (key(r) < key(routes[bi]) ? i : bi), 0);
  labels[best((r) => r.duration)].push("Fastest");
  labels[best((r) => -(r.score.protectedMeters / Math.max(r.score.meters, 1)))].push("Most protected");
  labels[best((r) => (r.ascent ?? 0) * 10 + r.score.steep.length)].push("Flattest");
  labels[best((r) => r.score.construction.length + r.score.closures.length)].push(
    routes.some((r) => r.score.construction.length + r.score.closures.length) ? "Fewest closures" : "",
  );
  return labels.map((l) => l.filter(Boolean).slice(0, 2).join(" · "));
}

// What each problem is worth in minutes of riding, for ranking routes. Rough by design:
// a closed lane costs a detour, a steep block a slog, a likely bridge opening a wait.
const COST_MIN = {
  closedLane: 8,
  otherConstruction: 2,
  closure: 6,
  steepBlock: 1.5,
  bridge: 6, // times the chance it opens
  crash: 0.3,
  slowTrafficKm: 3,
  protectedShare: -4, // a fully protected route is worth 4 minutes
};
const CLOSED_IMPACTS = new Set(["closed", "rerouted"]);

/** Minutes, plus problems priced in minutes. Lower is better. */
export function routeCost(r: { duration: number; score: RouteScore }): number {
  const s = r.score;
  const lanes = new Map<string, boolean>();
  for (const c of s.construction) lanes.set(c.lane, (lanes.get(c.lane) ?? false) || CLOSED_IMPACTS.has(c.impact));
  const closed = [...lanes.values()].filter(Boolean).length;
  return (
    r.duration / 60 +
    closed * COST_MIN.closedLane +
    (lanes.size - closed) * COST_MIN.otherConstruction +
    s.closures.length * COST_MIN.closure +
    s.steep.length * COST_MIN.steepBlock +
    s.bridges.reduce((n, b) => n + b.chance * COST_MIN.bridge, 0) +
    s.crashes * COST_MIN.crash +
    (s.slowTrafficMeters / 1000) * COST_MIN.slowTrafficKm +
    (s.protectedMeters / Math.max(s.meters, 1)) * COST_MIN.protectedShare
  );
}
