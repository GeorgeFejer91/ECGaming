import { defineConfig, devices } from "@playwright/test";
const port = process.env.ECG_TEST_PORT ?? "4179";

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
    launchOptions: { args: ["--use-angle=swiftshader", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] },
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
