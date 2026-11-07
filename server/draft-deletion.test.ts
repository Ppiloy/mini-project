import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPasswordForTest } from "./passwords.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";
import type { BlobIO } from "./storage/blob-io.js";
import type { EnvironmentMarker } from "./runtime/environment.js";

class TestPool implements PgPoolLike {
  constructor(private readonly database: PGlite) {}

  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }

  async connect(): Promise<PgQueryable> {
    return { query: (text, values, callback) => this.query(text, values, callback), release: () => undefined };
  }
}

const origin = "https://ftc.example.test";
const taxpayerA = "00000000-0000-4000-8000-000000000001";
const taxpayerB = "00000000-0000-4000-8000-000000000002";
const officer = "00000000-0000-4000-8000-000000000003";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

function blobStore(options: { failDeletes?: number; pausePuts?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  let remainingDeleteFailures = options.failDeletes ?? 0;
  let releasePut!: () => void;
  let putStarted!: () => void;
  const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
  const started = new Promise<void>((resolve) => { putStarted = resolve; });
  const deletedKeys: string[] = [];
  const blobs: BlobIO = {
    async put(_marker: EnvironmentMarker, key, bytes) {
      if (options.pausePuts) { putStarted(); await putGate; }
      objects.set(key, Uint8Array.from(bytes));
    },
    async get(_marker, key) { const bytes = objects.get(key); return bytes ? Uint8Array.from(bytes) : null; },
    async delete(_marker, key) {
      deletedKeys.push(key);
      if (remainingDeleteFailures > 0) { remainingDeleteFailures -= 1; throw new Error("temporary blob deletion failure"); }
      objects.delete(key);
    },
  };
  return { blobs, deletedKeys, releasePut, started };
}

async function setup(blobIO: BlobIO = blobStore().blobs) {
  const database = new PGlite();
  cleanup.push(() => database.close());
  const migrations = (await readdir("netlify/database/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
  const pool = new TestPool(database);
  const password = await hashPasswordForTest("test-password-01");
  await pool.query(`INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES
    ($1,'taxpayer-a','Taxpayer A',$4,'taxpayer'),($2,'taxpayer-b','Taxpayer B',$4,'taxpayer'),($3,'officer-a','Officer A',$4,'officer')`,
  [taxpayerA, taxpayerB, officer, password]);
  const app = createApp({ pool, sessionSecret: "draft-deletion-test-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false, blobIO, officerUserId: officer });
  return { app, pool };
}

async function login(app: ReturnType<typeof createApp>, username = "taxpayer-a") {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").set("Origin", origin).send({ loginName: username, password: "test-password-01" });
  expect(response.status).toBe(200);
  return { agent, csrf: response.body.data.csrfToken as string };
}

async function createCase(agent: ReturnType<typeof request.agent>, csrf: string, requestId: string) {
  const response = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrf).send({ requestId });
  expect(response.status).toBe(201);
  return response.body.data.case as { id: string; draft: { revision: number } };
}

describe("confirmed draft deletion HTTP workflow", () => {
  it("removes an owned draft from the active list and releases one of the ten case slots", async () => {
    const { app } = await setup();
    const { agent, csrf } = await login(app);
    const first = await createCase(agent, csrf, "delete-case-first");
    for (let index = 1; index < 10; index += 1) await createCase(agent, csrf, `delete-case-quota-${index}`);

    const deleted = await agent.delete(`/api/cases/${first.id}`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: first.draft.revision, requestId: "delete-case-request-1" });

    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true, cleanupPending: false, revision: 0 });
    expect((await agent.get("/api/cases").set("Origin", origin)).body.data.cases).toHaveLength(9);
    expect((await agent.get(`/api/cases/${first.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrf).send({ requestId: "delete-case-first" })).status).toBe(409);
    expect((await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrf).send({ requestId: "delete-case-freed-slot" })).status).toBe(201);
  });

  it("requires the owner, CSRF token, current revision, and a draft state", async () => {
    const { app, pool } = await setup();
    const owner = await login(app);
    const otherTaxpayer = await login(app, "taxpayer-b");
    const reviewingOfficer = await login(app, "officer-a");
    const draft = await createCase(owner.agent, owner.csrf, "delete-case-authorization");
    const payload = { expectedRevision: 0, requestId: "delete-case-authorization-request" };

    expect((await owner.agent.delete(`/api/cases/${draft.id}`).set("Origin", origin).send(payload)).status).toBe(403);
    expect((await otherTaxpayer.agent.delete(`/api/cases/${draft.id}`).set("Origin", origin).set("X-CSRF-Token", otherTaxpayer.csrf).send(payload)).status).toBe(404);
    expect((await reviewingOfficer.agent.delete(`/api/cases/${draft.id}`).set("Origin", origin).set("X-CSRF-Token", reviewingOfficer.csrf).send(payload)).status).toBe(403);
    expect((await owner.agent.delete(`/api/cases/${draft.id}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ ...payload, expectedRevision: 1 })).status).toBe(409);

    const marker = (await pool.query<{ marker_id: string }>("SELECT marker_id FROM active_hosting_environment WHERE singleton=true")).rows[0]!.marker_id;
    const submittedSnapshotId = "00000000-0000-4000-8000-000000000091";
    await pool.query(
      `INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version)
       VALUES ($1,$2,0,'submitted','{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'test','test')`, [submittedSnapshotId, draft.id],
    );
    await pool.query(
      "UPDATE ftc_cases SET status='submitted',assigned_officer_id=$2,submitted_snapshot_id=$3,submitted_at=now() WHERE id=$1 AND environment_marker_id=$4",
      [draft.id, officer, submittedSnapshotId, marker],
    );
    expect((await owner.agent.delete(`/api/cases/${draft.id}`).set("Origin", origin).set("X-CSRF-Token", owner.csrf).send(payload)).status).toBe(409);
  });

  it("keeps a failed evidence cleanup visible and retryable while hiding all private case reads and blocking mutations", async () => {
    const store = blobStore({ failDeletes: 1 });
    const { app } = await setup(store.blobs);
    const { agent, csrf } = await login(app);
    const record = await createCase(agent, csrf, "delete-case-evidence-retry");
    const uploaded = await agent.post(`/api/cases/${record.id}/attachments`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .field("expectedRevision", "0").field("requestId", "delete-case-upload").field("sourceId", "")
      .field("kind", "other").field("displayName", "proof.pdf")
      .attach("file", Buffer.from("%PDF-1.7\nDraft proof\n%%EOF", "ascii"), { filename: "proof.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe(201);
    const caseRecord = uploaded.body.data.case as { draft: { revision: number } };
    const preview = await agent.post(`/api/cases/${record.id}/calculate`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: caseRecord.draft.revision, requestId: "delete-case-preview" });
    expect(preview.status).toBe(200);
    const originalDraft = caseRecord.draft;
    const deleteRequest = { expectedRevision: caseRecord.draft.revision, requestId: "delete-case-evidence-request" };

    const pending = await agent.delete(`/api/cases/${record.id}`).set("Origin", origin).set("X-CSRF-Token", csrf).send(deleteRequest);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toEqual({ deleted: false, cleanupPending: true, revision: caseRecord.draft.revision });
    const listed = await agent.get("/api/cases").set("Origin", origin);
    expect(listed.body.data.cases.map((item: { id: string }) => item.id)).toContain(record.id);
    expect(listed.body.data.pendingDeletions).toEqual([{ caseId: record.id, requestId: deleteRequest.requestId }]);
    expect((await agent.get(`/api/cases/${record.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.get(`/api/snapshots/${preview.body.data.snapshot.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.get(`/api/attachments/${uploaded.body.data.attachment.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.put(`/api/cases/${record.id}/draft`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: caseRecord.draft.revision, requestId: "delete-case-save-blocked", data: originalDraft })).status).toBe(409);
    expect((await agent.post(`/api/cases/${record.id}/calculate`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: caseRecord.draft.revision, requestId: "delete-case-calculate-blocked" })).status).toBe(409);
    expect((await agent.post(`/api/cases/${record.id}/submit`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: caseRecord.draft.revision, previewSnapshotId: preview.body.data.snapshot.id, requestId: "delete-case-submit-blocked" })).status).toBe(409);
    expect((await agent.delete(`/api/attachments/${uploaded.body.data.attachment.id}`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: caseRecord.draft.revision, requestId: "delete-case-evidence-blocked" })).status).toBe(409);
    const secondUpload = await agent.post(`/api/cases/${record.id}/attachments`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .field("expectedRevision", String(caseRecord.draft.revision)).field("requestId", "delete-case-upload-blocked").field("sourceId", "")
      .field("kind", "other").field("displayName", "another.pdf")
      .attach("file", Buffer.from("%PDF-1.7\nDraft proof\n%%EOF", "ascii"), { filename: "another.pdf", contentType: "application/pdf" });
    expect(secondUpload.status).toBe(409);
    expect((await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrf).send({ requestId: "delete-case-evidence-retry" })).status).toBe(409);

    const retried = await agent.delete(`/api/cases/${record.id}`).set("Origin", origin).set("X-CSRF-Token", csrf).send(deleteRequest);
    expect(retried.status).toBe(200);
    expect(retried.body.data).toEqual({ deleted: true, cleanupPending: false, revision: caseRecord.draft.revision });
    expect(store.deletedKeys).toHaveLength(2);
    const afterCleanup = await agent.get("/api/cases").set("Origin", origin);
    expect(afterCleanup.body.data.cases.map((item: { id: string }) => item.id)).not.toContain(record.id);
    expect(afterCleanup.body.data.pendingDeletions ?? []).toHaveLength(0);
    expect((await agent.get(`/api/cases/${record.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.get(`/api/snapshots/${preview.body.data.snapshot.id}`).set("Origin", origin)).status).toBe(404);
    expect((await agent.get(`/api/attachments/${uploaded.body.data.attachment.id}`).set("Origin", origin)).status).toBe(404);
  });

  it("refuses deletion during a blob upload and permits deletion after the upload settles", async () => {
    const store = blobStore({ pausePuts: true });
    const { app } = await setup(store.blobs);
    const { agent, csrf } = await login(app);
    const record = await createCase(agent, csrf, "delete-case-upload-race");
    const uploadPromise = agent.post(`/api/cases/${record.id}/attachments`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .field("expectedRevision", "0").field("requestId", "delete-case-upload-race-upload").field("sourceId", "")
      .field("kind", "other").field("displayName", "in-flight.pdf")
      .attach("file", Buffer.from("%PDF-1.7\nIn flight\n%%EOF", "ascii"), { filename: "in-flight.pdf", contentType: "application/pdf" })
      .then((response) => response);
    await store.started;

    const blocked = await agent.delete(`/api/cases/${record.id}`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: 1, requestId: "delete-case-upload-race-delete" });
    expect(blocked.status).toBe(409);
    store.releasePut();
    const uploaded = await uploadPromise;
    expect(uploaded.status).toBe(201);
    const deleted = await agent.delete(`/api/cases/${record.id}`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: uploaded.body.data.revision, requestId: "delete-case-upload-race-delete" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ deleted: true, cleanupPending: false });
  });
});
