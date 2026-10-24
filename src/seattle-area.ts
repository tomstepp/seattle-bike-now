// Where "near Seattle" ends. No map or DOM here, so it's easy to test.

// Seattle city limits as a box (SDOT's Seattle_City_Limits layer, with the
// west edge at Alki). The box is a little generous at the corners, which a
// 10-mile buffer swamps.
const CITY = { west: -122.42, south: 47.494, east: -122.236, north: 47.736 };
export const NEAR_KM = 16.1; // 10 miles

// The city box grown by NEAR_KM; also the map's pan limits, so any dot we show is reachable.
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos((47.6 * Math.PI) / 180);
export const NEAR_BOUNDS: [[number, number], [number, number]] = [
  [CITY.west - NEAR_KM / KM_PER_DEG_LNG, CITY.south - NEAR_KM / KM_PER_DEG_LAT],
  [CITY.east + NEAR_KM / KM_PER_DEG_LNG, CITY.north + NEAR_KM / KM_PER_DEG_LAT],
];

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Distance to the city box; 0 inside it. */
export function kmFromCity(p: { lat: number; lng: number }): number {
  const nearest = {
    lat: Math.min(Math.max(p.lat, CITY.south), CITY.north),
    lng: Math.min(Math.max(p.lng, CITY.west), CITY.east),
  };
  return distanceKm(p, nearest);
}
