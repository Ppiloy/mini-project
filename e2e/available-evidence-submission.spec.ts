import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const statement = "ฉันยืนยันว่าได้แนบเอกสารที่มีอยู่ในขณะนี้แล้ว และรับทราบว่าเจ้าหน้าที่อาจขอเอกสารเพิ่มเติม";

async function captureCleanScreenshot(page: import("@playwright/test").Page, path: string) {
  await page.evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await page.screenshot({ path, fullPage: true });
}

test("a zero-file guest case stays a draft without a submission declaration", async ({ page }, testInfo) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await expect(page.locator(".file-list li")).toHaveCount(0);
  await expect(page.locator(".evidence-checklist")).toHaveCount(0);
  await expect(page.getByText(/ยังไม่มีไฟล์พร้อมใช้งานสำหรับ/).first()).toBeVisible();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);

  await expect(page.getByRole("checkbox", { name: statement, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ", exact: true })).toHaveCount(0);
  await captureCleanScreenshot(page, testInfo.outputPath("guest-zero-file-result.png"));
  await page.reload();
  await page.locator("details.result-worksheet-details > summary").click();
  await expect(page.getByText("ไม่มีไฟล์แนบในผลคำนวณที่บันทึกไว้นี้")).toBeVisible();
});

test("a guest report exports available evidence filenames without a submission declaration", async ({ page }, testInfo) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("แนบ: หลักฐานเงินได้").setInputFiles({
    name: "available-income.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\navailable source proof\n%%EOF", "ascii"),
  });
  await expect(page.getByText("available-income.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ", exact: true })).toHaveCount(0);
  await page.locator("details.result-worksheet-details > summary").click();
  await expect(page.getByText("available-income.pdf", { exact: true })).toBeVisible();
  await captureCleanScreenshot(page, testInfo.outputPath("guest-available-evidence.png"));
  await page.getByRole("link", { name: "ดูรายงาน", exact: true }).click();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("submitted-available-evidence.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.getWorksheet("ผลคำนวณ");
  expect(worksheet).toBeDefined();
  const values: string[] = [];
  worksheet!.eachRow((row) => row.eachCell((cell) => values.push(String(cell.text ?? cell.value ?? ""))));
  const exportedText = values.join("\n");
  expect(exportedText).not.toContain(statement);
  expect(exportedText).toContain("available-income.pdf");
  expect(exportedText).toContain("หมวดที่ยังไม่มีไฟล์พร้อมใช้งาน");
  for (const kind of ["หลักฐานภาษีไทย", "หลักฐานภาษีต่างประเทศ", "หลักฐานการนำเงินเข้าไทย"]) {
    expect(exportedText).toContain(kind);
  }
});
