import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "ถัดไป" }).click();
  }
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
}

async function verifyDownload(
  page: import("@playwright/test").Page,
  row: import("@playwright/test").Locator,
  name: string,
  bytes: Buffer,
  targetPath: string,
) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "ดาวน์โหลด", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(name);
  await download.saveAs(targetPath);
  expect(await readFile(targetPath)).toEqual(bytes);
}

test("guest evidence previews and downloads the original file after reload", async ({ page }, testInfo) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);

  const name = "หลักฐานรายได้.pdf";
  const bytes = await readFile(new URL("../server/fixtures/fictional-preview-evidence.pdf", import.meta.url));
  const imageName = "หลักฐานประกอบ.png";
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm3kAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("แนบ: หลักฐานเงินได้").setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
  await page.getByLabel("แนบ: หลักฐานเงินได้").setInputFiles({ name: imageName, mimeType: "image/png", buffer: imageBytes });
  let row = page.locator(".file-list li").filter({ hasText: name });

  await expect(row.getByRole("button", { name: "ดูตัวอย่าง", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "ดูตัวอย่าง", exact: true }).click();
  const preview = page.getByRole("dialog", { name: `ตัวอย่าง: ${name}` });
  await expect(preview).toBeVisible();
  await expect(preview.locator("iframe")).toBeVisible();
  const pdfPreviewScreenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach("evidence-pdf-preview", { body: pdfPreviewScreenshot, contentType: "image/png" });
  await preview.getByRole("button", { name: "ปิดตัวอย่าง" }).click();

  await verifyDownload(page, row, name, bytes, testInfo.outputPath("taxpayer-evidence.pdf"));
  const imageRow = page.locator(".file-list li").filter({ hasText: imageName });
  await imageRow.getByRole("button", { name: "ดูตัวอย่าง", exact: true }).click();
  const imagePreview = page.getByRole("dialog", { name: `ตัวอย่าง: ${imageName}` });
  await expect(imagePreview.getByRole("img", { name: `ตัวอย่างไฟล์: ${imageName}` })).toBeVisible();
  await imagePreview.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  await verifyDownload(page, imageRow, imageName, imageBytes, testInfo.outputPath("taxpayer-image.png"));

  await page.reload();
  await advanceToReview(page);
  row = page.locator(".file-list li").filter({ hasText: name });
  const reloadedImageRow = page.locator(".file-list li").filter({ hasText: imageName });
  await expect(row).toBeVisible();
  await verifyDownload(page, row, name, bytes, testInfo.outputPath("reloaded-evidence.pdf"));
  await verifyDownload(page, reloadedImageRow, imageName, imageBytes, testInfo.outputPath("reloaded-image.png"));
  await reloadedImageRow.getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(reloadedImageRow).toHaveCount(0);

  for (const [label, filename] of [
    ["แนบหลักฐานภาษีไทย", "thai-tax.pdf"],
    ["แนบ: หลักฐานภาษีต่างประเทศ", "foreign-tax.pdf"],
    ["แนบ: หลักฐานการนำเงินเข้าไทย", "remittance.pdf"],
  ] as const) {
    await page.getByLabel(label).setInputFiles({ name: filename, mimeType: "application/pdf", buffer: bytes });
  }
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);
});

test("guest editor detects missing browser evidence bytes", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  const bytes = await readFile(new URL("../server/fixtures/fictional-preview-evidence.pdf", import.meta.url));
  for (const [label, name] of [
    ["แนบหลักฐานภาษีไทย", "thai-tax.pdf"],
    ["แนบ: หลักฐานเงินได้", "foreign-income.pdf"],
    ["แนบ: หลักฐานภาษีต่างประเทศ", "foreign-tax.pdf"],
    ["แนบ: หลักฐานการนำเงินเข้าไทย", "remittance.pdf"],
  ] as const) {
    await page.getByLabel(label).setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
  }
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  const caseId = new URL(page.url()).pathname.split("/")[3]!;

  await page.evaluate(`(async () => {
    const databases = await indexedDB.databases();
    const names = databases.map((database) => database.name).filter(Boolean);
    await Promise.all(names.map((name) => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB deletion was blocked"));
    })));
  })()`);

  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);

  await page.goto(`/demo/cases/${caseId}/edit`);
  await advanceToReview(page);
  const missingRow = page.locator(".file-list li").filter({ hasText: "foreign-income.pdf" });
  await expect(missingRow.getByText("ไฟล์ต้นฉบับไม่พร้อมใช้งาน")).toBeVisible();
  await expect(missingRow.getByRole("button", { name: "ดูตัวอย่าง", exact: true })).toBeDisabled();
  await expect(missingRow.getByRole("button", { name: "ดาวน์โหลด", exact: true })).toBeDisabled();
});
