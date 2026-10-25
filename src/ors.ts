// OpenRouteService: bike routes (with alternatives and turn-by-turn steps) and
// place search. Free tier: 2,000 routes and 1,000 searches a day. Its data is
// OpenStreetMap, so results can be shown on any map (unlike Google's).
// The key ships in the page; the worst a copied key can do is use up the free quota.

const KEY = import.meta.env.VITE_ORS_KEY as string | undefined;
const API = "https://api.openrouteservice.org";
// Seattle plus the 10-mile ring the map pans to, for place search.
const BOUNDS = { minLng: -122.64, minLat: 47.35, maxLng: -122.02, maxLat: 47.88 };

export const routingAvailable = () => Boolean(KEY);

type LngLat = [number, number];

export interface Step {
  instruction: string; // "Turn left onto Dexter Avenue North"
  distance: number; // meters to the next step
  duration: number; // seconds
  type: number; // ORS instruction type: 0 left, 1 right, … 10 arrive, 11 depart
  at: LngLat; // where the step starts
}

export interface Route {
  coords: LngLat[];
  distance: number; // meters
  duration: number; // seconds
  ascent: number; // meters
  descent: number;
  steps: Step[];
}

export interface Place {
  label: string;
  at: LngLat;
}

interface OrsFeature {
  geometry: { coordinates: number[][] };
  properties: {
    summary: { distance?: number; duration?: number };
    ascent?: number;
    descent?: number;
    segments?: { steps?: { instruction: string; distance: number; duration: number; type: number; way_points: [number, number] }[] }[];
  };
}

/** Up to three bike routes from `from` to `to`, optionally steering around areas. */
export async function fetchRoutes(from: LngLat, to: LngLat, avoid?: LngLat[][][]): Promise<Route[]> {
  if (!KEY) throw new Error("no OpenRouteService key");
  const body: Record<string, unknown> = {
    coordinates: [from, to],
    instructions: true,
    elevation: true,
    // weight_factor: how much longer an alternative may be; share_factor: how much it may overlap.
    // Short trips rarely have alternatives that overlap less than 60%, so allow 75%.
    alternative_routes: { target_count: 3, weight_factor: 1.8, share_factor: 0.75 },
  };
  if (avoid?.length) body.options = { avoid_polygons: { type: "MultiPolygon", coordinates: avoid } };
  const res = await fetch(`${API}/v2/directions/cycling-regular/geojson`, {
    method: "POST",
    headers: { Authorization: KEY, "Content-Type": "application/json", Accept: "application/geo+json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouteService: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return parseRoutes((await res.json()) as { features: OrsFeature[] });
}

export function parseRoutes(json: { features: OrsFeature[] }): Route[] {
  return json.features.map((f) => {
    const coords = f.geometry.coordinates.map(([lng, lat]) => [lng, lat] as LngLat);
    const steps = (f.properties.segments ?? []).flatMap((seg) =>
      (seg.steps ?? []).map((s) => ({
        instruction: s.instruction,
        distance: s.distance,
        duration: s.duration,
        type: s.type,
        at: coords[s.way_points[0]] ?? coords[0],
      })),
    );
    return {
      coords,
      distance: f.properties.summary.distance ?? 0,
      duration: f.properties.summary.duration ?? 0,
      ascent: f.properties.ascent ?? 0,
      descent: f.properties.descent ?? 0,
      steps,
    };
  });
}

/** Place suggestions for a search box, biased to Seattle. */
export async function searchPlaces(text: string, near?: LngLat): Promise<Place[]> {
  if (!KEY || text.trim().length < 3) return [];
  const q = new URLSearchParams({
    api_key: KEY,
    text,
    "boundary.rect.min_lon": String(BOUNDS.minLng),
    "boundary.rect.min_lat": String(BOUNDS.minLat),
    "boundary.rect.max_lon": String(BOUNDS.maxLng),
    "boundary.rect.max_lat": String(BOUNDS.maxLat),
    size: "6",
  });
  if (near) {
    q.set("focus.point.lon", String(near[0]));
    q.set("focus.point.lat", String(near[1]));
  }
  const res = await fetch(`${API}/geocode/autocomplete?${q}`);
  if (!res.ok) throw new Error(`OpenRouteService search: HTTP ${res.status}`);
  const json = (await res.json()) as { features: { properties: { label: string }; geometry: { coordinates: LngLat } }[] };
  return json.features.map((f) => ({ label: f.properties.label.replace(/, (WA|Washington), USA$/, ""), at: f.geometry.coordinates }));
}

/** A short name for a point ("1200 Dexter Ave N"), or null. */
export async function nameOf(at: LngLat): Promise<string | null> {
  if (!KEY) return null;
  const q = new URLSearchParams({ api_key: KEY, "point.lon": String(at[0]), "point.lat": String(at[1]), size: "1", layers: "address,street,venue" });
  const res = await fetch(`${API}/geocode/reverse?${q}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { features: { properties: { name?: string } }[] };
  return json.features[0]?.properties.name ?? null;
}
