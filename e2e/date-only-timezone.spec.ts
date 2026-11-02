import { expect, test } from "@playwright/test";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { partialRemittanceFixture } from "../src/fixtures/index.js";

test.use({ timezoneId: "America/New_York" });

test("report date-only facts keep their saved calendar day while timestamps remain local", async ({ page }) => {
  const inputs = structuredClone(partialRemittanceFixture.draft);
  const source = inputs.sources[0];
  if (!source || !source.remittance) throw new Error("The report fixture requires a source and remittance date.");
  source.earnedDate = "2025-01-01";
  source.remittance = { ...source.remittance, remittanceDate: "2025-01-01" };

  const snapshot = createCalculationSnapshot({
    id: "date-only-timezone",
    caseId: "date-only-timezone-case",
    revision: inputs.revision,
    kind: "preview",
    inputs,
    evidence: [],
    createdAt: "2025-01-01T02:30:00.000Z",
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      data: {
        user: { id: "date-viewer", loginName: "viewer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null },
        csrfToken: "date-viewer-csrf",
      },
      requestId: "session",
    },
  }));
  await page.route("**/api/snapshots/date-only-timezone", (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));

  await page.goto("/reports/date-only-timezone");
  const sourceCard = page.locator(".worksheet-source-card").first();
  await expect(sourceCard).toContainText("วันที่เกิดเงินได้: 1 ม.ค. 2568");
  await expect(sourceCard).toContainText("วันที่นำเข้าไทย: 1 ม.ค. 2568");

  const savedAt = page.locator(".report-meta > div").filter({ hasText: "ผลคำนวณบันทึกเมื่อ" });
  await expect(savedAt).toContainText("31 ธ.ค. 2567");
  await expect(savedAt).toContainText("21:30");
});
