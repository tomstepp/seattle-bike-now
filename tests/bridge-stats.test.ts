import { describe, expect, it } from "vitest";
import { bridgeStats, type BridgeRow } from "../scripts/bridge-stats";

const row = (open: string, close: string): BridgeRow => ({
  entityid: "3",
  entityname: "Fremont",
  opendatetime: `${open}:00.000`,
  closedatetime: `${close}:00.000`,
  latitude: "47.6476",
  longitude: "-122.3497",
});

describe("bridgeStats", () => {
  it("merges open/close pairs logged a few minutes apart into one opening", () => {
    const stats = bridgeStats([
      row("2026-10-19T14:05", "2026-10-19T14:07"),
      row("2026-10-19T14:08", "2026-10-19T14:11"), // span re-settling
      row("2026-10-19T18:30", "2026-10-19T18:34"),
    ]);
    // 2 openings on 1 day.
    expect(stats.openingsPerDay).toBe(2);
    expect(stats.medianMinutes).toBe(6); // 14:05–14:11 is the longer one; median of [4, 6]
  });

  it("gives the share of days with an opening in each hour, split by day type", () => {
    // Mon 2026-10-19 and Tue 2026-10-20: an opening at 2pm on Monday only.
    // Sat 2026-10-24 is the last logged day, opening at 11am.
    const stats = bridgeStats([
      row("2026-10-19T14:05", "2026-10-19T14:07"),
      row("2026-10-24T11:00", "2026-10-24T11:04"),
    ]);
    // Mon–Fri = 5 weekdays, Sat = 1 weekend day.
    expect(stats.weekday[14]).toBe(0.2);
    expect(stats.weekday[11]).toBe(0);
    expect(stats.weekend[11]).toBe(1);
    expect(stats.firstLogged).toBe("2026-10-19");
    expect(stats.lastLogged).toBe("2026-10-24");
  });

  it("counts an hour once even with several openings in it", () => {
    const stats = bridgeStats([
      row("2026-10-19T14:05", "2026-10-19T14:07"),
      row("2026-10-19T14:40", "2026-10-19T14:44"),
    ]);
    expect(stats.weekday[14]).toBe(1);
    expect(stats.openingsPerDay).toBe(2);
  });

  it("carries the bridge's name and position", () => {
    const stats = bridgeStats([row("2026-10-19T14:05", "2026-10-19T14:07")]);
    expect(stats).toMatchObject({ id: "3", name: "Fremont", lat: 47.6476, lng: -122.3497 });
  });
});
