import { describe, expect, it } from "vitest";
import { parseRoutes } from "../src/ors";
import { avoidAreas, googleMapsUrl, pointsAlong, toGpx } from "../src/route-export";

const line: [number, number][] = [
  [-122.35, 47.65],
  [-122.34, 47.65],
  [-122.34, 47.66],
];

describe("route exports", () => {
  it("writes a GPX track with every point", () => {
    const gpx = toGpx(line, "Fremont to <home>");
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('<trkpt lat="47.650000" lon="-122.350000"/>');
    expect(gpx).toContain("Fremont to &#60;home&#62;");
  });

  it("finds points by share of distance", () => {
    const [mid] = pointsAlong([[-122.35, 47.65], [-122.33, 47.65]], [0.5]);
    expect(mid[0]).toBeCloseTo(-122.34, 5);
  });

  it("links to Google Maps bike directions through points on the route", () => {
    const url = new URL(googleMapsUrl(line));
    expect(url.searchParams.get("travelmode")).toBe("bicycling");
    expect(url.searchParams.get("origin")).toBe("47.65000,-122.35000");
    expect(url.searchParams.get("destination")).toBe("47.66000,-122.34000");
    expect(url.searchParams.get("waypoints")!.split("|")).toHaveLength(3);
  });

  it("wraps each stretch to avoid in a closed rectangle", () => {
    const polys = avoidAreas([line]);
    expect(polys).toHaveLength(2);
    const ring = polys[0][0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // Covers the street: the midpoint of the first stretch is inside the rectangle's bounds.
    const lats = ring.map((p) => p[1]);
    expect(Math.min(...lats)).toBeLessThan(47.65);
    expect(Math.max(...lats)).toBeGreaterThan(47.65);
  });
});

describe("parseRoutes", () => {
  it("reads OpenRouteService GeoJSON into routes with steps", () => {
    const routes = parseRoutes({
      features: [
        {
          geometry: { coordinates: [[-122.35, 47.65, 10], [-122.34, 47.65, 12], [-122.34, 47.66, 30]] },
          properties: {
            summary: { distance: 1800, duration: 420 },
            ascent: 20,
            descent: 0,
            segments: [
              {
                steps: [
                  { instruction: "Head east", distance: 750, duration: 180, type: 11, way_points: [0, 1] },
                  { instruction: "Turn left onto Dexter Avenue North", distance: 1050, duration: 240, type: 0, way_points: [1, 2] },
                  { instruction: "Arrive at your destination", distance: 0, duration: 0, type: 10, way_points: [2, 2] },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ distance: 1800, duration: 420, ascent: 20 });
    expect(routes[0].coords[1]).toEqual([-122.34, 47.65]);
    expect(routes[0].steps[1]).toMatchObject({ instruction: "Turn left onto Dexter Avenue North", at: [-122.34, 47.65] });
  });
});
