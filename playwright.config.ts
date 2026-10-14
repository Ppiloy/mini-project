import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const node = `"${process.execPath}"`;
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const viteCli = resolve(dirname(fileURLToPath(import.meta.resolve("vite"))), "../../bin/vite.js");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${node} "${tsxCli}" watch server/dev.ts`,
      url: "http://127.0.0.1:8888/api/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `${node} "${viteCli}" --host 127.0.0.1 --strictPort`,
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
