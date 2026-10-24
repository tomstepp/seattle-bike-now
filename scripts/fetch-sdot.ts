// Downloads SDOT Existing Bike Facilities + Multi-use Trails and writes one
// normalized GeoJSON for the map: public/data/bike-network.geojson.
// Raw responses are kept in data/raw/ (gitignored) for debugging.
import { mkdir, writeFile } from "node:fs/promises";

const SERVICE =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer";
const LAYER_TRAILS = 1;
const LAYER_EXISTING = 2;
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

// TomTom tiles the worker matches against; z14 includes local streets.
const TILE_ZOOM = 14;

// Slippy-map tile [x, y] containing a point.
function tileFor(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [
    Math.floor(((lng + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  ];
}

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

// ~11 cm precision; keeps the file small.
function round(coords: unknown): unknown {
  if (typeof coords === "number") return Math.round(coords * 1e6) / 1e6;
  return (coords as unknown[]).map(round);
}

// "E UNION ST BETWEEN 33RD AVE AND 34TH AVE (BKF-SHW)" -> "E UNION ST"
function streetFromDesc(desc: unknown): string {
  return String(desc ?? "").split(/ BETWEEN | (?=\()/)[0].trim();
}

async function main() {
  await mkdir("data/raw", { recursive: true });
  await mkdir("public/data", { recursive: true });

  const [existing, trails] = await Promise.all([
    fetchLayer(LAYER_EXISTING, "OBJECTID,CATEGORY,UNITDESC,CURRENT_STATUS"),
    fetchLayer(LAYER_TRAILS, "OBJECTID,ORD_STNAME_CONCAT"),
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
  console.log(`wrote ${out.length} segments`, counts, "skipped", skipped);

  // Worker input: shared segments only, plus the TomTom tiles they touch, so
  // each cron run fetches only tiles that can color something.
  const shared = out
    .filter((f) => !f.properties.separated)
    .map((f) => ({ id: f.properties.id as string, coords: f.geometry!.coordinates as [number, number][] }));
  const tiles = new Set<string>();
  // Sample along each edge too (z14 tiles are ~1.6 km), so long blocks that
  // cross a tile edge between vertices still pull in both tiles.
  for (const s of shared) {
    for (let i = 0; i < s.coords.length - 1; i++) {
      const [[x0, y0], [x1, y1]] = [s.coords[i], s.coords[i + 1]];
      for (let t = 0; t <= 1; t += 0.1) tiles.add(tileFor(x0 + t * (x1 - x0), y0 + t * (y1 - y0), TILE_ZOOM).join("/"));
    }
    const [lng, lat] = s.coords[s.coords.length - 1];
    tiles.add(tileFor(lng, lat, TILE_ZOOM).join("/"));
  }
  await mkdir("worker/data", { recursive: true });
  await writeFile(
    "worker/data/shared-segments.json",
    JSON.stringify({ zoom: TILE_ZOOM, tiles: [...tiles].sort(), segments: shared }),
  );
  console.log(`worker: ${shared.length} shared segments across ${tiles.size} z${TILE_ZOOM} tiles`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
