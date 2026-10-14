import { expect, test } from "@playwright/test";

const caseId = "case-review-recovery";
const user = { id: "taxpayer-review", loginName: "taxpayer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null } as const;
const csrfToken = "csrf-test-token";

function record(revision: number) {
  const now = "2026-10-14T00:00:00.000Z";
  const draft = {
    id: caseId,
    taxYear: 2025,
    domesticAssessableIncome: "100.00",
    thaiTax: { amountBeforeFtc: "10.00", provenance: "ตัวอย่างทดสอบ", confirmedAt: now, confirmedInputFingerprint: "test-fingerprint" },
    sources: [],
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
    sha256,
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

  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({ json: { data: { case: current, attachments: files }, requestId: "case" } }));
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
      await route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Upload response failed", requestId: "upload-failed" } } });
      return;
    }
    const uploaded = committedUpload!;
    await route.fulfill({ json: { data: { attachment: uploaded, case: current }, requestId: "upload-acknowledged" } });
  });

  await page.goto(`/app/cases/${caseId}/edit`);
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByText("โหมดระบบที่เชื่อมต่อเซิร์ฟเวอร์")).toBeVisible();
  await expect(page.getByText("ข้อมูลจำลองเท่านั้น")).toHaveCount(0);
  await page.getByLabel("แนบหลักฐานภาษีไทย").setInputFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: Buffer.from("new bytes") });

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
  await expect(page.getByText("same.pdf")).toHaveCount(2);
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
    return route.fulfill({ json: { data: { case: latest, attachments: [] }, requestId: `case-${detailCalls}` } });
  });
  await page.route("**/api/snapshots/snapshot-revision-1", (route) => route.fulfill({ json: { data: { snapshot }, requestId: "snapshot" } }));
  await page.route(`**/api/cases/${caseId}/submit`, async (route) => {
    submitCalls += 1;
    await route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Draft revision changed", requestId: "submit-conflict" } } });
  });

  await page.goto(`/app/cases/${caseId}/result?preview=snapshot-revision-1`);
  const submit = page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/ร่างปัจจุบันเป็นรุ่น 2 แต่ผลคำนวณเป็นรุ่น 1/)).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(detailCalls).toBe(2);
  expect(submitCalls).toBe(1);
});

test("Thai font assets remain loaded locally for offline print", async ({ page, context }) => {
  const fontRequests: string[] = [];
  page.on("response", (response) => { if (/\.woff2?(?:\?|$)/.test(response.url())) fontRequests.push(response.url()); });
  await page.goto("/demo");
  await page.evaluate('document.fonts.load(\'16px "Noto Sans Thai"\')');
  expect(await page.evaluate('document.fonts.check(\'16px "Noto Sans Thai"\')')).toBe(true);
  expect(fontRequests.some((url) => new URL(url).origin === new URL(page.url()).origin && /noto-sans-thai/.test(url))).toBe(true);
  await context.setOffline(true);
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate('document.fonts.check(\'16px "Noto Sans Thai"\')')).toBe(true);
  await expect(page.getByText("ระบบต้นแบบเพื่อการศึกษา")).toBeVisible();
});
