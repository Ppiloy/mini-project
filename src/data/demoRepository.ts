import type {
  ApiUser,
  AttachmentMetadata,
  CalculationSnapshot,
  FtcCaseDraft,
  FtcCaseRecord,
} from "../../shared/contracts.js";
import { withCanonicalThbAmounts } from "../../shared/calculator.js";
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
    : { id: "demo-taxpayer", loginName: "taxpayer-demo", displayName: "ผู้เสียภาษีตัวอย่าง", role: "taxpayer", maskedReference: "ผู้เสียภาษี •• 2568" };
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

async function evidenceFingerprint(file: File): Promise<string> {
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
  return readStore().snapshots.find((item) => item.caseId === caseId && item.kind === "preview" && item.revision === revision);
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

export async function submitDemoCase(id: string, snapshot: CalculationSnapshot): Promise<FtcCaseRecord> {
  let store = readStore();
  let index = store.cases.findIndex((record) => record.id === id && record.status === "draft");
  if (index < 0) throw new Error("กรณีนี้ส่งแล้วหรือไม่อยู่ในคิวสาธิต");
  const currentDraft = withCanonicalThbAmounts(store.cases[index]!.draft);
  const currentPreview = store.snapshots.find((item) => item.caseId === id && item.kind === "preview" && item.revision === store.cases[index]!.draft.revision);
  if (snapshot.kind !== "submitted" || snapshot.caseId !== id || snapshot.revision !== store.cases[index]!.draft.revision
    || JSON.stringify(snapshot.inputs) !== JSON.stringify(currentDraft)
    || !currentPreview || JSON.stringify(snapshot.result) !== JSON.stringify(currentPreview.result)
    || JSON.stringify(snapshot.evidence) !== JSON.stringify(currentPreview.evidence)
    || store.snapshots.some((item) => item.id === snapshot.id)) {
    throw new Error("ผลส่งตรวจไม่ตรงกับฉบับคำนวณล่าสุด");
  }
  const missingEvidence = await Promise.all(snapshot.evidence.map(async (evidence) =>
    await readDemoEvidenceFile(evidence.id).catch(() => null) ? null : evidence.id,
  ));
  const missingEvidenceIds = missingEvidence.filter((evidenceId): evidenceId is string => evidenceId !== null);
  if (missingEvidenceIds.length > 0) {
    store.attachments = store.attachments.map((item) => missingEvidenceIds.includes(item.id) ? { ...item, status: "failed" } : item);
    store.storedEvidenceIds = store.storedEvidenceIds.filter((evidenceId) => !missingEvidenceIds.includes(evidenceId));
    writeStore(store);
    throw new Error("ไฟล์ต้นฉบับบางรายการไม่มีอยู่ในอุปกรณ์นี้ กรุณาแนบไฟล์เหล่านั้นอีกครั้งก่อนส่งตรวจ");
  }
  store = readStore();
  index = store.cases.findIndex((record) => record.id === id && record.status === "draft");
  const latestPreview = index < 0 ? null : store.snapshots.find((item) => item.caseId === id && item.kind === "preview" && item.revision === store.cases[index]!.draft.revision);
  const latestDraft = index < 0 ? null : withCanonicalThbAmounts(store.cases[index]!.draft);
  if (index < 0 || snapshot.revision !== store.cases[index]!.draft.revision
    || !latestDraft || JSON.stringify(snapshot.inputs) !== JSON.stringify(latestDraft)
    || !latestPreview || JSON.stringify(snapshot.result) !== JSON.stringify(latestPreview.result)
    || JSON.stringify(snapshot.evidence) !== JSON.stringify(latestPreview.evidence)) {
    throw new Error("ร่างหรือผลคำนวณเปลี่ยนไประหว่างส่ง กรุณาคำนวณใหม่ก่อนส่งตรวจ");
  }
  const now = new Date().toISOString();
  const submitted: FtcCaseRecord = {
    ...store.cases[index]!,
    status: "submitted",
    assignedOfficerId: demoUser("officer").id,
    submittedSnapshotId: snapshot.id,
    submittedAt: now,
    updatedAt: now,
  };
  store.cases[index] = submitted;
  store.snapshots.unshift(snapshot);
  writeStore(store);
  return submitted;
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
