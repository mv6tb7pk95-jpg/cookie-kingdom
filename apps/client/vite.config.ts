import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/api": "http://localhost:8787" } },
  base: "./",
  build: { chunkSizeWarningLimit: 1500 },
});
