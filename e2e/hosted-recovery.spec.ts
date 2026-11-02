import { expect, test } from "@playwright/test";
import { createCalculationSnapshot } from "../shared/snapshot.js";
import { partialRemittanceFixture } from "../src/fixtures/index.js";

const caseId = "case-review-recovery";
const user = { id: "taxpayer-review", loginName: "taxpayer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null } as const;
const csrfToken = "csrf-test-token";

function record(revision: number) {
  const now = "2026-10-14T00:00:00.000Z";
  const draft = {
    ...structuredClone(partialRemittanceFixture.draft),
    id: caseId,
    revision,
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: caseId,
    ownerId: user.id,
    status: "draft",
    draft,
    assignedOfficerId: null,
    submittedSnapshotId: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function attachment(id: string, sha256: string) {
  return {
    id,
    caseId,
    sourceId: null,
    kind: "thai_tax",
    displayName: "same.pdf",
    mediaType: "application/pdf",
    byteSize: 10,
    sha256: sha256 === "sha256-old-bytes" ? "a".repeat(64) : "b".repeat(64),
    status: "ready",
    createdAt: "2026-10-14T00:00:00.000Z",
  };
}

async function installHostedSession(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { data: { user, csrfToken }, requestId: "session" } }));
}

test("a failed same-name evidence upload stays failed and retries the same operation", async ({ page }) => {
  await installHostedSession(page);
  let current = record(0);
  const existing = attachment("old-file", "sha256-old-bytes");
  let files = [existing];
  let uploadAttempts = 0;
  let committedUpload: ReturnType<typeof attachment> | null = null;
  const uploadBodies: string[] = [];
  let releaseUpload!: () => void;
  let uploadArrived!: () => void;
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  const uploadRequest = new Promise<void>((resolve) => { uploadArrived = resolve; });
  let releaseDelete!: () => void;
  let deleteArrived!: () => void;
  const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const deleteRequest = new Promise<void>((resolve) => { deleteArrived = resolve; });

  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({ json: { data: { case: current, attachments: files, currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: "case" } }));
  await page.route(`**/api/cases/${caseId}/draft`, async (route) => {
    current = { ...current, draft: { ...current.draft, revision: current.draft.revision + 1 } };
    await route.fulfill({ json: { data: { case: current }, requestId: "save" } });
  });
  await page.route(`**/api/cases/${caseId}/attachments`, async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    uploadBodies.push(body);
    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      committedUpload = { ...attachment("new-file", "sha256-new-bytes"), byteSize: 13 };
      files = [committedUpload, ...files];
      current = { ...current, draft: { ...current.draft, revision: current.draft.revision + 1 } };
      uploadArrived();
      await uploadGate;
      await route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Upload response failed", requestId: "upload-failed" } } });
      return;
    }
    const uploaded = committedUpload!;
    await route.fulfill({ json: { data: { attachment: uploaded, case: current, revision: current.draft.revision }, requestId: "upload-acknowledged" } });
  });
  await page.route("**/api/attachments/new-file", async (route) => {
    deleteArrived();
    await deleteGate;
    files = files.filter((file) => file.id !== "new-file");
    current = { ...current, draft: { ...current.draft, revision: current.draft.revision + 1 } };
    await route.fulfill({ json: { data: { deleted: true, revision: current.draft.revision }, requestId: "delete-acknowledged" } });
  });

  await page.goto(`/app/cases/${caseId}/edit`);
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป" }).click();
  await expect(page.getByText("ข้อมูลจำลองเท่านั้น")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.getByLabel("แนบหลักฐานภาษีไทย").setInputFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: Buffer.from("new bytes") });

  await uploadRequest;
  await expect(page.getByRole("status").filter({ hasText: "กำลังแนบไฟล์…" })).toBeVisible();
  releaseUpload();
  await expect(page.getByRole("alert").filter({ hasText: "Upload response failed" })).toBeVisible();
  await expect(page.getByText("แนบรายการไฟล์แล้ว")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ลองแนบไฟล์เดิมอีกครั้ง" })).toBeVisible();
  await page.getByRole("button", { name: "ลองแนบไฟล์เดิมอีกครั้ง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "แนบรายการไฟล์แล้ว" })).toBeVisible();
  expect(uploadAttempts).toBe(2);

  const fieldValue = (body: string, name: string) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]+)`))?.[1];
  expect(fieldValue(uploadBodies[0]!, "requestId")).toBeTruthy();
  expect(fieldValue(uploadBodies[1]!, "requestId")).toBe(fieldValue(uploadBodies[0]!, "requestId"));
  expect(fieldValue(uploadBodies[1]!, "expectedRevision")).toBe(fieldValue(uploadBodies[0]!, "expectedRevision"));
  expect(uploadBodies[0]).toContain("new bytes");
  expect(uploadBodies[1]).toContain("new bytes");
  await expect(page.locator(".file-list li")).toHaveCount(2);

  const uploadedFile = page.locator(".file-list li").filter({ hasText: "same.pdf" }).first();
  await uploadedFile.getByRole("button", { name: "ลบ", exact: true }).click();
  await deleteRequest;
  await expect(page.getByRole("status").filter({ hasText: "กำลังลบไฟล์…" })).toBeVisible();
  releaseDelete();
  await expect(page.getByRole("status").filter({ hasText: "ลบรายการไฟล์แล้ว" })).toBeVisible();
  await expect(page.locator(".file-list li")).toHaveCount(1);
});

test("a submit conflict loads the newer draft and disables the stale preview", async ({ page }) => {
  await installHostedSession(page);
  const snapshot = {
    id: "snapshot-revision-1",
    caseId,
    revision: 1,
    kind: "preview",
    inputs: record(1).draft,
    result: {
      outcome: "ready",
      allowableCredit: "1.00",
      unroundedCountryCreditTotal: "1.00",
      displayRoundingReconciliation: "0",
      domesticAssessableIncome: "100.00",
      totalRemittedIncome: "0.00",
      totalAssessableIncome: "100.00",
      thaiTaxBeforeFtc: "10.00",
      countries: [],
      lines: [],
      validationMessages: [],
      assumptions: [],
      policyVersion: "test-policy",
      engineVersion: "test-engine",
      roundingPolicy: "test-rounding",
    },
    evidence: [],
    policy: { id: "test-policy", taxYear: 2025, effectiveFrom: null, effectiveTo: null, sourceUrls: [], reviewedAt: null, assumptions: [], roundingPolicy: "test-rounding" },
    createdAt: "2026-10-14T00:00:00.000Z",
  };
  let detailCalls = 0;
  let submitCalls = 0;
  await page.route(`**/api/cases/${caseId}`, (route) => {
    detailCalls += 1;
    const latest = record(detailCalls === 1 ? 1 : 2);
    return route.fulfill({ json: { data: { case: latest, attachments: [], currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: `case-${detailCalls}` } });
  });
  await page.route("**/api/snapshots/snapshot-revision-1", (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));
  await page.route(`**/api/cases/${caseId}/submit`, async (route) => {
    submitCalls += 1;
    await route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Draft revision changed", requestId: "submit-conflict" } } });
  });

  await page.goto(`/app/cases/${caseId}/result?preview=snapshot-revision-1`);
  const submit = page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "มีการเปลี่ยนแปลงในร่างหลังบันทึกผลนี้ กรุณาบันทึกและคำนวณใหม่ก่อนส่ง" })).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(detailCalls).toBe(2);
  expect(submitCalls).toBe(1);
});

test("editing during a delayed draft save survives the server acknowledgement", async ({ page }) => {
  await installHostedSession(page);
  let current = record(0);
  const now = "2026-10-14T00:00:00.000Z";
  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({
    json: { data: { case: current, attachments: [], currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: "case" },
  }));

  let releaseSave!: () => void;
  let acknowledgeRequest!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const saveArrived = new Promise<void>((resolve) => { acknowledgeRequest = resolve; });
  await page.route(`**/api/cases/${caseId}/draft`, async (route) => {
    const payload = route.request().postDataJSON() as { data: ReturnType<typeof record>["draft"] };
    acknowledgeRequest();
    await saveGate;
    current = {
      ...current,
      draft: { ...payload.data, id: caseId, revision: current.draft.revision + 1, createdAt: now, updatedAt: now },
      updatedAt: now,
    };
    await route.fulfill({ json: { data: { case: current }, requestId: "delayed-save" } });
  });

  await page.goto(`/app/cases/${caseId}/edit`);
  const year = page.getByLabel("ปีภาษี (พ.ศ.)");
  await year.selectOption("2567");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/draft`));
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await saveArrived;

  const editBlocked = await year.isDisabled();
  releaseSave();
  await responsePromise;

  expect(editBlocked).toBe(true);
  await expect(year).toHaveValue("2567");
  await expect(year).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
});

test("a failed delayed save never reports success and Next keeps the edited form in place", async ({ page }) => {
  await installHostedSession(page);
  let current = record(0);
  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({
    json: { data: { case: current, attachments: [], currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: "case" },
  }));

  let releaseFirstSave!: () => void;
  let firstSaveArrived!: () => void;
  const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  const firstSaveRequest = new Promise<void>((resolve) => { firstSaveArrived = resolve; });
  let saveAttempts = 0;
  await page.route(`**/api/cases/${caseId}/draft`, async (route) => {
    saveAttempts += 1;
    if (saveAttempts === 1) {
      firstSaveArrived();
      await firstSaveGate;
    }
    await route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Draft save failed", requestId: `save-${saveAttempts}` } } });
  });

  await page.goto(`/app/cases/${caseId}/edit`);
  const year = page.getByLabel("ปีภาษี (พ.ศ.)");
  const firstResponse = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/draft`));
  await page.getByRole("button", { name: "ถัดไป" }).click();
  await firstSaveRequest;
  await expect(year).toBeDisabled();
  releaseFirstSave();
  await firstResponse;
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(year).toHaveValue("2568");
  await expect(page.getByRole("status").filter({ hasText: "บันทึกไม่สำเร็จ" })).toHaveText("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
  await expect(page.getByRole("alert").filter({ hasText: "Draft save failed" })).toBeVisible();

  await year.selectOption("2567");
  await page.getByRole("button", { name: "ถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(year).toHaveValue("2567");
  await expect(page.getByRole("status").filter({ hasText: "บันทึกไม่สำเร็จ" })).toHaveText("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
  expect(saveAttempts).toBe(2);
});

test("review controls stay locked until the hosted calculation request finishes", async ({ page }) => {
  await installHostedSession(page);
  const now = "2026-10-14T00:00:00.000Z";
  let current = { ...record(0), draft: { ...partialRemittanceFixture.draft, id: caseId, revision: 0 } };
  let releaseCalculation!: () => void;
  let calculationArrived!: () => void;
  const calculationGate = new Promise<void>((resolve) => { releaseCalculation = resolve; });
  const calculateRequest = new Promise<void>((resolve) => { calculationArrived = resolve; });
  let snapshot: ReturnType<typeof createCalculationSnapshot> | null = null;

  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({
    json: { data: { case: current, attachments: [], currentPreview: null, snapshotSummaries: [], auditEvents: [] }, requestId: "case" },
  }));
  await page.route(`**/api/cases/${caseId}/draft`, async (route) => {
    const payload = route.request().postDataJSON() as { data: typeof current.draft };
    current = { ...current, draft: { ...payload.data, id: caseId, revision: current.draft.revision + 1, createdAt: now, updatedAt: now }, updatedAt: now };
    await route.fulfill({ json: { data: { case: current }, requestId: "save" } });
  });
  await page.route(`**/api/cases/${caseId}/calculate`, async (route) => {
    calculationArrived();
    await calculationGate;
    snapshot = createCalculationSnapshot({ id: "delayed-preview", caseId, revision: current.draft.revision, kind: "preview", inputs: current.draft, evidence: [], createdAt: now });
    await route.fulfill({ json: { data: { snapshot }, requestId: "calculate" } });
  });
  await page.route("**/api/snapshots/delayed-preview", (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));

  await page.goto(`/app/cases/${caseId}/edit`);
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป" }).click();
  const confirmation = page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย (L)" });
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await calculateRequest;
  await expect(confirmation).toBeDisabled();
  await expect(page.getByRole("button", { name: "ย้อนกลับ" })).toBeDisabled();
  releaseCalculation();
  await expect(page).toHaveURL(/\/app\/cases\/case-review-recovery\/result\?preview=delayed-preview$/);
});

test("Thai font assets remain loaded locally for offline print", async ({ page, context }) => {
  const fontRequests: string[] = [];
  page.on("response", (response) => { if (/\.woff2?(?:\?|$)/.test(response.url())) fontRequests.push(response.url()); });
  const snapshot = createCalculationSnapshot({
    id: "offline-print-report",
    caseId,
    revision: partialRemittanceFixture.draft.revision,
    kind: "preview",
    inputs: partialRemittanceFixture.draft,
    evidence: [],
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { data: { user, csrfToken }, requestId: "session" } }));
  await page.route("**/api/snapshots/offline-print-report", (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));
  await page.goto("/reports/offline-print-report");
  await expect(page.locator(".report-footer")).toBeHidden();
  await page.evaluate('document.fonts.load(\'16px "Noto Sans Thai"\')');
  expect(await page.evaluate('document.fonts.check(\'16px "Noto Sans Thai"\')')).toBe(true);
  expect(fontRequests.some((url) => new URL(url).origin === new URL(page.url()).origin && /noto-sans-thai/.test(url))).toBe(true);
  await context.setOffline(true);
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate('document.fonts.check(\'16px "Noto Sans Thai"\')')).toBe(true);
  await expect(page.locator(".report-footer")).toBeVisible();
  await expect(page.locator(".report-footer")).toHaveText("ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น");
});
