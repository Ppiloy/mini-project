import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import type { FtcCaseRecord, FrozenEvidenceReference } from "../shared/contracts.js";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { countryLimitBelowFixture } from "../src/fixtures/domain.js";

test("legacy unknown country names remain visible in result evidence groups and Excel export", async ({ page }, testInfo) => {
  const now = "2026-11-03T00:00:00.000Z";
  const caseId = "legacy-unknown-country-case";
  const snapshotId = "legacy-unknown-country-preview";
  const draft = structuredClone(countryLimitBelowFixture.draft);
  draft.id = caseId;
  draft.createdAt = now;
  draft.updatedAt = now;
  const sourceId = draft.sources[0]!.id!;
  const evidence: FrozenEvidenceReference[] = [
    { id: "legacy-income-evidence", sourceId, kind: "foreign_income", displayName: "legacy-income.pdf", mediaType: "application/pdf", byteSize: 100, sha256: "a".repeat(64) },
  ];
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence, createdAt: now });
  const legacyDraft = structuredClone(draft);
  legacyDraft.sources[0]!.countryCode = "XX";
  legacyDraft.sources[0]!.countryName = "ประเทศอื่น";
  snapshot.inputs = structuredClone(legacyDraft);
  snapshot.result.countries[0]!.countryCode = "XX";
  snapshot.result.countries[0]!.countryName = "ประเทศอื่น";
  const record: FtcCaseRecord = {
    id: caseId, ownerId: "demo-taxpayer", status: "draft", draft: legacyDraft, assignedOfficerId: null,
    submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };

  await page.addInitScript(({ savedSnapshot, caseRecord }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseRecord], snapshots: [savedSnapshot], attachments: [] }));
  }, { savedSnapshot: snapshot, caseRecord: record });
  await page.goto(`/demo/cases/${caseId}/result?preview=${snapshotId}`);

  const countryLabel = "ประเทศอื่น (XX) · ไม่พบในรายชื่อ DTA ที่รองรับ";
  const evidenceRow = page.locator(".submission-available-inventory li").filter({ hasText: "legacy-income.pdf" });
  await expect(evidenceRow).toContainText(countryLabel);
  const missingEvidenceRow = page.locator(".missing-evidence-groups li").filter({ hasText: countryLabel });
  await expect(missingEvidenceRow).toContainText("หลักฐานภาษีต่างประเทศ");
  await expect(missingEvidenceRow).toContainText("หลักฐานการนำเงินเข้าไทย");

  await page.getByRole("link", { name: "ดูรายงาน", exact: true }).click();
  await expect(page.getByRole("table", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toContainText(countryLabel);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  const download = await downloadPromise;
  const workbookPath = testInfo.outputPath("legacy-country-report.xlsx");
  await mkdir(dirname(workbookPath), { recursive: true });
  await download.saveAs(workbookPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet("ผลคำนวณ");
  expect(sheet).toBeDefined();
  if (!sheet) throw new Error("The legacy report workbook is missing its result worksheet.");
  const values: string[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))));
  expect(values).toContain(countryLabel);
});
