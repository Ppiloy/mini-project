import { expect, test } from "@playwright/test";

test("a taxpayer confirms deletion of a draft from the dashboard", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  await page.goto("/demo/app");

  const card = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });
  await expect(card).toBeVisible();
  const deleteButton = card.getByRole("button", { name: "ลบร่าง" });
  const dismissedDialog = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await deleteButton.click();
  await dismissedDialog;
  await expect(card).toBeVisible();

  const acceptedDialog = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await deleteButton.click();
  await acceptedDialog;
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() })).toHaveCount(0);
});

test("loading a worked example leaves the browser clipboard unchanged", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { writes: 0, text: "clipboard stays untouched" };
    const browser = globalThis as unknown as { navigator: object; __FTC_CLIPBOARD_TEST__?: typeof state };
    Object.defineProperty(browser, "__FTC_CLIPBOARD_TEST__", { configurable: true, value: state });
    Object.defineProperty(browser.navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => state.text,
        writeText: async (text: string) => { state.writes += 1; state.text = text; },
      },
    });
  });
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);

  const clipboard = await page.evaluate(() => (globalThis as unknown as { __FTC_CLIPBOARD_TEST__: { writes: number; text: string } }).__FTC_CLIPBOARD_TEST__);
  expect(clipboard).toEqual({ writes: 0, text: "clipboard stays untouched" });
});
