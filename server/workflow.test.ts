import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDraft, createEmptySource } from "../shared/draft.js";
import { createApp } from "./app.js";
import { hashPasswordForTest } from "./passwords.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";
import type { BlobIO } from "./storage/blob-io.js";
import { ensureEnvironmentMarker, resolveRuntimeEnvironmentConfig, type EnvironmentMarker, type RuntimeEnvironmentConfig } from "./runtime/environment.js";

class PGlitePool implements PgPoolLike {
  constructor(private readonly database: PGlite) {}
  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }
  async connect(): Promise<PgQueryable> { return { query: (text, values, callback) => this.query(text, values, callback), release: () => undefined }; }
}

const origin = "https://ftc.example.test";
const taxpayerId = "00000000-0000-4000-8000-000000000001";
const officerId = "00000000-0000-4000-8000-000000000003";
const afterEachCallbacks: Array<() => Promise<void>> = [];
afterEach(async () => { while (afterEachCallbacks.length) await afterEachCallbacks.pop()?.(); });

function storage(): BlobIO {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(_marker: EnvironmentMarker, key: string, bytes: Uint8Array) {
      const existing = blobs.get(key);
      if (existing && Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) throw new Error("key conflict");
      blobs.set(key, Uint8Array.from(bytes));
    },
    async get(_marker: EnvironmentMarker, key: string) { const value = blobs.get(key); return value ? Uint8Array.from(value) : null; },
    async delete(_marker: EnvironmentMarker, key: string) { blobs.delete(key); },
  };
}

async function setup(environment?: RuntimeEnvironmentConfig, injectedBlobs?: BlobIO) {
  const database = new PGlite(); afterEachCallbacks.push(() => database.close());
  const migrations = (await readdir("netlify/database/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
  const pool = new PGlitePool(database); const password = await hashPasswordForTest("test-password-01");
  await pool.query(`INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES
    ($1,'taxpayer-a','Taxpayer A',$3,'taxpayer'),('00000000-0000-4000-8000-000000000002','taxpayer-b','Taxpayer B',$3,'taxpayer'),
    ($2,'officer-a','Officer A',$3,'officer')`, [taxpayerId,officerId,password]);
  const blobIO = injectedBlobs ?? storage();
  const app = createApp({ pool, sessionSecret: "workflow-test-session-secret-has-sufficient-entropy", allowedOrigin: origin,
    trustedHttps: false, blobIO, officerUserId: officerId, environment });
  return { app,pool,database,blobIO };
}

async function login(app: ReturnType<typeof createApp>, name = "taxpayer-a") {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").set("Origin",origin).send({loginName:name,password:"test-password-01"});
  expect(response.status).toBe(200);
  return { agent,csrf:response.body.data.csrfToken as string };
}

async function createCase(agent: ReturnType<typeof request.agent>, csrf: string, requestId = "case-workflow-01") {
  const response = await agent.post("/api/cases").set("Origin",origin).set("X-CSRF-Token",csrf).send({requestId});
  expect(response.status).toBe(201);
  return response.body.data.case as {id:string;draft:{revision:number}};
}

function pdfBytes(suffix = "one"): Buffer { return Buffer.from(`%PDF-1.7\n${suffix}\n%%EOF`, "ascii"); }

function validDraft(caseId: string) {
  const source = createEmptySource();
  Object.assign(source, {
    countryCode:"VN",countryName:"Vietnam",incomeType:"salary_40_1",earnedTaxYear:2025,earnedDate:"2025-01-01",
    residenceDaysInEarnedYear:365,inputMode:"worksheet_thb",grossIncomeAmount:"500000",currencyCode:"THB",
    actualForeignTaxPaid:"150000",eligibleForeignTax:"150000",eligibilityRationale:"Educational assumption for testing.",
    remittance:{remittanceDate:"2025-02-01",transferTotalAmount:"500000",transferCurrencyCode:"THB",transferTotalThb:null,classification:"income_only",classificationNote:null},
    remittedIncomeAmount:"500000",evidenceChecklist:["foreign_income","foreign_tax","remittance"],
  });
  return Object.assign(createEmptyDraft(),{id:caseId,taxYear:2025,domesticAssessableIncome:"1000000",thaiTax:{amountBeforeFtc:"318750",provenance:"Test supplied tax amount",confirmedAt:null,confirmedInputFingerprint:null},sources:[source]});
}

async function uploadPdf(agent: ReturnType<typeof request.agent>, csrf: string, caseId: string, expectedRevision: number, id: string, sourceId: string) {
  return agent.post(`/api/cases/${caseId}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
    .field("expectedRevision",String(expectedRevision)).field("requestId",id).field("sourceId",sourceId)
    .field("kind","other").field("displayName",`${id}.pdf`).attach("file",pdfBytes(id),{filename:`${id}.pdf`,contentType:"application/pdf"});
}

describe("hosted evidence, preview and submission HTTP workflows", () => {
  it("blocks officer credentials from every taxpayer endpoint and denies owner branches for officer-owned records", async () => {
    let blobReads = 0;
    const blobs:BlobIO={...storage(),async get(){blobReads+=1;return pdfBytes("private");}};
    const {app,pool}=await setup(undefined,blobs);
    const officer=await login(app,"officer-a");
    const headers={Origin:origin,"X-CSRF-Token":officer.csrf};
    expect((await officer.agent.get("/api/cases").set("Origin",origin)).status).toBe(403);
    expect((await officer.agent.post("/api/cases").set(headers).send({requestId:"officer-create"})).status).toBe(403);
    expect((await pool.query("SELECT id FROM ftc_cases WHERE owner_id=$1",[officerId])).rows).toHaveLength(0);
    const marker=(await pool.query<{marker_id:string}>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]!.marker_id;
    const ownedCaseId="00000000-0000-4000-8000-000000000101";
    const ownedSnapshotId="00000000-0000-4000-8000-000000000102";
    const ownedAttachmentId="00000000-0000-4000-8000-000000000103";
    const draft=createEmptyDraft(); draft.id=ownedCaseId; draft.createdAt=new Date().toISOString(); draft.updatedAt=draft.createdAt;
    await pool.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id) VALUES ($1,$2,$3::jsonb,$4,$5)",
      [ownedCaseId,officerId,JSON.stringify(draft),"legacy-officer-owned-case",marker]);
    const snapshotInputs=JSON.stringify(draft);
    await pool.query("INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version) VALUES ($1,$2,0,'preview',$3::jsonb,'{\"outcome\":\"incomplete\",\"engineVersion\":\"test\"}'::jsonb,'[]'::jsonb,'{\"id\":\"test\"}'::jsonb,'test','test')",
      [ownedSnapshotId,ownedCaseId,snapshotInputs]);
    await pool.query("INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id) VALUES ($1,$2,'local','ftc-evidence-local','us-east-2','cases/legacy-officer-owned/evidence','secret.pdf','application/pdf',16,$3,'other','ready',$4)",
      [ownedAttachmentId,ownedCaseId,"f".repeat(64),marker]);

    expect((await officer.agent.get("/api/cases").set("Origin",origin)).status).toBe(403);
    expect((await officer.agent.get(`/api/cases/${ownedCaseId}`).set("Origin",origin)).status).toBe(403);
    expect((await officer.agent.put(`/api/cases/${ownedCaseId}/draft`).set(headers).send({expectedRevision:0,requestId:"officer-save",data:draft})).status).toBe(403);
    expect((await officer.agent.post(`/api/cases/${ownedCaseId}/calculate`).set(headers).send({expectedRevision:0,requestId:"officer-calculate"})).status).toBe(403);
    expect((await officer.agent.post(`/api/cases/${ownedCaseId}/submit`).set(headers).send({expectedRevision:0,previewSnapshotId:ownedSnapshotId,requestId:"officer-self-submit"})).status).toBe(403);
    expect((await officer.agent.post(`/api/cases/${ownedCaseId}/attachments`).set(headers)
      .field("expectedRevision","0").field("requestId","officer-upload").field("kind","other").field("displayName","x.pdf")
      .attach("file",pdfBytes("blocked"),{filename:"x.pdf",contentType:"application/pdf"})).status).toBe(403);
    expect((await officer.agent.delete(`/api/attachments/${ownedAttachmentId}`).set(headers).send({expectedRevision:0,requestId:"officer-delete"})).status).toBe(403);
    expect((await officer.agent.get(`/api/attachments/${ownedAttachmentId}`).set("Origin",origin)).status).toBe(404);
    expect((await officer.agent.get(`/api/snapshots/${ownedSnapshotId}`).set("Origin",origin)).status).toBe(404);
    expect((await officer.agent.get("/api/officer/cases").set("Origin",origin)).status).toBe(200);
    expect((await officer.agent.get(`/api/officer/cases/${ownedCaseId}`).set("Origin",origin)).status).toBe(404);
    expect(blobReads).toBe(0);
    expect((await pool.query<{revision:number;status:string}>("SELECT revision,status FROM ftc_cases WHERE id=$1",[ownedCaseId])).rows[0]).toMatchObject({revision:0,status:"draft"});
    expect((await pool.query("SELECT id FROM attachments WHERE case_id=$1",[ownedCaseId])).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM calculation_snapshots WHERE case_id=$1",[ownedCaseId])).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM foreign_income_sources WHERE case_id=$1",[ownedCaseId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM remittances WHERE case_id=$1",[ownedCaseId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM exchange_rate_references WHERE case_id=$1",[ownedCaseId])).rows).toHaveLength(0);
  });

  it("allows cleanup bookkeeping on deleted tombstones after submission while keeping evidence metadata frozen", async () => {
    const {app,pool}=await setup();
    const {agent,csrf}=await login(app);
    const record=await createCase(agent,csrf,"submitted-cleanup-case");
    const marker=(await pool.query<{marker_id:string}>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]!.marker_id;
    const snapshotId="00000000-0000-4000-8000-000000000202";
    const attachmentId="00000000-0000-4000-8000-000000000203";
    await pool.query("INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version) VALUES ($1,$2,0,'submitted','{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'test','test')",[snapshotId,record.id]);
    await pool.query("INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id,cleanup_pending) VALUES ($1,$2,'local','ftc-evidence-local','us-east-2','cases/submitted-cleanup/tombstone','deleted.pdf','application/pdf',16,$3,'other','deleted',$4,true)",
      [attachmentId,record.id,"e".repeat(64),marker]);
    await pool.query("UPDATE ftc_cases SET status='submitted',assigned_officer_id=$2,submitted_snapshot_id=$3,submitted_at=now() WHERE id=$1",[record.id,officerId,snapshotId]);

    await pool.query("UPDATE attachments SET cleanup_pending=false,storage_deleted_at=now() WHERE id=$1 AND status='deleted'",[attachmentId]);
    expect((await pool.query<{cleanup_pending:boolean;storage_deleted_at:Date|string|null;status:string}>(
      "SELECT cleanup_pending,storage_deleted_at,status FROM attachments WHERE id=$1",[attachmentId])).rows[0])
      .toMatchObject({cleanup_pending:false,status:"deleted"});
    await expect(pool.query("UPDATE attachments SET display_name='changed.pdf' WHERE id=$1",[attachmentId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM attachments WHERE id=$1",[attachmentId])).rejects.toThrow();
    expect((await pool.query<{display_name:string}>("SELECT display_name FROM attachments WHERE id=$1",[attachmentId])).rows[0]?.display_name).toBe("deleted.pdf");
  });

  it("accepts the Unicode displayName sent by the browser upload contract at the public multipart endpoint", async () => {
    const {app}=await setup();
    const {agent,csrf}=await login(app);
    const record=await createCase(agent,csrf,"unicode-upload-case");
    const filename="ใบรับรองภาษี.pdf";
    const uploaded=await agent.post(`/api/cases/${record.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","unicode-upload-request").field("sourceId","")
      .field("kind","other").field("displayName",filename)
      .attach("file",pdfBytes("unicode-display-name"),{filename,contentType:"application/pdf"});
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.attachment.displayName).toBe(filename);
  });

  it("requires explicit hosted context and resolves distinct DB branch namespaces without exposing credentials", () => {
    expect(() => resolveRuntimeEnvironmentConfig({NETLIFY:"true",NETLIFY_DB_URL:"postgres://user:secret@db.example/branch-a",SITE_ID:"site"} as NodeJS.ProcessEnv)).toThrow(/FTC_DEPLOYMENT_CONTEXT/);
    expect(() => resolveRuntimeEnvironmentConfig({NETLIFY_DB_URL:"postgres://user:secret@db.example/branch-a"} as NodeJS.ProcessEnv)).toThrow(/FTC_DEPLOYMENT_CONTEXT/);
    const a = resolveRuntimeEnvironmentConfig({NETLIFY:"true",FTC_DEPLOYMENT_CONTEXT:"deploy-preview",NETLIFY_DB_URL:"postgres://branch_a:secret@db.example/ftc",SITE_ID:"site",FTC_BLOB_REGION:"us-east-2"} as NodeJS.ProcessEnv);
    const b = resolveRuntimeEnvironmentConfig({NETLIFY:"true",FTC_DEPLOYMENT_CONTEXT:"deploy-preview",NETLIFY_DB_URL:"postgres://branch_b:secret@db.example/ftc",SITE_ID:"site",FTC_BLOB_REGION:"us-east-2"} as NodeJS.ProcessEnv);
    expect(a.kind).toBe("preview"); expect(a.databaseFingerprint).not.toBe(b.databaseFingerprint);
    expect(a.storageStore).not.toBe(b.storageStore); expect(JSON.stringify(a)).not.toContain("secret");
  });

  it("fails closed on a mismatched production marker and permits an isolated preview clone", async () => {
    const {pool} = await setup();
    const production:RuntimeEnvironmentConfig={kind:"production",databaseFingerprint:"1".repeat(64),storageStore:"ftc-evidence-prod-site",storageRegion:"us-east-2",deploymentContext:"production"};
    const marker=await ensureEnvironmentMarker(pool,production);
    await expect(ensureEnvironmentMarker(pool,{...production,databaseFingerprint:"2".repeat(64)})).rejects.toThrow(/does not match/);
    await pool.query("INSERT INTO user_sessions(sid,sess,expire) VALUES ('copied-session','{}'::json,NOW()+interval '1 hour')");
    const sameDatabasePreview:RuntimeEnvironmentConfig={...production,kind:"preview",deploymentContext:"deploy-preview"};
    await expect(ensureEnvironmentMarker(pool,sameDatabasePreview)).rejects.toThrow(/does not match/);
    expect((await pool.query("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]?.marker_id).toBe(marker.id);
    expect((await pool.query("SELECT sid FROM user_sessions WHERE sid='copied-session'")).rows).toHaveLength(1);
    const preview=await ensureEnvironmentMarker(pool,{kind:"preview",databaseFingerprint:"3".repeat(64),storageStore:"ftc-evidence-preview-site-3",storageRegion:"us-east-2",deploymentContext:"deploy-preview"});
    expect(preview.id).not.toBe(marker.id); expect(preview.kind).toBe("preview");
    expect((await pool.query("SELECT sid FROM user_sessions WHERE sid='copied-session'")).rows).toHaveLength(0);
    expect((await ensureEnvironmentMarker(pool,{kind:"preview",databaseFingerprint:"3".repeat(64),storageStore:"ftc-evidence-preview-site-3",storageRegion:"us-east-2",deploymentContext:"deploy-preview"})).id).toBe(preview.id);
    for (const changed of [{...preview,storageStore:"another-store"},{...preview,storageRegion:"ap-southeast-1"},{...preview,deploymentContext:"branch-deploy"}]) {
      await expect(ensureEnvironmentMarker(pool,changed)).rejects.toThrow(/does not match/);
    }
    expect((await pool.query("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]?.marker_id).toBe(preview.id);
  });

  it("rejects preview initialization over the same production DB at the HTTP boundary without rotating sessions", async () => {
    const production:RuntimeEnvironmentConfig={kind:"production",databaseFingerprint:"4".repeat(64),storageStore:"ftc-evidence-prod-site",storageRegion:"us-east-2",deploymentContext:"production"};
    const {app,pool}=await setup(production);
    const {agent,csrf}=await login(app);
    const record=await createCase(agent,csrf,"same-production-db-case");
    const activeBefore=await pool.query<{marker_id:string}>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true");
    const sessionsBefore=await pool.query<{count:number}>("SELECT count(*)::int AS count FROM user_sessions");
    const previewConfig:RuntimeEnvironmentConfig={...production,kind:"preview",storageStore:"ftc-evidence-preview-site",deploymentContext:"deploy-preview"};
    const previewApp=createApp({pool,sessionSecret:"workflow-test-session-secret-has-sufficient-entropy",allowedOrigin:origin,trustedHttps:false,
      blobIO:storage(),officerUserId:officerId,environment:previewConfig});
    const rejected=await request.agent(previewApp).get("/api/auth/session").set("Origin",origin);
    expect(rejected.status).toBe(503);
    expect((await pool.query("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]?.marker_id).toBe(activeBefore.rows[0]?.marker_id);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM user_sessions")).rows[0]?.count).toBe(sessionsBefore.rows[0]?.count);
    expect((await pool.query("SELECT id FROM ftc_cases WHERE id=$1 AND environment_marker_id=$2",[record.id,activeBefore.rows[0]?.marker_id])).rows).toHaveLength(1);
  });

  it("isolates copied preview records and expires copied sessions when a preview DB branch changes", async () => {
    const firstConfig: RuntimeEnvironmentConfig = { kind:"production",databaseFingerprint:"a".repeat(64),storageStore:"ftc-evidence-prod-site",storageRegion:"us-east-2",deploymentContext:"production" };
    const { app,pool } = await setup(firstConfig);
    const { agent,csrf } = await login(app);
    const created = await createCase(agent,csrf,"preview-copy-case");
    const first = await pool.query<{id:string}>("SELECT marker.id FROM active_hosting_environment active JOIN hosting_environment_markers marker ON marker.id=active.marker_id");
    const firstId = first.rows[0]!.id;
    await pool.query(`INSERT INTO attachments(case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
      VALUES ($1,'production','ftc-evidence-prod-site','us-east-2','cases/copied-production-object','tax.pdf','application/pdf',10,$2,'thai_tax','ready',$3)`,[created.id,"a".repeat(64),firstId]);
    const copiedAttachment = await pool.query<{id:string}>("SELECT id FROM attachments WHERE case_id=$1",[created.id]);
    const secondConfig:RuntimeEnvironmentConfig = {kind:"preview",databaseFingerprint:"b".repeat(64),storageStore:"ftc-preview-b",storageRegion:"us-east-2",deploymentContext:"deploy-preview"};
    const second = await ensureEnvironmentMarker(pool,secondConfig);
    expect(second.id).not.toBe(firstId);
    expect((await agent.get("/api/auth/session").set("Origin",origin)).status).toBe(503);
    let productionReads=0;
    const guardedBlobs:BlobIO={...storage(),async get(){productionReads+=1;return null;}};
    const secondApp = createApp({pool,sessionSecret:"workflow-test-session-secret-has-sufficient-entropy",allowedOrigin:origin,trustedHttps:false,
      blobIO:guardedBlobs,officerUserId:officerId,environment:secondConfig});
    const gated = await request.agent(secondApp).post("/api/auth/login").set("Origin",origin)
      .send({loginName:"taxpayer-a",password:"test-password-01"});
    expect(gated.status).toBe(503);
    expect(gated.body.error.code).toBe("preview_initialization_required");
    for (const changed of [{...secondConfig,storageStore:"drifted-preview-store"},{...secondConfig,storageRegion:"ap-southeast-1"},{...secondConfig,deploymentContext:"branch-deploy"}]) {
      await expect(ensureEnvironmentMarker(pool,changed)).rejects.toThrow(/does not match/);
      const driftApp=createApp({pool,sessionSecret:"workflow-test-session-secret-has-sufficient-entropy",allowedOrigin:origin,trustedHttps:false,
        blobIO:guardedBlobs,officerUserId:officerId,environment:changed});
      expect((await request.agent(driftApp).get(`/api/cases/${created.id}`).set("Origin",origin)).status).toBe(503);
    }
    expect((await request.agent(secondApp).get(`/api/attachments/${copiedAttachment.rows[0]!.id}`).set("Origin",origin)).status).toBe(503);
    expect(productionReads).toBe(0);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM ftc_cases WHERE environment_marker_id=$1",[firstId])).rows[0]?.count).toBe(1);
  },10000);

  it("persists immutable revision-bound previews and exposes bounded authoritative detail", async () => {
    const { app,pool } = await setup();
    const { agent,csrf } = await login(app); const record = await createCase(agent,csrf,"calculate-case");
    const preview = await agent.post(`/api/cases/${record.id}/calculate`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:0,requestId:"preview-1"});
    expect(preview.status).toBe(200);
    expect(preview.body.data.snapshot.revision).toBe(0);
    expect(preview.body.data.snapshot.result.outcome).toBe("incomplete");
    const detail = await agent.get(`/api/cases/${record.id}`).set("Origin",origin);
    expect(detail.status).toBe(200);
    expect(detail.body.data.currentPreview.id).toBe(preview.body.data.snapshot.id);
    expect(detail.body.data.snapshotSummaries).toHaveLength(1);
    expect(detail.body.data.case.draft.revision).toBe(0);
    const stale = await agent.post(`/api/cases/${record.id}/calculate`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:1,requestId:"preview-stale"});
    expect(stale.status).toBe(409);
    await expect(pool.query("UPDATE calculation_snapshots SET result='{}'::jsonb WHERE id=$1",[preview.body.data.snapshot.id])).rejects.toThrow();
  });

  it("resumes an identical upload, advances evidence revisions, authorizes bytes, then tombstones and releases references", async () => {
    const { app,pool } = await setup(); const { agent,csrf } = await login(app); const record = await createCase(agent,csrf,"upload-case");
    const draft = structuredClone((await agent.get(`/api/cases/${record.id}`).set("Origin",origin)).body.data.case.draft);
    const source = validDraft(record.id).sources[0]!;
    draft.sources = [source];
    const saved = await agent.put(`/api/cases/${record.id}/draft`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:0,requestId:"source-save",data:draft});
    expect(saved.status).toBe(200);
    const sourceId = saved.body.data.case.draft.sources[0].id as string;
    const first = await uploadPdf(agent,csrf,record.id,1,"upload-retry-1",sourceId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.attachment.status).toBe("ready");
    expect(first.body.data.revision).toBe(3);
    const replay = await uploadPdf(agent,csrf,record.id,1,"upload-retry-1",sourceId);
    expect(replay.status).toBe(200);
    expect(replay.body.data.attachment.id).toBe(first.body.data.attachment.id);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM attachments WHERE case_id=$1",[record.id])).rows[0]?.count).toBe(1);
    const download = await agent.get(`/api/attachments/${first.body.data.attachment.id}`).set("Origin",origin);
    expect(download.status).toBe(200); expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.body.toString("ascii")).toContain("%PDF-1.7");
    const deleted = await agent.delete(`/api/attachments/${first.body.data.attachment.id}`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:3,requestId:"delete-upload-1"});
    expect(deleted.status).toBe(200); expect(deleted.body.data.revision).toBe(4);
    const stored = await pool.query<{status:string;source_id:string|null;remittance_id:string|null;cleanup_pending:boolean}>("SELECT status,source_id,remittance_id,cleanup_pending FROM attachments WHERE id=$1",[first.body.data.attachment.id]);
    expect(stored.rows[0]).toMatchObject({status:"deleted",source_id:null,remittance_id:null,cleanup_pending:false});
    const removed = structuredClone(saved.body.data.case.draft); removed.sources=[];
    const removal = await agent.put(`/api/cases/${record.id}/draft`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:4,requestId:"remove-after-evidence",data:removed});
    expect(removal.status).toBe(200);
  });

  it("rejects unsupported signatures and over-limit files before creating reservations", async () => {
    const {app,pool}=await setup(); const {agent,csrf}=await login(app); const record=await createCase(agent,csrf,"invalid-upload-case");
    const unsupported=await agent.post(`/api/cases/${record.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","wrong-signature").field("sourceId","").field("kind","other").field("displayName","bad.pdf")
      .attach("file",Buffer.from("not a PDF"),{filename:"bad.pdf",contentType:"application/pdf"});
    expect(unsupported.status).toBe(415);
    const oversized=await agent.post(`/api/cases/${record.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","too-large").field("sourceId","").field("kind","other").field("displayName","large.pdf")
      .attach("file",Buffer.concat([Buffer.from("%PDF-1.7\n"),Buffer.alloc(3*1024*1024)]),{filename:"large.pdf",contentType:"application/pdf"});
    expect(oversized.status).toBe(413);
    expect((await pool.query("SELECT id FROM attachments WHERE case_id=$1",[record.id])).rows).toHaveLength(0);
    expect((await agent.get(`/api/cases/${record.id}`).set("Origin",origin)).body.data.case.draft.revision).toBe(0);

    const boundaryCase=await createCase(agent,csrf,"exact-file-limit");
    const exactlyThreeMiB=Buffer.alloc(3*1024*1024,0x20); exactlyThreeMiB.write("%PDF-1.7\n",0,"ascii");
    const boundary=await agent.post(`/api/cases/${boundaryCase.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","exact-three-mib").field("sourceId","").field("kind","other").field("displayName","boundary.pdf")
      .attach("file",exactlyThreeMiB,{filename:"boundary.pdf",contentType:"application/pdf"});
    expect(boundary.status,JSON.stringify(boundary.body)).toBe(201);
    expect(boundary.body.data.attachment.byteSize).toBe(3*1024*1024);
  });

  it("enforces the 20-file case quota while pending and failed attachments consume capacity", async () => {
    const {app,pool}=await setup(); const {agent,csrf}=await login(app); const record=await createCase(agent,csrf,"case-file-quota");
    const marker=(await pool.query<{marker_id:string}>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]!.marker_id;
    for(let index=0;index<18;index+=1) {
      await pool.query("INSERT INTO attachments(case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id) VALUES ($1,'local','ftc-evidence-local','us-east-2',$2,'seed.pdf','application/pdf',0,$3,'other',$4,$5)",
        [record.id,`cases/${record.id}/quota-${index}`,"a".repeat(64),index%2===0?"pending":"failed",marker]);
    }
    const first=await uploadPdf(agent,csrf,record.id,0,"quota-file-19","");
    expect(first.status).toBe(201);
    const second=await uploadPdf(agent,csrf,record.id,first.body.data.revision,"quota-file-20","");
    expect(second.status).toBe(201);
    const rejected=await uploadPdf(agent,csrf,record.id,second.body.data.revision,"quota-file-21","");
    expect(rejected.status).toBe(429);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM attachments WHERE case_id=$1",[record.id])).rows[0]?.count).toBe(20);
    expect((await agent.get(`/api/cases/${record.id}`).set("Origin",origin)).body.data.case.draft.revision).toBe(second.body.data.revision);
  });

  it("enforces the 30 MiB case byte quota and five-file-per-source quota at the HTTP boundary", async () => {
    const {app,pool}=await setup(); const {agent,csrf}=await login(app);
    const byteCase=await createCase(agent,csrf,"case-byte-quota");
    const marker=(await pool.query<{marker_id:string}>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]!.marker_id;
    const fiveBytePdf=Buffer.from("%PDF-");
    await pool.query("INSERT INTO attachments(case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id) VALUES ($1,'local','ftc-evidence-local','us-east-2','cases/byte-quota/seed','seed.pdf','application/pdf',$2,$3,'other','pending',$4)",
      [byteCase.id,30*1024*1024-fiveBytePdf.length,"b".repeat(64),marker]);
    const atByteBoundary=await agent.post(`/api/cases/${byteCase.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","exact-case-bytes").field("sourceId","").field("kind","other").field("displayName","five.pdf")
      .attach("file",fiveBytePdf,{filename:"five.pdf",contentType:"application/pdf"});
    expect(atByteBoundary.status).toBe(201);
    const beyondByteBoundary=await uploadPdf(agent,csrf,byteCase.id,atByteBoundary.body.data.revision,"over-case-bytes","");
    expect(beyondByteBoundary.status).toBe(429);

    const sourceCase=await createCase(agent,csrf,"per-source-quota");
    const initial=(await agent.get(`/api/cases/${sourceCase.id}`).set("Origin",origin)).body.data.case.draft;
    initial.sources=[validDraft(sourceCase.id).sources[0]];
    const saved=await agent.put(`/api/cases/${sourceCase.id}/draft`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:0,requestId:"source-quota-save",data:initial});
    expect(saved.status).toBe(200);
    const sourceId=saved.body.data.case.draft.sources[0].id as string;
    let revision=saved.body.data.case.draft.revision as number;
    for(let index=0;index<5;index+=1) {
      const uploaded=await uploadPdf(agent,csrf,sourceCase.id,revision,`source-quota-${index}`,sourceId);
      expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(201); revision=uploaded.body.data.revision;
    }
    const sixth=await uploadPdf(agent,csrf,sourceCase.id,revision,"source-quota-6",sourceId);
    expect(sixth.status).toBe(429);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM attachments WHERE case_id=$1 AND source_id=$2",[sourceCase.id,sourceId])).rows[0]?.count).toBe(5);
  });

  it("keeps failed writes durable and resumes the same upload request after a storage fault", async () => {
    const durable=storage(); let shouldFail=true;
    const flaky:BlobIO={
      async put(marker,key,bytes){if(shouldFail){shouldFail=false;throw new Error("temporary blob fault");}return durable.put(marker,key,bytes);},
      get:(marker,key)=>durable.get(marker,key),delete:(marker,key)=>durable.delete(marker,key),
    };
    const {app,pool}=await setup(undefined,flaky); const {agent,csrf}=await login(app); const record=await createCase(agent,csrf,"retry-failed-upload");
    const failed=await agent.post(`/api/cases/${record.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","same-upload-request").field("sourceId","").field("kind","other").field("displayName","retry.pdf")
      .attach("file",pdfBytes("retry"),{filename:"retry.pdf",contentType:"application/pdf"});
    expect(failed.status).toBe(503);
    const failedState=await pool.query<{status:string;revision:number}>(
      "SELECT attachment.status,case_record.revision FROM attachments attachment JOIN ftc_cases case_record ON case_record.id=attachment.case_id WHERE attachment.case_id=$1",[record.id]);
    expect(failedState.rows[0]).toMatchObject({status:"failed",revision:2});
    const resumed=await agent.post(`/api/cases/${record.id}/attachments`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .field("expectedRevision","0").field("requestId","same-upload-request").field("sourceId","").field("kind","other").field("displayName","retry.pdf")
      .attach("file",pdfBytes("retry"),{filename:"retry.pdf",contentType:"application/pdf"});
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.attachment.status).toBe("ready");
    expect(resumed.body.data.revision).toBe(4);
    expect((await pool.query<{count:number}>("SELECT count(*)::int AS count FROM attachments WHERE case_id=$1",[record.id])).rows[0]?.count).toBe(1);
  });

  it("cleans up a late Blob write after a pending upload is canceled", async () => {
    const blobs=new Map<string,Uint8Array>(); let startPut!:()=>void; let resolvePut!:()=>void;
    const started=new Promise<void>((resolve)=>{startPut=resolve;}); const finish=new Promise<void>((resolve)=>{resolvePut=resolve;});
    const racing:BlobIO={
      async put(_marker,key,bytes){startPut();await finish;blobs.set(key,Uint8Array.from(bytes));},
      async get(_marker,key){return blobs.get(key)??null;},
      async delete(_marker,key){blobs.delete(key);},
    };
    const {app,pool}=await setup(undefined,racing); const {agent,csrf}=await login(app); const record=await createCase(agent,csrf,"cancel-race");
    const uploadTask=uploadPdf(agent,csrf,record.id,0,"cancel-race-upload","").then((value)=>value);
    await started;
    const pending=await pool.query<{id:string}>("SELECT id FROM attachments WHERE case_id=$1",[record.id]);
    expect(pending.rows).toHaveLength(1);
    const canceled=await agent.delete(`/api/attachments/${pending.rows[0]!.id}`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:1,requestId:"cancel-pending-upload"});
    expect(canceled.status).toBe(200);
    resolvePut();
    const late=await uploadTask;
    expect(late.status).toBe(404);
    expect(blobs.size).toBe(0);
    expect((await pool.query<{cleanup_pending:boolean;status:string}>("SELECT cleanup_pending,status FROM attachments WHERE id=$1",[pending.rows[0]!.id])).rows[0]).toMatchObject({cleanup_pending:false,status:"deleted"});
  });

  it("serializes a deferred upload finalization against submit and only submits a ready current revision", async () => {
    const durable=storage(); let holdNext=false; let startedResolve!:()=>void; let finishResolve!:()=>void;
    const started=new Promise<void>((resolve)=>{startedResolve=resolve;});
    const finish=new Promise<void>((resolve)=>{finishResolve=resolve;});
    const blobs:BlobIO={
      async put(marker,key,bytes){if(holdNext){holdNext=false;startedResolve();await finish;}await durable.put(marker,key,bytes);},
      get:(marker,key)=>durable.get(marker,key),delete:(marker,key)=>durable.delete(marker,key),
    };
    const {app}=await setup(undefined,blobs); const {agent,csrf}=await login(app); const record=await createCase(agent,csrf,"submit-finalization-race");
    const saved=await agent.put(`/api/cases/${record.id}/draft`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:0,requestId:"race-save",data:validDraft(record.id),confirmations:{thaiTax:true,eligibleSourceIndexes:[0]}});
    expect(saved.status).toBe(200);
    let revision=saved.body.data.case.draft.revision as number;
    for(const [index,source] of saved.body.data.case.draft.sources.entries()) {
      const uploaded=await uploadPdf(agent,csrf,record.id,revision,`race-required-${index}`,source.id);
      expect(uploaded.status).toBe(201); revision=uploaded.body.data.revision;
    }
    holdNext=true;
    const uploadTask=uploadPdf(agent,csrf,record.id,revision,"race-finalize-upload","").then((response)=>response);
    await started;
    const reservedRevision=revision+1;
    const pendingPreview=await agent.post(`/api/cases/${record.id}/calculate`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:reservedRevision,requestId:"race-pending-preview"});
    expect(pendingPreview.status).toBe(200);
    const submitTask=agent.post(`/api/cases/${record.id}/submit`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:reservedRevision,previewSnapshotId:pendingPreview.body.data.snapshot.id,requestId:"race-submit"}).then((response)=>response);
    finishResolve();
    const [uploadResult,submitResult]=await Promise.all([uploadTask,submitTask]);
    expect(uploadResult.status).toBe(201);
    expect([409,422]).toContain(submitResult.status);
    const current=await agent.get(`/api/cases/${record.id}`).set("Origin",origin);
    expect(current.body.data.case.status).toBe("draft");
    expect(current.body.data.case.draft.revision).toBe(uploadResult.body.data.revision);
    const freshPreview=await agent.post(`/api/cases/${record.id}/calculate`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:uploadResult.body.data.revision,requestId:"race-ready-preview"});
    const submitted=await agent.post(`/api/cases/${record.id}/submit`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:uploadResult.body.data.revision,previewSnapshotId:freshPreview.body.data.snapshot.id,requestId:"race-submit-ready"});
    expect(submitted.status).toBe(200);
  });

  it("calculates and submits the current confirmed case atomically to the configured officer", async () => {
    const { app,pool } = await setup(); const { agent,csrf } = await login(app); const record = await createCase(agent,csrf,"submit-case");
    const draft = validDraft(record.id);
    const saved = await agent.put(`/api/cases/${record.id}/draft`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:0,requestId:"submit-save",data:draft,confirmations:{thaiTax:true,eligibleSourceIndexes:[0]}});
    expect(saved.status).toBe(200);
    let revision = saved.body.data.case.draft.revision as number;
    for (const [index,source] of saved.body.data.case.draft.sources.entries()) {
      const uploaded = await uploadPdf(agent,csrf,record.id,revision,`submit-upload-${index}`,source.id);
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201); revision=uploaded.body.data.revision;
    }
    const preview = await agent.post(`/api/cases/${record.id}/calculate`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:revision,requestId:"submit-preview"});
    expect(preview.status).toBe(200);
    const submission = await agent.post(`/api/cases/${record.id}/submit`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:revision,previewSnapshotId:preview.body.data.snapshot.id,requestId:"submit-once"});
    expect(submission.status,JSON.stringify(submission.body)).toBe(200);
    expect(submission.body.data.case.status).toBe("submitted");
    expect(submission.body.data.snapshot.kind).toBe("submitted");
    const replay = await agent.post(`/api/cases/${record.id}/submit`).set("Origin",origin).set("X-CSRF-Token",csrf)
      .send({expectedRevision:revision,previewSnapshotId:preview.body.data.snapshot.id,requestId:"submit-once"});
    expect(replay.status).toBe(200); expect(replay.body.data.snapshot.id).toBe(submission.body.data.snapshot.id);
    const officer = await login(app,"officer-a");
    const queue = await officer.agent.get("/api/officer/cases").set("Origin",origin);
    expect(queue.status).toBe(200); expect(queue.body.data.cases.map((item:{id:string})=>item.id)).toContain(record.id);
    const detail = await officer.agent.get(`/api/officer/cases/${record.id}`).set("Origin",origin);
    expect(detail.status).toBe(200); expect(detail.body.data.auditEvents[0].actor).toBe("Officer A");
    expect(typeof detail.body.data.auditEvents[0].event).toBe("string");
    expect((await officer.agent.get(`/api/snapshots/${submission.body.data.snapshot.id}`).set("Origin",origin)).status).toBe(200);
    expect((await officer.agent.get(`/api/attachments/${detail.body.data.attachments[0].id}`).set("Origin",origin)).status).toBe(200);
    const auditCount = await pool.query<{count:number}>("SELECT count(*)::int AS count FROM audit_events WHERE case_id=$1 AND event_type='officer_case_accessed'",[record.id]);
    expect(auditCount.rows[0]?.count).toBe(1);
    await pool.query("CREATE FUNCTION fail_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$");
    await pool.query("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_audit_insert()");
    const auditFailure = await officer.agent.get(`/api/officer/cases/${record.id}`).set("Origin",origin);
    expect(auditFailure.status).toBe(503);
    expect(auditFailure.body.data).toBeUndefined();
  });
});
