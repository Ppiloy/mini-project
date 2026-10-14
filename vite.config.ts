import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const thaiFontPackage = dirname(require.resolve("@fontsource/noto-sans-thai/400.css"));
const apiPort = process.env.FTC_TEST_API_PORT ?? "8888";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: [process.cwd(), thaiFontPackage] }, proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "tmp/**", "e2e/**"],
    restoreMocks: true,
  },
});
