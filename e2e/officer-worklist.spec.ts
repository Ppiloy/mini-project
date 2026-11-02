import { expect, test } from "@playwright/test";
import type { FtcCaseRecord, FrozenEvidenceReference, OfficerWorklistItem } from "../shared/contracts.js";
import { partialRemittanceFixture } from "../src/fixtures/domain.js";
import { classifySubmittedSnapshot } from "../shared/review.js";
import { createCalculationSnapshot } from "../shared/snapshot.js";

const officer = { id: "officer-worklist-test", loginName: "officer-test", displayName: "เจ้าหน้าที่ทดสอบ", role: "officer", maskedReference: null } as const;
const reviewScope = "จุดตรวจนี้ช่วยชี้ข้อมูลเชิงโครงสร้างเท่านั้น ไม่ใช่การอนุมัติหรือคำวินิจฉัยสิทธิในเครดิตภาษี; การมีไฟล์แนบไม่ได้ยืนยันว่าเอกสารถูกต้องหรือครบถ้วน";

function makeSubmission(caseId: string, submittedAt: string, options: { flagged?: boolean } = {}) {
  const draft = structuredClone(partialRemittanceFixture.draft);
  draft.id = caseId;
  draft.createdAt = submittedAt;
  draft.updatedAt = submittedAt;
  draft.sources[0]!.id = `${caseId}-source`;
  if (options.flagged) {
    draft.sources[0]!.unsupportedClassification = "unsupported_income_type";
    draft.sources[0]!.unsupportedExplanation = "ข้อเท็จจริงตัวอย่างยังไม่อยู่ในขอบเขตที่รองรับ";
  }
  const evidenceKinds = options.flagged ? [] : ["foreign_income", "foreign_tax", "remittance", "thai_tax"] as const;
  const evidence: FrozenEvidenceReference[] = evidenceKinds.map((kind, index) => ({
    id: `${caseId}-evidence-${index}`, sourceId: kind === "thai_tax" ? null : draft.sources[0]!.id, kind,
    displayName: `หลักฐาน ${index + 1}.pdf`, mediaType: "application/pdf", byteSize: 10, sha256: "a".repeat(64),
  }));
  const snapshot = createCalculationSnapshot({ id: `${caseId}-snapshot`, caseId, revision: draft.revision,
    kind: "submitted", inputs: draft, evidence, createdAt: submittedAt });
  const record: FtcCaseRecord = { id: caseId, ownerId: "taxpayer-worklist-test", status: "submitted", draft,
    assignedOfficerId: officer.id, submittedSnapshotId: snapshot.id, submittedAt, createdAt: submittedAt, updatedAt: submittedAt };
  const reviewPoints = classifySubmittedSnapshot(snapshot);
  const item: OfficerWorklistItem = { caseId, reference: caseId, taxYear: snapshot.inputs.taxYear,
    sourceCount: snapshot.inputs.sources.length, totalFtc: snapshot.result.allowableCredit, submittedAt,
    reviewStatus: "awaiting_review", reviewPointCount: reviewPoints.length, reviewPoints };
  return { item, record, snapshot };
}

test("officer worklist filters and orders unresolved cases, then shows the same points in read-only detail", async ({ page }) => {
  const submissions = [
    makeSubmission("case-flagged-new", "2025-10-10T00:00:00.000Z", { flagged: true }),
    makeSubmission("case-flagged-old", "2025-10-01T00:00:00.000Z", { flagged: true }),
    makeSubmission("case-clear-oldest", "2025-09-01T00:00:00.000Z"),
  ];
  const allItems = submissions.map(({ item }) => item);
  const byCaseId = new Map(submissions.map((submission) => [submission.item.caseId, submission]));

  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { data: { user: officer, csrfToken: "csrf-officer" }, requestId: "worklist-session" },
  }));
  await page.route("**/api/officer/worklist**", async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status") ?? "all";
    const reviewPoints = url.searchParams.get("reviewPoints") ?? "all";
    const filtered = allItems.filter((item) => (status === "all" || item.reviewStatus === "awaiting_review")
      && (reviewPoints === "all" || (reviewPoints === "with" ? item.reviewPointCount > 0 : item.reviewPointCount === 0)));
    await route.fulfill({ json: { data: { cases: filtered, reviewScope }, requestId: "worklist-data" } });
  });
  await page.route("**/api/officer/cases/*", async (route) => {
    const caseId = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const detail = byCaseId.get(caseId);
    if (!detail) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "ไม่พบข้อมูล", requestId: "worklist-detail" } } });
    return route.fulfill({ json: { data: { case: detail.record, attachments: [], snapshot: detail.snapshot, auditEvents: [] }, requestId: "worklist-detail" } });
  });

  await page.goto("/officer");
  const table = page.getByRole("table", { name: "รายการกรณีที่ส่งเข้าตรวจสอบ" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-case-id", "case-flagged-old");
  await expect(rows.nth(1)).toHaveAttribute("data-case-id", "case-flagged-new");
  await expect(rows.nth(2)).toHaveAttribute("data-case-id", "case-clear-oldest");
  await expect(table).toContainText("เลขอ้างอิง");
  await expect(table).toContainText("ปีภาษี");
  await expect(table).toContainText("แหล่งเงินได้");
  await expect(table).toContainText("เครดิตภาษีรวม");
  await expect(table).toContainText("วันที่ส่ง");
  await expect(table).toContainText("สถานะ");
  await expect(table).toContainText("จุดที่ควรตรวจ");

  const filters = page.locator(".officer-worklist-filters");
  const statusFilter = filters.getByLabel("สถานะการตรวจทาน");
  await expect(statusFilter.locator("option")).toHaveCount(2);
  await statusFilter.selectOption("awaiting_review");
  await expect(rows).toHaveCount(3);
  const pointsFilter = filters.getByLabel("จุดที่ควรตรวจ");
  await pointsFilter.selectOption("with");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-case-id", "case-flagged-old");
  await pointsFilter.selectOption("without");
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveAttribute("data-case-id", "case-clear-oldest");
  await statusFilter.selectOption("all");
  await pointsFilter.selectOption("all");

  const flaggedRow = table.locator('tbody tr[data-case-id="case-flagged-old"]');
  await flaggedRow.getByRole("link", { name: "ตรวจทาน", exact: true }).click();
  await expect(page.getByRole("heading", { name: "จุดที่ควรตรวจ" })).toBeVisible();
  await expect(page.getByText("ข้อเท็จจริงตัวอย่างยังไม่อยู่ในขอบเขตที่รองรับ")).toBeVisible();
  await expect(page.getByText("ยังไม่พบหลักฐานภาษีไทยที่เชื่อมกับกรณีนี้")).toBeVisible();
  await expect(page.getByText("ขั้นตอนถัดไป:").first()).toBeVisible();
  await expect(page.getByText("หลักฐานที่ขาด").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /ผ่าน|อนุมัติ|ไม่ผ่าน|ขอเอกสารเพิ่ม/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "กลับไปหน้ารายการ", exact: true })).toHaveCount(1);
});

test("a slower old filter response cannot replace the currently selected worklist", async ({ page }) => {
  const submissions = [
    makeSubmission("case-flagged", "2025-10-01T00:00:00.000Z", { flagged: true }),
    makeSubmission("case-clear", "2025-09-01T00:00:00.000Z"),
  ];
  const allItems = submissions.map(({ item }) => item);
  let releaseStaleResponse!: () => void;
  let signalStaleRequest!: () => void;
  let signalStaleResponse!: () => void;
  const staleResponseGate = new Promise<void>((resolve) => { releaseStaleResponse = resolve; });
  const staleRequestStarted = new Promise<void>((resolve) => { signalStaleRequest = resolve; });
  const staleResponseFinished = new Promise<void>((resolve) => { signalStaleResponse = resolve; });

  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { data: { user: officer, csrfToken: "csrf-officer" }, requestId: "worklist-race-session" },
  }));
  await page.route("**/api/officer/worklist**", async (route) => {
    const url = new URL(route.request().url());
    const reviewPoints = url.searchParams.get("reviewPoints") ?? "all";
    const filtered = allItems.filter((item) => reviewPoints === "all"
      || (reviewPoints === "with" ? item.reviewPointCount > 0 : item.reviewPointCount === 0));
    if (reviewPoints === "with") {
      signalStaleRequest();
      await staleResponseGate;
    }
    await route.fulfill({ json: { data: { cases: filtered, reviewScope }, requestId: `worklist-${reviewPoints}` } });
    if (reviewPoints === "with") signalStaleResponse();
  });

  await page.goto("/officer");
  const table = page.getByRole("table", { name: "รายการกรณีที่ส่งเข้าตรวจสอบ" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const pointsFilter = page.getByLabel("จุดที่ควรตรวจ", { exact: true });
  await pointsFilter.selectOption("with");
  await staleRequestStarted;
  await pointsFilter.selectOption("without");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator('tbody tr[data-case-id="case-clear"]')).toBeVisible();

  releaseStaleResponse();
  await staleResponseFinished;
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator('tbody tr[data-case-id="case-flagged"]')).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("officer worklist keeps phone overflow inside the table scroller", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { item } = makeSubmission("case-mobile", "2025-10-01T00:00:00.000Z");
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { data: { user: officer, csrfToken: "csrf-officer" }, requestId: "worklist-mobile-session" },
  }));
  await page.route("**/api/officer/worklist**", (route) => route.fulfill({
    json: { data: { cases: [item], reviewScope }, requestId: "worklist-mobile-data" },
  }));

  await page.goto("/officer");
  const table = page.getByRole("table", { name: "รายการกรณีที่ส่งเข้าตรวจสอบ" });
  await expect(table).toBeVisible();
  const widths = await page.evaluate<{ viewport: number; document: number; body: number; scrollerClient: number; scrollerContent: number }>(`(() => {
    const scroller = document.querySelector(".officer-worklist-table")?.parentElement;
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      scrollerClient: scroller?.clientWidth ?? 0,
      scrollerContent: scroller?.scrollWidth ?? 0,
    };
  })()`);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.scrollerContent).toBeGreaterThan(widths.scrollerClient);
  const screenshot = await page.screenshot({ path: testInfo.outputPath("officer-worklist-mobile.png"), fullPage: true });
  await testInfo.attach("officer-worklist-mobile", { body: screenshot, contentType: "image/png" });
});
