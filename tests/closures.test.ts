import { describe, expect, it } from "vitest";
import { daysThisWeek, hoursOn, type Closure } from "../src/closures";
import { streetCase } from "../src/format";
import { groupCollisions } from "../scripts/collision-stats";
import { crashesFor, windowStart } from "../src/crashes";
import type { CollisionsFile } from "../src/data-types";

const closure = (over: Partial<Closure>): Closure => ({
  permit: "P1",
  type: "Play Street",
  street: "9TH AVE NW",
  from: "NW 65TH ST",
  to: "NW 67TH ST",
  start: "2026-05-12",
  end: "2026-11-08",
  hours: [null, null, null, null, null, null, null],
  coords: [],
  ...over,
});

describe("closure schedules", () => {
  // Fridays 4–9 PM and Sundays 1–8 PM.
  const play = closure({ hours: ["1PM-8PM", null, null, null, null, "4PM-9PM", null] });

  it("is closed only on its weekdays", () => {
    expect(hoursOn(play, "2026-10-23")).toBe("4PM-9PM"); // Friday
    expect(hoursOn(play, "2026-10-25")).toBe("1PM-8PM"); // Sunday
    expect(hoursOn(play, "2026-10-24")).toBeNull(); // Saturday
  });

  it("is open outside its date range", () => {
    expect(hoursOn(play, "2026-11-13")).toBeNull(); // a Friday after the permit ends
  });

  it("treats a permit with no weekday hours as all day", () => {
    expect(hoursOn(closure({ start: "2026-10-31", end: "2026-10-31" }), "2026-10-31")).toBe("all day");
  });

  it("lists the days it's in effect this week, today first", () => {
    expect(daysThisWeek(play, "2026-10-24")).toEqual(["2026-10-25", "2026-10-30"]);
  });
});

describe("streetCase", () => {
  it("turns city capitals into readable street names", () => {
    expect(streetCase("FREMONT AVE N AND N 34TH ST")).toBe("Fremont Ave N & N 34th St");
    expect(streetCase("BROADWAY BETWEEN E PIKE ST AND E PINE ST")).toBe("Broadway between E Pike St & E Pine St");
    expect(streetCase("NE 95TH ST")).toBe("NE 95th St");
  });
});

describe("groupCollisions", () => {
  const crash = (location: string, day: string, over = {}) => ({
    location,
    lng: -122.3,
    lat: 47.6,
    day,
    injuries: 1,
    serious: 0,
    fatal: 0,
    ...over,
  });

  it("groups crashes by location, oldest first", () => {
    const places = groupCollisions([
      crash("A AND B", "2025-01-01"),
      crash("C AND D", "2026-03-01", { serious: 1 }),
      crash("C AND D", "2025-02-01"),
    ]);
    expect(places.find((p) => p.location === "C AND D")!.crashes).toEqual([
      ["2025-02-01", 1, 0, 0],
      ["2026-03-01", 1, 1, 0],
    ]);
    expect(places).toHaveLength(2);
  });
});

describe("crash windows", () => {
  const file: CollisionsFile = {
    generatedAt: "",
    since: "2021-10-25",
    through: "2026-08-28",
    places: [
      { location: "OLD", lng: 0, lat: 0, crashes: [["2022-01-01", 1, 0, 0], ["2022-02-01", 1, 0, 0], ["2022-03-01", 1, 0, 0]] },
      { location: "RECENT", lng: 0, lat: 0, crashes: [["2025-01-01", 1, 0, 0], ["2026-07-01", 1, 1, 0]] },
      { location: "FATAL", lng: 0, lat: 0, crashes: [["2026-08-20", 0, 0, 1]] },
    ],
  };

  it("counts back from SDOT's newest record, not today", () => {
    expect(windowStart("2026-08-28", 3)).toBe("2026-05-29");
    expect(windowStart("2026-08-28", 12)).toBe("2025-08-29");
  });

  it("shows only crashes inside the window, worst first", () => {
    const three = crashesFor(file, "3m").spots;
    expect(three.map((s) => [s.location, s.crashes])).toEqual([
      ["FATAL", 1],
      ["RECENT", 1],
    ]);
    expect(three[1]).toMatchObject({ serious: 1, last: "2026-07-01" });
    const five = crashesFor(file, "5y").spots;
    expect(five.map((s) => s.location)).toEqual(["OLD", "RECENT", "FATAL"]);
  });
});
