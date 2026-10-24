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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
