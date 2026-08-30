import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
