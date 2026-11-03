import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import type { FtcCaseRecord, ForeignIncomeSourceDraft, FrozenEvidenceReference } from "../shared/contracts.js";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "../shared/confirmations.js";
import { createEmptyDraft, createEmptySource } from "../shared/draft.js";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { partialRemittanceFixture, slideDiscrepancyFixture } from "../src/fixtures/domain.js";

function rowWithValue(sheet: ExcelJS.Worksheet, value: string): ExcelJS.Row | undefined {
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const values = row.values;
    if (Array.isArray(values) && values.slice(1).some((cell) => cell === value)) return row;
  }
  return undefined;
}

test("report workbook preserves the saved source, country, total, provenance, and evidence values", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-vietnam-china-case";
  const snapshotId = "excel-vietnam-china-snapshot";
  const draft = structuredClone(slideDiscrepancyFixture.draft);
  draft.id = caseId;
  draft.createdAt = now;
  draft.updatedAt = now;
  const evidence: FrozenEvidenceReference[] = [
    { id: "excel-thai-tax-file", sourceId: null, kind: "thai_tax", displayName: "หลักฐานภาษีไทย.pdf", mediaType: "application/pdf", byteSize: 4096, sha256: "a".repeat(64) },
    { id: "excel-vn-income-file", sourceId: "vn-salary", kind: "foreign_income", displayName: "หนังสือรับรองรายได้เวียดนาม.pdf", mediaType: "application/pdf", byteSize: 2048, sha256: "b".repeat(64) },
  ];
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence, createdAt: now });
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };

  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);
  const reportTimestamp = await page.locator(".report-meta > div").filter({ hasText: "ผลคำนวณบันทึกเมื่อ" }).locator("strong").innerText();

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const workbookPath = testInfo.outputPath("saved-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");
  expect(rowWithValue(sheet, "ผลคำนวณบันทึกเมื่อ")?.getCell(2).value).toBe(reportTimestamp);
  expect(rowWithValue(sheet, "หน่วยเงิน")?.getCell(2).value).toContain("ยอดเงินในตารางหลักแสดงเป็นบาท");
  expect(rowWithValue(sheet, "สรุปช่วงเวลาที่พำนัก")).toBeUndefined();

  const totalRow = rowWithValue(sheet, "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย");
  expect(Number(totalRow?.getCell(2).value)).toBe(143544.3);
  const countryHeading = rowWithValue(sheet, "เครดิตภาษีที่คำนวณได้ตามประเทศ");
  expect(countryHeading).toBeDefined();
  if (!countryHeading) throw new Error("The country worksheet section is missing.");
  const countryHeader = sheet.getRow(countryHeading.number + 1);
  expect(countryHeader.getCell(1).value).toBe("ประเทศ (M)");
  expect(countryHeader.getCell(5).value).toBe("เครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย (Q)");
  const sourceHeader = rowWithValue(sheet, "ปีภาษีที่เกิดเงินได้ (A)");
  expect((sheet.views[0] as { ySplit?: number } | undefined)?.ySplit).toBe(sourceHeader?.number);
  expect(sheet.autoFilter).toBe(`A${sourceHeader?.number}:I${(sourceHeader?.number ?? 0) + draft.sources.length}`);
  const vietnam = sheet.getRows(countryHeader.number + 1, sheet.rowCount - countryHeader.number - 1)
    ?.find((row) => row.getCell(1).value === "เวียดนาม");
  const china = sheet.getRows(countryHeader.number + 1, sheet.rowCount - countryHeader.number - 1)
    ?.find((row) => row.getCell(1).value === "จีน");
  expect(Number(vietnam?.getCell(4).value)).toBe(121044.3);
  expect(Number(china?.getCell(4).value)).toBe(36313.29);
  expect(Number(china?.getCell(5).value)).toBe(22500);

  const thaiTaxEvidence = rowWithValue(sheet, "หลักฐานภาษีไทย");
  const sourceEvidence = rowWithValue(sheet, "เวียดนาม · 40(1) เงินเดือนหรือค่าจ้าง");
  expect(thaiTaxEvidence).toBeDefined();
  expect(sourceEvidence).toBeDefined();
  expect(rowWithValue(sheet, "หลักฐานภาษีไทย.pdf")?.number).toBeGreaterThan(thaiTaxEvidence?.number ?? 0);
  expect(rowWithValue(sheet, "หนังสือรับรองรายได้เวียดนาม.pdf")?.number).toBeGreaterThan(sourceEvidence?.number ?? 0);
  expect(rowWithValue(sheet, slideDiscrepancyFixture.draft.thaiTax.provenance ?? "")?.number).toBeDefined();
});

test("partial-remittance workbook retains the saved 50 percent allocation and taxpayer notes as text", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-partial-case";
  const snapshotId = "excel-partial-snapshot";
  const draft = structuredClone(partialRemittanceFixture.draft);
  draft.id = caseId;
  draft.createdAt = now;
  draft.updatedAt = now;
  const note = '=HYPERLINK("https://example.invalid","note")';
  draft.sources[0]!.eligibilityRationale = note;
  draft.sources[0]!.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(draft.sources[0]!);
  draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("partial-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");

  const sourceRow = sheet.getRows(1, sheet.rowCount)?.find((row) => row.getCell(1).value === "จีน · 40(4) เงินปันผล");
  expect(Number(sourceRow?.getCell(9).value)).toBe(0.5);
  expect(sourceRow?.getCell(9).numFmt).toBe("0.00%");
  const countryHeading = rowWithValue(sheet, "เครดิตภาษีที่คำนวณได้ตามประเทศ");
  expect(countryHeading).toBeDefined();
  if (!countryHeading) throw new Error("The country worksheet section is missing.");
  const countryHeader = sheet.getRow(countryHeading.number + 1);
  const china = sheet.getRows(countryHeader.number + 1, sheet.rowCount - countryHeader.number - 1)
    ?.find((row) => row.getCell(1).value === "จีน");
  expect(Number(china?.getCell(3).value)).toBe(2500);
  const noteRow = rowWithValue(sheet, note);
  expect(noteRow?.getCell(3).value).toBe(note);
});

test("workbook H percentage preserves the report's rounded value for a non-terminating ratio", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-third-share-case";
  const snapshotId = "excel-third-share-snapshot";
  const draft = createEmptyDraft();
  draft.id = caseId;
  draft.taxYear = 2025;
  draft.domesticAssessableIncome = "0.00";
  draft.thaiTax = { amountBeforeFtc: "100.00", provenance: "ภาษีไทยที่ผู้ใช้ระบุ", confirmedAt: now, confirmedInputFingerprint: null };
  draft.revision = 1;
  draft.createdAt = now;
  draft.updatedAt = now;
  const source: ForeignIncomeSourceDraft = {
    ...createEmptySource(),
    id: "third-share-source", countryCode: "VN", countryName: "Vietnam", incomeType: "salary_40_1", subtype: "salary",
    earnedTaxYear: 2025, earnedDate: "2025-01-01", residenceDaysInEarnedYear: 365,
    inputMode: "worksheet_thb", grossIncomeAmount: "3.00", currencyCode: "THB",
    actualForeignTaxPaid: "0.30", eligibleForeignTax: "0.30", eligibilityRationale: "เหตุผลทดสอบอัตราส่วนหนึ่งในสาม",
    eligibilityConfirmedAt: now, eligibilityConfirmedInputFingerprint: null,
    remittance: { remittanceDate: "2025-01-01", transferTotalAmount: "1.00", transferCurrencyCode: "THB", transferTotalThb: null, classification: "income_only", classificationNote: null },
    remittedIncomeAmount: "1.00",
  };
  source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
  draft.sources = [source];
  draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  expect(snapshot.result.outcome).toBe("ready");
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);
  const sourceTable = page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" });
  await expect(sourceTable).toContainText("33.33%");

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("third-share-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");
  const sourceRow = sheet.getRows(1, sheet.rowCount)?.find((row) => row.getCell(1).value === "เวียดนาม · 40(1) เงินเดือนหรือค่าจ้าง");
  expect(sourceRow).toBeDefined();
  if (!sourceRow) throw new Error("The saved source worksheet row is missing.");
  expect(typeof sourceRow.getCell(9).value).toBe("number");
  expect(Number(sourceRow.getCell(9).value)).toBe(0.3333);
  expect(sourceRow.getCell(9).numFmt).toBe("0.00%");
});

test("FX provenance exports as exact text and only safe source URLs become readable hyperlinks", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-fx-case";
  const snapshotId = "excel-fx-snapshot";
  const draft = createEmptyDraft();
  draft.id = caseId;
  draft.taxYear = 2025;
  draft.domesticAssessableIncome = "0.00";
  draft.thaiTax = { amountBeforeFtc: "1000.00", provenance: "ภาษีไทยที่ผู้ใช้ระบุ", confirmedAt: now, confirmedInputFingerprint: null };
  draft.revision = 1;
  draft.createdAt = now;
  draft.updatedAt = now;
  const makeFxSource = (id: string, sourceUrl: string): ForeignIncomeSourceDraft => {
    const source: ForeignIncomeSourceDraft = {
      ...createEmptySource(),
      id, countryCode: "VN", countryName: "Vietnam", incomeType: "salary_40_1", subtype: "salary",
      earnedTaxYear: 2025, earnedDate: "2025-01-01", residenceDaysInEarnedYear: 365,
      inputMode: "original_currency", grossIncomeAmount: "100.00", currencyCode: "USD",
      actualForeignTaxPaid: "30.00", eligibleForeignTax: "20.00", eligibilityRationale: `เหตุผลที่ผู้ใช้ระบุ ${id}`,
      eligibilityConfirmedAt: now, eligibilityConfirmedInputFingerprint: null,
      remittance: { remittanceDate: "2025-01-01", transferTotalAmount: "100.00", transferCurrencyCode: "USD", transferTotalThb: null, classification: "income_only", classificationNote: null },
      remittedIncomeAmount: "100.00",
      fxReference: {
        currencyCode: "USD", thbRate: "35.12345678", baseUnits: 1, effectiveDate: "2025-01-01",
        rateType: "manual", sourceKind: "user_supplied", sourceLabel: `แหล่งที่ผู้ใช้ระบุ ${id}`,
        sourceUrl, educationalAssumption: `สมมติฐานที่ผู้ใช้ระบุ ${id}`,
      },
    };
    source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
    return source;
  };
  draft.sources = [
    makeFxSource("fx-safe-source", "https://fx.example.test/rate/2025-01-01"),
    makeFxSource("fx-unsafe-source", "javascript:alert(1)"),
  ];
  draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("fx-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");
  const rateRows = sheet.getRows(1, sheet.rowCount)?.filter((row) => row.getCell(2).value === "อัตราแลกเปลี่ยนที่ใช้");
  expect(rateRows?.[0]?.getCell(3).value).toBe("35.12345678 บาทต่อ 1 ดอลลาร์สหรัฐ (USD)");
  const links: Array<{ text: string; hyperlink: string }> = [];
  sheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (value && typeof value === "object" && "hyperlink" in value) links.push({ text: value.text, hyperlink: value.hyperlink });
  }));
  expect(links).toEqual([{ text: "แหล่งอัตราแลกเปลี่ยน", hyperlink: "https://fx.example.test/rate/2025-01-01" }]);
  const originalIncomeRow = sheet.getRows(1, sheet.rowCount)?.find((row) => row.getCell(2).value === "จำนวนเงินได้ในต่างประเทศ (D)");
  expect(originalIncomeRow?.getCell(3).numFmt).toBe("#,##0.00;[Red]-#,##0.00");
  const originalTaxRow = sheet.getRows(1, sheet.rowCount)?.find((row) => row.getCell(2).value === "จำนวนภาษีชำระในต่างประเทศ (E)");
  expect(originalTaxRow?.getCell(3).numFmt).toBe("#,##0.00;[Red]-#,##0.00");
  const actualPaidRow = sheet.getRows(1, sheet.rowCount)?.find((row) => row.getCell(2).value === "ภาษีที่ชำระทั้งหมดตามหลักฐาน");
  expect(actualPaidRow?.getCell(3).value).toBe(30);
  expect(actualPaidRow?.getCell(3).numFmt).toBe("#,##0.00;[Red]-#,##0.00");
  const safeNote = rowWithValue(sheet, "สมมติฐานที่ผู้ใช้ระบุ fx-safe-source");
  expect(safeNote?.getCell(3).value).toBe("สมมติฐานที่ผู้ใช้ระบุ fx-safe-source");
});

test("workbook preserves frozen residence periods and inclusive per-year day totals", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-residence-case";
  const snapshotId = "excel-residence-snapshot";
  const draft = structuredClone(slideDiscrepancyFixture.draft);
  draft.id = caseId;
  draft.createdAt = now;
  draft.updatedAt = now;
  draft.residencePeriods = [
    { startDate: "2024-12-31", endDate: "2025-01-02" },
    { startDate: "2025-01-02", endDate: "2025-06-29" },
  ];
  draft.sources = draft.sources.map((source) => {
    const confirmedSource = { ...source, residenceDaysInEarnedYear: 180 };
    return { ...confirmedSource, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(confirmedSource) };
  });
  draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("residence-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");

  expect(rowWithValue(sheet, "สรุปช่วงเวลาที่พำนัก")).toBeDefined();
  expect(rowWithValue(sheet, "ช่วงที่ 1")?.getCell(3).value).toBe("2024-12-31 – 2025-01-02");
  expect(rowWithValue(sheet, "ช่วงที่ 2")?.getCell(3).value).toBe("2025-01-02 – 2025-06-29");
  expect(rowWithValue(sheet, "ปี พ.ศ. 2567 (ค.ศ. 2024) · ปีปฏิทินในช่วงพำนัก")?.getCell(3).value).toBe("1 วัน · ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41");
  expect(rowWithValue(sheet, "ปี พ.ศ. 2568 (ค.ศ. 2025) · ปีที่เกิดเงินได้")?.getCell(3).value).toBe("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
  expect(rowWithValue(sheet, "ข้อสังเกตช่วงพำนัก")?.getCell(3).value).toBe("นับวันเริ่มต้นและวันสิ้นสุดรวมกัน และนับวันปฏิทินที่ซ้ำกันเพียงครั้งเดียว สรุปวันพำนักนี้แยกจากปีภาษีที่ใช้ยื่น และไม่ได้ยืนยันการรองรับการคำนวณ สิทธิ FTC หรือสิทธิตาม DTA");
  expect(Number(rowWithValue(sheet, "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย")?.getCell(2).value)).toBe(143544.3);
});

test("saved declaration-only residence stays explicitly unverified in the report and workbook", async ({ page }, testInfo) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "excel-declared-residence-case";
  const snapshotId = "excel-declared-residence-snapshot";
  const draft = structuredClone(partialRemittanceFixture.draft);
  draft.id = caseId;
  draft.createdAt = now;
  draft.updatedAt = now;
  draft.residenceYears = [{ earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days" }];
  draft.sources = draft.sources.map((source) => {
    const normalizedSource = { ...source, residenceDaysInEarnedYear: null };
    return { ...normalizedSource, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(normalizedSource) };
  });
  draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/reports/${snapshotId}`);

  const worksheetDetails = page.locator(".result-worksheet-details");
  if (await worksheetDetails.count()) await worksheetDetails.locator(":scope > summary").click();
  const summary = page.locator(".worksheet-residence-summary");
  await expect(summary).toContainText("2568 · ปีที่เกิดเงินได้");
  await expect(summary).toContainText("ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน · ยังไม่ผ่านการตรวจสอบ · ไม่มีจำนวนวันแน่นอน");
  await expect(summary).not.toContainText(/180 วัน · (?:ครบ|ต่ำกว่า)เกณฑ์/);
  await expect(page.locator(".worksheet-source-meta").first()).toContainText("ดูข้อมูลวันพำนักปี พ.ศ. 2568");

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadReady;
  const workbookPath = testInfo.outputPath("declared-residence-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The saved report workbook is missing its result worksheet.");
  expect(rowWithValue(sheet, "ปี พ.ศ. 2568 (ค.ศ. 2025) · ปีที่เกิดเงินได้")?.getCell(3).value)
    .toBe("ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน · ยังไม่ผ่านการตรวจสอบ · ไม่มีจำนวนวันแน่นอน");
  expect(rowWithValue(sheet, "ข้อสังเกตช่วงพำนัก")?.getCell(3).value)
    .toContain("นับวันแรกและวันสุดท้ายรวมกัน");
});
