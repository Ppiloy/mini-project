import { createHash, randomUUID } from "node:crypto";
import { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import type { ApiUser, CalculationSnapshot, FtcCaseRecord, FrozenEvidenceReference } from "../../shared/contracts.js";
import { validateSubmission } from "../../shared/calculator.js";
import { DEMO_POLICY } from "../../shared/policy.js";
import { createCalculationSnapshot } from "../../shared/snapshot.js";
import type { PgPoolLike, PgQueryable } from "../postgres.js";
import { ApiFailure } from "../api-failure.js";
import { digest, inTransaction, loadCaseRecord, type CaseRow } from "../app.js";
import type { BlobIO } from "../storage/blob-io.js";
import type { EnvironmentMarker } from "../runtime/environment.js";
import { appendAudit, attachmentMetadata, getAttachments, getAuditSummaries, getLatestCurrentPreview, incrementCaseRevision, loadWorkflowCase, snapshotRecord, type AttachmentRow, type SnapshotRow } from "./repository.js";

interface RouteOptions {
  pool: PgPoolLike;
  authenticated: RequestHandler;
  csrf: RequestHandler;
  blobIO?: BlobIO;
  officerUserId?: string;
  environmentMarker(response: Response): EnvironmentMarker;
  apiError(response: Response, status: number, code: string, message: string, fields?: unknown): void;
}

const uploadParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, fieldSize: 8192, files: 1, fields: 6, parts: 7 } });
const caseUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxCaseBytes = 30 * 1024 * 1024;
const supportedKinds = new Set(["foreign_income", "foreign_tax", "remittance", "thai_tax", "other"]);

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function routeId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && caseUuid.test(candidate) ? candidate.toLowerCase() : null;
}
function failInput(message = "รูปแบบคำขอไม่ถูกต้อง"): never { throw new ApiFailure(400, "invalid_input", message); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) return failInput();
  return value;
}
function requestId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.includes("\u0000")) return failInput("requestId ไม่ถูกต้อง");
  return value;
}
function revision(value: unknown): number {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || (value as number) < 0) return failInput("expectedRevision ไม่ถูกต้อง");
  return value as number;
}
function parseStored<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
function conflict(message: string): never { throw new ApiFailure(409, "conflict", message); }
function notFound(): never { throw new ApiFailure(404, "not_found", "ไม่พบข้อมูลรายการนี้"); }
function statusJson<T>(value: T | string): T { return parseStored(value); }
function sameJson(left: unknown, right: unknown): boolean {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])])) : value;
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

function fileFacts(file: Express.Multer.File, displayName: unknown): { displayName: string; mediaType: string; sha256: string } {
  if (!file || file.size < 1) throw new ApiFailure(400, "invalid_input", "กรุณาเลือกไฟล์ที่ไม่ว่างเปล่า");
  if (typeof displayName !== "string" || displayName.length < 1 || displayName.length > 180 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw new ApiFailure(400, "invalid_input", "ชื่อไฟล์ไม่ถูกต้อง");
  }
  const trimmedName = displayName.trim();
  if (!trimmedName || trimmedName !== trimmedName.split(/[\\/]/).at(-1)) throw new ApiFailure(400, "invalid_input", "ชื่อไฟล์ไม่ถูกต้อง");
  const bytes = file.buffer;
  const extension = trimmedName.split(".").at(-1)?.toLowerCase();
  let mediaType: string | null = null;
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-" && extension === "pdf" && file.mimetype === "application/pdf") mediaType = "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && extension === "png" && file.mimetype === "image/png") mediaType = "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && ["jpg", "jpeg"].includes(extension ?? "") && file.mimetype === "image/jpeg") mediaType = "image/jpeg";
  if (!mediaType) throw new ApiFailure(415, "unsupported_media_type", "รองรับเฉพาะไฟล์ PDF, PNG หรือ JPEG ที่ตรวจสอบชนิดได้");
  return { displayName: trimmedName, mediaType, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function ownedCaseForUpdate(client: PgQueryable, caseId: string, userId: string, marker: EnvironmentMarker): Promise<CaseRow> {
  const result = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1 AND owner_id=$2 AND environment_marker_id=$3 FOR UPDATE", [caseId, userId, marker.id]);
  if (!result.rows[0]) notFound();
  return result.rows[0];
}

async function currentAttachmentRow(client: PgQueryable, attachmentId: string, marker: EnvironmentMarker): Promise<AttachmentRow | null> {
  const result = await client.query<AttachmentRow>(
    `SELECT a.* FROM attachments a JOIN ftc_cases c ON c.id=a.case_id
     WHERE a.id=$1 AND a.environment_marker_id=$2 AND c.environment_marker_id=$2
       AND a.storage_environment=$3 AND a.storage_store=$4 AND a.storage_region=$5 FOR UPDATE OF a`,
    [attachmentId, marker.id, marker.kind, marker.storageStore, marker.storageRegion]);
  return result.rows[0] ?? null;
}

function snapshotInsertSql(): string {
  return `INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::timestamptz)`;
}

function frozenEvidence(rows: readonly AttachmentRow[]): FrozenEvidenceReference[] {
  return rows.filter((row) => row.status === "ready").map((row) => ({ id: row.id, sourceId: row.source_id, kind: row.kind,
    displayName: row.display_name, mediaType: row.media_type, byteSize: row.byte_size, sha256: row.sha256 }));
}

async function addMutationReplay(client: PgQueryable, caseId: string, operation: string, id: string, bodyDigest: string, response: unknown): Promise<void> {
  await client.query(`INSERT INTO api_mutation_requests(case_id,request_id,operation,request_digest,response)
    VALUES ($1,$2,$3,$4,$5::jsonb)`, [caseId, id, operation, bodyDigest, JSON.stringify(response)]);
}

async function priorMutation(client: PgQueryable, caseId: string, operation: string, id: string, bodyDigest: string): Promise<unknown | null> {
  const result = await client.query<{ request_digest: string; response: unknown }>(
    "SELECT request_digest,response FROM api_mutation_requests WHERE case_id=$1 AND operation=$2 AND request_id=$3", [caseId, operation, id]);
  if (!result.rows[0]) return null;
  if (result.rows[0].request_digest !== bodyDigest) conflict("requestId นี้ถูกใช้กับคำขออื่นแล้ว");
  return statusJson(result.rows[0].response);
}

export function registerWorkflowRoutes(app: Express, options: RouteOptions): void {
  const blobIO = options.blobIO;
  const upload: RequestHandler[] = [options.authenticated, options.csrf, uploadParser.single("file")];

  app.get("/api/cases/:id", options.authenticated, async (request, response, next) => {
    try {
      const id = routeId(request.params.id); if (!id) notFound();
      const user = response.locals.user as ApiUser;
      const marker = options.environmentMarker(response);
      const detail = await inTransaction(options.pool,async (client) => {
        const result = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1 AND owner_id=$2 AND environment_marker_id=$3 FOR SHARE", [id, user.id, marker.id]);
        if (!result.rows[0]) notFound();
        return loadWorkflowCase(client,result.rows[0],marker.id);
      });
      response.json({ data: detail, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/cases/:id/calculate", options.authenticated, options.csrf, async (request, response, next) => {
    try {
      const caseId = routeId(request.params.id); if (!caseId) notFound();
      const body = exact(request.body, ["expectedRevision", "requestId"]);
      const expectedRevision = revision(body.expectedRevision); const id = requestId(body.requestId);
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const bodyDigest = digest({ expectedRevision });
      const result = await inTransaction(options.pool, async (client) => {
        const row = await ownedCaseForUpdate(client, caseId, user.id, marker);
        const replay = await priorMutation(client, row.id, "calculate", id, bodyDigest);
        if (replay) return { snapshot: (replay as { snapshot: CalculationSnapshot }).snapshot, replayed: true };
        if (row.status !== "draft") conflict("ส่งรายการแล้ว ไม่สามารถคำนวณตัวอย่างใหม่ได้");
        if (row.revision !== expectedRevision) conflict("ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดแบบร่างล่าสุด");
        const record = await loadCaseRecord(client, row);
        const attachmentResult = await getAttachments(client, row.id, marker.id);
        const snapshot = createCalculationSnapshot({ id: randomUUID(), caseId: row.id, revision: row.revision, kind: "preview",
          inputs: record.draft, evidence: frozenEvidence(attachmentResult.rows), createdAt: new Date().toISOString() });
        await client.query(snapshotInsertSql(), [snapshot.id, snapshot.caseId, snapshot.revision, snapshot.kind,
          JSON.stringify(snapshot.inputs), JSON.stringify(snapshot.result), JSON.stringify(snapshot.evidence), JSON.stringify(snapshot.policy),
          snapshot.policy.id, snapshot.result.engineVersion, snapshot.createdAt]);
        await appendAudit(client, user.id, row.id, "preview_created", snapshot.id);
        await addMutationReplay(client, row.id, "calculate", id, bodyDigest, { snapshot });
        return { snapshot, replayed: false };
      });
      response.json({ data: { snapshot: result.snapshot }, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/cases/:id/attachments", ...upload, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const caseId = routeId(request.params.id); if (!caseId) notFound();
      if (!isRecord(request.body)) failInput();
      const allowed = new Set(["expectedRevision", "requestId", "sourceId", "kind", "displayName"]);
      if (Object.keys(request.body).some((key) => !allowed.has(key))) failInput();
      const expectedRevision = revision(request.body.expectedRevision); const id = requestId(request.body.requestId);
      const sourceId = request.body.sourceId === "" || request.body.sourceId === undefined ? null : request.body.sourceId;
      if (sourceId !== null && (typeof sourceId !== "string" || !caseUuid.test(sourceId))) failInput("รหัสแหล่งเงินได้ไม่ถูกต้อง");
      if (typeof request.body.kind !== "string" || !supportedKinds.has(request.body.kind)) failInput("ชนิดหลักฐานไม่ถูกต้อง");
      const file = request.file;
      if (!file) failInput("กรุณาเลือกไฟล์");
      const facts = fileFacts(file, request.body.displayName);
      const bodyDigest = digest({ expectedRevision, sourceId, kind: request.body.kind, ...facts, size: file.size });
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const reservation = await inTransaction(options.pool, async (client) => {
        const row = await ownedCaseForUpdate(client, caseId, user.id, marker);
        const prior = await client.query<{ request_digest: string; response: { attachmentId?: string; state?: string; data?: unknown } }>(
          "SELECT request_digest,response FROM api_mutation_requests WHERE case_id=$1 AND operation='upload' AND request_id=$2", [row.id, id]);
        if (prior.rows[0]) {
          if (prior.rows[0].request_digest !== bodyDigest) conflict("requestId นี้ถูกใช้กับไฟล์หรือข้อมูลอื่นแล้ว");
          const saved = statusJson(prior.rows[0].response);
          if (saved.state === "complete") return { attachmentId: saved.attachmentId!, replay: saved.data, created: false };
          const attachmentId = saved.attachmentId;
          if (!attachmentId) throw new Error("Upload reservation is missing its attachment id.");
          const previous = await client.query<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 AND case_id=$2 FOR UPDATE", [attachmentId, row.id]);
          if (!previous.rows[0] || previous.rows[0].status === "deleted") notFound();
          if (previous.rows[0].status === "failed") {
            await client.query("UPDATE attachments SET status='pending' WHERE id=$1", [attachmentId]);
            await incrementCaseRevision(client, row.id);
          }
          return { attachmentId, replay: null, created: false };
        }
        if (row.status !== "draft") conflict("ส่งรายการแล้ว ไม่สามารถแก้ไขหลักฐานได้");
        if (row.revision !== expectedRevision) conflict("ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดแบบร่างล่าสุด");
        let remittanceId: string | null = null;
        if (sourceId !== null) {
          const source = await client.query<{ id: string; remittance_id: string | null }>(
            `SELECT source.id,remittance.id AS remittance_id FROM foreign_income_sources source
             LEFT JOIN remittances remittance ON remittance.case_id=source.case_id AND remittance.source_id=source.id
             WHERE source.id=$1 AND source.case_id=$2`, [sourceId, row.id]);
          if (!source.rows[0]) notFound();
          remittanceId = source.rows[0].remittance_id;
        }
        const counts = await client.query<{ count: number; bytes: string; source_count: number }>(
          `SELECT count(*)::int AS count,coalesce(sum(byte_size),0)::text AS bytes,
             count(*) FILTER (WHERE source_id=$2)::int AS source_count
           FROM attachments WHERE case_id=$1 AND status <> 'deleted'`, [row.id, sourceId]);
        const current = counts.rows[0]!;
        if (current.count >= 20 || Number(current.bytes) + file.size > maxCaseBytes || (sourceId && current.source_count >= 5)) {
          throw new ApiFailure(429, "rate_limited", "รายการนี้มีหลักฐานครบจำนวนหรือขนาดที่อนุญาตแล้ว");
        }
        const attachmentId = randomUUID(); const key = `cases/${row.id}/${attachmentId}`;
        await client.query(
          `INSERT INTO attachments(id,case_id,source_id,remittance_id,storage_environment,storage_store,storage_region,
             storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)`,
          [attachmentId,row.id,sourceId,remittanceId,marker.kind,marker.storageStore,marker.storageRegion,key,facts.displayName,facts.mediaType,file.size,facts.sha256,request.body.kind,marker.id]);
        await incrementCaseRevision(client, row.id);
        await appendAudit(client, user.id, row.id, "evidence_upload_reserved");
        await addMutationReplay(client, row.id, "upload", id, bodyDigest, { state: "reserved", attachmentId });
        return { attachmentId, replay: null, created: true };
      });
      if (reservation.replay) {
        response.json({ data: reservation.replay, requestId: response.locals.requestId });
        return;
      }
      if (!blobIO) throw new Error("Evidence storage is unavailable.");
      const blobKeyResult = await options.pool.query<{ storage_key: string }>("SELECT storage_key FROM attachments WHERE id=$1", [reservation.attachmentId]);
      const key = blobKeyResult.rows[0]?.storage_key;
      if (!key) notFound();
      try {
        await blobIO.put(marker, key, file.buffer);
      } catch (error) {
        await inTransaction(options.pool, async (client) => {
          const owner = await client.query<{ case_id: string }>("SELECT case_id FROM attachments WHERE id=$1 AND environment_marker_id=$2", [reservation.attachmentId,marker.id]);
          if (!owner.rows[0]) return;
          const caseResult = await client.query<{ id: string; status: string }>("SELECT id,status FROM ftc_cases WHERE id=$1 AND environment_marker_id=$2 FOR UPDATE", [owner.rows[0].case_id,marker.id]);
          if (!caseResult.rows[0]) return;
          const locked = await client.query<{ case_id: string; status: string }>("SELECT case_id,status FROM attachments WHERE id=$1 AND environment_marker_id=$2 FOR UPDATE", [reservation.attachmentId,marker.id]);
          const item = locked.rows[0];
          if (item?.status === "pending") {
            await client.query("UPDATE attachments SET status='failed' WHERE id=$1", [reservation.attachmentId]);
            await incrementCaseRevision(client, item.case_id);
            await appendAudit(client, user.id, item.case_id, "evidence_upload_failed");
          }
        });
        throw error;
      }
      const completed = await inTransaction(options.pool, async (client) => {
        const row = await ownedCaseForUpdate(client, caseId, user.id, marker);
        if (row.status !== "draft") conflict("รายการเปลี่ยนสถานะระหว่างอัปโหลด");
        const attachment = await client.query<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 AND case_id=$2 AND environment_marker_id=$3 FOR UPDATE", [reservation.attachmentId,row.id,marker.id]);
        const item = attachment.rows[0]; if (!item) notFound();
        if (item.status === "deleted") {
          await client.query("UPDATE attachments SET cleanup_pending=true WHERE id=$1", [item.id]);
          return { tombstoned:true as const, key:item.storage_key, data:null };
        }
        if (item.status === "pending") {
          await client.query("UPDATE attachments SET status='ready' WHERE id=$1", [item.id]);
          await incrementCaseRevision(client, row.id);
          await appendAudit(client, user.id, row.id, "evidence_uploaded");
        }
        const freshCaseResult = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1", [row.id]);
        const refreshedAttachment = await client.query<AttachmentRow>("SELECT * FROM attachments WHERE id=$1", [item.id]);
        const caseRecord = await loadCaseRecord(client, freshCaseResult.rows[0]!);
        const data = { attachment: attachmentMetadata(refreshedAttachment.rows[0]!), case: caseRecord, revision: caseRecord.draft.revision };
        await client.query("UPDATE api_mutation_requests SET response=$4::jsonb WHERE case_id=$1 AND operation='upload' AND request_id=$2 AND request_digest=$3",
          [row.id,id,bodyDigest,JSON.stringify({ state:"complete",attachmentId:item.id,data })]);
        return { tombstoned:false as const, key:null, data };
      });
      if (completed.tombstoned) {
        try {
          await blobIO.delete(marker,completed.key);
          await options.pool.query("UPDATE attachments SET cleanup_pending=false,storage_deleted_at=now() WHERE id=$1 AND status='deleted'",[reservation.attachmentId]);
        } catch { /* leave the durable cleanup marker for operations recovery */ }
        notFound();
      }
      response.status(reservation.created ? 201 : 200).json({ data: completed.data, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.delete("/api/attachments/:id", options.authenticated, options.csrf, async (request, response, next) => {
    let cleanup: { marker: EnvironmentMarker; key: string } | null = null;
    try {
      const attachmentId = routeId(request.params.id); if (!attachmentId) notFound();
      const body = exact(request.body, ["expectedRevision", "requestId"]);
      const expectedRevision = revision(body.expectedRevision); const id = requestId(body.requestId);
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const preflight = await options.pool.query<{ case_id: string }>("SELECT case_id FROM attachments WHERE id=$1", [attachmentId]);
      if (!preflight.rows[0]) notFound();
      const result = await inTransaction(options.pool, async (client) => {
        const row = await ownedCaseForUpdate(client, preflight.rows[0]!.case_id, user.id, marker);
        const bodyDigest = digest({ attachmentId, expectedRevision });
        const replay = await priorMutation(client, row.id, "delete-attachment", id, bodyDigest);
        if (replay) return { response: replay as { deleted: true; revision: number }, key: null as string | null };
        if (row.status !== "draft") conflict("ส่งรายการแล้ว ไม่สามารถลบหลักฐานได้");
        if (row.revision !== expectedRevision) conflict("ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดแบบร่างล่าสุด");
        const attachment = await currentAttachmentRow(client, attachmentId, marker);
        if (!attachment || attachment.case_id !== row.id) notFound();
        if (attachment.status === "deleted") conflict("ไฟล์นี้ถูกลบไปแล้ว");
        await client.query("UPDATE attachments SET status='deleted',source_id=NULL,remittance_id=NULL,cleanup_pending=true WHERE id=$1", [attachment.id]);
        const refreshed = await incrementCaseRevision(client, row.id);
        await appendAudit(client, user.id, row.id, "evidence_deleted");
        const responseBody = { deleted: true as const, revision: refreshed.revision };
        await addMutationReplay(client, row.id, "delete-attachment", id, bodyDigest, responseBody);
        return { response: responseBody, key: attachment.storage_key };
      });
      cleanup = result.key ? { marker, key: result.key } : null;
      if (cleanup && blobIO) {
        try {
          await blobIO.delete(cleanup.marker, cleanup.key);
          await options.pool.query("UPDATE attachments SET cleanup_pending=false,storage_deleted_at=now() WHERE id=$1 AND status='deleted'", [attachmentId]);
        } catch { /* durable cleanup_pending is left for operations recovery */ }
      }
      response.json({ data: result.response, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/attachments/:id", options.authenticated, async (request, response, next) => {
    try {
      const attachmentId = routeId(request.params.id); if (!attachmentId) notFound();
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const metadata = await options.pool.query<{ case_id:string; owner_id:string; assigned_officer_id:string | null; case_status:string; active_assignment:boolean }>(
        `SELECT a.case_id,c.owner_id,c.assigned_officer_id,c.status AS case_status,
           EXISTS(SELECT 1 FROM officer_case_assignments assignment WHERE assignment.case_id=c.id AND assignment.officer_id=$6 AND assignment.active) AS active_assignment
         FROM attachments a JOIN ftc_cases c ON c.id=a.case_id
         WHERE a.id=$1 AND a.environment_marker_id=$2 AND c.environment_marker_id=$2
           AND a.storage_environment=$3 AND a.storage_store=$4 AND a.storage_region=$5`,
        [attachmentId,marker.id,marker.kind,marker.storageStore,marker.storageRegion,user.id]);
      const item = metadata.rows[0]; if (!item) notFound();
      const isOwner = item.owner_id === user.id;
      const isAssignedOfficer = item.case_status === "submitted" && item.assigned_officer_id === user.id && item.active_assignment && user.role === "officer";
      if (!isOwner && !isAssignedOfficer) notFound();
      if (isAssignedOfficer) {
        await inTransaction(options.pool, async (client) => {
          const authorization = await client.query<{id:string}>(
            `SELECT c.id FROM ftc_cases c JOIN officer_case_assignments a ON a.case_id=c.id AND a.officer_id=$2 AND a.active
             WHERE c.id=$1 AND c.assigned_officer_id=$2 AND c.status='submitted' AND c.environment_marker_id=$3 FOR UPDATE OF c`,
            [item.case_id,user.id,marker.id]);
          if (!authorization.rows[0]) notFound();
          await appendAudit(client,user.id,item.case_id,"officer_evidence_accessed");
        });
      }
      const fullMetadata = await options.pool.query<AttachmentRow>(
        `SELECT a.* FROM attachments a WHERE a.id=$1 AND a.case_id=$2 AND a.environment_marker_id=$3
          AND a.storage_environment=$4 AND a.storage_store=$5 AND a.storage_region=$6`,
        [attachmentId,item.case_id,marker.id,marker.kind,marker.storageStore,marker.storageRegion]);
      const row=fullMetadata.rows[0]; if (!row || row.status === "deleted") notFound();
      if (row.status !== "ready" && row.status !== "pending") notFound();
      if (row.status !== "ready") conflict("ไฟล์ยังไม่พร้อมใช้งาน");
      if (!blobIO) throw new Error("Evidence storage is unavailable.");
      const bytes = await blobIO.get(marker, row.storage_key); if (!bytes) notFound();
      response.setHeader("Content-Type", row.media_type);
      response.setHeader("Content-Length", String(bytes.byteLength));
      response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.display_name)}`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "private, no-store");
      response.status(200).send(Buffer.from(bytes));
    } catch (error) { next(error); }
  });

  app.post("/api/cases/:id/submit", options.authenticated, options.csrf, async (request, response, next) => {
    try {
      const caseId = routeId(request.params.id); if (!caseId) notFound();
      const body = exact(request.body, ["expectedRevision", "previewSnapshotId", "requestId"]);
      const expectedRevision = revision(body.expectedRevision); const previewId = routeId(body.previewSnapshotId as string);
      if (!previewId) failInput("previewSnapshotId ไม่ถูกต้อง");
      const id = requestId(body.requestId); const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const digestValue = digest({ expectedRevision, previewSnapshotId: previewId });
      const submitted = await inTransaction(options.pool, async (client) => {
        const row = await ownedCaseForUpdate(client, caseId, user.id, marker);
        const replay = await priorMutation(client, row.id, "submit", id, digestValue);
        if (replay) return replay as { case: FtcCaseRecord; snapshot: CalculationSnapshot };
        if (row.status !== "draft") conflict("รายการนี้ส่งไปแล้ว");
        if (row.revision !== expectedRevision) conflict("ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดแบบร่างล่าสุด");
        if (!options.officerUserId || !caseUuid.test(options.officerUserId)) throw new ApiFailure(503, "service_unavailable", "ยังไม่ได้กำหนดเจ้าหน้าที่รับรายการ");
        const officer = await client.query<{ id: string }>("SELECT id FROM app_users WHERE id=$1 AND role='officer' AND active=true FOR UPDATE", [options.officerUserId]);
        if (!officer.rows[0]) throw new ApiFailure(503, "service_unavailable", "เจ้าหน้าที่รับรายการยังไม่พร้อมใช้งาน");
        const record = await loadCaseRecord(client, row);
        const previewResult = await client.query<SnapshotRow>(
          `SELECT * FROM calculation_snapshots WHERE id=$1 AND case_id=$2 AND revision=$3 AND kind='preview'
           AND policy_id=$4 AND engine_version=$5 FOR UPDATE`,
          [previewId,row.id,row.revision,DEMO_POLICY.id,DEMO_POLICY.engineVersion]);
        if (!previewResult.rows[0]) conflict("ตัวอย่างคำนวณไม่ใช่ฉบับล่าสุดของข้อมูลปัจจุบัน กรุณาคำนวณใหม่");
        const preview = snapshotRecord(previewResult.rows[0]);
        const attachments = await getAttachments(client,row.id,marker.id);
        const current = await getLatestCurrentPreview(client,row.id,row.revision);
        if (!current || current.id !== preview.id) conflict("ตัวอย่างคำนวณไม่ใช่ฉบับปัจจุบัน กรุณาคำนวณใหม่");
        const computed = createCalculationSnapshot({ id: preview.id, caseId: row.id, revision: row.revision, kind: "preview",
          inputs: record.draft, evidence: frozenEvidence(attachments.rows), createdAt: preview.createdAt });
        if (!sameJson(computed.result,preview.result) || !sameJson(computed.inputs,preview.inputs) ||
            !sameJson(computed.evidence,preview.evidence)) conflict("ข้อมูลตัวอย่างคำนวณไม่ตรงกับข้อมูลที่บันทึก");
        const validation = validateSubmission(record.draft, computed.result, { currentRevision: row.revision, previewRevision: preview.revision,
          attachments: attachments.metadata });
        if (validation.length) {
          const incomplete = validation.some((message) => message.code === "submit.calculation_not_ready" || message.code === "submit.no_positive_remittance" || message.code === "submit.source_evidence_missing" || message.code === "submit.preview_stale");
          throw new ApiFailure(422, incomplete ? "incomplete_case" : "unsupported_case", "กรุณาแก้ไขข้อมูลและหลักฐานก่อนส่งตรวจ", validation);
        }
        await client.query("INSERT INTO officer_case_assignments(case_id,officer_id,assigned_by) VALUES ($1,$2,$3)", [row.id,options.officerUserId,user.id]);
        const snapshot = createCalculationSnapshot({ id: randomUUID(), caseId: row.id, revision: row.revision, kind: "submitted",
          inputs: record.draft, evidence: frozenEvidence(attachments.rows), createdAt: new Date().toISOString() });
        await client.query(snapshotInsertSql(), [snapshot.id,snapshot.caseId,snapshot.revision,snapshot.kind,JSON.stringify(snapshot.inputs),
          JSON.stringify(snapshot.result),JSON.stringify(snapshot.evidence),JSON.stringify(snapshot.policy),snapshot.policy.id,snapshot.result.engineVersion,snapshot.createdAt]);
        const updated = await client.query<CaseRow>(
          `UPDATE ftc_cases SET status='submitted',assigned_officer_id=$2,submitted_snapshot_id=$3,submitted_at=$4::timestamptz,updated_at=$4::timestamptz
           WHERE id=$1 RETURNING *`, [row.id,options.officerUserId,snapshot.id,snapshot.createdAt]);
        await appendAudit(client,user.id,row.id,"case_submitted",snapshot.id);
        const caseRecord = await loadCaseRecord(client,updated.rows[0]!);
        const data = { case: caseRecord,snapshot };
        await addMutationReplay(client,row.id,"submit",id,digestValue,data);
        return data;
      });
      response.json({ data: submitted, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/officer/cases", options.authenticated, async (_request, response, next) => {
    try {
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      if (user.role !== "officer") throw new ApiFailure(403,"forbidden","ไม่มีสิทธิ์เข้าถึงข้อมูลเจ้าหน้าที่");
      const ids = await inTransaction(options.pool,async (client) => {
        const rows = await client.query<{id:string}>(
          `SELECT c.id FROM ftc_cases c JOIN officer_case_assignments assignment ON assignment.case_id=c.id AND assignment.officer_id=$1 AND assignment.active
           WHERE c.assigned_officer_id=$1 AND c.status='submitted' AND c.environment_marker_id=$2 ORDER BY c.submitted_at DESC,c.id FOR UPDATE OF c`, [user.id,marker.id]);
        for (const row of rows.rows) await appendAudit(client,user.id,row.id,"officer_queue_accessed");
        return rows.rows.map(({id})=>id);
      });
      const result = await options.pool.query<CaseRow>(
        `SELECT c.* FROM ftc_cases c WHERE c.id=ANY($1::uuid[]) AND c.assigned_officer_id=$2 AND c.status='submitted' AND c.environment_marker_id=$3
         ORDER BY c.submitted_at DESC,c.id`,[ids,user.id,marker.id]);
      const cases = await Promise.all(result.rows.map((row) => loadCaseRecord(options.pool,row)));
      response.json({ data: { cases }, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/officer/cases/:id", options.authenticated, async (request, response, next) => {
    try {
      const caseId = routeId(request.params.id); if (!caseId) notFound();
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      if (user.role !== "officer") throw new ApiFailure(403,"forbidden","ไม่มีสิทธิ์เข้าถึงข้อมูลเจ้าหน้าที่");
      const result = await inTransaction(options.pool, async (client) => {
        const access = await client.query<Pick<CaseRow,"id"|"submitted_snapshot_id">>(
          `SELECT c.id,c.submitted_snapshot_id FROM ftc_cases c JOIN officer_case_assignments a ON a.case_id=c.id AND a.officer_id=$2 AND a.active
           WHERE c.id=$1 AND c.assigned_officer_id=$2 AND c.status='submitted' AND c.environment_marker_id=$3 FOR UPDATE OF c`, [caseId,user.id,marker.id]);
        if (!access.rows[0]) notFound();
        await appendAudit(client,user.id,caseId,"officer_case_accessed",access.rows[0].submitted_snapshot_id ?? undefined);
        return access.rows[0]!;
      });
      const fullCase = await options.pool.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1 AND environment_marker_id=$2",[caseId,marker.id]);
      if (!fullCase.rows[0]) notFound();
      const detail = await loadWorkflowCase(options.pool,fullCase.rows[0],marker.id);
      const snapshotResult = await options.pool.query<SnapshotRow>("SELECT * FROM calculation_snapshots WHERE id=$1 AND case_id=$2 AND kind='submitted'", [result.submitted_snapshot_id,caseId]);
      if (!snapshotResult.rows[0]) notFound();
      response.json({ data: { case: detail.case,attachments: detail.attachments,snapshot:snapshotRecord(snapshotResult.rows[0]),auditEvents:await getAuditSummaries(options.pool,caseId) }, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/snapshots/:id", options.authenticated, async (request, response, next) => {
    try {
      const snapshotId = routeId(request.params.id); if (!snapshotId) notFound();
      const user = response.locals.user as ApiUser; const marker = options.environmentMarker(response);
      const access = await options.pool.query<{ case_id: string; owner_id: string; assigned_officer_id: string | null; status: string; active_assignment:boolean }>(
        `SELECT c.id AS case_id,c.owner_id,c.assigned_officer_id,c.status,
           EXISTS(SELECT 1 FROM officer_case_assignments assignment WHERE assignment.case_id=c.id AND assignment.officer_id=$3 AND assignment.active) AS active_assignment
         FROM calculation_snapshots s JOIN ftc_cases c ON c.id=s.case_id
         WHERE s.id=$1 AND c.environment_marker_id=$2`, [snapshotId,marker.id,user.id]);
      const row = access.rows[0]; if (!row) notFound();
      const isOwner = row.owner_id === user.id;
      const isOfficer = user.role === "officer" && row.assigned_officer_id === user.id && row.active_assignment && row.status === "submitted";
      if (!isOwner && !isOfficer) notFound();
      if (isOfficer) await inTransaction(options.pool,async (client) => {
        const authorization=await client.query<{id:string}>(
          `SELECT c.id FROM ftc_cases c JOIN officer_case_assignments a ON a.case_id=c.id AND a.officer_id=$2 AND a.active
           WHERE c.id=$1 AND c.assigned_officer_id=$2 AND c.status='submitted' AND c.environment_marker_id=$3 FOR UPDATE OF c`,
          [row.case_id,user.id,marker.id]);
        if (!authorization.rows[0]) notFound();
        await appendAudit(client,user.id,row.case_id,"officer_snapshot_accessed",snapshotId);
      });
      const result = await options.pool.query<SnapshotRow>("SELECT * FROM calculation_snapshots WHERE id=$1 AND case_id=$2",[snapshotId,row.case_id]);
      if (!result.rows[0]) notFound();
      response.json({ data: { snapshot: snapshotRecord(result.rows[0]) }, requestId: response.locals.requestId });
    } catch (error) { next(error); }
  });
}
