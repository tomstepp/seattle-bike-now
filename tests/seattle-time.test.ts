import { describe, expect, it } from "vitest";
import { formatDay, hourLabel, seattleHour, seattleIsWeekend, sunTimes } from "../src/seattle-time";

// Minutes past midnight, Seattle time.
const seattleMinutes = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .format(d)
    .split(":")
    .map(Number);
  return h * 60 + m;
};

describe("Seattle time", () => {
  it("uses Seattle's hour and weekday whatever the viewer's zone", () => {
    // 2026-10-24 01:30 UTC is Friday 6:30 PM in Seattle (PDT).
    const d = new Date("2026-10-24T01:30:00Z");
    expect(seattleHour(d)).toBe(18);
    expect(seattleIsWeekend(d)).toBe(false);
    // 2026-12-05 20:00 UTC is Saturday noon (PST).
    expect(seattleHour(new Date("2026-12-05T20:00:00Z"))).toBe(12);
    expect(seattleIsWeekend(new Date("2026-12-05T20:00:00Z"))).toBe(true);
  });

  it("formats hours and days", () => {
    expect([0, 6, 12, 18].map(hourLabel)).toEqual(["12a", "6a", "12p", "6p"]);
    expect(formatDay("2026-09-30")).toBe("Sep 30");
  });

  it("gets sunrise and sunset within a few minutes", () => {
    // Summer solstice in Seattle: about 5:11 AM and 9:10 PM.
    const june = sunTimes(47.62, -122.35, new Date("2026-06-21T19:00:00Z"));
    expect(Math.abs(seattleMinutes(june.sunrise) - (5 * 60 + 11))).toBeLessThanOrEqual(5);
    expect(Math.abs(seattleMinutes(june.sunset) - (21 * 60 + 10))).toBeLessThanOrEqual(5);
    // Winter solstice: about 7:55 AM and 4:20 PM.
    const dec = sunTimes(47.62, -122.35, new Date("2026-12-21T20:00:00Z"));
    expect(Math.abs(seattleMinutes(dec.sunrise) - (7 * 60 + 55))).toBeLessThanOrEqual(5);
    expect(Math.abs(seattleMinutes(dec.sunset) - (16 * 60 + 20))).toBeLessThanOrEqual(5);
  });

  it("uses Seattle's date in the evening, when UTC is already tomorrow", () => {
    const evening = new Date("2026-06-22T04:00:00Z"); // 9 PM June 21 in Seattle
    const noon = new Date("2026-06-21T19:00:00Z");
    expect(sunTimes(47.62, -122.35, evening).sunset.getTime()).toBe(sunTimes(47.62, -122.35, noon).sunset.getTime());
  });
});
