import { describe, expect, it } from "vitest";
import { SegmentIndex } from "../src/match";
import { labelRoutes, scoreRoute, type ScoreContext } from "../src/route-score";

const M_LAT = 1 / 110_540;
const M_LNG = 1 / (111_320 * Math.cos((47.62 * Math.PI) / 180));
const at = (eastM: number, northM: number): [number, number] => [-122.33 + eastM * M_LNG, 47.62 + northM * M_LAT];

// Along y=0: 0–200 m protected trail, 200–400 m a steep painted lane, 400–600 m no lane.
const lanes = [
  { id: "trail", coords: [at(0, 0), at(200, 0)] },
  { id: "hill", coords: [at(200, 0), at(400, 0)] },
];
const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  lanes: new SegmentIndex(lanes),
  laneInfo: new Map([
    ["trail", { street: "Burke-Gilman Trail", separated: true }],
    ["hill", { street: "Queen Anne Ave N", separated: false, slope: 12 }],
  ]),
  traffic: { hill: 0.3 },
  construction: { index: new SegmentIndex([{ id: "0", coords: [at(250, 3), at(350, 3)] }]), items: [{ lane: "Queen Anne Ave N", impact: "closed" }] },
  closures: { index: new SegmentIndex([{ id: "0", coords: [at(500, -50), at(500, 50)] }]), items: [{ street: "Cross St", hours: "2p–6p" }] },
  crashes: [
    { lng: at(100, 10)[0], lat: at(100, 10)[1], crashes: 2 },
    { lng: at(100, 80)[0], lat: at(100, 80)[1], crashes: 5 },
  ],
  bridges: [{ name: "Fremont", lng: at(300, 20)[0], lat: at(300, 20)[1], chance: 0.6 }],
  ...over,
});
const route = [at(0, 2), at(600, 2)];
// Lanes match within 15 m, so a lane's stretch can run a sample or two past its end.
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(25);

describe("scoreRoute", () => {
  const s = scoreRoute(route, ctx());

  it("splits the route by lane type", () => {
    near(s.meters, 600);
    near(s.protectedMeters, 200);
    near(s.sharedMeters, 200);
  });

  it("lists each steep block once", () => {
    expect(s.steep).toEqual([{ street: "Queen Anne Ave N", slope: 12 }]);
  });

  it("measures slow car traffic on shared lanes", () => {
    near(s.slowTrafficMeters, 200);
    expect(scoreRoute(route, ctx({ traffic: { hill: 0.9 } })).slowTrafficMeters).toBe(0);
  });

  it("finds construction along the route but not a closed street it only crosses", () => {
    expect(s.construction).toEqual([{ lane: "Queen Anne Ave N", impact: "closed" }]);
    expect(s.closures).toEqual([]);
  });

  it("counts nearby crashes and bridges", () => {
    expect(s.crashes).toBe(2);
    expect(s.bridges).toEqual([{ name: "Fremont", chance: 0.6 }]);
  });
});

describe("labelRoutes", () => {
  const score = (over = {}) => ({ ...scoreRoute(route, ctx()), ...over });
  it("names the routes that stand out", () => {
    const labels = labelRoutes([
      { duration: 900, ascent: 40, score: score({ protectedMeters: 100 }) },
      { duration: 1100, ascent: 10, score: score({ protectedMeters: 500, construction: [] }) },
    ]);
    expect(labels[0]).toBe("Fastest");
    expect(labels[1]).toBe("Most protected · Flattest");
  });

  it("doesn't label a lone route", () => {
    expect(labelRoutes([{ duration: 900, score: score() }])).toEqual([""]);
  });
});
