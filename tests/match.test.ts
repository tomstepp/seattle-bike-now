import { describe, expect, it } from "vitest";
import { matchTraffic, SegmentIndex, type FlowPiece, type Segment } from "../src/match";

// Meters to degrees near Seattle, matching the matcher's own projection.
const M_LAT = 1 / 110_540;
const M_LNG = 1 / (111_320 * Math.cos((47.62 * Math.PI) / 180));
const LNG0 = -122.33;
const LAT0 = 47.62;
const at = (eastM: number, northM: number): [number, number] => [LNG0 + eastM * M_LNG, LAT0 + northM * M_LAT];

// A 100 m east-west block.
const block: Segment = { id: "block", coords: [at(0, 0), at(100, 0)] };
const piece = (coords: [number, number][], level = 0.5): FlowPiece => ({ coords, level });

describe("matchTraffic", () => {
  it("matches a parallel line inside the 15 m buffer", () => {
    const out = matchTraffic(new SegmentIndex([block]), [piece([at(0, 8), at(100, 8)])]);
    expect(out.get("block")?.level).toBeCloseTo(0.5);
  });

  it("ignores a parallel line outside the buffer", () => {
    const out = matchTraffic(new SegmentIndex([block]), [piece([at(0, 25), at(100, 25)])]);
    expect(out.size).toBe(0);
  });

  it("ignores a cross street", () => {
    const out = matchTraffic(new SegmentIndex([block]), [piece([at(50, -50), at(50, 50)])]);
    expect(out.size).toBe(0);
  });

  it("allows small angle differences but not large ones", () => {
    // ~11° off: still the same street.
    const near = matchTraffic(new SegmentIndex([block]), [piece([at(0, -10), at(100, 10)])]);
    expect(near.has("block")).toBe(true);
    // ~40° off: a diagonal crossing.
    const far = matchTraffic(new SegmentIndex([block]), [piece([at(0, -40), at(100, 40)])]);
    expect(far.size).toBe(0);
  });

  it("needs 30% of the block covered", () => {
    const glancing = matchTraffic(new SegmentIndex([block]), [piece([at(-50, 5), at(20, 5)])]);
    expect(glancing.size).toBe(0);
    const half = matchTraffic(new SegmentIndex([block]), [piece([at(0, 5), at(50, 5)])]);
    expect(half.has("block")).toBe(true);
  });

  it("lets one long piece color every block it runs along", () => {
    const blocks = [0, 1, 2].map((i) => ({ id: `b${i}`, coords: [at(i * 100, 0), at(i * 100 + 100, 0)] }));
    const out = matchTraffic(new SegmentIndex(blocks), [piece([at(0, 5), at(300, 5)], 0.3)]);
    expect([...out.keys()].sort()).toEqual(["b0", "b1", "b2"]);
  });

  it("weights the level by matched length", () => {
    // Two directions of a two-way street: 100 m at 1.0, 50 m at 0.4.
    const out = matchTraffic(new SegmentIndex([block]), [
      piece([at(0, 5), at(100, 5)], 1),
      piece([at(0, -5), at(50, -5)], 0.4),
    ]);
    expect(out.get("block")!.level).toBeCloseTo((100 * 1 + 50 * 0.4) / 150, 1);
  });

  it("picks the nearer of two parallel segments", () => {
    const other: Segment = { id: "other", coords: [at(0, 20), at(100, 20)] };
    const out = matchTraffic(new SegmentIndex([block, other]), [piece([at(0, 14), at(100, 14)])]);
    expect([...out.keys()]).toEqual(["other"]);
  });
});
