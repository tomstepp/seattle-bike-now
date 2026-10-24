// Matches TomTom flow pieces to SDOT shared bike segments.
//
// "Within 15 m of the segment" is the 15 m buffer test from PLAN.md, done as a
// point-to-line distance in a local meter projection. TomTom tiles carry no
// street names, so ties go to the nearest segment running the same direction.
// Pure geometry, no map or DOM, so the scheduled worker can reuse it.

type LngLat = [number, number];
type XY = [number, number];

export interface Segment {
  id: string;
  coords: LngLat[];
}

export interface FlowPiece {
  coords: LngLat[];
  level: number; // TomTom relative traffic_level, 0–1
}

export interface SegmentTraffic {
  level: number; // length-weighted mean of matched pieces
  matchedMeters: number;
}

const BUFFER_M = 15;
const MAX_ANGLE_DEG = 25;
const SAMPLE_M = 10;
const MIN_SHARE = 0.6; // share of a piece's samples that must hit one segment
const CELL_M = 200;

// Equirectangular projection around Seattle; error is well under a meter at city scale.
const LAT0 = 47.62;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const project = ([lng, lat]: LngLat): XY => [lng * M_PER_DEG_LNG, lat * M_PER_DEG_LAT];

interface Edge {
  segId: string;
  a: XY;
  b: XY;
  angle: number; // undirected, 0–180
}

function undirectedAngle(a: XY, b: XY): number {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return (deg + 360) % 180;
}

function angleDiff(x: number, y: number): number {
  const d = Math.abs(x - y) % 180;
  return Math.min(d, 180 - d);
}

function distToEdge(p: XY, e: Edge): number {
  const [ax, ay] = e.a;
  const dx = e.b[0] - ax;
  const dy = e.b[1] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

/** Grid index over shared segments. Build once, match every refresh. */
export class SegmentIndex {
  private cells = new Map<string, Edge[]>();

  constructor(segments: Segment[]) {
    for (const seg of segments) {
      const pts = seg.coords.map(project);
      for (let i = 0; i < pts.length - 1; i++) {
        const edge: Edge = { segId: seg.id, a: pts[i], b: pts[i + 1], angle: undirectedAngle(pts[i], pts[i + 1]) };
        const [x0, x1] = [Math.min(edge.a[0], edge.b[0]) - BUFFER_M, Math.max(edge.a[0], edge.b[0]) + BUFFER_M];
        const [y0, y1] = [Math.min(edge.a[1], edge.b[1]) - BUFFER_M, Math.max(edge.a[1], edge.b[1]) + BUFFER_M];
        for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++) {
          for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) {
            const key = cellKey(cx, cy);
            const list = this.cells.get(key);
            if (list) list.push(edge);
            else this.cells.set(key, [edge]);
          }
        }
      }
    }
  }

  /** Nearest same-direction segment within the buffer, or null. */
  nearest(p: XY, angle: number): string | null {
    const edges = this.cells.get(cellKey(Math.floor(p[0] / CELL_M), Math.floor(p[1] / CELL_M)));
    let best: string | null = null;
    let bestDist = BUFFER_M;
    for (const e of edges ?? []) {
      if (angleDiff(angle, e.angle) > MAX_ANGLE_DEG) continue;
      const d = distToEdge(p, e);
      if (d <= bestDist) {
        bestDist = d;
        best = e.segId;
      }
    }
    return best;
  }
}

// Points every SAMPLE_M along a line, each with the local direction.
function sample(coords: LngLat[]): { p: XY; angle: number }[] {
  const pts = coords.map(project);
  const out: { p: XY; angle: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const angle = undirectedAngle(a, b);
    for (let s = 0; s < len; s += SAMPLE_M) {
      const t = s / len;
      out.push({ p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], angle });
    }
  }
  return out;
}

function lengthM(coords: LngLat[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [a, b] = [project(coords[i]), project(coords[i + 1])];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** Assign each flow piece to at most one segment; return per-segment traffic. */
export function matchTraffic(index: SegmentIndex, pieces: FlowPiece[]): Map<string, SegmentTraffic> {
  const acc = new Map<string, { weighted: number; meters: number }>();
  for (const piece of pieces) {
    const samples = sample(piece.coords);
    if (samples.length === 0) continue;
    const votes = new Map<string, number>();
    for (const { p, angle } of samples) {
      const id = index.nearest(p, angle);
      if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    let winner: string | null = null;
    let top = 0;
    for (const [id, n] of votes) if (n > top) [winner, top] = [id, n];
    if (!winner || top / samples.length < MIN_SHARE) continue;

    const meters = lengthM(piece.coords);
    const a = acc.get(winner) ?? { weighted: 0, meters: 0 };
    a.weighted += piece.level * meters;
    a.meters += meters;
    acc.set(winner, a);
  }
  const out = new Map<string, SegmentTraffic>();
  for (const [id, a] of acc) out.set(id, { level: a.weighted / a.meters, matchedMeters: Math.round(a.meters) });
  return out;
}
