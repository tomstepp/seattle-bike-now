import { describe, expect, it } from "vitest";
import { summarize } from "../scripts/counter-stats";
import { addDays } from "../scripts/socrata";

const info = { dataset: "x", name: "Test counter", lng: -122.35, lat: 47.65 };

// Daily counts for every day from start through end.
function series(start: string, end: string, count: (day: string, i: number) => number) {
  const days = new Map<string, number>();
  let i = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) days.set(d, count(d, i++));
  return days;
}

describe("summarize", () => {
  it("averages the last 30 days and compares with the same weeks last year", () => {
    const days = series("2024-09-01", "2026-09-30", (d) => (d >= "2026-01-01" ? 1200 : 1000));
    const s = summarize(info, days)!;
    expect(s.lastDay).toBe("2026-09-30");
    expect(s.avgPerDay30).toBe(1200);
    expect(s.changeVsLastYear).toBeCloseTo(0.2);
  });

  it("skips the comparison when last year is mostly missing", () => {
    const days = series("2026-01-01", "2026-09-30", () => 500);
    expect(summarize(info, days)!.changeVsLastYear).toBeNull();
  });

  it("finds the record day", () => {
    const days = series("2026-06-01", "2026-09-30", (d) => (d === "2026-07-06" ? 6755 : 3000));
    expect(summarize(info, days)!.record).toEqual({ day: "2026-07-06", count: 6755 });
  });

  it("returns 52 weekly totals, null where the counter was mostly offline", () => {
    const days = series("2025-09-01", "2026-09-30", () => 100);
    // Knock out most of one week in August.
    for (let d = "2026-08-03"; d <= "2026-08-08"; d = addDays(d, 1)) days.delete(d);
    const { weekly } = summarize(info, days)!;
    expect(weekly).toHaveLength(52);
    expect(weekly.filter((w) => w === null)).toHaveLength(1);
    expect(weekly.filter((w) => w !== null).every((w) => w === 700)).toBe(true);
  });

  it("returns null with under 30 days of data", () => {
    expect(summarize(info, series("2026-09-10", "2026-09-30", () => 10))).toBeNull();
  });
});
