import { describe, expect, it } from "vitest";
import { commuteEnds, directionFor, directionOf, directionParam, type Commute } from "../src/commute";

const commute: Commute = {
  home: { label: "Home", at: [-122.35, 47.68] },
  work: { label: "Work", at: [-122.33, 47.61] },
};

describe("commute", () => {
  it("heads to work in the morning and home after noon", () => {
    expect(directionFor(7)).toBe("work");
    expect(directionFor(11)).toBe("work");
    expect(directionFor(12)).toBe("home");
    expect(directionFor(18)).toBe("home");
  });

  it("turns a direction into start and end", () => {
    expect(commuteEnds(commute, "work")).toEqual({ from: commute.home, to: commute.work });
    expect(commuteEnds(commute, "home")).toEqual({ from: commute.work, to: commute.home });
  });

  it("recognizes commute ends by position, not label", () => {
    const home = { label: "1234 N 45th St", at: [-122.35, 47.68] as [number, number] };
    expect(directionOf(commute, home, commute.work)).toBe("work");
    expect(directionOf(commute, commute.work, home)).toBe("home");
    expect(directionOf(commute, home, { label: "Gym", at: [-122.3, 47.66] })).toBeNull();
    expect(directionOf(commute, null, commute.work)).toBeNull();
  });

  it("reads the home-screen shortcut parameter", () => {
    expect(directionParam("?go=work")).toBe("work");
    expect(directionParam("?go=home&x=1")).toBe("home");
    expect(directionParam("?go=gym")).toBeNull();
    expect(directionParam("")).toBeNull();
  });
});
