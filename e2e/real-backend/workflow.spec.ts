import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiSuccessSchemas } from "../../shared/contracts.js";
import type { CalculationSnapshot } from "../../shared/contracts.js";
import { advance, browserApi, createCase, login, operatorSeed } from "./fixtures.js";
import { assertFocusedSkipLinkIsScreenOnly } from "./print-acceptance.js";

const proofBytes = (label: string) => Buffer.from(`%PDF-1.7\n% fictional acceptance evidence: ${label}\n%%EOF\n`, "ascii");

test("real taxpayer journey persists a server-assigned source, evidence, calculation, submitted snapshot and officer audit", async ({ browser, page }, testInfo) => {
  const seed = await operatorSeed();
  const taxpayerA = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const taxpayerB = seed.credentials.find((item) => item.loginName === "taxpayer-demo-b")!;
  const officer = seed.credentials.find((item) => item.loginName === "officer-demo")!;
  const a = await login(page, taxpayerA);
  const caseId = await createCase(page);

  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await advance(page);
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();
  await page.getByLabel("ประเทศที่เกิดเงินได้").selectOption("VN");
  await page.locator(".source-card").first().locator("select").nth(1).selectOption("salary_40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-15");
  await page.getByLabel("วันพำนักในประเทศไทยในปีที่เกิดเงินได้").fill("365");
  await page.getByLabel("รูปแบบการกรอก").selectOption("worksheet_thb");
  const firstSourceSave = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/draft`) && response.request().method() === "PUT");
  await advance(page);
  const sourceSaveResponse = await firstSourceSave;
  expect(sourceSaveResponse.status()).toBe(200);
  const sourceEnvelope = await sourceSaveResponse.json() as { data?: { case?: { draft?: { sources?: Array<{ id?: string }> } } } };
  expect(apiSuccessSchemas.case.safeParse(sourceEnvelope).success).toBe(true);
  const sourceId = sourceEnvelope.data?.case?.draft?.sources?.[0]?.id;
  expect(sourceId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();

  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("50000");
  await page.getByLabel("ภาษีต่างประเทศที่ชำระจริง").fill("5000");
  await page.getByLabel("E · ภาษีที่สมมติว่าเข้าเกณฑ์").fill("5000");
  await page.getByLabel("เหตุผลของสมมติฐาน E").fill("หลักฐานสมมติระบุภาษีที่ชำระและสมมติให้เข้าเกณฑ์เต็มจำนวน");
  await page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย").fill("25000");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-07-01");
  await page.getByLabel("ยอดโอนทั้งหมด (ข้อมูลประกอบ)").fill("25000");
  await page.getByLabel("ลักษณะการโอน").selectOption("income_only");
  await advance(page);
  await page.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ").fill("100000");
  await page.getByLabel("L · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ").fill("20000");
  await page.getByLabel("ที่มาของจำนวน L").fill("ตัวเลขสมมติสำหรับ acceptance ในเครื่อง");
  await advance(page);
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย L" }).check();
  await page.getByRole("checkbox", { name: "ยืนยัน E และเหตุผล · แหล่งเงินได้ 1" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานเงินได้ต่างประเทศ" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานภาษีที่ชำระในต่างประเทศ" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานการนำเงินเข้าไทย" }).check();

  const uploadedFiles = [
    { name: "thai-tax.pdf", label: "แนบหลักฐานภาษีไทย", kind: "thai_tax" },
    { name: "foreign-income.pdf", label: "แนบ: หลักฐานเงินได้ต่างประเทศ", kind: "foreign_income" },
    { name: "foreign-tax.pdf", label: "แนบ: หลักฐานภาษีที่ชำระในต่างประเทศ", kind: "foreign_tax" },
    { name: "remittance.pdf", label: "แนบ: หลักฐานการนำเงินเข้าไทย", kind: "remittance" },
  ] as const;
  for (const file of uploadedFiles) {
    const uploadResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/cases/${caseId}/attachments`) && response.request().method() === "POST");
    await page.getByLabel(file.label).setInputFiles({ name: file.name, mimeType: "application/pdf", buffer: proofBytes(file.name) });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(201);
    expect(apiSuccessSchemas.attachmentUpload.safeParse(await uploadResponse.json()).success).toBe(true);
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  }
  const persisted = await browserApi(page, `/api/cases/${caseId}`);
  expect(persisted.status).toBe(200);
  expect(apiSuccessSchemas.caseDetail.safeParse(persisted.json).success).toBe(true);
  const caseDetail = (persisted.json as { data: { case: { draft: { sources: Array<{ id: string }> } }; attachments: Array<{
    id: string; sourceId: string | null; kind: string; displayName: string; mediaType: string; byteSize: number; sha256: string;
  }> } }).data;
  expect(caseDetail.case.draft.sources[0]?.id).toBe(sourceId);
  const sourceFiles = caseDetail.attachments.filter((attachment) => attachment.sourceId === sourceId);
  expect(sourceFiles.map((attachment) => attachment.kind).sort()).toEqual(["foreign_income", "foreign_tax", "remittance"]);
  for (const file of uploadedFiles) {
    const attachment = caseDetail.attachments.find((item) => item.kind === file.kind)!;
    expect(attachment.sha256).toBe(createHash("sha256").update(proofBytes(file.name)).digest("hex"));
  }
  const incomeRow = page.locator(".file-list > li").filter({ hasText: "foreign-income.pdf" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    incomeRow.getByRole("button", { name: "ดาวน์โหลด" }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  const downloaded = await download.createReadStream();
  expect(downloaded).not.toBeNull();
  const pieces: Buffer[] = [];
  for await (const chunk of downloaded!) pieces.push(Buffer.from(chunk));
  expect(Buffer.concat(pieces)).toEqual(proofBytes("foreign-income.pdf"));

  const calculateResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/calculate`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  const calculateResponse = await calculateResponsePromise;
  expect(calculateResponse.status()).toBe(200);
  expect(apiSuccessSchemas.snapshot.safeParse(await calculateResponse.json()).success).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/app/cases/${caseId}/result\\?preview=[0-9a-f-]+$`, "i"));
  await expect(page.getByText("เครดิตที่ใช้ได้ตามสมมติฐาน")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  const previewId = new URL(page.url()).searchParams.get("preview")!;
  const previewResponse = await browserApi(page, `/api/snapshots/${previewId}`);
  expect(previewResponse.status).toBe(200);
  const preview = (previewResponse.json as { data: { snapshot: CalculationSnapshot } }).data.snapshot;
  expect(preview.id).toBe(previewId);
  expect(preview.result.allowableCredit).toBe("2500.00");
  const taxpayerCard = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });
  await page.route(`**/api/cases/${caseId}`, (route) => route.abort(), { times: 1 });
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(taxpayerCard.getByRole("alert")).toContainText("รุ่นนโยบาย");
  await expect(taxpayerCard).not.toContainText("2,500.00");
  await taxpayerCard.getByRole("button", { name: "ลองโหลดผลคำนวณอีกครั้ง" }).click();
  await expect(taxpayerCard).toContainText("2,500.00");
  await expect(taxpayerCard.getByRole("link", { name: "เปิดรายงาน" })).toBeVisible();
  await page.reload();
  await expect(taxpayerCard).toContainText("2,500.00");
  await taxpayerCard.getByRole("link", { name: "เปิดรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${previewId}$`));
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  await assertFocusedSkipLinkIsScreenOnly(page, testInfo.outputPath("draft-report.pdf"));
  await page.goto(`/app/cases/${caseId}/result?preview=${previewId}`);
  await expect(page.getByText("เครดิตที่ใช้ได้ตามสมมติฐาน")).toBeVisible();
  const sourceLines = preview.result.lines.filter((line) => line.sourceId === sourceId);
  expect(sourceLines.map((line) => line.code)).toEqual([
    "source_D", "source_E_paid", "source_E_eligible", "source_F", "source_share", "source_G",
  ]);
  expect(sourceLines.map((line) => line.value)).toEqual(["50000", "5000", "5000", "25000", "0.5", "2500"]);
  const uploadedEvidence = caseDetail.attachments.map(({ id, sourceId: attachedSourceId, kind, displayName, mediaType, byteSize, sha256 }) => ({
    id, sourceId: attachedSourceId, kind, displayName, mediaType, byteSize, sha256,
  })).sort((left, right) => left.id.localeCompare(right.id));
  expect(preview.evidence.map((item) => ({ ...item })).sort((left, right) => left.id.localeCompare(right.id))).toEqual(uploadedEvidence);
  // Independent work: D=50,000, E=5,000, F=25,000 gives a 50% allocation (2,500).
  // N=25,000, K=J+N=125,000, so the L=20,000 cap is 4,000; min(O,P)=2,500.
  const allocatedFromReference = (25_000 / 50_000) * 5_000;
  const thaiCapFromReference = (25_000 / (100_000 + 25_000)) * 20_000;
  expect(Math.min(allocatedFromReference, thaiCapFromReference)).toBe(2_500);

  const submitPromise = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/submit`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" }).click();
  const submitResponse = await submitPromise;
  expect(submitResponse.status()).toBe(200);
  expect(apiSuccessSchemas.submission.safeParse(await submitResponse.json()).success).toBe(true);
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
  await page.getByRole("link", { name: "เปิดรายงาน / พิมพ์" }).click();
  await expect(page.getByRole("heading", { name: "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
  await expect(page.getByText("rd-ftc-demo-2568-v1")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  const reportUrl = page.url();
  const submittedSnapshotId = new URL(reportUrl).pathname.split("/").at(-1)!;
  expect(submittedSnapshotId).toMatch(/^[0-9a-f-]{36}$/i);
  const ownerDetail = await browserApi(page, `/api/cases/${caseId}`);
  const submittedCase = (ownerDetail.json as { data: { case: { status: string; draft: { revision: number }; submittedSnapshotId: string } } }).data.case;
  expect(submittedCase.status).toBe("submitted");
  expect(submittedCase.submittedSnapshotId).toBe(submittedSnapshotId);
  const submittedSnapshotResponse = await browserApi(page, `/api/snapshots/${submittedSnapshotId}`);
  expect(apiSuccessSchemas.snapshot.safeParse(submittedSnapshotResponse.json).success).toBe(true);
  const submittedSnapshot = (submittedSnapshotResponse.json as { data: { snapshot: CalculationSnapshot } }).data.snapshot;
  expect(submittedSnapshot.kind).toBe("submitted");
  expect(submittedSnapshot.revision).toBe(submittedCase.draft.revision);
  const submittedSourceLines = submittedSnapshot.result.lines.filter((line) => line.sourceId === sourceId);
  expect(submittedSourceLines.map((line) => line.code)).toEqual(sourceLines.map((line) => line.code));
  expect(submittedSourceLines.map((line) => line.value)).toEqual(sourceLines.map((line) => line.value));
  expect(submittedSnapshot.evidence.map((item) => ({ ...item })).sort((left, right) => left.id.localeCompare(right.id))).toEqual(uploadedEvidence);

  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(taxpayerCard).toContainText("ส่งแล้ว · คิวตรวจสอบ");
  await expect(taxpayerCard).toContainText("2,500.00");
  await taxpayerCard.getByRole("link", { name: "เปิดรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${submittedSnapshotId}$`));
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  await assertFocusedSkipLinkIsScreenOnly(page, testInfo.outputPath("submitted-report.pdf"));

  const taxpayerBContext = await browser.newContext();
  try {
    const bPage = await taxpayerBContext.newPage();
    await login(bPage, taxpayerB);
    const otherOwnerResults = await bPage.evaluate(async ({ caseId, snapshotId, attachmentId }) => {
      const urls = [`/api/cases/${caseId}`, `/api/snapshots/${snapshotId}`, `/api/attachments/${attachmentId}`];
      const statuses: number[] = [];
      for (const url of urls) statuses.push((await fetch(url)).status);
      return statuses;
    }, { caseId, snapshotId: submittedSnapshotId, attachmentId: caseDetail.attachments[0]!.id });
    expect(otherOwnerResults).toEqual([404, 404, 404]);
  } finally { await taxpayerBContext.close(); }

  const anonymousContext = await browser.newContext();
  try {
    const anon = await anonymousContext.newPage();
    await anon.goto("/login");
    const anonymousResults = await anon.evaluate(async ({ caseId, snapshotId, attachmentId }) => {
      const urls = [`/api/cases/${caseId}`, `/api/snapshots/${snapshotId}`, `/api/attachments/${attachmentId}`];
      const statuses: number[] = [];
      for (const url of urls) statuses.push((await fetch(url)).status);
      return statuses;
    }, { caseId, snapshotId: submittedSnapshotId, attachmentId: caseDetail.attachments[0]!.id });
    expect(anonymousResults).toEqual([401, 401, 401]);
  } finally { await anonymousContext.close(); }

  const officerContext = await browser.newContext();
  try {
    const officerPage = await officerContext.newPage();
    const officerSession = await login(officerPage, officer, true);
    await expect(officerPage.getByRole("heading", { name: "คิวกรณีที่ส่งเข้าตรวจสอบ" })).toBeVisible();
    const queue = await browserApi(officerPage, "/api/officer/cases");
    const queueCase = (queue.json as { data: { cases: Array<{ id: string; assignedOfficerId: string }> } }).data.cases.find((item) => item.id === caseId);
    expect(queueCase?.assignedOfficerId).toBe(seed.FTC_OFFICER_USER_ID);
    await officerPage.getByRole("link", { name: "ตรวจทานแบบอ่านอย่างเดียว" }).first().click();
    await expect(officerPage.getByText("ส่งแล้ว · อ่านอย่างเดียว")).toBeVisible();
    await expect(officerPage.getByRole("heading", { name: "ประวัติการเข้าถึง" })).toBeVisible();
    await officerPage.getByRole("link", { name: "ดูรายงานที่พิมพ์ได้" }).click();
    await expect(officerPage).toHaveURL(reportUrl);
    await expect(officerPage.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
    await expect(officerPage.getByText("2,500.00", { exact: true }).first()).toBeVisible();
    const officerMutation = await browserApi(officerPage, `/api/cases/${caseId}/draft`, {
      method: "PUT", csrfToken: officerSession.csrfToken,
      body: { expectedRevision: 0, requestId: "officer-read-only-proof", data: {} },
    });
    expect(officerMutation.status).toBe(403);
    const audit = await browserApi(officerPage, `/api/officer/cases/${caseId}`);
    expect(audit.status).toBe(200);
    expect(apiSuccessSchemas.officerCaseDetail.safeParse(audit.json).success).toBe(true);
    const auditRows = (audit.json as { data: { auditEvents: Array<{ eventType: string }>; snapshot: { id: string } } }).data;
    expect(auditRows.snapshot.id).toBe(submittedSnapshotId);
    expect(auditRows.auditEvents.length).toBeGreaterThan(0);
  } finally { await officerContext.close(); }

  const submittedEdit = await browserApi(page, `/api/cases/${caseId}/draft`, {
    method: "PUT", csrfToken: a.csrfToken,
    body: {
      expectedRevision: submittedCase.draft.revision,
      requestId: "submitted-read-only-proof",
      data: submittedCase.draft,
    },
  });
  expect(submittedEdit.status).toBe(409);
  expect((submittedEdit.json as { error?: { message?: string } }).error?.message).toBe("รายการที่ส่งแล้วแก้ไขไม่ได้");
});

test("real API rejects incomplete and unsupported input without inventing an ordinary credit", async ({ page }) => {
  const seed = await operatorSeed();
  await login(page, seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!);
  const caseId = await createCase(page);
  for (let step = 0; step < 4; step += 1) await advance(page);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/cases/${caseId}/result\\?preview=`));
  await expect(page.locator('.alert[role="status"]').filter({ hasText: "ข้อมูลยังไม่ครบสำหรับคำนวณ" })).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true })).toHaveCount(0);
  const incompleteId = new URL(page.url()).searchParams.get("preview")!;
  const incomplete = await browserApi(page, `/api/snapshots/${incompleteId}`);
  expect((incomplete.json as { data: { snapshot: { result: { outcome: string; allowableCredit: string | null } } } }).data.snapshot.result).toMatchObject({ outcome: "incomplete", allowableCredit: null });

  await page.getByRole("button", { name: "กลับไปแก้ไข" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await advance(page);
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();
  await page.getByLabel("ประเทศที่เกิดเงินได้").selectOption("XX");
  await page.locator(".source-card").first().locator("select").nth(1).selectOption("other");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2024-03-01");
  await page.getByLabel("วันพำนักในประเทศไทยในปีที่เกิดเงินได้").fill("179");
  await page.getByLabel("รูปแบบการกรอก").selectOption("worksheet_thb");
  await advance(page);
  await advance(page);
  await page.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ").fill("10000");
  await page.getByLabel("L · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ").fill("1000");
  await page.getByLabel("ที่มาของจำนวน L").fill("ค่าทดสอบขอบเขต");
  await advance(page);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByText("ต้นแบบรองรับเฉพาะปีภาษี 2568 (ค.ศ. 2025)")).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" })).toBeDisabled();
  const unsupportedId = new URL(page.url()).searchParams.get("preview")!;
  const unsupported = await browserApi(page, `/api/snapshots/${unsupportedId}`);
  expect((unsupported.json as { data: { snapshot: { result: { outcome: string; allowableCredit: string | null } } } }).data.snapshot.result).toMatchObject({ outcome: "needs_review", allowableCredit: null });
});

test("real stale save offers deliberate reapply and keeps typed values until saved", async ({ browser }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  try {
    const first = await firstContext.newPage();
    await login(first, credential);
    const caseId = await createCase(first);
    const second = await secondContext.newPage();
    const secondSession = await login(second, credential);
    for (let step = 0; step < 3; step += 1) await advance(first);
    await first.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ").fill("111111");
    const latestEnvelope = (await browserApi(second, `/api/cases/${caseId}`)).json as { data: { case: { draft: Record<string, unknown> & { revision: number } } } };
    const latestDraft = latestEnvelope.data.case.draft;
    const independentSave = await browserApi(second, `/api/cases/${caseId}/draft`, {
      method: "PUT", csrfToken: secondSession.csrfToken,
      body: {
        expectedRevision: latestDraft.revision,
        requestId: crypto.randomUUID(),
        data: { ...latestDraft, domesticAssessableIncome: "222222.00" },
        confirmations: { thaiTax: false, eligibleSourceIds: [], eligibleSourceIndexes: [] },
      },
    });
    expect(independentSave.status).toBe(200);
    const conflictResponsePromise = first.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/draft`) && response.request().method() === "PUT");
    await first.getByRole("button", { name: "บันทึกร่าง" }).click();
    expect((await conflictResponsePromise).status()).toBe(409);
    await expect(first.locator(".conflict-panel")).toContainText("ไม่บันทึกทับข้อมูลล่าสุดโดยอัตโนมัติ");
    await first.getByRole("button", { name: "นำการแก้ไขปัจจุบันไปใช้ต่อ" }).click();
    await expect(first.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ")).toHaveValue("111111");
    await expect(first.locator(".conflict-panel")).toBeHidden();
    const reapplyResponsePromise = first.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseId}/draft`) && response.request().method() === "PUT");
    await first.getByRole("button", { name: "บันทึกร่าง" }).click();
    const reapplyResponse = await reapplyResponsePromise;
    const reapplyRequest = reapplyResponse.request().postDataJSON() as { expectedRevision?: number };
    expect(reapplyResponse.status(), `reapply save used revision ${reapplyRequest.expectedRevision}`).toBe(200);
    await expect(first.getByRole("status").filter({ hasText: /บันทึกแล้ว · รุ่นข้อมูล/ })).toBeVisible();
    await first.reload();
    for (let step = 0; step < 3; step += 1) await advance(first);
    await expect(first.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ")).toHaveValue("111111");
    const saved = await browserApi(first, `/api/cases/${caseId}`);
    const savedDraft = (saved.json as { data: { case: { draft: { domesticAssessableIncome: string } } } }).data.case.draft;
    expect(savedDraft.domesticAssessableIncome).toBe("111111");
  } finally {
    await secondContext.close();
    await firstContext.close();
  }
});

test("real same-browser logout and account switch clear the previous account's cached draft", async ({ page }) => {
  const seed = await operatorSeed();
  const taxpayerA = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const taxpayerB = seed.credentials.find((item) => item.loginName === "taxpayer-demo-b")!;
  const sessionA = await login(page, taxpayerA);
  const caseId = await createCase(page);
  const cacheKey = `ftc.hosted.pending.${sessionA.userId}.${caseId}`;
  await page.evaluate((key) => sessionStorage.setItem(key, JSON.stringify({ ownerId: "old-account-cache" })), cacheKey);
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), cacheKey)).toBeNull();
  await login(page, taxpayerB);
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
  const bCases = await browserApi(page, "/api/cases");
  expect((bCases.json as { data: { cases: Array<{ id: string }> } }).data.cases.some((record) => record.id === caseId)).toBe(false);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), cacheKey)).toBeNull();
});

test("real hosted and fixture identities cannot cross route modes; fixture choice revokes hosted session and hosted login restores it", async ({ page }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  await login(page, credential);

  // A live server identity cannot render the fixture UI at fixture-only URLs.
  await page.goto("/demo/app");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator(".mode-tag")).toHaveCount(0);
  await page.goto(`/demo/reports/${crypto.randomUUID()}`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator(".mode-tag")).toHaveCount(0);

  // Create a real server snapshot so the report boundary is exercised against a real id.
  await page.goto("/app");
  const caseId = await createCase(page);
  for (let step = 0; step < 4; step += 1) await advance(page);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/cases/${caseId}/result\\?preview=`));
  const realSnapshotId = new URL(page.url()).searchParams.get("preview")!;
  const snapshotProbe = await browserApi(page, `/api/snapshots/${realSnapshotId}`);
  expect(snapshotProbe.status).toBe(200);

  // Selecting the fixture persona from a hosted session confirms server logout first.
  await page.goto("/demo");
  const logoutResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.locator(".mode-tag")).toBeVisible();
  const endedSession = await browserApi(page, "/api/auth/session");
  expect(endedSession.status).toBe(401);

  let snapshotReads = 0;
  page.on("request", (request) => { if (request.url().includes("/api/snapshots/")) snapshotReads += 1; });
  await page.goto("/app");
  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.locator(".mode-tag")).toBeVisible();
  await page.goto(`/reports/${realSnapshotId}`);
  await expect(page).toHaveURL(/\/demo\/app$/);
  expect(snapshotReads).toBe(0);

  // An explicit hosted login clears the fixture marker and restores the server identity.
  await login(page, credential);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator(".mode-tag")).toHaveCount(0);
  expect((await browserApi(page, "/api/auth/session")).status).toBe(200);
  snapshotReads = 0;
  await page.goto("/demo/app");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(`/demo/reports/${realSnapshotId}`);
  await expect(page).toHaveURL(/\/app$/);
  expect(snapshotReads).toBe(0);
});

test("fixture chooser waits for the real initial hosted session response before allowing a mode switch", async ({ browser }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const signedInContext = await browser.newContext();
  let fixtureContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const signedInPage = await signedInContext.newPage();
    await login(signedInPage, credential);
    const savedStorageState = await signedInContext.storageState();
    fixtureContext = await browser.newContext({ storageState: savedStorageState });
    const page = await fixtureContext.newPage();

    let releaseSession!: () => void;
    let sessionResponseReady!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseSession = resolve; });
    const realSessionReady = new Promise<void>((resolve) => { sessionResponseReady = resolve; });
    await page.route("**/api/auth/session", async (route) => {
      const actualResponse = await route.fetch();
      sessionResponseReady();
      await responseGate;
      await route.fulfill({ response: actualResponse });
    });

    await page.goto("/demo");
    await realSessionReady;
    await expect(page.getByRole("status").filter({ hasText: "กำลังตรวจสอบเซสชัน" })).toBeVisible();
    await expect(page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" })).toHaveCount(0);

    releaseSession();
    await expect(page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" })).toBeVisible();
    const logoutResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
    await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
    expect((await logoutResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/demo\/app$/);
    expect((await browserApi(page, "/api/auth/session")).status).toBe(401);
  } finally {
    await fixtureContext?.close();
    await signedInContext.close();
  }
});

test("offline fixture fallback discloses that an existing hosted session could not be checked", async ({ browser }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const signedInContext = await browser.newContext();
  let offlineContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const signedInPage = await signedInContext.newPage();
    const signedInSession = await login(signedInPage, credential);
    offlineContext = await browser.newContext({ storageState: await signedInContext.storageState() });
    const page = await offlineContext.newPage();
    await page.route("**/api/auth/session", (route) => route.abort("internetdisconnected"));
    await page.goto("/demo");
    await expect(page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" })).toBeEnabled();
    const sessionWarning = page.getByRole("alert");
    await expect(sessionWarning).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await expect(sessionWarning).toContainText("rd-ftc-demo-2568-v1");

    await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
    await expect(page).toHaveURL(/\/demo\/app$/);
    await expect(page.locator(".mode-tag")).toBeVisible();
    const persistentWarning = page.getByRole("alert");
    await expect(persistentWarning).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await page.reload();
    await expect(page.locator(".mode-tag")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await page.goto(`/demo/reports/${crypto.randomUUID()}`);
    await expect(page.getByRole("alert").filter({ hasText: "ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว" })).toBeVisible();
    await page.goto("/demo");
    await expect(page.getByRole("alert")).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะเจ้าหน้าที่" }).click();
    await expect(page).toHaveURL(/\/demo\/officer$/);
    await expect(page.getByRole("alert")).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await page.unroute("**/api/auth/session");
    expect((await browserApi(page, "/api/auth/session")).status).toBe(200);
    await page.getByRole("button", { name: "ตรวจสอบสถานะออนไลน์" }).click();
    await expect(page.getByRole("alert")).toContainText("ตรวจพบว่าเซสชันออนไลน์เดิมยังเปิดอยู่");
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("ตรวจพบว่าเซสชันออนไลน์เดิมยังเปิดอยู่");
    const endedOnlineSession = await browserApi(page, "/api/auth/logout", { method: "POST", csrfToken: signedInSession.csrfToken });
    expect(endedOnlineSession.status).toBe(200);
    await page.getByRole("button", { name: "ตรวจสอบสถานะออนไลน์" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await offlineContext?.close();
    await signedInContext.close();
  }
});

test("a delayed real session refresh cannot restore an obsolete warning after hosted login and confirmed logout", async ({ browser }) => {
  const seed = await operatorSeed();
  const taxpayerA = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const taxpayerB = seed.credentials.find((item) => item.loginName === "taxpayer-demo-b")!;
  const signedInContext = await browser.newContext();
  let probeContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let releaseOldSession!: () => void;
  try {
    const signedInPage = await signedInContext.newPage();
    const a = await login(signedInPage, taxpayerA);
    probeContext = await browser.newContext({ storageState: await signedInContext.storageState() });
    const page = await probeContext.newPage();
    await page.route("**/api/auth/session", (route) => route.abort("internetdisconnected"), { times: 1 });
    await page.goto("/demo");
    await expect(page.getByRole("alert")).toContainText("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว");
    await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
    await expect(page).toHaveURL(/\/demo\/app$/);

    let oldResponseFetched!: () => void;
    const fetched = new Promise<void>((resolve) => { oldResponseFetched = resolve; });
    const responseGate = new Promise<void>((resolve) => { releaseOldSession = resolve; });
    let delayedResponseSetsCookie = false;
    await page.route("**/api/auth/session", async (route) => {
      const actualResponse = await route.fetch();
      delayedResponseSetsCookie = Object.hasOwn(actualResponse.headers(), "set-cookie");
      oldResponseFetched();
      await responseGate;
      await route.fulfill({ response: actualResponse });
    }, { times: 1 });
    const oldRefreshResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/session") && response.request().method() === "GET");
    await page.getByRole("button", { name: "ตรวจสอบสถานะออนไลน์" }).click();
    await fetched;

    // Keep the same React session provider alive while changing identity and mode.
    await page.evaluate(() => {
      const browser = globalThis as unknown as {
        history: { pushState: (data: object, unused: string, url?: string) => void };
        dispatchEvent: (event: object) => boolean;
        PopStateEvent: new (type: string, init: { state: null }) => object;
      };
      browser.history.pushState({}, "", "/login");
      browser.dispatchEvent(new browser.PopStateEvent("popstate", { state: null }));
    });
    await expect(page.getByRole("heading", { name: "เข้าสู่ระบบผู้เสียภาษี" })).toBeVisible();
    const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.getByLabel("ชื่อผู้ใช้").fill(taxpayerB.loginName);
    await page.getByLabel("รหัสผ่าน").fill(taxpayerB.password);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    const b = await loginResponse.json() as { data?: { user?: { id?: string; displayName?: string } } };
    expect(b.data?.user?.id).toBeTruthy();
    expect(b.data?.user?.id).not.toBe(a.userId);
    await expect(page).toHaveURL(/\/app$/);
    expect((await browserApi(page, "/api/auth/session")).status).toBe(200);

    releaseOldSession();
    expect((await oldRefreshResponse).status()).toBe(200);
    expect(delayedResponseSetsCookie).toBe(false);
    await expect(page).toHaveURL(/\/app$/);
    expect((await browserApi(page, "/api/auth/session")).status).toBe(200);
    expect(await page.evaluate(() => sessionStorage.getItem("ftc.hosted.session.unverified"))).toBeNull();

    await page.evaluate(() => {
      const browser = globalThis as unknown as {
        history: { pushState: (data: object, unused: string, url?: string) => void };
        dispatchEvent: (event: object) => boolean;
        PopStateEvent: new (type: string, init: { state: null }) => object;
      };
      browser.history.pushState({}, "", "/demo");
      browser.dispatchEvent(new browser.PopStateEvent("popstate", { state: null }));
    });
    await expect(page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" })).toBeVisible();
    const logoutResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
    await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
    expect((await logoutResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/demo\/app$/);
    expect((await browserApi(page, "/api/auth/session")).status).toBe(401);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("ftc.hosted.session.unverified"))).toBeNull();
  } finally {
    releaseOldSession?.();
    await probeContext?.close();
    await signedInContext.close();
  }
});

test("a delayed confirmed logout cannot clear a newer hosted login", async ({ page }) => {
  const seed = await operatorSeed();
  const taxpayerA = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  const taxpayerB = seed.credentials.find((item) => item.loginName === "taxpayer-demo-b")!;
  await login(page, taxpayerA);

  let releaseLogout!: () => void;
  let logoutResponseFetched!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseLogout = resolve; });
  const fetched = new Promise<void>((resolve) => { logoutResponseFetched = resolve; });
  let delayedLogoutSetsCookie = false;
  await page.route("**/api/auth/logout", async (route) => {
    const actualResponse = await route.fetch();
    delayedLogoutSetsCookie = Object.hasOwn(actualResponse.headers(), "set-cookie");
    logoutResponseFetched();
    await responseGate;
    await route.fulfill({ response: actualResponse });
  }, { times: 1 });
  try {
    const oldLogoutResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
    await page.getByRole("button", { name: "ออกจากระบบ" }).click();
    await fetched;
    await page.evaluate(() => {
      const browser = globalThis as unknown as {
        history: { pushState: (data: object, unused: string, url?: string) => void };
        dispatchEvent: (event: object) => boolean;
        PopStateEvent: new (type: string, init: { state: null }) => object;
      };
      browser.history.pushState({}, "", "/login");
      browser.dispatchEvent(new browser.PopStateEvent("popstate", { state: null }));
    });
    await expect(page.getByRole("heading", { name: "เข้าสู่ระบบผู้เสียภาษี" })).toBeVisible();
    const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.getByLabel("ชื่อผู้ใช้").fill(taxpayerB.loginName);
    await page.getByLabel("รหัสผ่าน").fill(taxpayerB.password);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    const b = await loginResponse.json() as { data?: { user?: { id?: string; displayName?: string } } };
    expect(b.data?.user?.id).toBeTruthy();
    await expect(page).toHaveURL(/\/app$/);
    const currentSession = await browserApi(page, "/api/auth/session");
    expect(currentSession.status).toBe(200);
    expect((currentSession.json as { data: { user: { id: string } } }).data.user.id).toBe(b.data?.user?.id);

    releaseLogout();
    expect((await oldLogoutResponse).status()).toBe(200);
    expect(delayedLogoutSetsCookie).toBe(false);
    await expect(page).toHaveURL(/\/app$/);
    const afterLateLogout = await browserApi(page, "/api/auth/session");
    expect(afterLateLogout.status).toBe(200);
    expect((afterLateLogout.json as { data: { user: { id: string } } }).data.user.id).toBe(b.data?.user?.id);
    await expect(page.getByRole("banner").getByText(b.data?.user?.displayName ?? "", { exact: true })).toBeVisible();
  } finally {
    releaseLogout?.();
  }
});

test("hosted editor guards Back/Forward and sign-out while preserving dirty values until confirmed", async ({ page }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  await login(page, credential);
  await createCase(page);
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]+\/edit$/i);
  const taxYear = page.getByLabel("ปีภาษี (พ.ศ.)");
  await taxYear.selectOption("2567");

  const forwardPrompt = page.waitForEvent("dialog");
  const forwardNavigation = page.goForward();
  const forwardDialog = await forwardPrompt;
  expect(forwardDialog.message()).toContain("มีข้อมูลที่ยังไม่ได้บันทึก");
  await forwardDialog.dismiss();
  await forwardNavigation;
  await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]+\/edit$/i);
  await expect(taxYear).toHaveValue("2567");

  const backPrompt = page.waitForEvent("dialog");
  const backNavigation = page.goBack();
  const backDialog = await backPrompt;
  expect(backDialog.message()).toContain("มีข้อมูลที่ยังไม่ได้บันทึก");
  await backDialog.dismiss();
  await backNavigation;
  await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]+\/edit$/i);
  await expect(taxYear).toHaveValue("2567");

  const acceptedBackPrompt = page.waitForEvent("dialog");
  const acceptedBack = page.goBack();
  const acceptedBackDialog = await acceptedBackPrompt;
  await acceptedBackDialog.accept();
  await acceptedBack;
  await expect(page).toHaveURL(/\/app$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]+\/edit$/i);
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("");

  await taxYear.selectOption("2567");
  let logoutRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/auth/logout")) logoutRequests += 1; });
  let signOutMessage = "";
  const dismissDirtySignOut = (dialog: import("@playwright/test").Dialog) => {
    signOutMessage = dialog.message();
    void dialog.dismiss();
  };
  page.on("dialog", dismissDirtySignOut);
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  page.off("dialog", dismissDirtySignOut);
  expect(signOutMessage).toContain("มีข้อมูลที่ยังไม่ได้บันทึก");
  expect(logoutRequests).toBe(0);
  expect((await browserApi(page, "/api/auth/session")).status).toBe(200);
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2567");

  const skipDialog = page.waitForEvent("dialog", { timeout: 250 }).catch(() => null);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const skipLink = page.getByRole("link", { name: "ข้ามไปยังเนื้อหาหลัก" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await skipDialog).toBeNull();
  await expect(page).toHaveURL(/#main-content$/);
});

test("fixture mode switch keeps the hosted session visible after a real logout rejection and retries safely across reload", async ({ page }) => {
  const seed = await operatorSeed();
  const credential = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")!;
  await login(page, credential);
  await page.goto("/demo");

  await page.route("**/api/auth/logout", async (route) => {
    const headers = { ...route.request().headers(), "x-csrf-token": "deliberately-invalid-test-token" };
    await route.continue({ headers });
  }, { times: 1 });

  const failedLogoutPromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  const failedLogout = await failedLogoutPromise;
  expect(failedLogout.status()).toBe(403);
  const failureEnvelope = await failedLogout.json() as { error?: { requestId?: string } };
  const requestId = failureEnvelope.error?.requestId;
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
  const failureAlert = page.getByRole("alert");
  await expect(failureAlert).toContainText(requestId!);
  await expect(failureAlert).toContainText("rd-ftc-demo-2568-v1");
  await expect(page).toHaveURL(/\/demo$/);
  expect((await browserApi(page, "/api/auth/session")).status).toBe(200);

  const retryLogoutPromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  expect((await retryLogoutPromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.locator(".mode-tag")).toBeVisible();
  expect((await browserApi(page, "/api/auth/session")).status).toBe(401);

  await page.reload();
  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.locator(".mode-tag")).toBeVisible();
  expect((await browserApi(page, "/api/auth/session")).status).toBe(401);
});
