import { defineConfig } from "vite";

export default defineConfig({
  // MapLibre finds its worker next to its own module; pre-bundling moves the module.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
