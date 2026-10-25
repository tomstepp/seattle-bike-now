// Which TomTom tiles to fetch: the z14 tiles that shared bike segments touch.

// z14 includes local streets in TomTom's flow tiles.
export const TILE_ZOOM = 14;

/** Slippy-map tile [x, y] containing a point. */
export function tileFor(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [
    Math.floor(((lng + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  ];
}

/** "x/y" tiles touched by the lines, sorted. */
export function tilesFor(lines: [number, number][][], z = TILE_ZOOM): string[] {
  const tiles = new Set<string>();
  // Sample along each edge too (z14 tiles are ~1.6 km), so long blocks that
  // cross a tile edge between vertices still pull in both tiles.
  for (const coords of lines) {
    for (let i = 0; i < coords.length - 1; i++) {
      const [[x0, y0], [x1, y1]] = [coords[i], coords[i + 1]];
      for (let t = 0; t <= 1; t += 0.1) tiles.add(tileFor(x0 + t * (x1 - x0), y0 + t * (y1 - y0), z).join("/"));
    }
    const [lng, lat] = coords[coords.length - 1];
    tiles.add(tileFor(lng, lat, z).join("/"));
  }
  return [...tiles].sort();
}
