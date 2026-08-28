import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  base: "/ECGaming/",
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        groundControl: resolve(
          import.meta.dirname,
          "ground-control/index.html",
        ),
        flight: resolve(import.meta.dirname, "flight/index.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
