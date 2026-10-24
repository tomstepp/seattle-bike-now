import { describe, expect, it } from "vitest";
import { bridgeChance, chanceClass, sparkline } from "../src/conditions";
import type { BridgeStats } from "../src/data-types";

const bridge: BridgeStats = {
  id: "3",
  name: "Fremont",
  lng: -122.35,
  lat: 47.65,
  firstLogged: "2025-10-24",
  lastLogged: "2026-10-23",
  openingsPerDay: 8,
  medianMinutes: 4,
  weekday: Array.from({ length: 24 }, (_, h) => h / 100),
  weekend: Array.from({ length: 24 }, (_, h) => 0.5 + h / 100),
};

describe("bridge odds", () => {
  it("reads the current Seattle hour from the right day type", () => {
    // Thu 2026-10-22 8 AM PDT.
    expect(bridgeChance(bridge, new Date("2026-10-22T15:00:00Z"))).toBe(0.08);
    // Sat 2026-10-24 2 PM PDT.
    expect(bridgeChance(bridge, new Date("2026-10-24T21:00:00Z"))).toBe(0.64);
  });

  it("bands odds into likely, possible and unlikely", () => {
    expect([0.6, 0.4, 0.2, 0.15, 0.1].map(chanceClass)).toEqual(["likely", "likely", "possible", "possible", "unlikely"]);
  });
});

describe("sparkline", () => {
  it("draws one line when there are no gaps", () => {
    expect(sparkline([1, 2, 3, 4]).match(/<polyline/g)).toHaveLength(1);
  });

  it("breaks the line where the counter was offline", () => {
    expect(sparkline([1, 2, null, 3, 4]).match(/<polyline/g)).toHaveLength(2);
  });

  it("drops runs too short to draw", () => {
    expect(sparkline([1, null, 2, 3]).match(/<polyline/g)).toHaveLength(1);
  });
});
