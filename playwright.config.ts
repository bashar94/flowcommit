import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4368);

/**
 * Editor tests run against the built app (npm run build) in the Chrome already on this computer,
 * so no browsers are downloaded. Run them with: npm run test:e2e
 */
export default defineConfig({
  testDir: "e2e",
  globalTeardown: "./e2e/teardown.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL ?? "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://localhost:${PORT}/api/project`,
    reuseExistingServer: false,
    stdout: "pipe",
    env: { E2E_PORT: String(PORT) },
  },
});
