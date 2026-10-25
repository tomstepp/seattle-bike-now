import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works at a domain root or under a path (GitHub Pages).
  base: "./",
  // MapLibre finds its worker next to its own module; pre-bundling moves the module.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  // In dev, /api goes to `npm run dev:worker` (wrangler dev on :8787).
  server: { proxy: { "/api": "http://localhost:8787" } },
  // The map chunk is ~1 MB, nearly all MapLibre itself; it loads in parallel with
  // the small entry chunk, so there's nothing left to split.
  build: { chunkSizeWarningLimit: 1200 },
});
