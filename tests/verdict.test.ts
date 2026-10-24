import { describe, expect, it } from "vitest";
import { verdict, type VerdictInput } from "../src/verdict";
import type { Hour } from "../src/weather";

// Saturday 2026-10-24, 2 PM in Seattle (PDT).
const NOW = new Date("2026-10-24T21:00:00Z");
const hour = (h: number, over: Partial<Hour> = {}): Hour => ({
  start: new Date(NOW.getTime() + h * 3_600_000),
  tempF: 53,
  rainChance: 5,
  windMph: 5,
  windDir: "S",
  sky: "Cloudy",
  ...over,
});

const input = (over: Partial<VerdictInput> = {}): VerdictInput => ({
  now: NOW,
  hours: [hour(0), hour(1), hour(2), hour(3)],
  alerts: [],
  sunrise: new Date("2026-10-24T14:41:00Z"), // 7:41 AM
  sunset: new Date("2026-10-25T01:05:00Z"), // 6:05 PM
  bridges: [],
  ...over,
});

describe("should I ride?", () => {
  it("says good to ride on a dry, calm afternoon", () => {
    const v = verdict(input())!;
    expect(v.tone).toBe("good");
    expect(v.headline).toBe("Good to ride");
    expect(v.details).toEqual(["dry, 53°"]);
    expect(v.short).toBe("Good to ride · 53°");
  });

  it("flags rain in the next few hours, with when", () => {
    const v = verdict(input({ hours: [hour(0), hour(1, { rainChance: 70 }), hour(2)] }))!;
    expect(v.tone).toBe("fair");
    expect(v.headline).toBe("Rain likely");
    expect(v.details[0]).toBe("rain from 3p (70%)");
  });

  it("ignores rain after the ride window", () => {
    const v = verdict(input({ hours: [hour(0), hour(1), hour(2), hour(4, { rainChance: 90 })] }))!;
    expect(v.tone).toBe("good");
  });

  it("calls strong wind and ice poor", () => {
    expect(verdict(input({ hours: [hour(0, { windMph: 30 })] }))!.tone).toBe("poor");
    expect(verdict(input({ hours: [hour(0, { tempF: 30 })] }))!.headline).toBe("Icy spots likely");
  });

  it("names the first problem but keeps the worst tone", () => {
    const v = verdict(input({ hours: [hour(0, { rainChance: 80, windMph: 28 })] }))!;
    expect(v.headline).toBe("Rain likely");
    expect(v.tone).toBe("poor");
    expect(v.details).toEqual(["rain now (80%)", "wind to 28 mph"]);
  });

  it("puts a severe weather alert first", () => {
    const v = verdict(input({ alerts: [{ event: "Wind Advisory", headline: "" }] }))!;
    expect(v.headline).toBe("Wind Advisory");
    expect(v.tone).toBe("poor");
  });

  it("mentions darkness coming during the ride", () => {
    const evening = new Date("2026-10-25T00:00:00Z"); // 5 PM
    const v = verdict(input({ now: evening, hours: [hour(3), hour(4)] }))!;
    expect(v.details).toContain("dark by 6p");
  });

  it("mentions bridges likely to open", () => {
    const v = verdict(input({ bridges: [{ name: "Fremont", chance: 0.6 }, { name: "Montlake", chance: 0.1 }] }))!;
    expect(v.details).toContain("Fremont bridge may open");
  });

  it("gives no answer without a forecast", () => {
    expect(verdict(input({ hours: [] }))).toBeNull();
  });
});
