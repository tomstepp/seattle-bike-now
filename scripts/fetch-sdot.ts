// Downloads SDOT Existing Bike Facilities + Multi-use Trails and writes one
// normalized GeoJSON for the map: public/data/bike-network.geojson.
// Raw responses are kept in data/raw/ (gitignored) for debugging.
import { mkdir, writeFile } from "node:fs/promises";
import { TILE_ZOOM, tilesFor } from "../src/tiles";

const SERVICE =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer";
const LAYER_TRAILS = 1;
const LAYER_EXISTING = 2;
// Street blocks with SLOPE_PCT; a bike facility's SEGKEY is its block's COMPKEY.
const STREETS = "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_Streets_1/FeatureServer/0/query";
// Land boundaries only (north at N 145th St, south toward Burien); the shoreline is the rest.
const CITY_LIMITS =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Seattle_City_Limits/FeatureServer/0/query";
const PAGE = 2000; // service maxRecordCount

type Facility =
  | "trail"
  | "protected"
  | "buffered"
  | "painted"
  | "climbing"
  | "greenway"
  | "sharrow";

// SDOT CATEGORY codes on the Existing Bike Facilities layer.
const CATEGORY: Record<string, Facility> = {
  "BKF-OFFST": "trail", // misc off-street paths
  "BKF-PBL": "protected",
  "BKF-BBL": "buffered",
  "BKF-BL": "painted",
  "BKF-CLMB": "climbing",
  "BKF-NGW": "greenway",
  "BKF-SHW": "sharrow",
};

// Separated: no shared space with cars. Shared: riding in or beside traffic.
const SEPARATED = new Set<Facility>(["trail", "protected", "greenway"]);

interface Feature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

async function fetchLayer(layer: number, outFields: string): Promise<Feature[]> {
  const all: Feature[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields,
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      orderByFields: "OBJECTID",
    });
    const res = await fetch(`${SERVICE}/${layer}/query?${params}`);
    if (!res.ok) throw new Error(`layer ${layer}: HTTP ${res.status}`);
    const page = (await res.json()) as { features?: Feature[]; error?: unknown };
    if (!page.features) throw new Error(`layer ${layer}: ${JSON.stringify(page.error)}`);
    all.push(...page.features);
    if (page.features.length < PAGE) return all;
  }
}

// ~1 m precision: well under lane width, and a third smaller gzipped than 6 decimals.
function round(coords: unknown): unknown {
  if (typeof coords === "number") return Math.round(coords * 1e5) / 1e5;
  return (coords as unknown[]).map(round);
}

// "E UNION ST BETWEEN 33RD AVE AND 34TH AVE (BKF-SHW)" -> "E UNION ST"
function streetFromDesc(desc: unknown): string {
  return String(desc ?? "").split(/ BETWEEN | (?=\()/)[0].trim();
}

/** Block COMPKEY -> grade in percent (unsigned; the city doesn't record direction). */
async function fetchSlopes(): Promise<Map<number, number>> {
  const slopes = new Map<number, number>();
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: "SLOPE_PCT IS NOT NULL",
      outFields: "COMPKEY,SLOPE_PCT",
      returnGeometry: "false",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });
    const res = await fetch(`${STREETS}?${params}`);
    if (!res.ok) throw new Error(`streets: HTTP ${res.status}`);
    const page = (await res.json()) as { features?: { attributes: { COMPKEY: number; SLOPE_PCT: number } }[]; error?: unknown };
    if (!page.features) throw new Error(`streets: ${JSON.stringify(page.error)}`);
    for (const f of page.features) slopes.set(f.attributes.COMPKEY, f.attributes.SLOPE_PCT);
    if (page.features.length < PAGE) return slopes;
  }
}

async function main() {
  await mkdir("data/raw", { recursive: true });
  await mkdir("public/data", { recursive: true });

  const [existing, trails, slopes] = await Promise.all([
    fetchLayer(LAYER_EXISTING, "OBJECTID,CATEGORY,UNITDESC,CURRENT_STATUS,SEGKEY"),
    fetchLayer(LAYER_TRAILS, "OBJECTID,ORD_STNAME_CONCAT"),
    fetchSlopes(),
  ]);
  await writeFile("data/raw/existing-bike-facilities.geojson", JSON.stringify(existing));
  await writeFile("data/raw/multi-use-trails.geojson", JSON.stringify(trails));

  const out: Feature[] = [];
  const skipped: Record<string, number> = {};

  for (const f of existing) {
    const p = f.properties;
    const facility = CATEGORY[String(p.CATEGORY)];
    // UNDERCONS = closed for construction; PLNRECON is in service, slated for rebuild.
    if (!facility || !f.geometry || p.CURRENT_STATUS === "UNDERCONS") {
      const why = !facility ? `category ${p.CATEGORY}` : !f.geometry ? "no geometry" : "under construction";
      skipped[why] = (skipped[why] ?? 0) + 1;
      continue;
    }
    out.push({
      type: "Feature",
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      properties: {
        id: `bf-${p.OBJECTID}`,
        facility,
        separated: SEPARATED.has(facility),
        street: streetFromDesc(p.UNITDESC),
        // Off-street paths have no block, so no slope.
        ...(slopes.has(Number(p.SEGKEY)) ? { slope: slopes.get(Number(p.SEGKEY)) } : {}),
      },
    });
  }

  for (const f of trails) {
    if (!f.geometry) continue;
    out.push({
      type: "Feature",
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      properties: {
        id: `tr-${f.properties.OBJECTID}`,
        facility: "trail",
        separated: true,
        street: String(f.properties.ORD_STNAME_CONCAT ?? ""),
      },
    });
  }

  const counts: Record<string, number> = {};
  for (const f of out) counts[f.properties.facility as string] = (counts[f.properties.facility as string] ?? 0) + 1;

  const fc = {
    type: "FeatureCollection",
    fetchedAt: new Date().toISOString(),
    source: "SDOT Existing Bike Facilities + Multi-use Trails (Seattle Only)",
    features: out,
  };
  await writeFile("public/data/bike-network.geojson", JSON.stringify(fc));
  const withSlope = out.filter((f) => f.properties.slope !== undefined).length;
  console.log(`wrote ${out.length} segments (${withSlope} with slope)`, counts, "skipped", skipped);

  // City limits, drawn so lanes and traffic visibly stop at the border rather than just ending.
  const limitsRes = await fetch(`${CITY_LIMITS}?${new URLSearchParams({ where: "1=1", outSR: "4326", f: "geojson" })}`);
  if (!limitsRes.ok) throw new Error(`city limits: HTTP ${limitsRes.status}`);
  const limits = (await limitsRes.json()) as { features: Feature[] };
  await writeFile(
    "public/data/city-limits.geojson",
    JSON.stringify({
      type: "FeatureCollection",
      features: limits.features
        .filter((f) => f.geometry)
        .map((f) => ({ type: "Feature", geometry: { type: f.geometry!.type, coordinates: round(f.geometry!.coordinates) }, properties: {} })),
    }),
  );
  console.log(`wrote ${limits.features.length} city limit lines`);

  // Worker input: shared segments only, plus the TomTom tiles they touch, so
  // each cron run fetches only tiles that can color something.
  const shared = out
    .filter((f) => !f.properties.separated)
    .map((f) => ({ id: f.properties.id as string, coords: f.geometry!.coordinates as [number, number][] }));
  const tiles = tilesFor(shared.map((x) => x.coords));
  await mkdir("worker/data", { recursive: true });
  await writeFile(
    "worker/data/shared-segments.json",
    JSON.stringify({ zoom: TILE_ZOOM, tiles, segments: shared }),
  );
  console.log(`worker: ${shared.length} shared segments across ${tiles.length} z${TILE_ZOOM} tiles`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
