import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4179/ECGaming/",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4179",
    url: "http://127.0.0.1:4179/ECGaming/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
