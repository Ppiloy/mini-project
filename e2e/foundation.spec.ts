import { expect, test } from "@playwright/test";

test("Vite serves the Thai app and proxies the API error contract", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ระบบต้นแบบเพื่อการศึกษา")).toBeVisible();

  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ data: { status: "ok" }, requestId: expect.any(String) });

  const unknownRoute = await page.request.get("/api/no-such-route");
  expect(unknownRoute.status()).toBe(404);
  expect(unknownRoute.headers()["content-type"]).toContain("application/json");
});
