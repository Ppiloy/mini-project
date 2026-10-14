import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const node = `"${process.execPath}"`;
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const viteCli = resolve(dirname(fileURLToPath(import.meta.resolve("vite"))), "../../bin/vite.js");
const apiPort = Number(process.env.FTC_REAL_API_PORT ?? 19111);
const webPort = Number(process.env.FTC_REAL_WEB_PORT ?? 15191);
// The config is re-evaluated in worker processes. Preserve the runner's path
// through inherited env so workers never point at a per-worker credential file.
const runDirectory = process.env.FTC_REAL_BROWSER_RUN_DIRECTORY ?? join(tmpdir(), `ftc-real-backend-browser-${process.pid}`);
process.env.FTC_REAL_BROWSER_RUN_DIRECTORY = runDirectory;
process.env.FTC_REAL_BROWSER_CREDENTIALS_FILE = join(runDirectory, "credentials.json");

if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 ||
    !Number.isInteger(webPort) || webPort < 1024 || webPort > 65535 || apiPort === webPort) {
  throw new Error("Real-backend browser acceptance needs two distinct, valid candidate-specific ports.");
}

export default defineConfig({
  testDir: "./e2e/real-backend",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium-real-backend", use: { ...devices["Desktop Chrome"] } }],
  globalTeardown: "./e2e/real-backend/global-teardown.ts",
  webServer: [
    {
      command: `${node} "${tsxCli}" e2e/real-backend/server.ts`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      timeout: 90_000,
      env: {
        PORT: String(apiPort),
        FTC_REAL_BROWSER_RUN_DIRECTORY: runDirectory,
        FTC_REAL_BROWSER_CREDENTIALS_FILE: join(runDirectory, "credentials.json"),
        FTC_REAL_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
      },
      reuseExistingServer: false,
    },
    {
      command: `${node} "${viteCli}" --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      timeout: 60_000,
      env: { FTC_TEST_API_PORT: String(apiPort) },
      reuseExistingServer: false,
    },
  ],
});
