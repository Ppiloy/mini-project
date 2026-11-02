import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const thaiFontPackage = dirname(require.resolve("@fontsource/noto-sans-thai/400.css"));
const apiPort = process.env.FTC_TEST_API_PORT ?? "8888";
const browserCache = process.env.FTC_BROWSER_TEST === "1"
  ? resolve(process.cwd(), "tmp", `vite-browser-${apiPort}`)
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...(browserCache ? { cacheDir: browserCache } : {}),
  server: {
    fs: { allow: [process.cwd(), thaiFontPackage] },
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    ...(process.env.FTC_BROWSER_TEST === "1" ? { hmr: false } : {}),
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "tmp/**", "e2e/**"],
    restoreMocks: true,
    // Bound concurrent DB/filesystem integration suites on constrained CI builders to avoid Vitest's 5s timeout.
    maxWorkers: process.env.CI ? 2 : 4,
  },
});
