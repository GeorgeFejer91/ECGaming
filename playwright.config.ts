import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    // Use the same software WebGL backend locally and on GPU-less CI runners.
    // The companion tests represent separate foreground devices in three tabs.
    launchOptions: { args: ["--use-angle=swiftshader", "--disable-backgrounding-occluded-windows"] },
    baseURL: "http://127.0.0.1:4179/",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4179",
    url: "http://127.0.0.1:4179/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
