import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const educationalNotice = "ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
}

async function printReport(page: import("@playwright/test").Page, name: string) {
  const pdfPath = resolve(process.cwd(), `tmp/pdfs/${name}.pdf`);
  const screenshotPath = resolve(process.cwd(), `tmp/pdfs/${name}-print.png`);
  await mkdir(dirname(pdfPath), { recursive: true });
  await expect(page.locator(".site-footer")).toContainText(educationalNotice);
  await expect(page.locator(".report-footer")).toBeHidden();
  await expect(page.locator(".worksheet-evidence-empty h2")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".site-footer")).toBeHidden();
  await expect(page.locator(".report-footer")).toBeVisible();
  await expect(page.locator(".report-footer")).toHaveText(educationalNotice);
  await expect(page.locator(".worksheet-evidence-empty h2")).toBeHidden();
  await expect(page.locator(".worksheet-evidence-empty .empty-evidence")).toBeVisible();
  await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const pdf = await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
  expect(pdf.byteLength).toBeGreaterThan(5_000);
  return { pdfPath, screenshotPath };
}

test("four-source report without saved residence periods keeps its legacy shape", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  await expect(page.getByRole("heading", { name: "ช่วงเวลาที่พำนักในประเทศไทย" })).toBeVisible();
  await expect(page.getByText("ยังไม่มีช่วงเวลาที่บันทึกไว้ในร่างนี้")).toBeVisible();
  await advanceToReview(page);
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.locator(".worksheet-source-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "สรุปช่วงเวลาที่พำนัก" })).toHaveCount(0);

  const snapshotId = new URL(page.url()).searchParams.get("preview");
  if (!snapshotId) throw new Error("The demo calculation did not expose its saved snapshot.");
  await page.goto(`/demo/reports/${snapshotId}`);
  await expect(page.locator(".worksheet-source-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "สรุปช่วงเวลาที่พำนัก" })).toHaveCount(0);
  await printReport(page, "ftc-four-source-no-residence-periods");
});

test("saved inclusive residence periods show frozen annual totals in result and report PDFs", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2024-12-15");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-06-30");
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 2").fill("2025-06-30");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 2").fill("2025-07-03");
  await advanceToReview(page);
  await page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีไทยก่อนเครดิต (L)", exact: false }).check();
  for (let source = 1; source <= 4; source += 1) {
    await page.getByRole("checkbox", { name: `ยืนยันจำนวนภาษีต่างประเทศ (E) · แหล่งเงินได้ ${source}`, exact: false }).check();
  }
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);

  const worksheetDetails = page.locator(".result-worksheet-details");
  await expect(worksheetDetails).not.toHaveAttribute("open", "");
  await worksheetDetails.locator(":scope > summary").click();
  const summary = page.getByRole("region", { name: "สรุปช่วงเวลาที่พำนัก" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("2024-12-15 – 2025-06-30");
  await expect(summary).toContainText("2025-06-30 – 2025-07-03");
  await expect(summary).toContainText("พ.ศ. 2567 (ค.ศ. 2024)");
  await expect(summary).toContainText("17 วัน · ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41");
  await expect(summary).toContainText("พ.ศ. 2568 (ค.ศ. 2025)");
  await expect(summary).toContainText("184 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
  await expect(summary).toContainText("แยกจากปีภาษีที่ใช้ยื่น");

  const snapshotId = new URL(page.url()).searchParams.get("preview");
  if (!snapshotId) throw new Error("The period-enabled calculation did not expose its saved snapshot.");
  await page.goto(`/demo/reports/${snapshotId}`);
  await expect(page.getByRole("region", { name: "สรุปช่วงเวลาที่พำนัก" })).toContainText("184 วัน");
  await page.reload();
  await expect(page.getByRole("region", { name: "สรุปช่วงเวลาที่พำนัก" })).toContainText("2024-12-15 – 2025-06-30");
  await printReport(page, "ftc-residence-periods");
});
