import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const node = `"${process.execPath}"`;
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const viteCli = resolve(dirname(fileURLToPath(import.meta.resolve("vite"))), "../../bin/vite.js");
const apiPort = Number(process.env.FTC_TEST_API_PORT ?? 8888);
const webPort = Number(process.env.FTC_TEST_WEB_PORT ?? 5173);
const runDirectory = process.env.FTC_REAL_BROWSER_RUN_DIRECTORY ?? join(tmpdir(), `ftc-real-backend-browser-${process.pid}`);
const runToken = process.env.TEST_WORKER_INDEX === undefined ? randomUUID() : process.env.FTC_REAL_BROWSER_RUN_TOKEN;
if (!runToken) throw new Error("The browser worker did not inherit its run ownership token.");
process.env.FTC_REAL_BROWSER_RUN_DIRECTORY = runDirectory;
process.env.FTC_REAL_BROWSER_RUN_TOKEN = runToken;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/real-backend/**"],
  fullyParallel: true,
  reporter: "list",
  globalTeardown: "./e2e/real-backend/global-teardown.ts",
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${node} "${tsxCli}" e2e/real-backend/server.ts`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      timeout: 90_000,
      env: {
        PORT: String(apiPort),
        FTC_REAL_BROWSER_RUN_DIRECTORY: runDirectory,
        FTC_REAL_BROWSER_RUN_TOKEN: runToken,
        FTC_REAL_BROWSER_CREDENTIALS_FILE: join(runDirectory, "credentials.json"),
        FTC_REAL_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
      },
      reuseExistingServer: false,
    },
    {
      command: `${node} "${viteCli}" --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      env: { FTC_TEST_API_PORT: String(apiPort) },
      reuseExistingServer: false,
    },
  ],
});
