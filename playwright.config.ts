import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const node = `"${process.execPath}"`;
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const viteCli = resolve(dirname(fileURLToPath(import.meta.resolve("vite"))), "../../bin/vite.js");
const apiPort = Number(process.env.FTC_TEST_API_PORT ?? 8888);
const webPort = Number(process.env.FTC_TEST_WEB_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/real-backend/**"],
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${node} "${tsxCli}" watch server/dev.ts`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `${node} "${viteCli}" --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      env: { FTC_TEST_API_PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
