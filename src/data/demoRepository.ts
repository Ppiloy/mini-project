import type {
  ApiUser,
  AttachmentMetadata,
  CalculationSnapshot,
  FrozenEvidenceReference,
  FtcCaseDraft,
  FtcCaseRecord,
  SubmissionAcknowledgement,
  SubmissionMetadata,
} from "../../shared/contracts.js";
import { validateSubmission, withCanonicalThbAmounts } from "../../shared/calculator.js";
import { missingEvidenceInventory } from "../../shared/evidenceInventory.js";
import { AVAILABLE_EVIDENCE_STATEMENT_V1 } from "../../shared/labels.js";
import { DEMO_POLICY } from "../../shared/policy.js";
import { createCalculationSnapshot } from "../../shared/snapshot.js";
import { deleteDemoEvidenceFiles, readDemoEvidenceFile, storeDemoEvidenceFile } from "./demoEvidenceStore.js";

const STORE_KEY = "ftc.prototype.fixture.v1";

export type DemoPersona = "taxpayer" | "officer";

interface DemoStore {
  cases: FtcCaseRecord[];
  snapshots: CalculationSnapshot[];
  attachments: AttachmentMetadata[];
  storedEvidenceIds: string[];
}

const blankStore = (): DemoStore => ({ cases: [], snapshots: [], attachments: [], storedEvidenceIds: [] });

function invalidStoreError(): Error {
  return new Error("เปิดข้อมูลสาธิตไม่ได้ เพราะเบราว์เซอร์ไม่อนุญาตให้อ่านพื้นที่จัดเก็บหรือข้อมูลเสียหาย กรุณาเปิดใช้พื้นที่จัดเก็บในเบราว์เซอร์หรือกู้คืนข้อมูลเดิม แล้วโหลดหน้านี้ใหม่ ข้อมูลเดิมยังไม่ได้ถูกลบหรือเขียนทับ");
}

function readStore(): DemoStore {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORE_KEY);
  } catch {
    throw invalidStoreError();
  }
  if (stored === null) return blankStore();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw invalidStoreError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidStoreError();

  const candidate = parsed as Partial<DemoStore>;
  const storedEvidenceIds = candidate.storedEvidenceIds;
  if (!Array.isArray(candidate.cases) || !Array.isArray(candidate.snapshots) || !Array.isArray(candidate.attachments)
    || (storedEvidenceIds !== undefined && (!Array.isArray(storedEvidenceIds) || !storedEvidenceIds.every((id) => typeof id === "string")))) {
    throw invalidStoreError();
  }
  return {
    cases: candidate.cases,
    snapshots: candidate.snapshots,
    attachments: candidate.attachments,
    storedEvidenceIds: storedEvidenceIds ?? [],
  };
}

function writeStore(store: DemoStore): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function touchCase(store: DemoStore, caseId: string): void {
  const index = store.cases.findIndex((record) => record.id === caseId && record.status === "draft");
  if (index < 0) return;
  const now = new Date().toISOString();
  const record = store.cases[index]!;
  store.cases[index] = { ...record, draft: { ...record.draft, revision: record.draft.revision + 1, updatedAt: now }, updatedAt: now };
}

export function demoUser(persona: DemoPersona): ApiUser {
  return persona === "officer"
    ? { id: "demo-officer", loginName: "officer-demo", displayName: "เจ้าหน้าที่ตัวอย่าง", role: "officer", maskedReference: null }
    : { id: "demo-taxpayer", loginName: "taxpayer-demo", displayName: "ผู้ใช้โดยไม่เข้าสู่ระบบ", role: "taxpayer", maskedReference: null };
}

export function listDemoCases(persona: DemoPersona): FtcCaseRecord[] {
  const user = demoUser(persona);
  const all = readStore().cases;
  return persona === "officer"
    ? all.filter((record) => record.status === "submitted" && record.assignedOfficerId === user.id)
    : all.filter((record) => record.ownerId === user.id);
}

export function findDemoCase(id: string, persona: DemoPersona): FtcCaseRecord | undefined {
  return listDemoCases(persona).find((record) => record.id === id);
}

async function evidenceFingerprint(file: Blob): Promise<string> {
  if (!crypto.subtle) return Promise.reject(new Error("ไม่สามารถตรวจสอบไฟล์ในเบราว์เซอร์นี้ได้"));
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function assertDemoAttachmentAllowed(store: DemoStore, caseId: string, sourceId: string | null, file: File): FtcCaseRecord {
  const record = store.cases.find((item) => item.id === caseId && item.status === "draft");
  if (!record) throw new Error("ไม่พบร่างที่แนบไฟล์ได้ในสาธิตนี้");
  if (sourceId !== null && !record.draft.sources.some((source) => source.id === sourceId)) {
    throw new Error("ไม่พบแหล่งเงินได้ที่เลือก กรุณาบันทึกร่างล่าสุดก่อนแนบไฟล์");
  }
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("รองรับเฉพาะไฟล์ PDF, JPEG หรือ PNG");
  }
  if (file.size <= 0 || file.size > 3 * 1024 * 1024) throw new Error("ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 3 MiB");
  const currentFiles = store.attachments.filter((item) => item.caseId === caseId && item.status !== "deleted");
  const sameSource = currentFiles.filter((item) => item.sourceId === sourceId);
  if (sameSource.length >= 5) throw new Error("แนบไฟล์ต่อรายการได้ไม่เกิน 5 ไฟล์");
  if (currentFiles.length >= 20 || currentFiles.reduce((sum, item) => sum + item.byteSize, 0) + file.size > 30 * 1024 * 1024) {
    throw new Error("ไฟล์เกินโควตาของกรณี: สูงสุด 20 ไฟล์และรวม 30 MiB");
  }
  return record;
}

export function createDemoCase(): FtcCaseRecord {
  const now = new Date().toISOString();
  const id = `demo-${crypto.randomUUID()}`;
  const draft: FtcCaseDraft = {
    id,
    taxYear: 2025,
    domesticAssessableIncome: null,
    thaiTax: { amountBeforeFtc: null, provenance: null, confirmedAt: null, confirmedInputFingerprint: null },
    sources: [],
    residenceYears: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  const record: FtcCaseRecord = {
    id,
    ownerId: demoUser("taxpayer").id,
    status: "draft",
    draft,
    assignedOfficerId: null,
    submittedSnapshotId: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store.cases.unshift(record);
  writeStore(store);
  return record;
}

export function createDemoCaseFromDraft(example: FtcCaseDraft): FtcCaseRecord {
  const created = createDemoCase();
  const draft: FtcCaseDraft = {
    ...structuredClone(example),
    id: created.id,
    revision: created.draft.revision,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    sources: example.sources.map((source) => ({ ...structuredClone(source), id: null })),
  };
  return saveDemoDraft(created.id, draft);
}

export function saveDemoDraft(id: string, draft: FtcCaseDraft): FtcCaseRecord {
  const store = readStore();
  const index = store.cases.findIndex((record) => record.id === id && record.status === "draft");
  if (index < 0) throw new Error("ไม่พบร่างที่แก้ไขได้ในสาธิตนี้");
  const now = new Date().toISOString();
  const savedDraft = {
    ...draft,
    id,
    revision: store.cases[index]!.draft.revision + 1,
    updatedAt: now,
    sources: draft.sources.map((source) => source.id === null ? { ...source, id: `demo-source-${crypto.randomUUID()}` } : source),
  };
  const saved: FtcCaseRecord = {
    ...store.cases[index]!,
    draft: savedDraft,
    updatedAt: now,
  };
  store.cases[index] = saved;
  writeStore(store);
  return saved;
}

export function saveDemoSnapshot(snapshot: CalculationSnapshot): CalculationSnapshot {
  const store = readStore();
  const record = store.cases.find((item) => item.id === snapshot.caseId);
  if (!record || record.status !== "draft") throw new Error("ไม่สามารถเปลี่ยนผลของกรณีที่ส่งแล้วได้");
  if (snapshot.kind !== "preview" || snapshot.revision !== record.draft.revision
    || JSON.stringify(snapshot.inputs) !== JSON.stringify(withCanonicalThbAmounts(record.draft))) {
    throw new Error("ผลคำนวณไม่ตรงกับร่างที่บันทึกไว้");
  }
  const old = store.snapshots.findIndex((item) => item.caseId === snapshot.caseId && item.revision === snapshot.revision && item.kind === snapshot.kind);
  if (old >= 0) store.snapshots.splice(old, 1);
  store.snapshots.unshift(snapshot);
  writeStore(store);
  return snapshot;
}

export function findDemoSnapshot(id: string): CalculationSnapshot | undefined {
  return readStore().snapshots.find((item) => item.id === id);
}

export function latestDemoPreview(caseId: string, revision: number): CalculationSnapshot | undefined {
  return readStore().snapshots.find((item) => item.caseId === caseId
    && item.kind === "preview"
    && item.revision === revision
    && item.policy.id === DEMO_POLICY.id
    && item.result.policyVersion === DEMO_POLICY.id
    && item.result.engineVersion === DEMO_POLICY.engineVersion);
}

export async function addDemoAttachment(caseId: string, sourceId: string | null, kind: AttachmentMetadata["kind"], file: File): Promise<AttachmentMetadata> {
  const beforeSave = readStore();
  assertDemoAttachmentAllowed(beforeSave, caseId, sourceId, file);
  const sha256 = await evidenceFingerprint(file);
  const attachment: AttachmentMetadata = {
    id: `demo-evidence-${crypto.randomUUID()}`,
    caseId,
    sourceId,
    kind,
    displayName: file.name,
    mediaType: file.type || "application/octet-stream",
    byteSize: file.size,
    sha256,
    status: "ready",
    createdAt: new Date().toISOString(),
  };
  await storeDemoEvidenceFile(attachment.id, file);
  const store = readStore();
  try {
    assertDemoAttachmentAllowed(store, caseId, sourceId, file);
  } catch (error) {
    await deleteDemoEvidenceFiles([attachment.id]);
    throw error;
  }
  store.attachments.unshift(attachment);
  store.storedEvidenceIds = [...new Set([...store.storedEvidenceIds, attachment.id])];
  touchCase(store, caseId);
  try {
    writeStore(store);
  } catch (error) {
    await deleteDemoEvidenceFiles([attachment.id]).catch(() => undefined);
    throw error;
  }
  return attachment;
}

export async function getDemoAttachmentFile(id: string): Promise<Blob | null> {
  try {
    const blob = await readDemoEvidenceFile(id);
    if (!blob) markDemoEvidenceUnavailable(id);
    return blob;
  } catch {
    markDemoEvidenceUnavailable(id);
    return null;
  }
}

export function listDemoAttachments(caseId: string): AttachmentMetadata[] {
  const store = readStore();
  const storedEvidenceIds = new Set(store.storedEvidenceIds);
  return store.attachments
    .filter((item) => item.caseId === caseId && item.status !== "deleted")
    .map((item) => item.status === "ready" && !storedEvidenceIds.has(item.id) ? { ...item, status: "failed" } : item);
}

function markDemoEvidenceUnavailable(id: string): void {
  const store = readStore();
  const attachment = store.attachments.find((item) => item.id === id && item.status !== "failed");
  if (!attachment || !store.cases.some((record) => record.id === attachment.caseId && record.status === "draft")) return;
  store.attachments = store.attachments.map((item) => item.id === id ? { ...item, status: "failed" } : item);
  store.storedEvidenceIds = store.storedEvidenceIds.filter((value) => value !== id);
  if (attachment.status === "ready") touchCase(store, attachment.caseId);
  try { writeStore(store); } catch { /* The caller still reports the missing file without claiming it is usable. */ }
}

export async function deleteDemoAttachment(id: string): Promise<void> {
  const store = readStore();
  const attachment = store.attachments.find((item) => item.id === id);
  if (attachment && !store.cases.some((record) => record.id === attachment.caseId && record.status === "draft")) {
    throw new Error("ไฟล์ของกรณีที่ส่งแล้วไม่สามารถลบหรือเปลี่ยนได้");
  }
  const next = structuredClone(store);
  next.attachments = next.attachments.filter((item) => item.id !== id);
  next.storedEvidenceIds = next.storedEvidenceIds.filter((value) => value !== id);
  if (attachment) touchCase(next, attachment.caseId);
  writeStore(next);
  try {
    await deleteDemoEvidenceFiles([id]);
  } catch (error) {
    writeStore(store);
    throw error;
  }
}

export async function submitDemoCase(id: string, acknowledgement: SubmissionAcknowledgement): Promise<{ case: FtcCaseRecord; snapshot: CalculationSnapshot }> {
  let store = readStore();
  let index = store.cases.findIndex((record) => record.id === id && record.ownerId === demoUser("taxpayer").id && record.status === "draft");
  if (index < 0) throw new Error("กรณีนี้ส่งแล้วหรือไม่อยู่ในคิวสาธิต");
  if (acknowledgement.version !== 1 || acknowledgement.acknowledged !== true
    || !Number.isSafeInteger(acknowledgement.revision) || typeof acknowledgement.previewSnapshotId !== "string") {
    throw new Error("กรุณายืนยันเอกสารที่มีอยู่ก่อนส่งตรวจ");
  }

  const findPreview = (currentStore: DemoStore, currentIndex: number): CalculationSnapshot | undefined => currentStore.snapshots.find((item) =>
    item.id === acknowledgement.previewSnapshotId && item.caseId === id && item.kind === "preview"
      && item.revision === currentStore.cases[currentIndex]!.draft.revision);
  const collectEvidence = (currentStore: DemoStore): FrozenEvidenceReference[] => currentStore.attachments
    .filter((item) => item.caseId === id && item.status === "ready")
    .map(({ id: evidenceId, sourceId, kind, displayName, mediaType, byteSize, sha256 }) => ({ id: evidenceId, sourceId, kind, displayName, mediaType, byteSize, sha256 }));
  const computeCurrentPreview = (currentStore: DemoStore, currentIndex: number) => {
    const record = currentStore.cases[currentIndex]!;
    const draft = withCanonicalThbAmounts(record.draft);
    const evidence = collectEvidence(currentStore);
    const preview = createCalculationSnapshot({ id: acknowledgement.previewSnapshotId, caseId: id, revision: record.draft.revision,
      kind: "preview", inputs: draft, evidence, createdAt: new Date().toISOString(), policy: DEMO_POLICY });
    return { preview, draft, evidence };
  };
  const isCurrentVersion = (snapshot: CalculationSnapshot) => snapshot.policy.id === DEMO_POLICY.id
    && snapshot.result.policyVersion === DEMO_POLICY.id && snapshot.result.engineVersion === DEMO_POLICY.engineVersion;
  const ensureCurrent = (currentStore: DemoStore, currentIndex: number) => {
    const record = currentStore.cases[currentIndex]!;
    if (acknowledgement.revision !== record.draft.revision) throw new Error("ข้อมูลเปลี่ยนไปแล้ว กรุณาคำนวณใหม่และยืนยันรายการเอกสารอีกครั้ง");
    const savedPreview = findPreview(currentStore, currentIndex);
    if (!savedPreview || !isCurrentVersion(savedPreview)) throw new Error("ผลคำนวณไม่ใช่รุ่นปัจจุบัน กรุณาคำนวณใหม่ก่อนส่งตรวจ");
    const current = computeCurrentPreview(currentStore, currentIndex);
    if (JSON.stringify(current.draft) !== JSON.stringify(savedPreview.inputs)
      || JSON.stringify(current.preview.result) !== JSON.stringify(savedPreview.result)
      || JSON.stringify(current.evidence) !== JSON.stringify(savedPreview.evidence)) {
      throw new Error("ร่าง ผลคำนวณ หรือรายการไฟล์เปลี่ยนไป กรุณาคำนวณใหม่ก่อนส่งตรวจ");
    }
    const validation = validateSubmission(record.draft, current.preview.result, {
      currentRevision: record.draft.revision,
      previewRevision: savedPreview.revision,
      attachments: currentStore.attachments.filter((item) => item.caseId === id && item.status !== "deleted"),
    });
    if (validation.length) throw new Error(validation.map((item) => item.message).join(" · "));
    return { record, savedPreview, ...current };
  };

  const initial = ensureCurrent(store, index);
  if (initial.evidence.reduce((sum, item) => sum + item.byteSize, 0) > 30 * 1024 * 1024) throw new Error("ไฟล์รวมมีขนาดเกิน 30 MiB ต่อกรณี");
  const unavailableIds: string[] = [];
  for (const evidence of initial.evidence) {
    try {
      const blob = await readDemoEvidenceFile(evidence.id);
      if (!blob || blob.size !== evidence.byteSize || blob.size < 1 || blob.size > 3 * 1024 * 1024
        || blob.type !== evidence.mediaType || await evidenceFingerprint(blob) !== evidence.sha256) unavailableIds.push(evidence.id);
    } catch { unavailableIds.push(evidence.id); }
  }
  if (unavailableIds.length > 0) {
    store.attachments = store.attachments.map((item) => unavailableIds.includes(item.id) ? { ...item, status: "failed" } : item);
    store.storedEvidenceIds = store.storedEvidenceIds.filter((value) => !unavailableIds.includes(value));
    touchCase(store, id);
    writeStore(store);
    throw new Error("ไฟล์ต้นฉบับบางรายการไม่มีอยู่หรือข้อมูลไม่ตรงกับไฟล์ในอุปกรณ์นี้ กรุณาแนบไฟล์เหล่านั้นอีกครั้งก่อนส่งตรวจ");
  }

  store = readStore();
  index = store.cases.findIndex((record) => record.id === id && record.ownerId === demoUser("taxpayer").id && record.status === "draft");
  if (index < 0) throw new Error("กรณีนี้ส่งแล้วหรือไม่อยู่ในคิวสาธิต");
  const latest = ensureCurrent(store, index);
  const submittedAt = new Date().toISOString();
  const submissionMetadata: SubmissionMetadata = {
    version: 1,
    statement: AVAILABLE_EVIDENCE_STATEMENT_V1,
    acknowledgedBy: demoUser("taxpayer").id,
    acknowledgedAt: submittedAt,
    revision: latest.record.draft.revision,
    previewSnapshotId: latest.savedPreview.id,
    missingEvidence: missingEvidenceInventory(latest.draft, latest.evidence),
  };
  const snapshot = createCalculationSnapshot({ id: `demo-submitted-${crypto.randomUUID()}`, caseId: id, revision: latest.record.draft.revision,
    kind: "submitted", inputs: latest.draft, evidence: latest.evidence, createdAt: submittedAt, policy: DEMO_POLICY, submissionMetadata });
  const submitted: FtcCaseRecord = {
    ...latest.record,
    status: "submitted",
    assignedOfficerId: demoUser("officer").id,
    submittedSnapshotId: snapshot.id,
    submittedAt,
    updatedAt: submittedAt,
  };
  store.cases[index] = submitted;
  store.snapshots.unshift(snapshot);
  writeStore(store);
  return { case: submitted, snapshot };
}

export async function deleteDemoCase(id: string, ownerId: string): Promise<boolean> {
  const store = readStore();
  const record = store.cases.find((item) => item.id === id);
  if (!record || record.ownerId !== ownerId || record.status !== "draft") return false;
  const evidenceIds = store.attachments.filter((item) => item.caseId === id).map((item) => item.id);
  const next = structuredClone(store);
  next.cases = next.cases.filter((item) => item.id !== id);
  next.snapshots = next.snapshots.filter((item) => item.caseId !== id);
  next.attachments = next.attachments.filter((item) => item.caseId !== id);
  next.storedEvidenceIds = next.storedEvidenceIds.filter((evidenceId) => !evidenceIds.includes(evidenceId));
  writeStore(next);
  try {
    await deleteDemoEvidenceFiles(evidenceIds);
    return true;
  } catch (error) {
    writeStore(store);
    throw error;
  }
}

export function clearDemoState(): void {
  localStorage.removeItem(STORE_KEY);
}
