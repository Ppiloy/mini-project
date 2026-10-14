import { defineConfig, devices } from "@playwright/test";

const node = `"${process.execPath}"`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${node} node_modules/tsx/dist/cli.mjs watch server/dev.ts`,
      url: "http://127.0.0.1:8888/api/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `${node} node_modules/vite/bin/vite.js --host 127.0.0.1`,
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
