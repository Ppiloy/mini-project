import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createEmptyDraft, createEmptySource } from "../shared/draft.js";
import { createCalculationSnapshot } from "../shared/snapshot.js";

async function enterVietnamChinaResult(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่างเวียดนามและจีน · 143,544.30" }).click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  }
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
}

async function advanceToReview(page: import("@playwright/test").Page) {
  const headings = ["แหล่งเงินได้จากต่างประเทศ", "การนำเงินเข้าและภาษีต่างประเทศ", "เงินได้ในประเทศและภาษีไทย", "หลักฐานและตรวจทาน"];
  for (const heading of headings) {
    await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
}

test("taxpayer result presents the Vietnam–China calculation as the canonical A–Q worksheet", async ({ page }, testInfo) => {
  await enterVietnamChinaResult(page);
  await expect(page.getByText(/ผลคำนวณนี้บันทึกไว้เมื่อ/)).toBeVisible();
  await expect(page.getByText(/ยังไม่ได้ยื่นแบบภาษีต่อกรมสรรพากร/)).toBeVisible();
  await expect(page.getByRole("link", { name: "ดูรายงาน" })).toBeVisible();
  await expect(page.getByRole("button", { name: "แก้ไขข้อมูล" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  const sourceTable = page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" });
  for (const label of [
    "(A) - ปีภาษีที่เกิดเงินได้",
    "(B) - ประเทศแหล่งเงินได้",
    "(C) - ประเภทเงินได้",
    "(D) - จำนวนเงินได้ในต่างประเทศ",
    "(E) - จำนวนภาษีชำระในต่างประเทศ",
    "(F) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ",
    "(G) - จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ",
    "(H) - สัดส่วนเงินได้ต่างประเทศที่นำเข้ามา",
  ]) await expect(sourceTable.getByText(label, { exact: true })).toBeVisible();

  for (const label of [
    "(I) - เงินได้พึงประเมินในต่างประเทศที่นำเข้ามา",
    "(J) - เงินได้พึงประเมินในประเทศไทย",
    "(K) - เงินได้พึงประเมินรวมจากทุกแหล่งเงินได้",
    "(L) - ภาษีที่ต้องชำระในประเทศไทย",
    "(M) - ประเทศ",
    "(N) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ (แยกตามประเทศ)",
    "(O) - จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้ที่นำเข้ามา (แยกตามประเทศ)",
    "(P) - เครดิตภาษีที่คำนวณได้ (คำนวณเพดานเครดิตภาษี)",
    "(Q) - เครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย",
  ]) await expect((label.startsWith("(M)") || label.startsWith("(N)") || label.startsWith("(O)") || label.startsWith("(P)") || label.startsWith("(Q)"))
    ? page.getByRole("table", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" }).getByText(label, { exact: true })
    : page.getByRole("region", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" }).getByText(label, { exact: true })).toBeVisible();

  const summaryTable = page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" });
  await expect(summaryTable.getByRole("row")).toHaveCount(4);
  await expect(summaryTable.getByRole("row").filter({ hasText: "(L) - ภาษีที่ต้องชำระในประเทศไทย" })).toContainText("318,750.00 บาท");

  const total = page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" });
  await expect(total).toContainText("143,544.30 บาท");
  const countries = page.getByRole("region", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" });
  const vietnam = countries.getByRole("table", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" }).getByRole("row").filter({ hasText: "เวียดนาม" });
  const china = countries.getByRole("table", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" }).getByRole("row").filter({ hasText: "จีน" });
  await expect(vietnam).toContainText("121,044.30");
  await expect(china).toContainText("36,313.29");
  await expect(china).toContainText("22,500.00");

  const desktopShot = testInfo.outputPath("worksheet-desktop.png");
  await page.screenshot({ path: desktopShot, fullPage: true });
  await testInfo.attach("worksheet-desktop", { path: desktopShot, contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileShot = testInfo.outputPath("worksheet-mobile.png");
  await page.screenshot({ path: mobileShot, fullPage: true });
  await testInfo.attach("worksheet-mobile", { path: mobileShot, contentType: "image/png" });
});

test("a missing earned-income year stays blank instead of borrowing the calculation year", async ({ page }) => {
  const now = "2026-11-02T00:00:00.000Z";
  const caseId = "missing-earned-year-case";
  const snapshotId = "missing-earned-year-preview";
  const draft = createEmptyDraft();
  draft.id = caseId;
  draft.taxYear = 2025;
  draft.domesticAssessableIncome = "0.00";
  draft.thaiTax = { amountBeforeFtc: "100000.00", provenance: "ภาษีไทยที่ระบุสำหรับตัวอย่าง", confirmedAt: null, confirmedInputFingerprint: null };
  draft.revision = 1;
  draft.createdAt = now;
  draft.updatedAt = now;
  draft.sources = [{
    ...createEmptySource(),
    id: "source-without-earned-year",
    countryCode: "CN",
    countryName: "China",
    incomeType: "dividend_40_4",
    subtype: "dividend",
    earnedTaxYear: null,
    earnedDate: "2025-01-01",
    residenceDaysInEarnedYear: 365,
    inputMode: "worksheet_thb",
    grossIncomeAmount: "50000.00",
    currencyCode: "THB",
    grossIncomeThb: "50000.00",
    actualForeignTaxPaid: "5000.00",
    actualForeignTaxPaidThb: "5000.00",
    eligibleForeignTax: "5000.00",
    eligibleForeignTaxThb: "5000.00",
    remittance: { remittanceDate: "2025-01-01", transferTotalAmount: "25000.00", transferCurrencyCode: "THB", transferTotalThb: "25000.00", classification: "income_only", classificationNote: null },
    remittedIncomeAmount: "25000.00",
    remittedIncomeThb: "25000.00",
    evidenceChecklist: ["foreign_income", "foreign_tax", "remittance"],
  }];
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record = { id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null, submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });

  await page.goto(`/demo/cases/${caseId}/result?preview=${snapshotId}`);
  const sourceTable = page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" });
  await expect(sourceTable.locator(".worksheet-source-values").getByRole("cell").first()).toHaveText("—");
});

test("printable report uses the same Thai A–Q worksheet for the saved calculation", async ({ page }, testInfo) => {
  await enterVietnamChinaResult(page);
  await page.getByRole("link", { name: "ดูรายงาน" }).click();

  await expect(page.getByRole("heading", { name: "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "กลับไปหน้ารายการ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "พิมพ์ / บันทึกเป็น PDF" })).toBeVisible();
  await expect(page.getByText("เลขอ้างอิง", { exact: true })).toBeVisible();
  await expect(page.getByText(/เวลาที่แสดงคือเวลาบันทึกผลคำนวณ ไม่ใช่เวลายื่นแบบภาษีต่อกรมสรรพากร/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง", { exact: true })).toBeVisible();
  const countryTable = page.getByRole("table", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" });
  await expect(countryTable.getByRole("row").filter({ hasText: "เวียดนาม" })).toContainText("121,044.30");
  await expect(countryTable.getByRole("row").filter({ hasText: "จีน" })).toContainText("22,500.00");
  await expect(page.getByText("rd-ftc-demo-2568-v1", { exact: false })).toHaveCount(0);

  const formulaDetails = page.locator(".worksheet-formulas");
  await expect(formulaDetails).not.toHaveAttribute("open", "");
  await page.emulateMedia({ media: "print" });
  await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
  await expect(formulaDetails).toHaveAttribute("open", "");
  await expect(formulaDetails.locator("summary")).toBeHidden();
  await expect(page.getByText("วิธีคำนวณและการจัดสรร", { exact: true })).toBeVisible();
  await expect(formulaDetails).toContainText("แบ่งจำนวนภาษีใน (E)");
  const printShot = testInfo.outputPath("worksheet-print.png");
  await page.screenshot({ path: printShot, fullPage: true });
  await testInfo.attach("worksheet-print", { path: printShot, contentType: "image/png" });
  await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
  await expect(formulaDetails).not.toHaveAttribute("open", "");
  await page.emulateMedia({ media: "screen" });
  await expect(formulaDetails.locator("summary")).toBeVisible();
  await page.evaluate("document.fonts.ready");
  const pdfPath = resolve(process.cwd(), "tmp/pdfs/ftc-worksheet-qa.pdf");
  await mkdir(dirname(pdfPath), { recursive: true });
  await page.emulateMedia({ media: "print" });
  await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
  await expect(formulaDetails).not.toHaveAttribute("open", "");
  await page.emulateMedia({ media: "screen" });
  await testInfo.attach("worksheet-a4-pdf", { path: pdfPath, contentType: "application/pdf" });
});

test("officer detail reuses the worksheet and groups frozen evidence by source and Thai tax", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);

  const file = { name: "หลักฐานตัวอย่าง.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture evidence preview") };
  for (const label of [
    "แนบหลักฐานภาษีไทย",
    "แนบ: หลักฐานเงินได้ต่างประเทศ",
    "แนบ: หลักฐานภาษีที่ชำระในต่างประเทศ",
    "แนบ: หลักฐานการนำเงินเข้าไทย",
  ]) await page.getByLabel(label).setInputFiles(file);

  await page.getByLabel("ยืนยันจำนวนและที่มาของภาษีไทย L").check();
  await page.getByLabel("ยืนยัน E และเหตุผล · แหล่งเงินได้ 1").check();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();

  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะเจ้าหน้าที่" }).click();
  await page.getByRole("link", { name: "ตรวจทานแบบอ่านอย่างเดียว" }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  const sourceTable = page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" });
  await expect(sourceTable.getByText("50.00%", { exact: true })).toBeVisible();
  await expect(sourceTable.getByText("เหตุผลของ (E) ที่ผู้ใช้ระบุ:", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" })).toContainText("ก่อนใช้เครดิตภาษีต่างประเทศ");
  const evidence = page.getByRole("region", { name: "เอกสารประกอบที่บันทึกกับผลนี้" });
  await expect(page.getByRole("link", { name: "ดูรายงาน" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "กลับไปหน้ารายการ" })).toBeVisible();
  await expect(evidence.getByRole("heading", { name: "หลักฐานภาษีไทย" })).toBeVisible();
  await expect(evidence.getByRole("heading", { name: /จีน.*เงินปันผล/ })).toBeVisible();
  await expect(evidence.getByText("หลักฐานตัวอย่าง.pdf", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("cell", { name: "เปิดดูกรณี" })).toBeVisible();
});
