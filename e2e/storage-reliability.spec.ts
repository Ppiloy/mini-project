import { expect, test } from "@playwright/test";

const FAULT_KEY = "__FTC_TEST_LOCAL_STORAGE_READ__";

async function createKnownDraft(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  return new URL(page.url()).pathname.split("/")[3]!;
}

async function installStorageReadFault(page: import("@playwright/test").Page) {
  await page.addInitScript((faultKey) => {
    const browser = globalThis as unknown as {
      Storage: { prototype: { getItem: (this: object, key: string) => string | null } };
      sessionStorage: { getItem(key: string): string | null };
      localStorage: object;
    };
    const originalGetItem = browser.Storage.prototype.getItem;
    browser.Storage.prototype.getItem = function (this: object, key: string) {
      if (this === browser.localStorage) {
        const mode = browser.sessionStorage.getItem(faultKey);
        if (mode === "throw") throw new Error("Injected local storage read failure");
        if (mode === "malformed") return "{ invalid JSON";
        if (mode === "shape") return '{"cases":{},"snapshots":[],"attachments":[]}';
      }
      return originalGetItem.call(this, key);
    };
  }, FAULT_KEY);
}

test("local storage read failures stay visible and cannot replace a saved draft", async ({ page }) => {
  const caseId = await createKnownDraft(page);
  await installStorageReadFault(page);
  await page.evaluate((key) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem(key: string, value: string): void } };
    browser.sessionStorage.setItem(key, "throw");
  }, FAULT_KEY);

  await page.goto("/demo/app");
  await expect(page.getByRole("alert")).toContainText("พื้นที่จัดเก็บ");
  await expect(page.getByRole("alert")).toContainText("โหลดหน้านี้ใหม่");
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await expect(page.getByRole("alert")).toContainText("ไม่ได้ถูกลบหรือเขียนทับ");

  await page.evaluate((key) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem(key: string, value: string): void } };
    browser.sessionStorage.setItem(key, "off");
  }, FAULT_KEY);
  await page.reload();
  await expect(page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() })).toBeVisible();
});

test("malformed storage reads cannot silently hide or overwrite saved draft history", async ({ page }) => {
  const caseId = await createKnownDraft(page);
  await installStorageReadFault(page);
  await page.evaluate((key) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem(key: string, value: string): void } };
    browser.sessionStorage.setItem(key, "malformed");
  }, FAULT_KEY);

  await page.goto("/demo/app");
  await expect(page.getByRole("alert")).toContainText("ข้อมูลสาธิต");
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await expect(page.getByRole("alert")).toContainText("ไม่ได้ถูกลบหรือเขียนทับ");

  await page.evaluate((key) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem(key: string, value: string): void } };
    browser.sessionStorage.setItem(key, "shape");
  }, FAULT_KEY);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("ข้อมูลสาธิต");
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await expect(page.getByRole("alert")).toContainText("ไม่ได้ถูกลบหรือเขียนทับ");

  await page.evaluate((key) => {
    const browser = globalThis as unknown as { sessionStorage: { setItem(key: string, value: string): void } };
    browser.sessionStorage.setItem(key, "off");
  }, FAULT_KEY);
  await page.reload();
  await expect(page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() })).toBeVisible();
});
