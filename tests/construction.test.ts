import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConstruction, onBikeLanes } from "../src/construction";
import { bestSegment, SegmentIndex } from "../src/match";

const M_LAT = 1 / 110_540;
const M_LNG = 1 / (111_320 * Math.cos((47.62 * Math.PI) / 180));
const at = (eastM: number, northM: number): [number, number] => [-122.33 + eastM * M_LNG, 47.62 + northM * M_LAT];

// A 200 m east-west lane.
const index = new SegmentIndex([{ id: "lane", coords: [at(0, 0), at(200, 0)] }]);

describe("bestSegment", () => {
  it("finds a short work area along a long lane", () => {
    expect(bestSegment(index, [[at(80, 6), at(110, 6)]])).toBe("lane");
  });

  it("ignores a line that only crosses the lane", () => {
    expect(bestSegment(index, [[at(100, -40), at(100, 40)]])).toBeNull();
  });

  it("ignores work on a parallel street", () => {
    expect(bestSegment(index, [[at(0, 60), at(200, 60)]])).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchConstruction", () => {
  const feature = (permit: string, impact: string, end: string, line: [number, number][]) => ({
    properties: {
      PERMIT_NUMBER: permit,
      ADDRESS: "917  NE 63RD ST ",
      PERMIT_TYPE_ALIAS: "Minor Utility Permit",
      USE_DESCRIPTION: "Utility Infrastructure",
      IMPACT_BIKE_LANE: impact,
      WORK_DAYS: "Weekdays Only",
      USE_END_DATE: Date.parse(`${end}T00:00:00Z`), // how SDOT stores dates
    },
    geometry: { type: "LineString", coordinates: line },
  });

  it("merges a permit's work areas, keeping the worst impact and the latest end", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        features: [
          feature("P1", "Rerouted", "2026-11-01", [at(80, 6), at(110, 6)]),
          feature("P1", "Closed", "2027-01-28", [at(120, 6), at(150, 6)]),
          feature("P2", "Intermittent Closure", "2026-12-01", [at(0, 60), at(200, 60)]),
        ],
      }),
    );
    const permits = await fetchConstruction("2026-10-24");
    expect(permits).toHaveLength(2);
    expect(permits[0]).toMatchObject({ permit: "P1", impact: "closed", end: "2027-01-28", address: "917 NE 63RD ST" });
    expect(permits[0].lines).toHaveLength(2);

    // P2 is on a street with no lane, so it drops out.
    const onLanes = onBikeLanes(permits, index, new Map([["lane", "NE 63RD ST"]]));
    expect(onLanes.map((c) => [c.permit, c.lane])).toEqual([["P1", "NE 63RD ST"]]);
  });

  it("falls back to the permit type when the description is a paragraph", async () => {
    const long = feature("P3", "Closed", "2026-11-01", [at(0, 0), at(50, 0)]);
    long.properties.USE_DESCRIPTION = "approved work areas per TCP; approved start date and duration as approved by Hub Coordinator";
    vi.stubGlobal("fetch", async () => Response.json({ features: [long] }));
    expect((await fetchConstruction("2026-10-24"))[0].work).toBe("Minor Utility Permit");
  });
});
