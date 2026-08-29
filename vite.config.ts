import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
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
        mobile: resolve(import.meta.dirname, "mobile/index.html"),
        pixelHop: resolve(import.meta.dirname, "games/pixel-hop/index.html"),
        superTux: resolve(import.meta.dirname, "games/supertux/index.html"),
        moth: resolve(import.meta.dirname, "games/moth/index.html"),
        breathSonification: resolve(
          import.meta.dirname,
          "breath-sonification/index.html",
        ),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
