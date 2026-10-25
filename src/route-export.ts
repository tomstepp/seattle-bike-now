// Taking a route elsewhere (GPX for navigation apps, a Google Maps link) and
// shaping closures for the router to avoid. Pure, so it can be tested.

type LngLat = [number, number];

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const escXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A GPX track that Ride with GPS, Komoot, Garmin and Wahoo can import and navigate. */
export function toGpx(coords: LngLat[], name: string): string {
  const pts = coords.map(([lng, lat]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`).join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Seattle Bike Now" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escXml(name)}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

function lengthM(a: LngLat, b: LngLat) {
  return Math.hypot((b[0] - a[0]) * mPerDegLng(a[1]), (b[1] - a[1]) * M_PER_DEG_LAT);
}

/** Points at the given fractions of the route's length. */
export function pointsAlong(coords: LngLat[], fractions: number[]): LngLat[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + lengthM(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  return fractions.map((f) => {
    const target = f * total;
    const i = Math.max(1, cum.findIndex((c) => c >= target));
    const t = (target - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9);
    const [a, b] = [coords[i - 1], coords[i]];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  });
}

// Google may still pick its own path between these, so more points keep it closer;
// mobile apps accept only a few.
const GOOGLE_WAYPOINTS = 3;

/** Opens Google Maps bike directions roughly along the route. Only a link, so Google's API terms don't apply. */
export function googleMapsUrl(coords: LngLat[]): string {
  const ll = ([lng, lat]: LngLat) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const via = pointsAlong(coords, Array.from({ length: GOOGLE_WAYPOINTS }, (_, i) => (i + 1) / (GOOGLE_WAYPOINTS + 1)));
  const q = new URLSearchParams({
    api: "1",
    origin: ll(coords[0]),
    destination: ll(coords[coords.length - 1]),
    travelmode: "bicycling",
    waypoints: via.map(ll).join("|"),
  });
  return `https://www.google.com/maps/dir/?${q}`;
}

/**
 * Thin rectangles around closed stretches, as GeoJSON MultiPolygon coordinates
 * for the router's avoid_polygons. Wide enough to cover the street, not its neighbors.
 */
export function avoidAreas(lines: LngLat[][], halfWidthM = 12, extendM = 8): LngLat[][][] {
  const polys: LngLat[][][] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const kx = mPerDegLng(a[1]);
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const [ux, uy] = [dx / len, dy / len]; // along
      const [nx, ny] = [-uy, ux]; // across
      const corner = (p: LngLat, along: number, across: number): LngLat => [
        p[0] + (ux * along + nx * across) / kx,
        p[1] + (uy * along + ny * across) / M_PER_DEG_LAT,
      ];
      const ring = [
        corner(a, -extendM, -halfWidthM),
        corner(b, extendM, -halfWidthM),
        corner(b, extendM, halfWidthM),
        corner(a, -extendM, halfWidthM),
      ];
      polys.push([[...ring, ring[0]]]);
    }
  }
  return polys;
}
