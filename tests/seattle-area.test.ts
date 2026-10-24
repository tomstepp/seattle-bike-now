import { describe, expect, it } from "vitest";
import { kmFromCity, NEAR_BOUNDS, NEAR_KM } from "../src/seattle-area";

const near = (lat: number, lng: number) => kmFromCity({ lat, lng }) <= NEAR_KM;

describe("near Seattle", () => {
  it("counts anywhere in the city", () => {
    expect(kmFromCity({ lat: 47.6205, lng: -122.3165 })).toBe(0); // Capitol Hill
    expect(kmFromCity({ lat: 47.5815, lng: -122.4165 })).toBe(0); // Alki
  });

  it("counts places within 10 miles of the city limits", () => {
    expect(near(47.8209, -122.3151)).toBe(true); // Lynnwood
    expect(near(47.6101, -122.2015)).toBe(true); // Bellevue
    expect(near(47.38, -122.235)).toBe(true); // Kent
  });

  it("leaves out places farther away", () => {
    expect(near(47.979, -122.202)).toBe(false); // Everett
    expect(near(47.2529, -122.4443)).toBe(false); // Tacoma
    expect(near(45.52, -122.68)).toBe(false); // Portland
  });

  it("lets the map pan to every place that counts", () => {
    const [[west, south], [east, north]] = NEAR_BOUNDS;
    for (const [lat, lng] of [
      [47.8209, -122.3151],
      [47.6101, -122.2015],
      [47.38, -122.235],
    ]) {
      expect(lat).toBeGreaterThan(south);
      expect(lat).toBeLessThan(north);
      expect(lng).toBeGreaterThan(west);
      expect(lng).toBeLessThan(east);
    }
  });
});
