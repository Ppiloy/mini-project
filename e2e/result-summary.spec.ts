import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { taxInputFingerprint } from "../shared/confirmations.js";
import { apiSuccessSchemas } from "../shared/contracts.js";
import { DEMO_POLICY } from "../shared/policy.js";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { countryLimitBelowFixture, roundingBoundaryFixture, slideDiscrepancyFixture } from "../src/fixtures/index.js";

const hostedUser = { id: "result-summary-taxpayer", loginName: "taxpayer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null } as const;
const hostedCsrf = "result-summary-csrf";
const hostedCaseId = "result-summary-case";
const timestamp = "2026-11-02T00:00:00.000Z";

function makeSnapshot(id: string, draftInput: typeof slideDiscrepancyFixture.draft) {
  const inputs = structuredClone(draftInput);
  inputs.id = hostedCaseId;
  return createCalculationSnapshot({
    id,
    caseId: hostedCaseId,
    revision: inputs.revision,
    kind: "preview",
    inputs,
    evidence: [],
    createdAt: timestamp,
  });
}

async function openHostedResult(
  page: import("@playwright/test").Page,
  snapshot: ReturnType<typeof createCalculationSnapshot>,
  currentRevision = snapshot.revision,
) {
  const validated = apiSuccessSchemas.snapshot.safeParse({ data: { snapshot }, requestId: "snapshot" });
  if (!validated.success) throw new Error(`Invalid snapshot response fixture: ${JSON.stringify(validated.error.issues)}`);
  const draft = { ...structuredClone(snapshot.inputs), revision: currentRevision, updatedAt: timestamp };
  const record = {
    id: hostedCaseId,
    ownerId: hostedUser.id,
    status: "draft" as const,
    draft,
    assignedOfficerId: null,
    submittedSnapshotId: null,
    submittedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    data: { user: hostedUser, csrfToken: hostedCsrf }, requestId: "session",
  } }));
  await page.route(`**/api/cases/${hostedCaseId}`, (route) => route.fulfill({ json: {
    data: { case: record, attachments: [], currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: "case",
  } }));
  await page.route(`**/api/snapshots/${snapshot.id}`, (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));
  await page.goto(`/app/cases/${hostedCaseId}/result?preview=${encodeURIComponent(snapshot.id)}`);
}

test("taxpayer result explains the saved country limit before the full worksheet", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);

  const screenshot = resolve(process.cwd(), "tmp/new-review/result-summary-green.png");
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  const summary = page.getByRole("region", { name: "สรุปเครดิตภาษี", exact: true });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("143,544.30 บาท");
  await expect(summary.locator(".result-rounding-note")).toHaveCount(0);

  const vietnam = summary.locator(".result-country-summary").filter({ hasText: "เวียดนาม" });
  await expect(vietnam.locator(".result-country-values > div").filter({ hasText: "ภาษีต่างประเทศที่จัดสรร (O)" })).toContainText("225,000.00 บาท");
  await expect(vietnam.locator(".result-country-values > div").filter({ hasText: "เพดานภาษีไทย (P)" })).toContainText("121,044.30 บาท");
  await expect(vietnam.locator(".result-country-values > div").filter({ hasText: "เครดิตภาษีที่ใช้ได้ (Q)" })).toContainText("121,044.30 บาท");
  await expect(vietnam).toContainText("121,044.30 บาท");
  await expect(vietnam).toContainText("จำกัดด้วยเพดานภาษีไทย (P)");

  const china = summary.locator(".result-country-summary").filter({ hasText: "จีน" });
  await expect(china.locator(".result-country-values > div").filter({ hasText: "ภาษีต่างประเทศที่จัดสรร (O)" })).toContainText("22,500.00 บาท");
  await expect(china.locator(".result-country-values > div").filter({ hasText: "เพดานภาษีไทย (P)" })).toContainText("36,313.29 บาท");
  await expect(china.locator(".result-country-values > div").filter({ hasText: "เครดิตภาษีที่ใช้ได้ (Q)" })).toContainText("22,500.00 บาท");
  await expect(china).toContainText("22,500.00 บาท");
  await expect(china).toContainText("จำกัดด้วยภาษีต่างประเทศที่จัดสรร (O)");

  const worksheet = page.locator(".result-worksheet-details");
  const worksheetDisclosure = worksheet.locator(":scope > summary");
  await expect(worksheetDisclosure).toHaveText("ดูตารางรายละเอียดทั้งหมด");
  await expect(worksheet).not.toHaveAttribute("open", "");
  await worksheetDisclosure.click();
  await expect(worksheet.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
});

test("equal saved O and P are described as an equal limit", async ({ page }) => {
  const inputs = structuredClone(countryLimitBelowFixture.draft);
  inputs.id = hostedCaseId;
  inputs.thaiTax.amountBeforeFtc = "10000.00";
  inputs.thaiTax.confirmedInputFingerprint = taxInputFingerprint(inputs);
  const snapshot = makeSnapshot("equal-country-limit", inputs);
  expect(snapshot.result.outcome).toBe("ready");
  expect(snapshot.result.countries[0]?.attributableForeignTax).toBe(snapshot.result.countries[0]?.thaiTaxLimit);

  await openHostedResult(page, snapshot);
  const summary = page.getByRole("region", { name: "สรุปเครดิตภาษี", exact: true });
  await expect(summary).toBeVisible();
  await expect(summary.locator(".result-country-limiting")).toHaveText("ภาษีต่างประเทศที่จัดสรร (O) และเพดานภาษีไทย (P) เท่ากัน จึงได้เครดิต (Q) เท่ากับจำนวนดังกล่าว");
});

test("stale and out-of-scope saved previews do not show an ordinary ready-credit summary", async ({ page }) => {
  const staleSnapshot = makeSnapshot("stale-result-preview", countryLimitBelowFixture.draft);
  expect(staleSnapshot.result.outcome).toBe("ready");
  await openHostedResult(page, staleSnapshot, staleSnapshot.revision + 1);
  await expect(page.getByRole("status").filter({ hasText: "ผลนี้เป็นข้อมูลก่อนการแก้ไขล่าสุด" })).toBeVisible();
  await expect(page.locator(".result-credit-summary")).toHaveCount(0);

  const unsupportedInputs = structuredClone(countryLimitBelowFixture.draft);
  unsupportedInputs.id = hostedCaseId;
  const source = unsupportedInputs.sources[0];
  if (!source) throw new Error("The out-of-scope preview fixture requires a source.");
  source.unsupportedClassification = "unsupported_income_type";
  source.unsupportedExplanation = "ใช้สำหรับตรวจการแสดงผลกรณีที่ยังไม่รองรับ";
  const unsupportedSnapshot = makeSnapshot("unsupported-result-preview", unsupportedInputs);
  expect(unsupportedSnapshot.result.outcome).toBe("needs_review");
  expect(unsupportedSnapshot.result.allowableCredit).toBeNull();

  await openHostedResult(page, unsupportedSnapshot);
  await expect(page.getByRole("status").filter({ hasText: "มีข้อมูลที่ต้องทบทวน" })).toBeVisible();
  await expect(page.locator(".result-credit-summary")).toHaveCount(0);
});

test("a saved preview from an older engine is stale even when its draft revision matches", async ({ page }) => {
  const oldEngineSnapshot = createCalculationSnapshot({
    id: "old-engine-result-preview",
    caseId: hostedCaseId,
    revision: countryLimitBelowFixture.draft.revision,
    kind: "preview",
    inputs: { ...structuredClone(countryLimitBelowFixture.draft), id: hostedCaseId },
    evidence: [],
    createdAt: timestamp,
    policy: { ...DEMO_POLICY, engineVersion: "ftc-engine-v1" },
  });
  expect(oldEngineSnapshot.revision).toBe(countryLimitBelowFixture.draft.revision);
  expect(oldEngineSnapshot.result.engineVersion).toBe("ftc-engine-v1");

  await openHostedResult(page, oldEngineSnapshot);

  await expect(page.getByRole("status").filter({ hasText: "ผลคำนวณนี้ใช้เงื่อนไขหรือวิธีคำนวณรุ่นก่อน" })).toBeVisible();
  await expect(page.getByRole("region", { name: "สรุปเครดิตภาษี", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "ดูรายงาน" })).toBeVisible();
});

test("explains a saved display-rounding adjustment without changing country credits", async ({ page }) => {
  const snapshot = makeSnapshot("rounding-reconciliation-preview", roundingBoundaryFixture.draft);
  expect(snapshot.result.outcome).toBe("ready");
  expect(snapshot.result.allowableCredit).toBe("0.01");
  expect(snapshot.result.displayRoundingReconciliation).toBe("-0.01");
  expect(snapshot.result.countries.map((country) => country.displayedAllowableCredit)).toEqual(["0.01", "0.01"]);

  await openHostedResult(page, snapshot);
  const summary = page.getByRole("region", { name: "สรุปเครดิตภาษี", exact: true });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("0.01 บาท");
  await expect(summary.locator(".result-country-summary")).toHaveCount(2);
  for (const country of await summary.locator(".result-country-summary").all()) {
    await expect(country.locator(".result-country-values > div").filter({ hasText: "เครดิตภาษีที่ใช้ได้ (Q)" })).toContainText("0.01 บาท");
  }
  await expect(summary.locator(".result-rounding-note")).toContainText("ยอดปรับการแสดงผล: -0.01 บาท");
  await expect(summary.locator(".result-rounding-note")).toContainText("ส่วนต่างนี้ไม่ได้กระจายกลับไปยังเครดิตรายประเทศ");
});
