import { defineConfig } from "vite";

export default defineConfig({
  // MapLibre finds its worker next to its own module; pre-bundling moves the module.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  // In dev, /api goes to `npm run dev:worker` (wrangler dev on :8787).
  server: { proxy: { "/api": "http://localhost:8787" } },
});
