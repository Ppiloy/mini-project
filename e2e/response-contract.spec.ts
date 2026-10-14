import { expect, test } from "@playwright/test";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { createEmptyDraft, createEmptySource } from "../shared/draft.js";

test("a malformed hosted success response shows a recoverable error and support identifiers", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      data: { user: { id: "taxpayer-response", loginName: "taxpayer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null }, csrfToken: "csrf-token" },
      requestId: "session-ok",
    },
  }));
  await page.route("**/api/cases", (route) => route.fulfill({
    json: { data: { cases: [{}] }, requestId: "malformed-cases-request" },
  }));

  await page.goto("/app");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("ระบบส่งข้อมูลกลับมาไม่ครบ");
  await expect(alert).toContainText("malformed-cases-request");
  await expect(alert).toContainText("rd-ftc-demo-2568-v1");
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
});

test("printable reports retain the frozen manual FX URL and assumption", async ({ page }) => {
  const now = "2026-10-14T00:00:00.000Z";
  const caseId = "report-fx-case";
  const snapshotId = "report-fx-snapshot";
  const draft = createEmptyDraft();
  draft.id = caseId;
  draft.taxYear = 2025;
  draft.domesticAssessableIncome = "0.00";
  draft.thaiTax = { amountBeforeFtc: "100.00", provenance: "Test source", confirmedAt: now, confirmedInputFingerprint: "test" };
  draft.revision = 4;
  draft.createdAt = now;
  draft.updatedAt = now;
  const source = createEmptySource();
  source.fxReference = {
    currencyCode: "USD", thbRate: "35.00", baseUnits: 1, effectiveDate: "2025-01-01",
    rateType: "manual", sourceKind: "user_supplied", sourceLabel: "Manual source for this frozen report",
    sourceUrl: "https://fx.example.test/rate/2025-01-01",
    educationalAssumption: "Entered manually for the educational example; not a verified historical rate.",
  };
  draft.sources = [source];
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [], createdAt: now });
  const record = { id: caseId, ownerId: "demo-taxpayer", status: "draft", draft, assignedOfficerId: null, submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now };
  await page.addInitScript(({ store, caseKey }) => {
    sessionStorage.setItem("ftc.demo.persona", "taxpayer");
    localStorage.setItem("ftc.prototype.fixture.v1", JSON.stringify({ cases: [caseKey], snapshots: [store], attachments: [] }));
  }, { store: snapshot, caseKey: record });

  await page.goto(`/demo/reports/${snapshotId}`);

  await expect(page.getByText("Entered manually for the educational example; not a verified historical rate.")).toBeVisible();
  const sourceLink = page.getByRole("link", { name: "https://fx.example.test/rate/2025-01-01" });
  await expect(sourceLink).toHaveAttribute("href", "https://fx.example.test/rate/2025-01-01");
});
