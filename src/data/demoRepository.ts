import type {
  ApiUser,
  AttachmentMetadata,
  CalculationSnapshot,
  FtcCaseDraft,
  FtcCaseRecord,
} from "../../shared/contracts.js";

const STORE_KEY = "ftc.prototype.fixture.v1";

export type DemoPersona = "taxpayer" | "officer";

interface DemoStore {
  cases: FtcCaseRecord[];
  snapshots: CalculationSnapshot[];
  attachments: AttachmentMetadata[];
}

const blankStore = (): DemoStore => ({ cases: [], snapshots: [], attachments: [] });

function readStore(): DemoStore {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (!stored) return blankStore();
    const parsed = JSON.parse(stored) as Partial<DemoStore>;
    return {
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return blankStore();
  }
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

export function addDemoAttachment(caseId: string, sourceId: string | null, kind: AttachmentMetadata["kind"], file: File): AttachmentMetadata {
  const attachment: AttachmentMetadata = {
    id: `demo-evidence-${crypto.randomUUID()}`,
    caseId,
    sourceId,
    kind,
    displayName: file.name,
    mediaType: file.type || "application/octet-stream",
    byteSize: file.size,
    sha256: "จำลองในโหมดสาธิต",
    status: "ready",
    createdAt: new Date().toISOString(),
  };
  const store = readStore();
  store.attachments.unshift(attachment);
  touchCase(store, caseId);
  writeStore(store);
  return attachment;
}

export function listDemoAttachments(caseId: string): AttachmentMetadata[] {
  return readStore().attachments.filter((item) => item.caseId === caseId && item.status !== "deleted");
}

export function deleteDemoAttachment(id: string): void {
  const store = readStore();
  const attachment = store.attachments.find((item) => item.id === id);
  store.attachments = store.attachments.filter((item) => item.id !== id);
  if (attachment) touchCase(store, attachment.caseId);
  writeStore(store);
}

export function submitDemoCase(id: string, snapshot: CalculationSnapshot): FtcCaseRecord {
  const store = readStore();
  const index = store.cases.findIndex((record) => record.id === id && record.status === "draft");
  if (index < 0) throw new Error("กรณีนี้ส่งแล้วหรือไม่อยู่ในคิวสาธิต");
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
  writeStore(store);
  return submitted;
}

export function clearDemoState(): void {
  localStorage.removeItem(STORE_KEY);
}
