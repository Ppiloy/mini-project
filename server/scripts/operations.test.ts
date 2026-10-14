import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCalculationSnapshot } from "../../shared/snapshot.js";
import { createEmptyDraft } from "../../shared/draft.js";
import { hashPasswordForTest } from "../passwords.js";
import { createApp } from "../app.js";
import type { EnvironmentMarker } from "../runtime/environment.js";
import type { PgPoolLike, PgQueryable } from "../postgres.js";
import { ensureEnvironmentMarker, resolveRuntimeEnvironmentConfig } from "../runtime/environment.js";
import type { BlobIO } from "../storage/blob-io.js";
import { createAuthenticatedCliBlobIO, runBackupCommand, runCleanupCommand, runPreviewInitializationCommand, runResetDemoCommand, runRestoreRehearsalCommand } from "./operations.js";

class TestPool implements PgPoolLike {
  lastError?: Error;
  constructor(readonly database: PGlite) {}
  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }), (error: Error) => {
      this.lastError = error;
      throw new Error(`PGlite query failed (${values?.length ?? 0} params): ${text.slice(0, 180)}`, { cause: error });
    });
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }
  async connect(): Promise<PgQueryable> {
    return { query: (text, values, callback) => this.query(text, values, callback), release: () => undefined };
  }
}

class TestBlobs implements BlobIO {
  readonly supportsStrongReads = true;
  readonly objects = new Map<string, Uint8Array>();
  deleteCalls: string[] = [];
  failAfterDelete = false;
  async put(_marker: EnvironmentMarker, key: string, bytes: Uint8Array) {
    const prior = this.objects.get(key);
    if (prior && Buffer.compare(Buffer.from(prior), Buffer.from(bytes)) !== 0) throw new Error("key conflict");
    this.objects.set(key, Uint8Array.from(bytes));
  }
  async get(_marker: EnvironmentMarker, key: string) {
    const bytes = this.objects.get(key);
    return bytes ? Uint8Array.from(bytes) : null;
  }
  async delete(_marker: EnvironmentMarker, key: string) {
    this.deleteCalls.push(key);
    this.objects.delete(key);
    if (this.failAfterDelete) {
      this.failAfterDelete = false;
      throw new Error("simulated lost delete acknowledgement");
    }
  }
  async list(_marker: EnvironmentMarker, prefix: string) {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key, etag: `etag-${key}` }));
  }
}

const activeDatabases: PGlite[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => { while (activeDatabases.length) await activeDatabases.pop()?.close(); while (temporaryDirectories.length) await rm(temporaryDirectories.pop()!, { recursive: true, force: true }); });

describe("authenticated Netlify CLI Blob adapter", () => {
  const marker = { kind: "preview", id: "95000000-0000-4000-8000-000000000001", initializedAt: "2026-10-14T00:00:00.000Z",
    deploymentContext: "deploy-preview", databaseFingerprint: "a".repeat(64), storageStore: "ftc-evidence-preview-test-1234567890123456", storageRegion: "us-east-2" } satisfies EnvironmentMarker;
  const statusJson = (siteId: string) => `Current Netlify User\n{\n  "account": {},\n  "siteData": {"site-id":"${siteId}"},\n  "loggedIn": true,\n  "linked": true\n}\nNetlify Project Info\n`;

  it("checks the authenticated linked site before any Blob command", async () => {
    const calls: string[][] = [];
    const io = createAuthenticatedCliBlobIO("trusted-site", async (args) => {
      calls.push(args);
      return { stdout: statusJson("different-site") };
    });
    await expect(io.list(marker, "cases/")).rejects.toThrow(/does not match the trusted site ID/);
    expect(calls).toEqual([["status", "--json"]]);
  });

  it("uses explicit region, consumes the complete CLI inventory, and never force-overwrites", async () => {
    const calls: string[][] = [];
    const io = createAuthenticatedCliBlobIO("trusted-site", async (args) => {
      calls.push(args);
      if (args[0] === "status") return { stdout: statusJson("trusted-site") };
      if (args[0] === "blobs:list") return { stdout: JSON.stringify({ blobs: [{ key: "cases/a/1", etag: "one" }, { key: "cases/b/2", etag: "two" }], directories: [] }) };
      if (args[0] === "blobs:get") {
        const error = new Error("child returned an error") as Error & { stderr: string };
        error.stderr = "Blob cases/new/1 does not exist in store";
        throw error;
      }
      if (args[0] === "blobs:set") return { stdout: "Success" };
      throw new Error("Unexpected test CLI command.");
    });
    expect(await io.list(marker, "cases/")).toEqual([{ key: "cases/a/1" }, { key: "cases/b/2" }]);
    await io.put(marker, "cases/new/1", Buffer.from("fictional bytes"));
    expect(calls.filter((args) => args[0] === "status")).toHaveLength(1);
    expect(calls.find((args) => args[0] === "blobs:list")).toEqual(["blobs:list", marker.storageStore, "--json", "--prefix", "cases/", "--region", "us-east-2"]);
    const put = calls.find((args) => args[0] === "blobs:set")!;
    expect(put).toEqual(["blobs:set", marker.storageStore, "cases/new/1", "--region", "us-east-2", "--input", expect.any(String)]);
    expect(put).not.toContain("--force");
    expect(io.supportsStrongReads).toBe(true);
  });

  it("retains only a redacted diagnostic class from CLI errors", async () => {
    const io = createAuthenticatedCliBlobIO("trusted-site", async () => {
      const error = new Error("failed") as Error & { stderr: string };
      error.stderr = "HTTP 403 Authorization failed for token password super-secret";
      throw error;
    });
    await expect(io.list(marker, "cases/")).rejects.toThrow(/access, status 403/);
    await expect(io.list(marker, "cases/")).rejects.not.toThrow(/super-secret|password|token/);
  });
});

async function cleanupFixture(includeOfficer = false, readyStorageKey?: string) {
  const database = new PGlite();
  activeDatabases.push(database);
  for (const name of (await readdir("netlify/database/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
  }
  const pool = new TestPool(database);
  const env: NodeJS.ProcessEnv = {
    FTC_DEPLOYMENT_CONTEXT: "dev",
    NETLIFY_DEV: "true",
    FTC_BLOB_REGION: "us-east-2",
    FTC_UPLOAD_SETTLE_MS: "60000",
    NETLIFY_DB_URL: "postgres://local-user:local-secret@127.0.0.1/ftc-cleanup",
  };
  const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const officerId = "84000000-0000-4000-8000-000000000002";
  const caseId = "20000000-0000-4000-8000-000000000001";
  const readyId = "30000000-0000-4000-8000-000000000001";
  const deletedId = "30000000-0000-4000-8000-000000000002";
  const snapshotId = "40000000-0000-4000-8000-000000000001";
  await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,'taxpayer-demo-a','Taxpayer A',$2,'taxpayer')", [ownerId, await hashPasswordForTest("fixture-password-01")]);
  if (includeOfficer) await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,'officer-demo','Fictional Officer',$2,'officer')", [officerId, await hashPasswordForTest("source-officer-password")]);
  const draft = createEmptyDraft();
  draft.id = caseId;
  await pool.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id,assigned_officer_id) VALUES ($1,$2,$3::jsonb,'cleanup-fixture',$4,$5)", [caseId, ownerId, JSON.stringify(draft), marker.id, includeOfficer ? officerId : null]);
  if (includeOfficer) await pool.query("INSERT INTO officer_case_assignments(case_id,officer_id,assigned_by) VALUES ($1,$2,$2)", [caseId, officerId]);
  await pool.query("INSERT INTO foreign_income_sources(id,case_id,position,source_data,gross_income_amount) VALUES ('35000000-0000-4000-8000-000000000001',$1,0,'{}'::jsonb,123.450000000123)", [caseId]);
  const readyBytes = Buffer.from("%PDF-1.7\nimmutable ready evidence\n%%EOF", "ascii");
  const deletedBytes = Buffer.from("%PDF-1.7\ntombstone evidence\n%%EOF", "ascii");
  const readyKey = readyStorageKey ?? `cases/${caseId}/${readyId}`;
  const deletedKey = `cases/${caseId}/${deletedId}`;
  const insertAttachment = async (id: string, key: string, bytes: Buffer) => {
    await pool.query(
      `INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9,'other','ready',$10)`,
      [id, caseId, marker.kind, marker.storageStore, marker.storageRegion, key, `${id}.pdf`, bytes.length, createHash("sha256").update(bytes).digest("hex"), marker.id],
    );
  };
  await insertAttachment(readyId, readyKey, readyBytes);
  await insertAttachment(deletedId, deletedKey, deletedBytes);
  await pool.query("UPDATE attachments SET status='deleted',cleanup_pending=true,cleanup_requested_at='2026-10-13T23:00:00.000Z' WHERE id=$1", [deletedId]);
  const readyEvidence = { id: readyId, sourceId: null, kind: "other" as const, displayName: `${readyId}.pdf`, mediaType: "application/pdf", byteSize: readyBytes.length,
    sha256: createHash("sha256").update(readyBytes).digest("hex") };
  const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "submitted", inputs: draft, evidence: [readyEvidence], createdAt: "2026-10-14T00:00:00.000Z" });
  await pool.query(
    `INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
     VALUES ($1,$2,$3,'submitted',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz)`,
    [snapshotId, caseId, draft.revision, JSON.stringify(snapshot.inputs), JSON.stringify(snapshot.result), JSON.stringify(snapshot.evidence), JSON.stringify(snapshot.policy), snapshot.policy.id, snapshot.result.engineVersion, snapshot.createdAt],
  );
  const tombstoneEvidence = { id: deletedId, sourceId: null, kind: "other" as const, displayName: `${deletedId}.pdf`, mediaType: "application/pdf", byteSize: deletedBytes.length,
    sha256: createHash("sha256").update(deletedBytes).digest("hex") };
  const draftPreview = createCalculationSnapshot({ id: "40000000-0000-4000-8000-000000000002", caseId, revision: draft.revision,
    kind: "preview", inputs: draft, evidence: [tombstoneEvidence], createdAt: "2026-10-13T23:30:00.000Z" });
  await pool.query(
    `INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
     VALUES ($1,$2,$3,'preview',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz)`,
    [draftPreview.id, caseId, draft.revision, JSON.stringify(draftPreview.inputs), JSON.stringify(draftPreview.result), JSON.stringify(draftPreview.evidence), JSON.stringify(draftPreview.policy), draftPreview.policy.id, draftPreview.result.engineVersion, draftPreview.createdAt],
  );
  await pool.query("UPDATE ftc_cases SET status='submitted',submitted_snapshot_id=$2,submitted_at=$3 WHERE id=$1", [caseId, snapshotId, snapshot.createdAt]);
  const blobs = new TestBlobs();
  await blobs.put(marker, readyKey, readyBytes);
  await blobs.put(marker, deletedKey, deletedBytes);
  return { pool, env, marker, caseId, readyId, deletedId, readyKey, deletedKey, readyBytes, deletedBytes, snapshotId, blobs };
}

describe("the cleanup operator command", () => {
  it("dry-runs without mutation, then retries only a submitted-case tombstone while preserving frozen ready evidence", async () => {
    const fixture = await cleanupFixture();
    const reviewDirectory = await mkdtemp(join(tmpdir(), "ftc-cleanup-review-")); temporaryDirectories.push(reviewDirectory);
    const output: string[] = [];
    const now = () => new Date("2026-10-14T00:10:00.000Z");
    const deps = { pool: fixture.pool, env: fixture.env, blobs: fixture.blobs, now,
      manifestPath: (command: string, id: string) => join(reviewDirectory, `${command}-${id}.json`), writeOutput: (line: string) => output.push(line) };
    const rowsBefore = await fixture.pool.query("SELECT id,status,cleanup_pending,storage_deleted_at FROM attachments ORDER BY id");
    const snapshotBefore = await fixture.pool.query("SELECT inputs,result,evidence,policy FROM calculation_snapshots WHERE id=$1", [fixture.snapshotId]);
    const deletedBefore = await fixture.blobs.get(fixture.marker, fixture.deletedKey);

    const plan = await runCleanupCommand(["--target", "local", "--dry-run"], deps);

    expect(plan.status).toBe("planned");
    expect(plan.manifest.target).toMatchObject({ markerId: fixture.marker.id, store: fixture.marker.storageStore, region: "us-east-2" });
    expect(plan.manifest.candidates.map((candidate) => candidate.attachmentId)).toContain(fixture.deletedId);
    expect(plan.manifest.candidates.find((candidate) => candidate.attachmentId === fixture.deletedId)?.action).toBe("delete-and-verify");
    expect(plan.manifest.candidates.find((candidate) => candidate.attachmentId === fixture.readyId)?.action).toBe("blocked-ready-evidence");
    const reviewPath = output.find((line) => line.includes("Review manifest:"))?.split("Review manifest: ")[1]?.split("; sha256:")[0];
    expect(reviewPath).toBeTruthy();
    const review = JSON.parse(await readFile(reviewPath!, "utf8")) as { manifest: { candidates: { attachmentId: string; status: string; requestedAgeMs: number; attemptCount: number; protection: string; snapshotReferences: { kind: string }[] }[]; target: { markerId: string; store: string; region: string } } };
    expect(review.manifest.target).toMatchObject({ markerId: fixture.marker.id, store: fixture.marker.storageStore, region: "us-east-2" });
    expect(review.manifest.candidates.find((candidate) => candidate.attachmentId === fixture.deletedId)).toMatchObject({
      status: "deleted", caseStatus: "submitted", requestedAgeMs: expect.any(Number), attemptCount: expect.any(Number), protection: "none",
      snapshotReferences: [{ kind: "preview" }],
    });
    expect(review.manifest.candidates.find((candidate) => candidate.attachmentId === fixture.readyId)?.protection).toBe("ready_evidence");
    expect(output.join(" ")).not.toMatch(/gross_income|salary|fixture-password|local-secret/);
    if (process.platform === "win32") {
      const acl = execFileSync("icacls", [reviewPath!], { encoding: "utf8" });
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
      expect(acl).toContain(`${principal}:(F)`);
      expect(acl).not.toMatch(/BUILTIN\\Users:/i);
    } else expect((await stat(reviewPath!)).mode & 0o077).toBe(0);
    expect(await fixture.pool.query("SELECT id,status,cleanup_pending,storage_deleted_at FROM attachments ORDER BY id")).toEqual(rowsBefore);
    expect(await fixture.blobs.get(fixture.marker, fixture.deletedKey)).toEqual(deletedBefore);
    expect(fixture.blobs.deleteCalls).toEqual([]);

    fixture.blobs.failAfterDelete = true;
    const firstExecution = await runCleanupCommand(["--target", "local", "--confirm", plan.manifestId], deps);
    expect(firstExecution.status).toBe("partial");
    expect(await fixture.blobs.get(fixture.marker, fixture.deletedKey)).toBeNull();
    expect((await fixture.pool.query("SELECT status,cleanup_pending,storage_deleted_at FROM attachments WHERE id=$1", [fixture.deletedId])).rows[0])
      .toEqual({ status: "deleted", cleanup_pending: true, storage_deleted_at: null });
    const snapshotAfterFailure = await fixture.pool.query("SELECT inputs,result,evidence,policy FROM calculation_snapshots WHERE id=$1", [fixture.snapshotId]);
    expect(snapshotAfterFailure.rows).toEqual(snapshotBefore.rows);
    expect(Buffer.from((await fixture.blobs.get(fixture.marker, fixture.readyKey))!)).toEqual(fixture.readyBytes);

    await fixture.blobs.put(fixture.marker, fixture.deletedKey, fixture.deletedBytes);
    const retryPlan = await runCleanupCommand(["--target", "local", "--dry-run"], deps);
    expect(retryPlan.manifest.candidates.find((candidate) => candidate.attachmentId === fixture.deletedId)?.action).toBe("delete-and-verify");
    await runCleanupCommand(["--target", "local", "--confirm", retryPlan.manifestId], deps);
    expect(await fixture.blobs.get(fixture.marker, fixture.deletedKey)).toBeNull();
    const cleaned = (await fixture.pool.query<{ status: string; cleanup_pending: boolean; storage_deleted_at: string | null }>("SELECT status,cleanup_pending,storage_deleted_at FROM attachments WHERE id=$1", [fixture.deletedId])).rows[0];
    expect(cleaned).toMatchObject({ status: "deleted", cleanup_pending: false });
    expect(cleaned?.storage_deleted_at).not.toBeNull();
    expect(Buffer.from((await fixture.blobs.get(fixture.marker, fixture.readyKey))!)).toEqual(fixture.readyBytes);
    expect((await fixture.pool.query("SELECT inputs,result,evidence,policy FROM calculation_snapshots WHERE id=$1", [fixture.snapshotId])).rows).toEqual(snapshotBefore.rows);
    expect(output.join(" ")).not.toMatch(/local-secret|immutable ready evidence|tombstone evidence/);
  });
});

describe("one-time preview initialization", () => {
  it("blocks HTTP login until credentials, fictional drafts, and evidence are verified; replay preserves live sessions", async () => {
    const database = new PGlite(); activeDatabases.push(database);
    for (const name of (await readdir("netlify/database/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
      await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    }
    const pool = new TestPool(database);
    const env: NodeJS.ProcessEnv = {
      FTC_DEPLOYMENT_CONTEXT: "deploy-preview", FTC_BLOB_REGION: "us-east-2", NETLIFY_SITE_ID: "fictional-site",
      NETLIFY_DB_URL: "postgres://preview-user:preview-secret@127.0.0.1/ftc-preview",
    };
    const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    await pool.query("INSERT INTO preview_environment_initialization(environment_marker_id,status) VALUES ($1,'pending')", [marker.id]);
    const accountRows = [
      ["50000000-0000-4000-8000-000000000001", "taxpayer-demo-a", "Taxpayer A", "taxpayer"],
      ["50000000-0000-4000-8000-000000000002", "taxpayer-demo-b", "Taxpayer B", "taxpayer"],
      ["50000000-0000-4000-8000-000000000003", "officer-demo", "Officer", "officer"],
    ] as const;
    for (const [id, login, name, role] of accountRows) {
      await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)", [id, login, name, await hashPasswordForTest("copied-preview-password"), role]);
      if (role === "taxpayer") await pool.query("INSERT INTO user_profiles(user_id,masked_reference) VALUES ($1,'***-1001')", [id]);
    }
    const copiedMarkerId = "51000000-0000-4000-8000-000000000001";
    await pool.query(`INSERT INTO hosting_environment_markers(id,kind,database_fingerprint,storage_store,storage_region,deployment_context)
      VALUES ($1,'production',$2,'ftc-evidence-prod-copied','us-east-2','production')`, [copiedMarkerId, "c".repeat(64)]);
    const copiedCaseId = "52000000-0000-4000-8000-000000000001";
    const copiedAttachmentId = "53000000-0000-4000-8000-000000000001";
    const copiedBytes = Buffer.from("copied production evidence must stay outside preview", "utf8");
    const copiedDraft = createEmptyDraft(); copiedDraft.id = copiedCaseId;
    await pool.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id) VALUES ($1,$2,$3::jsonb,'copied-production-case',$4)",
      [copiedCaseId, accountRows[0][0], JSON.stringify(copiedDraft), copiedMarkerId]);
    const copiedEvidence = { id: copiedAttachmentId, sourceId: null, kind: "other" as const, displayName: "copied-production.pdf", mediaType: "application/pdf",
      byteSize: copiedBytes.length, sha256: createHash("sha256").update(copiedBytes).digest("hex") };
    const copiedSnapshot = createCalculationSnapshot({ id: "54000000-0000-4000-8000-000000000001", caseId: copiedCaseId, revision: copiedDraft.revision,
      kind: "submitted", inputs: copiedDraft, evidence: [copiedEvidence], createdAt: "2026-10-13T23:00:00.000Z" });
    await pool.query(`INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
      VALUES ($1,$2,$3,'submitted',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz)`,
    [copiedSnapshot.id, copiedCaseId, copiedDraft.revision, JSON.stringify(copiedSnapshot.inputs), JSON.stringify(copiedSnapshot.result), JSON.stringify(copiedSnapshot.evidence),
      JSON.stringify(copiedSnapshot.policy), copiedSnapshot.policy.id, copiedSnapshot.result.engineVersion, copiedSnapshot.createdAt]);
    await pool.query(`INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
      VALUES ($1,$2,'production','ftc-evidence-prod-copied','us-east-2',$3,'copied-production.pdf','application/pdf',$4,$5,'other','ready',$6)`,
    [copiedAttachmentId, copiedCaseId, `cases/${copiedCaseId}/${copiedAttachmentId}`, copiedBytes.length, copiedEvidence.sha256, copiedMarkerId]);
    await pool.query("UPDATE ftc_cases SET status='submitted',submitted_snapshot_id=$2,submitted_at=$3 WHERE id=$1", [copiedCaseId, copiedSnapshot.id, copiedSnapshot.createdAt]);
    await pool.query("INSERT INTO user_sessions(sid,sess,expire) VALUES ('copied-preview-session','{}'::json,NOW()+interval '1 hour')");
    const blobs = new TestBlobs();
    const app = createApp({ pool, blobIO: blobs, sessionSecret: "preview-test-session-secret-at-least-32", allowedOrigin: "http://localhost:5173", trustedHttps: false, officerUserId: accountRows[2][0],
      environment: resolveRuntimeEnvironmentConfig(env) });
    const blocked = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName: "taxpayer-demo-a", password: "copied-preview-password" });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe("preview_initialization_required");

    const dir = await mkdtemp(join(tmpdir(), "ftc-preview-init-")); temporaryDirectories.push(dir);
    const credentialsPath = join(dir, "preview-credentials.json");
    const operationId = "61000000-0000-4000-8000-000000000001";
    const output: string[] = [];
    const deps = { pool, env, blobs, credentialsPath, manifestPath: (command: string, name: string) => join(dir, `review-${command}-${name}.json`),
      writeOutput: (line: string) => output.push(line) };
    const passwordHashesBefore = await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name");
    const sessionCountBefore = await pool.query("SELECT count(*)::int AS count FROM user_sessions");
    const caseCountBefore = await pool.query("SELECT count(*)::int AS count FROM ftc_cases");
    const blobKeysBefore = await blobs.list(marker, "cases/");
    const plan = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", operationId, "--dry-run"], deps);
    const planManifest = plan.manifest!;
    expect(plan.status).toBe("planned");
    expect(planManifest.target).toMatchObject({ kind: "preview", markerId: marker.id, store: marker.storageStore, region: "us-east-2" });
    expect(planManifest.drafts).toHaveLength(2);
    const previewPdf = await readFile(join(process.cwd(), "server", "fixtures", "fictional-preview-evidence.pdf"));
    expect(previewPdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.3");
    expect(previewPdf.toString("ascii")).toMatch(/startxref\n\d+\n%%EOF\s*$/);
    expect(planManifest.evidence).toMatchObject({ sha256: createHash("sha256").update(previewPdf).digest("hex"), byteSize: previewPdf.byteLength });
    expect(await readFile(join(dir, `review-preview-init-${plan.manifestId}.json`), "utf8")).toContain("cases/");
    expect(await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name")).toEqual(passwordHashesBefore);
    expect(await pool.query("SELECT count(*)::int AS count FROM user_sessions")).toEqual(sessionCountBefore);
    expect(await pool.query("SELECT count(*)::int AS count FROM ftc_cases")).toEqual(caseCountBefore);
    expect(await blobs.list(marker, "cases/")).toEqual(blobKeysBefore);
    expect(output.join(" ")).not.toMatch(/copied-preview-password|password_hash|gross_income/);
    await expect(runPreviewInitializationCommand(["--target", "preview", "--operation-id", operationId, "--confirm", "bad"], deps))
      .rejects.toThrow(/review the new dry-run manifest/);
    expect(await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name")).toEqual(passwordHashesBefore);
    const result = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", operationId, "--confirm", plan.manifestId!], deps);
    expect(result.status).toBe("initialized");
    const credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as { credentials: { loginName: string; password: string }[] };
    const oldPassword = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName: "taxpayer-demo-a", password: "copied-preview-password" });
    expect(oldPassword.status).toBe(401);
    const taxpayerAgent = request.agent(app);
    const login = await taxpayerAgent.post("/api/auth/login").set("Origin", "http://localhost:5173").send({
      loginName: "taxpayer-demo-a", password: credentials.credentials.find((item) => item.loginName === "taxpayer-demo-a")!.password,
    });
    expect(login.status).toBe(200);
    const downloadable = await taxpayerAgent.get(`/api/attachments/${planManifest.drafts[0]!.attachmentId}`).set("Origin", "http://localhost:5173");
    expect(downloadable.status).toBe(200);
    expect(downloadable.headers["content-type"]).toMatch(/application\/pdf/);
    expect(downloadable.body).toEqual(previewPdf);
    expect(await pool.query("SELECT sid FROM user_sessions")).toHaveProperty("rows.length", 1);
    expect((await pool.query("SELECT owner_id,status,environment_marker_id FROM ftc_cases WHERE environment_marker_id=$1 ORDER BY owner_id", [marker.id])).rows).toHaveLength(2);
    expect((await pool.query("SELECT id,status FROM attachments WHERE environment_marker_id=$1", [marker.id])).rows).toHaveLength(2);
    const replayPlan = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", operationId, "--dry-run"], deps);
    const replay = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", operationId, "--confirm", replayPlan.manifestId!], deps);
    expect(replay.status).toBe("replayed");
    expect((await pool.query("SELECT sid FROM user_sessions")).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM ftc_cases WHERE environment_marker_id=$1", [marker.id])).rows).toHaveLength(2);
    const supersessionPlan = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", "62000000-0000-4000-8000-000000000001", "--dry-run"], deps);
    await expect(runPreviewInitializationCommand(["--target", "preview", "--operation-id", "62000000-0000-4000-8000-000000000001", "--confirm", supersessionPlan.manifestId!], deps))
      .rejects.toThrow(/already belongs to another operation/);

    const backupPath = join(dir, "preview-backup.json");
    const backupPlan = await runBackupCommand(["--target", "preview", "--dry-run"], { pool, env, blobs });
    const backup = await runBackupCommand(["--target", "preview", "--confirm", backupPlan.manifestId, "--operation-id", "63000000-0000-4000-8000-000000000001"],
      { pool, env, blobs, credentialsPath: backupPath });
    expect(backup.status).toBe("written");
    const previewBackup = JSON.parse(await readFile(backupPath, "utf8")) as { tables: Record<string, Record<string, unknown>[]>; blobs: { key: string }[] };
    expect(previewBackup.tables.ftc_cases?.map((item) => item.id)).not.toContain(copiedCaseId);
    expect(previewBackup.tables.attachments?.map((item) => item.id)).not.toContain(copiedAttachmentId);
    expect(previewBackup.blobs.map((item) => item.key)).not.toContain(`cases/${copiedCaseId}/${copiedAttachmentId}`);
  });
});

describe("cleanup migration upgrade path", () => {
  it("backfills a submitted tombstone only after the bookkeeping fields are allowed", async () => {
    const database = new PGlite(); activeDatabases.push(database);
    const priorMigrations = (await readdir("netlify/database/migrations")).filter((entry) => entry.endsWith(".sql") && !entry.includes("20261014000500")).sort();
    for (const name of priorMigrations) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    const pool = new TestPool(database);
    const env: NodeJS.ProcessEnv = { FTC_DEPLOYMENT_CONTEXT: "dev", NETLIFY_DEV: "true", FTC_BLOB_REGION: "us-east-2",
      NETLIFY_DB_URL: "postgres://local-user:local-secret@127.0.0.1/ftc-upgrade" };
    const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    const ownerId = "71000000-0000-4000-8000-000000000001";
    const caseId = "72000000-0000-4000-8000-000000000001";
    const attachmentId = "73000000-0000-4000-8000-000000000001";
    const snapshotId = "74000000-0000-4000-8000-000000000001";
    await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,'upgrade-fixture','Upgrade Fixture',$2,'taxpayer')", [ownerId, await hashPasswordForTest("fixture-password-01")]);
    const draft = createEmptyDraft(); draft.id = caseId;
    await pool.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id) VALUES ($1,$2,$3::jsonb,'upgrade-fixture',$4)", [caseId, ownerId, JSON.stringify(draft), marker.id]);
    await pool.query(`INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
      VALUES ($1,$2,'local',$3,$4,$5,'retired.pdf','application/pdf',1,$6,'other','ready',$7)`,
    [attachmentId, caseId, marker.storageStore, marker.storageRegion, `cases/${caseId}/${attachmentId}`, createHash("sha256").update("x").digest("hex"), marker.id]);
    await pool.query("UPDATE attachments SET status='deleted',cleanup_pending=true WHERE id=$1", [attachmentId]);
    const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "submitted", inputs: draft, evidence: [], createdAt: "2026-10-14T00:00:00.000Z" });
    await pool.query(`INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
      VALUES ($1,$2,$3,'submitted',$4::jsonb,$5::jsonb,'[]'::jsonb,$6::jsonb,$7,$8,$9::timestamptz)`,
    [snapshotId, caseId, draft.revision, JSON.stringify(snapshot.inputs), JSON.stringify(snapshot.result), JSON.stringify(snapshot.policy), snapshot.policy.id, snapshot.result.engineVersion, snapshot.createdAt]);
    await pool.query("UPDATE ftc_cases SET status='submitted',submitted_snapshot_id=$2,submitted_at=$3 WHERE id=$1", [caseId, snapshotId, snapshot.createdAt]);
    const before = (await pool.query("SELECT status,cleanup_pending FROM attachments WHERE id=$1", [attachmentId])).rows[0];
    expect(before).toEqual({ status: "deleted", cleanup_pending: true });
    await database.exec(await readFile("netlify/database/migrations/20261014000500_operator_operations.sql", "utf8"));
    const after = (await pool.query<{ cleanup_requested_at: Date | string; created_at: Date | string }>("SELECT cleanup_requested_at,created_at FROM attachments WHERE id=$1", [attachmentId])).rows[0];
    expect(after?.cleanup_requested_at).not.toBeNull();
    expect(new Date(after!.cleanup_requested_at).getTime()).toBe(new Date(after!.created_at).getTime());
  });
});

describe("coordinated backup command", () => {
  it("writes a private database-and-Blob artifact and preserves NUMERIC values as exact strings", async () => {
    const fixture = await cleanupFixture();
    const dir = await mkdtemp(join(tmpdir(), "ftc-backup-")); temporaryDirectories.push(dir);
    const outputPath = join(dir, "backup.json");
    const output: string[] = [];
    const deps = { pool: fixture.pool, env: fixture.env, blobs: fixture.blobs, credentialsPath: outputPath,
      manifestPath: (command: string, id: string) => join(dir, `review-${command}-${id}.json`),
      writeOutput: (line: string) => output.push(line), now: () => new Date("2026-10-14T00:10:00.000Z") };
    const plan = await runBackupCommand(["--target", "local", "--dry-run"], deps);
    expect(plan.status).toBe("planned");
    expect(plan.manifest.target).toMatchObject({ markerId: fixture.marker.id, store: fixture.marker.storageStore, region: fixture.marker.storageRegion });
    expect(plan.manifest.objects.map((item) => item.key)).toContain(fixture.readyKey);
    const manifestPath = output.find((line) => line.includes("Review manifest:"))?.split("Review manifest: ")[1]?.split("; sha256:")[0];
    const review = JSON.parse(await readFile(manifestPath!, "utf8")) as { manifest: typeof plan.manifest };
    expect(review.manifest.objects.find((item) => item.key === fixture.readyKey)?.sha256).toBe(createHash("sha256").update(fixture.readyBytes).digest("hex"));
    expect(output.join(" ")).not.toMatch(/gross_income_amount|123\.450000|bytesBase64/);
    expect(await readFile(outputPath).catch(() => null)).toBeNull();
    const written = await runBackupCommand(["--target", "local", "--confirm", plan.manifestId, "--operation-id", "81000000-0000-4000-8000-000000000001"], deps);
    expect(written.status).toBe("written");
    const artifact = JSON.parse(await readFile(outputPath, "utf8")) as { manifest: typeof plan.manifest; tables: Record<string, Record<string, unknown>[]>; blobs: { key: string; sha256: string; bytesBase64: string }[] };
    expect(artifact.tables.foreign_income_sources?.[0]?.gross_income_amount).toBe("123.450000000123");
    expect(artifact.blobs.find((item) => item.key === fixture.readyKey)?.sha256).toBe(createHash("sha256").update(fixture.readyBytes).digest("hex"));
    expect(output.join(" ")).not.toMatch(/local-secret|immutable ready evidence|tombstone evidence/);
  });
});

describe("fresh local restore rehearsal", () => {
  it("restores facts and every object into a marker-derived isolated store, revokes sessions, and gates login until ready", async () => {
    const source = await cleanupFixture(true, "legacy/evidence-key");
    const unrelatedBytes = Buffer.from("fictional unrelated retained Blob", "ascii");
    await source.blobs.put(source.marker, "unrelated/orphan", unrelatedBytes);
    const dir = await mkdtemp(join(tmpdir(), "ftc-restore-")); temporaryDirectories.push(dir);
    const backupPath = join(dir, "source-backup.json");
    const manifestPath = (command: string, id: string) => join(dir, `review-${command}-${id}.json`);
    const backupPlan = await runBackupCommand(["--target", "local", "--dry-run"], { pool: source.pool, env: source.env, blobs: source.blobs, manifestPath });
    const backup = await runBackupCommand(["--target", "local", "--confirm", backupPlan.manifestId, "--operation-id", "82000000-0000-4000-8000-000000000001"],
      { pool: source.pool, env: source.env, blobs: source.blobs, artifactPath: () => backupPath, manifestPath });
    expect(backup.status).toBe("written");

    const database = new PGlite(); activeDatabases.push(database);
    for (const name of (await readdir("netlify/database/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    const pool = new TestPool(database);
    const env: NodeJS.ProcessEnv = { FTC_DEPLOYMENT_CONTEXT: "dev", NETLIFY_DEV: "true", FTC_BLOB_REGION: "us-east-2",
      NETLIFY_DB_URL: "postgres://local-user:local-secret@127.0.0.1/ftc-restore-fresh" };
    const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    expect(marker.storageStore).not.toBe(source.marker.storageStore);
    const blobs = new TestBlobs();
    const app = createApp({ pool, sessionSecret: "restore-test-session-secret-at-least-32", allowedOrigin: "http://localhost:5173", trustedHttps: false,
      environment: resolveRuntimeEnvironmentConfig(env), officerUserId: "84000000-0000-4000-8000-000000000002" });
    const blockedId = "83000000-0000-4000-8000-000000000001";
    await pool.query("INSERT INTO operator_environment_gates(environment_marker_id,operation_id,status,credential_file_sha256,backup_sha256) VALUES ($1,$2,'closed',$3,$4)",
      [marker.id, blockedId, "a".repeat(64), "b".repeat(64)]);
    const gated = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName: "taxpayer-demo-a", password: "copied-password" });
    expect(gated.status).toBe(503);
    expect(gated.body.error.code).toBe("environment_restore_incomplete");
    await pool.query("DELETE FROM operator_environment_gates WHERE environment_marker_id=$1", [marker.id]);

    const credentialsPath = join(dir, "fresh-credentials.json");
    const baseArgs = ["--target", "local", "--backup", backupPath, "--backup-sha256", backup.artifactSha256!, "--operation-id", "84000000-0000-4000-8000-000000000001"];
    const output: string[] = [];
    const deps = { pool, env, blobs, credentialsPath, writeOutput: (line: string) => output.push(line) };
    const restorePlan = await runRestoreRehearsalCommand([...baseArgs, "--dry-run"], deps);
    expect(restorePlan.status).toBe("planned");
    expect((await pool.query("SELECT id FROM app_users")).rows).toHaveLength(0);
    expect((await pool.query("SELECT environment_marker_id FROM operator_environment_gates")).rows).toHaveLength(0);
    expect(await blobs.list(marker, "")).toEqual([]);
    await blobs.put(marker, "unexpected/foreign-object", Buffer.from("leave target untouched", "ascii"));
    await expect(runRestoreRehearsalCommand([...baseArgs, "--confirm", restorePlan.manifestId!], deps))
      .rejects.toThrow(/Blob store is not empty/);
    expect((await pool.query("SELECT id FROM app_users")).rows).toHaveLength(0);
    expect((await pool.query("SELECT environment_marker_id FROM operator_environment_gates")).rows).toHaveLength(0);
    expect(await blobs.list(marker, "")).toEqual([{ key: "unexpected/foreign-object", etag: "etag-unexpected/foreign-object" }]);
    await blobs.delete(marker, "unexpected/foreign-object");
    const args = [...baseArgs, "--confirm", restorePlan.manifestId!];
    const restored = await runRestoreRehearsalCommand(args, deps);
    expect(restored.status).toBe("restored");
    const sourceCase = (await source.pool.query("SELECT id,status,submitted_at,submitted_snapshot_id,environment_marker_id FROM ftc_cases WHERE id=$1", [source.caseId])).rows[0];
    const restoredCase = (await pool.query("SELECT id,status,submitted_at,submitted_snapshot_id,environment_marker_id FROM ftc_cases WHERE id=$1", [source.caseId])).rows[0];
    expect(restoredCase).toMatchObject({ ...sourceCase, environment_marker_id: marker.id });
    expect((await pool.query("SELECT gross_income_amount::text FROM foreign_income_sources WHERE case_id=$1", [source.caseId])).rows[0]?.gross_income_amount).toBe("123.450000000123");
    expect(Buffer.from((await blobs.get(marker, source.readyKey))!)).toEqual(source.readyBytes);
    expect(Buffer.from((await blobs.get(marker, "unrelated/orphan"))!)).toEqual(unrelatedBytes);
    expect((await pool.query("SELECT count(*)::int count FROM user_sessions")).rows[0]?.count).toBe(0);
    const credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as { credentials: { loginName: string; password: string }[] };
    const loginName = credentials.credentials[0]!.loginName; const password = credentials.credentials.find((item) => item.loginName === loginName)!.password;
    const old = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName, password: "fixture-password-01" });
    expect(old.status).toBe(401);
    const fresh = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName, password });
    expect(fresh.status).toBe(200);
    expect((await pool.query("SELECT count(*)::int count FROM user_sessions")).rows[0]?.count).toBe(1);
    const officerCredential = credentials.credentials.find((item) => item.loginName === "officer-demo")!;
    const officerAgent = request.agent(app);
    const officer = await officerAgent.post("/api/auth/login").set("Origin", "http://localhost:5173").send({ loginName: "officer-demo", password: officerCredential.password });
    expect(officer.status).toBe(200);
    const restoredOfficerSession = await officerAgent.get("/api/auth/session").set("Origin", "http://localhost:5173");
    expect(restoredOfficerSession.status).toBe(200);
    expect(restoredOfficerSession.body.data.user).toMatchObject({ loginName: "officer-demo", role: "officer" });
    const originalDisplayName = (await source.pool.query<{ display_name: string }>("SELECT display_name FROM app_users WHERE login_name=$1", [loginName])).rows[0]!.display_name;
    await pool.query("UPDATE app_users SET display_name='Changed after restore' WHERE login_name=$1", [loginName]);
    await expect(runRestoreRehearsalCommand(args, deps)).rejects.toThrow(/relational snapshot differs/);
    await pool.query("UPDATE app_users SET display_name=$2 WHERE login_name=$1", [loginName, originalDisplayName]);
    expect((await runRestoreRehearsalCommand(args, deps)).status).toBe("replayed");
    expect((await blobs.list(marker, "")).map((item) => item.key).sort()).toEqual([source.readyKey, source.deletedKey, "unrelated/orphan"].sort());
    expect(output.join(" ")).not.toContain("fixture-password-01");
    await rm(credentialsPath, { force: true });
    await expect(runRestoreRehearsalCommand(args, deps)).rejects.toThrow(/credential file is missing/);
  });
});

describe("dedicated demo reset command", () => {
  it("requires a fresh coordinated backup for a draft-only whole-demo reset and accepts that exact backup without a cutoff", async () => {
    const database = new PGlite(); activeDatabases.push(database);
    for (const name of (await readdir("netlify/database/migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
      await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    }
    const pool = new TestPool(database);
    const env: NodeJS.ProcessEnv = { FTC_DEPLOYMENT_CONTEXT: "dev", NETLIFY_DEV: "true", FTC_BLOB_REGION: "us-east-2",
      NETLIFY_DB_URL: "postgres://local-user:local-secret@127.0.0.1/ftc-draft-reset" };
    const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    env.FTC_DEMO_RESET_MARKER_ID = marker.id;
    env.FTC_UPLOAD_SETTLE_MS = "0";
    expect(env.FTC_DEMO_RETENTION_CUTOFF).toBeUndefined();
    const taxpayers = [
      { id: "96000000-0000-4000-8000-000000000001", login: "taxpayer-demo-a", role: "taxpayer" },
      { id: "96000000-0000-4000-8000-000000000002", login: "taxpayer-demo-b", role: "taxpayer" },
      { id: "96000000-0000-4000-8000-000000000003", login: "officer-demo", role: "officer" },
    ] as const;
    for (const account of taxpayers) {
      await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,$2,$2,$3,$4)",
        [account.id, account.login, await hashPasswordForTest("draft-reset-fixture-password"), account.role]);
    }
    const caseId = "97000000-0000-4000-8000-000000000001";
    const attachmentId = "98000000-0000-4000-8000-000000000001";
    const snapshotId = "99000000-0000-4000-8000-000000000001";
    const draft = createEmptyDraft(); draft.id = caseId;
    await pool.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id) VALUES ($1,$2,$3::jsonb,'draft-reset-fixture',$4)",
      [caseId, taxpayers[0].id, JSON.stringify(draft), marker.id]);
    const bytes = Buffer.from("%PDF-1.3\nFictional draft evidence for reset backup test\n%%EOF\n", "ascii");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await pool.query(`INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id,created_at)
      VALUES ($1,$2,'local',$3,$4,$5,'draft-evidence.pdf','application/pdf',$6,$7,'other','ready',$8,'2020-01-01T00:00:00Z')`,
    [attachmentId, caseId, marker.storageStore, marker.storageRegion, "legacy/noncase-key", bytes.length, sha256, marker.id]);
    const evidence = { id: attachmentId, sourceId: null, kind: "other" as const, displayName: "draft-evidence.pdf", mediaType: "application/pdf", byteSize: bytes.length, sha256 };
    const snapshot = createCalculationSnapshot({ id: snapshotId, caseId, revision: draft.revision, kind: "preview", inputs: draft, evidence: [evidence], createdAt: "2020-01-01T00:00:00.000Z" });
    await pool.query(`INSERT INTO calculation_snapshots(id,case_id,revision,kind,inputs,result,evidence,policy,policy_id,engine_version,created_at)
      VALUES ($1,$2,$3,'preview',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz)`,
    [snapshotId, caseId, draft.revision, JSON.stringify(snapshot.inputs), JSON.stringify(snapshot.result), JSON.stringify(snapshot.evidence), JSON.stringify(snapshot.policy), snapshot.policy.id, snapshot.result.engineVersion, snapshot.createdAt]);
    const blobs = new TestBlobs(); await blobs.put(marker, "legacy/noncase-key", bytes);

    const dir = await mkdtemp(join(tmpdir(), "ftc-draft-reset-")); temporaryDirectories.push(dir);
    const backupPath = join(dir, "complete-backup.json");
    const resetCredentialPath = join(dir, "reset-credentials.json");
    const manifestPath = (command: string, id: string) => join(dir, `review-${command}-${id}.json`);
    const resetId = "9a000000-0000-4000-8000-000000000001";
    const output: string[] = [];
    const artifactPath = (command: string) => command === "demo-reset" ? resetCredentialPath : backupPath;
    const deps = { pool, env, blobs, manifestPath, artifactPath, now: () => new Date("2026-10-14T00:10:00.000Z"), writeOutput: (line: string) => output.push(line) };
    const mismatchedAttachmentId = "98000000-0000-4000-8000-000000000002";
    await pool.query(`INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id,created_at)
      VALUES ($1,$2,'local','ftc-evidence-local-mismatched-store-123456','us-east-2','legacy/wrong-store-key','wrong-store.pdf','application/pdf',$3,$4,'other','deleted',$5,'2020-01-01T00:00:00Z')`,
    [mismatchedAttachmentId, caseId, bytes.length, sha256, marker.id]);
    await expect(runResetDemoCommand(["--target", "local", "--operation-id", resetId, "--dry-run"], deps))
      .rejects.toThrow(/storage identity does not match the active target/);
    await expect(runBackupCommand(["--target", "local", "--dry-run"], deps))
      .rejects.toThrow(/different storage identity from the active target/);
    await pool.query("DELETE FROM attachments WHERE id=$1", [mismatchedAttachmentId]);
    const plan = await runResetDemoCommand(["--target", "local", "--operation-id", resetId, "--dry-run"], deps);
    expect(plan.manifest.cases).toHaveLength(1);
    expect(plan.manifest.cases[0]).toMatchObject({ id: caseId, status: "draft", snapshots: [{ id: snapshotId, kind: "preview" }] });
    expect(plan.manifest.objects).toContainEqual({ key: "legacy/noncase-key", sha256, byteSize: bytes.length, state: "present", scope: "attachment" });
    expect(plan.manifest.retentionGuard).toMatchObject({ configuredCutoff: null, submittedEligible: null });
    const initialAccountHashes = await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name");
    const noBackupArgs = ["--target", "local", "--operation-id", resetId, "--confirm", plan.manifestId];
    await expect(runResetDemoCommand(noBackupArgs, deps)).rejects.toThrow(/requires a verified complete backup/);
    expect((await pool.query("SELECT id,status FROM ftc_cases WHERE id=$1", [caseId])).rows).toEqual([{ id: caseId, status: "draft" }]);
    expect(await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name")).toEqual(initialAccountHashes);
    const retainedEvidence = await blobs.get(marker, "legacy/noncase-key");
    expect(retainedEvidence).not.toBeNull();
    expect(Buffer.from(retainedEvidence!)).toEqual(bytes);

    const backupPlan = await runBackupCommand(["--target", "local", "--dry-run"], deps);
    const backup = await runBackupCommand(["--target", "local", "--operation-id", "9b000000-0000-4000-8000-000000000001", "--confirm", backupPlan.manifestId], deps);
    expect(backup.status).toBe("written");
    const backupArtifact = JSON.parse(await readFile(backupPath, "utf8")) as { blobs: { key: string; sha256: string }[] };
    expect(backupArtifact.blobs.find((item) => item.key === "legacy/noncase-key")).toMatchObject({ key: "legacy/noncase-key", sha256 });
    const completed = await runResetDemoCommand([...noBackupArgs, "--backup", backupPath, "--backup-sha256", backup.artifactSha256!], deps);
    expect(completed.status).toBe("completed");
    expect(completed.manifestId).toBe(plan.manifestId);
    expect(await pool.query("SELECT id FROM ftc_cases WHERE id=$1", [caseId])).toHaveProperty("rows.length", 0);
    expect(await pool.query("SELECT id FROM attachments WHERE id=$1", [attachmentId])).toHaveProperty("rows.length", 0);
    expect(await blobs.get(marker, "legacy/noncase-key")).toBeNull();
    expect((await pool.query("SELECT backup_sha256,retention_cutoff FROM operator_demo_resets WHERE operation_id=$1", [resetId])).rows[0])
      .toEqual({ backup_sha256: backup.artifactSha256, retention_cutoff: null });
    expect(output.join(" ")).not.toMatch(/draft-reset-fixture-password|Fictional draft evidence|bytesBase64/);
  });

  it("requires a marker-bound verified backup for submitted data, deletes only its exact scope, and replays without another mutation", async () => {
    const fixture = await cleanupFixture();
    for (const [id, login, role] of [
      ["90000000-0000-4000-8000-000000000002", "taxpayer-demo-b", "taxpayer"],
      ["90000000-0000-4000-8000-000000000003", "officer-demo", "officer"],
    ] as const) {
      await fixture.pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)",
        [id, login, login, await hashPasswordForTest("copied-password-02"), role]);
      if (role === "taxpayer") await fixture.pool.query("INSERT INTO user_profiles(user_id,masked_reference) VALUES ($1,'***-1002')", [id]);
    }
    fixture.env.FTC_DEMO_RESET_MARKER_ID = fixture.marker.id;
    fixture.env.FTC_DEMO_RETENTION_CUTOFF = "2026-10-14T00:05:00.000Z";
    fixture.env.FTC_UPLOAD_SETTLE_MS = "0";
    await fixture.pool.query("INSERT INTO audit_events(actor_id,case_id,snapshot_id,event_type) VALUES ($1,$2,$3,'operator-review-fixture')",
      ["90000000-0000-4000-8000-000000000003", fixture.caseId, fixture.snapshotId]);
    const dir = await mkdtemp(join(tmpdir(), "ftc-reset-")); temporaryDirectories.push(dir);
    const backupPath = join(dir, "backup.json"); const resetCredentialPath = join(dir, "reset-credentials.json");
    const manifestPath = (command: string, id: string) => join(dir, `review-${command}-${id}.json`);
    const backupPlan = await runBackupCommand(["--target", "local", "--dry-run"], { pool: fixture.pool, env: fixture.env, blobs: fixture.blobs, manifestPath });
    const backup = await runBackupCommand(["--target", "local", "--confirm", backupPlan.manifestId,
      "--operation-id", "91000000-0000-4000-8000-000000000001"], { pool: fixture.pool, env: fixture.env, blobs: fixture.blobs, artifactPath: () => backupPath, manifestPath });
    expect(backup.status).toBe("written");
    const now = () => new Date();
    const resetOutput: string[] = [];
    const resetDeps = { pool: fixture.pool, env: fixture.env, blobs: fixture.blobs, manifestPath,
      artifactPath: (name: string) => name === "demo-reset" ? resetCredentialPath : backupPath, now,
      writeOutput: (line: string) => resetOutput.push(line) };
    const plan = await runResetDemoCommand(["--target", "local", "--dry-run", "--operation-id", "92000000-0000-4000-8000-000000000001"], resetDeps);
    expect(plan.status).toBe("planned");
    expect(plan.manifest.cases.map((item) => item.id)).toEqual([fixture.caseId]);
    expect(plan.manifest.cases[0]?.attachments[0]).toMatchObject({ id: fixture.readyId, status: "ready", storageKey: fixture.readyKey, sha256: createHash("sha256").update(fixture.readyBytes).digest("hex") });
    expect(plan.manifest.cases[0]?.snapshots.map((snapshot) => snapshot.kind)).toEqual(["preview", "submitted"]);
    expect(plan.manifest.cases[0]?.auditEvents.length).toBeGreaterThan(0);
    expect(plan.manifest.objects.find((item) => item.key === fixture.readyKey)).toMatchObject({ scope: "attachment", state: "present", sha256: createHash("sha256").update(fixture.readyBytes).digest("hex") });
    expect(plan.manifest.retentionGuard).toMatchObject({ configuredCutoff: fixture.env.FTC_DEMO_RETENTION_CUTOFF, submittedEligible: true });
    const resetReview = JSON.parse(await readFile(join(dir, `review-demo-reset-${plan.manifestId}.json`), "utf8")) as { manifest: typeof plan.manifest };
    expect(resetReview.manifest).toEqual(plan.manifest);
    expect(resetOutput.join(" ")).not.toMatch(/gross_income|123\.450000|fixture-password|bytesBase64/);
    await expect(runResetDemoCommand(["--target", "local", "--confirm", plan.manifestId, "--operation-id", "92000000-0000-4000-8000-000000000001", "--retention-cutoff", fixture.env.FTC_DEMO_RETENTION_CUTOFF], resetDeps))
      .rejects.toThrow(/requires a verified complete backup/);
    expect((await fixture.pool.query("SELECT id FROM ftc_cases WHERE id=$1", [fixture.caseId])).rows).toHaveLength(1);
    const completed = await runResetDemoCommand(["--target", "local", "--confirm", plan.manifestId, "--operation-id", "92000000-0000-4000-8000-000000000001",
      "--retention-cutoff", fixture.env.FTC_DEMO_RETENTION_CUTOFF!, "--backup", backupPath, "--backup-sha256", backup.artifactSha256!], resetDeps);
    expect(completed.status).toBe("completed");
    expect((await fixture.pool.query("SELECT id FROM ftc_cases WHERE id=$1", [fixture.caseId])).rows).toHaveLength(0);
    expect((await fixture.pool.query("SELECT id FROM attachments WHERE case_id=$1", [fixture.caseId])).rows).toHaveLength(0);
    expect(await fixture.blobs.get(fixture.marker, fixture.readyKey)).toBeNull();
    expect(await fixture.blobs.get(fixture.marker, fixture.deletedKey)).toBeNull();
    expect((await fixture.pool.query("SELECT login_name FROM app_users WHERE login_name=ANY($1::text[])", [["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"]])).rows).toHaveLength(3);
    const replay = await runResetDemoCommand(["--target", "local", "--confirm", plan.manifestId, "--operation-id", "92000000-0000-4000-8000-000000000001",
      "--retention-cutoff", fixture.env.FTC_DEMO_RETENTION_CUTOFF!, "--backup", backupPath, "--backup-sha256", backup.artifactSha256!], resetDeps);
    expect(replay.status).toBe("replayed");
    await rm(resetCredentialPath, { force: true });
    await expect(runResetDemoCommand(["--target", "local", "--confirm", plan.manifestId, "--operation-id", "92000000-0000-4000-8000-000000000001"], resetDeps))
      .rejects.toThrow(/private credential file is missing/);
  });
});
