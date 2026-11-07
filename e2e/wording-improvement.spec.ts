import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEMO_ENTRY_LABEL, EDUCATIONAL_NOTICE } from "../shared/labels.js";

async function capture(page: import("@playwright/test").Page, testInfo: import("@playwright/test").TestInfo, name: string) {
  await page.evaluate("document.querySelector('.skip-link')?.blur(); document.activeElement?.blur()");
  await page.addStyleTag({ content: ".skip-link { visibility: hidden !important; }" });
  const path = resolve("tmp/wording-review", name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("demo entry names the browser-local mode and the form leads with Thai field names", async ({ page }, testInfo) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: DEMO_ENTRY_LABEL, exact: true })).toBeVisible();
  await expect(page.getByText("ร่างและไฟล์แนบเก็บเฉพาะในเบราว์เซอร์และอุปกรณ์นี้ ผู้ใช้อุปกรณ์เดียวกันอาจเข้าถึงได้", { exact: true })).toBeVisible();
  await expect(page.getByText(EDUCATIONAL_NOTICE, { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await expect(page.getByText("ร่างโดยไม่เข้าสู่ระบบ · เก็บในเบราว์เซอร์นี้", { exact: true })).toBeVisible();
  await expect(page.getByText(EDUCATIONAL_NOTICE, { exact: true })).toHaveCount(1);
  await expect(page.getByText("ข้อมูลตัวอย่างบันทึกไว้ในเบราว์เซอร์นี้เท่านั้นและไม่เชื่อมกับบัญชีออนไลน์", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, testInfo, "demo-dashboard-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("ร่างโดยไม่เข้าสู่ระบบ · เก็บในเบราว์เซอร์นี้", { exact: true })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "demo-dashboard-mobile.png");
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.locator(".dashboard-heading").getByRole("button", { name: /เริ่มคำนวณใหม่/ }).click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก ปี พ\.ศ\. 2568/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await page.locator(".step-section-head").getByRole("button", { name: /เพิ่มแหล่งเงินได้/ }).click();
  await expect(page.getByText("จำนวนเงินได้ในต่างประเทศ", { exact: true })).toBeVisible();
  await expect(page.getByText("(D)", { exact: true })).toBeVisible();

  const source = page.locator(".source-card").first();
  await source.locator("#source-0-countryCode").fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await source.locator("#source-0-incomeType").selectOption("40_1");
  await source.locator("#source-0-earnedDate").fill("2025-01-01");
  await source.locator("#source-0-inputMode").selectOption("worksheet_thb");
  await source.locator("#source-0-grossIncomeAmount").fill("2250000.00");
  await source.locator("#source-0-actualForeignTaxPaid").fill("500000.00");
  await source.locator("#source-0-remittedIncomeAmount").fill("1250000.00");
  await source.locator("#source-0-remittance-remittanceDate").fill("2025-01-01");
  await capture(page, testInfo, "ordinary-entry-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "ordinary-entry-mobile.png");

  await page.setViewportSize({ width: 1280, height: 900 });
  await source.locator("#source-0-inputMode").selectOption("original_currency");
  await page.getByRole("alertdialog", { name: /ยืนยันการเปลี่ยนรูปแบบการกรอก/ })
    .getByRole("button", { name: "เปลี่ยนและล้างข้อมูล", exact: true }).click();
  await source.locator("#source-0-grossIncomeAmount").fill("100000.00");
  await source.locator("#source-0-actualForeignTaxPaid").fill("20000.00");
  await source.locator("#source-0-remittedIncomeAmount").fill("50000.00");
  await source.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true }).fill("36.25");
  await expect(source.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toHaveValue("36.25");
  await capture(page, testInfo, "manual-fx-entry-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "manual-fx-entry-mobile.png");
});

test("result and report use the same clear local-mode wording", async ({ page }, testInfo) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  for (const heading of [
    "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ",
    "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี",
    "เครดิตภาษีที่คำนวณได้ตามประเทศ",
    "หลักฐานและตรวจทาน",
  ]) {
    await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByText("ร่างโดยไม่เข้าสู่ระบบ · เก็บในเบราว์เซอร์นี้", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, testInfo, "result-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "result-mobile.png");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "ดูรายงาน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("ร่างโดยไม่เข้าสู่ระบบ · เก็บในเบราว์เซอร์นี้", { exact: true })).toBeVisible();
  await capture(page, testInfo, "report-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "report-mobile.png");
});

test("saved legacy FX quote and translated details remain visible after reload", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  const legacyRate = {
    currencyCode: "USD",
    thbRate: "3500.00000000",
    baseUnits: 100,
    effectiveDate: "2025-01-01",
    rateType: "fixture",
    sourceKind: "fixture",
    sourceLabel: "Synthetic educational FX value",
    sourceUrl: null,
    educationalAssumption: "Deliberately synthetic quote to demonstrate conversion per 100 units; not a historical market rate.",
  };
  await page.evaluate(({ targetCaseId, reference }) => {
    const key = "ftc.prototype.fixture.v1";
    const data = JSON.parse(localStorage.getItem(key) || "null");
    const record = data.cases.find((item: { id: string }) => item.id === targetCaseId);
    const source = record.draft.sources[0];
    source.inputMode = "original_currency";
    source.currencyCode = "USD";
    source.fxReference = reference;
    localStorage.setItem(key, JSON.stringify(data));
  }, { targetCaseId: caseId, reference: legacyRate });
  await page.goto(`/demo/cases/${encodeURIComponent(caseId)}/edit`);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const legacy = page.locator(".manual-fx-legacy");
  const expectReadableLegacyQuote = async () => {
    await expect(legacy).toContainText("100 USD = 3500.00000000 บาท · วันที่ใช้แปลง 2025-01-01");
    await legacy.locator("details > summary").click();
    await expect(legacy).toContainText("อัตราที่กำหนดไว้ในตัวอย่าง");
    await expect(legacy).toContainText("ตัวอย่างเพื่อการศึกษา");
    await expect(legacy).toContainText("Synthetic educational FX value");
    await expect(legacy).toContainText("วันที่ใช้แปลง 2025-01-01");
    await expect(legacy).toContainText("อัตราสมมติในตัวอย่างเพื่อสาธิตการแปลงต่อ 100 หน่วย ไม่ใช่อัตราตลาดย้อนหลัง");
    await expect(legacy).not.toContainText("fixture");
    await expect(legacy).not.toContainText("Deliberately synthetic quote");
  };
  await expectReadableLegacyQuote();

  await page.getByRole("button", { name: "บันทึกร่าง", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expectReadableLegacyQuote();
});
