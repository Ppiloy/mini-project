import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "./app.js";
import type { EnvironmentMarker } from "./runtime/environment.js";
import { ensureEnvironmentMarker, resolveRuntimeEnvironmentConfig } from "./runtime/environment.js";
import { createPreviewCredentialProof, createPreviewOperatorHandler, previewOperatorPlanSchema, signPreviewOperatorRequest } from "./runtime/preview-operator.js";
import type { OperatorBlobIO } from "./scripts/operations.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";

class TestPool implements PgPoolLike {
  constructor(readonly database: PGlite) {}
  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }
  async connect(): Promise<PgQueryable> { return { query: (text, values, callback) => this.query(text, values, callback), release: () => undefined }; }
}

class TestBlobs implements OperatorBlobIO {
  readonly supportsStrongReads = true;
  readonly objects = new Map<string, Uint8Array>();
  failWrites = false;
  async get(_marker: EnvironmentMarker, key: string) { const value = this.objects.get(key); return value ? Uint8Array.from(value) : null; }
  async put(_marker: EnvironmentMarker, key: string, bytes: Uint8Array) {
    if (this.failWrites) throw new Error("injected Blob write failure");
    const old = this.objects.get(key);
    if (old && Buffer.compare(Buffer.from(old), Buffer.from(bytes)) !== 0) throw new Error("Blob key conflict");
    this.objects.set(key, Uint8Array.from(bytes));
  }
  async delete(_marker: EnvironmentMarker, key: string) { this.objects.delete(key); }
  async list(_marker: EnvironmentMarker, prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })); }
}

const databases: PGlite[] = [];
afterEach(async () => { while (databases.length) await databases.pop()?.close(); vi.unstubAllEnvs(); });

const secret = "preview-operator-test-secret-with-more-than-32-characters";
const requestBody = (timestamp = Date.now()) => JSON.stringify({ action: "prepare", timestamp, siteId: "site-test", deployId: "deploy-test",
  branch: "feature/demo", origin: "https://preview.example.test", operationId: "61000000-0000-4000-8000-000000000001" });
const context = { site: { id: "site-test" }, deploy: { id: "deploy-test", branch: "feature/demo", context: "deploy-preview", published: false } };

function signedRequest(body: string, signature = signPreviewOperatorRequest(body, secret)): Request {
  return new Request("https://preview.example.test/.netlify/functions/preview-operator", { method: "POST", body,
    headers: { "x-ftc-preview-operator-signature": signature } });
}

describe("preview operator authentication boundary", () => {
  it("binds opaque credential provenance to the nonce, credential, database and key without assuming hostname equality", () => {
    const nonce = "a".repeat(32);
    const connection = "postgres://preview-user:preview-secret@preview.example.test/ftc-preview";
    const proof = createPreviewCredentialProof(connection, nonce, secret);
    expect(proof).toMatch(/^[a-f0-9]{64}$/);
    expect(createPreviewCredentialProof(connection.replace("preview.example.test", "runtime.example.test"), nonce, secret)).toBe(proof);
    expect(createPreviewCredentialProof(connection.replace("preview-secret", "production-secret"), nonce, secret)).not.toBe(proof);
    expect(createPreviewCredentialProof(connection.replace("ftc-preview", "ftc-production"), nonce, secret)).not.toBe(proof);
    expect(createPreviewCredentialProof(connection, "b".repeat(32), secret)).not.toBe(proof);
    expect(createPreviewCredentialProof(connection, nonce, `${secret}-different`)).not.toBe(proof);
  });

  it("rejects an invalid HMAC before resolving the runtime or database", async () => {
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("FTC_DEPLOYMENT_CONTEXT", "deploy-preview");
    vi.stubEnv("SITE_ID", "site-test");
    vi.stubEnv("FTC_ALLOWED_ORIGIN", "https://preview.example.test");
    const runtime = vi.fn(() => { throw new Error("must not initialize runtime"); });
    const response = await createPreviewOperatorHandler({ runtime })(signedRequest(requestBody(), "0".repeat(64)), context);
    expect(response.status).toBe(401);
    expect(runtime).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it.each([
    ["production deployment", { ...context, deploy: { ...context.deploy, context: "production" } }, "deploy-preview"],
    ["published deployment", { ...context, deploy: { ...context.deploy, published: true } }, "deploy-preview"],
    ["runtime production context", context, "production"],
  ])("rejects %s before resolving the runtime", async (_name, suppliedContext, runtimeContext) => {
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("FTC_DEPLOYMENT_CONTEXT", runtimeContext);
    vi.stubEnv("SITE_ID", "site-test");
    vi.stubEnv("FTC_ALLOWED_ORIGIN", "https://preview.example.test");
    const runtime = vi.fn(() => { throw new Error("must not initialize runtime"); });
    const response = await createPreviewOperatorHandler({ runtime })(signedRequest(requestBody()), suppliedContext);
    expect(response.status).toBe(403);
    expect(runtime).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("rejects stale signed requests", async () => {
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("FTC_DEPLOYMENT_CONTEXT", "deploy-preview");
    vi.stubEnv("SITE_ID", "site-test");
    vi.stubEnv("FTC_ALLOWED_ORIGIN", "https://preview.example.test");
    const runtime = vi.fn(() => { throw new Error("must not initialize runtime"); });
    const body = requestBody(0);
    const response = await createPreviewOperatorHandler({ runtime, now: () => 121_000 })(signedRequest(body), context);
    expect(response.status).toBe(401);
    expect(runtime).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("preview operator initialization flow", () => {
  it("prepares an empty preview, applies client-owned credentials, logs in all accounts, and replays only the exact recovery file", async () => {
    const database = new PGlite(); databases.push(database);
    for (const name of (await readdir("netlify/database/migrations")).filter((item) => item.endsWith(".sql")).sort()) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    const pool = new TestPool(database);
    const officerId = "50000000-0000-4000-8000-000000000003";
    const env = { FTC_DEPLOYMENT_CONTEXT: "deploy-preview", SITE_ID: "site-test", FTC_ALLOWED_ORIGIN: "https://preview.example.test",
      FTC_OFFICER_USER_ID: officerId, FTC_BLOB_REGION: "us-east-2", NETLIFY_DB_URL: "postgres://preview-user:preview-secret@127.0.0.1/ftc-preview",
      SESSION_SECRET: secret } satisfies NodeJS.ProcessEnv;
    vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("FTC_DEPLOYMENT_CONTEXT", "deploy-preview"); vi.stubEnv("SITE_ID", "site-test"); vi.stubEnv("FTC_ALLOWED_ORIGIN", "https://preview.example.test");
    const marker = await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    const blobs = new TestBlobs();
    const app = createApp({ pool, blobIO: blobs, sessionSecret: secret, allowedOrigin: env.FTC_ALLOWED_ORIGIN, trustedHttps: true,
      environment: resolveRuntimeEnvironmentConfig(env), officerUserId: officerId });
    const runtime = () => ({ pool, env, blobs });
    const handler = createPreviewOperatorHandler({ runtime });
    const siteContext = { site: { id: "site-test" }, deploy: { id: "deploy-test", branch: "feature/demo", context: "deploy-preview", published: false } };
    const operationId = "61000000-0000-4000-8000-000000000001";
    const makeCall = async (payload: Record<string, unknown>) => {
      const body = JSON.stringify(payload);
      const response = await handler(signedRequest(body), siteContext);
      const responseBody: unknown = await response.json();
      return { response, body: responseBody };
    };
    const pins = { timestamp: Date.now(), siteId: "site-test", deployId: "deploy-test", branch: "feature/demo", origin: "https://preview.example.test", operationId };
    const nonce = "a".repeat(32);
    const inspected = await makeCall({ action: "inspect", ...pins, nonce });
    expect(inspected.response.status).toBe(200);
    expect(inspected.response.headers.get("cache-control")).toBe("private, no-store");
    expect(inspected.body).toEqual({ data: { credentialProof: createPreviewCredentialProof(env.NETLIFY_DB_URL, nonce, secret) } });
    expect((await pool.query("SELECT id FROM app_users")).rows).toEqual([]);
    expect((await pool.query("SELECT operation_id FROM preview_environment_initialization")).rows).toEqual([]);
    const prepared = await makeCall({ action: "prepare", ...pins });
    expect(prepared.response.status).toBe(200);
    const plan = z.object({ data: previewOperatorPlanSchema }).parse(prepared.body).data;
    expect(plan).toMatchObject({ markerId: marker.id, officerUserId: officerId, operationId, status: "planned" });
    const credentialsContents = JSON.stringify({ version: 1, target: "preview", markerId: marker.id, operationId, createdAt: new Date().toISOString(), officerUserId: officerId,
      credentials: ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"].map((loginName, index) => ({ loginName, password: String(index + 1).repeat(64) })), drafts: plan.drafts });
    const apply = () => makeCall({ action: "apply", ...pins, manifestId: plan.manifestId, credentialsContents });
    const initialized = await apply();
    expect(initialized.response.status).toBe(200);
    expect(initialized.body).toMatchObject({ data: { status: "initialized", markerId: marker.id } });
    for (const [index, loginName] of ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"].entries()) {
      const password = String(index + 1).repeat(64);
      const response = await request(app).post("/api/auth/login").set("Origin", env.FTC_ALLOWED_ORIGIN).send({ loginName, password });
      expect(response.status).toBe(200);
      expect(response.body.data.user.loginName).toBe(loginName);
    }
    const replayPlan = await makeCall({ action: "prepare", ...pins, timestamp: Date.now() });
    expect(replayPlan.response.status).toBe(200);
    const replayManifest = z.object({ data: previewOperatorPlanSchema }).parse(replayPlan.body).data;
    const replay = await makeCall({ action: "apply", ...pins, timestamp: Date.now(), manifestId: replayManifest.manifestId, credentialsContents });
    expect(replay.response.status).toBe(200);
    expect(replay.body).toMatchObject({ data: { status: "replayed", markerId: marker.id } });
    const changedFile = JSON.stringify({ ...JSON.parse(credentialsContents), credentials: ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"].map((loginName, index) => ({ loginName, password: String(index + 4).repeat(64) })) });
    const changed = await makeCall({ action: "apply", ...pins, timestamp: Date.now(), manifestId: replayManifest.manifestId, credentialsContents: changedFile });
    expect(changed.response.status).toBe(503);
    expect((await request(app).post("/api/auth/login").set("Origin", env.FTC_ALLOWED_ORIGIN).send({ loginName: "taxpayer-demo-a", password: "4444444444444444444444444444444444444444444444444444444444444444" })).status).toBe(401);
  });

  it("keeps initialization gated when evidence storage fails", async () => {
    const database = new PGlite(); databases.push(database);
    for (const name of (await readdir("netlify/database/migrations")).filter((item) => item.endsWith(".sql")).sort()) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
    const pool = new TestPool(database);
    const officerId = "50000000-0000-4000-8000-000000000003";
    const env = { FTC_DEPLOYMENT_CONTEXT: "deploy-preview", SITE_ID: "site-test", FTC_ALLOWED_ORIGIN: "https://preview.example.test",
      FTC_OFFICER_USER_ID: officerId, FTC_BLOB_REGION: "us-east-2", NETLIFY_DB_URL: "postgres://preview-user:preview-secret@127.0.0.1/ftc-preview", SESSION_SECRET: secret } satisfies NodeJS.ProcessEnv;
    vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("FTC_DEPLOYMENT_CONTEXT", "deploy-preview"); vi.stubEnv("SITE_ID", "site-test"); vi.stubEnv("FTC_ALLOWED_ORIGIN", "https://preview.example.test");
    await ensureEnvironmentMarker(pool, resolveRuntimeEnvironmentConfig(env));
    const blobs = new TestBlobs(); blobs.failWrites = true;
    const app = createApp({ pool, blobIO: blobs, sessionSecret: secret, allowedOrigin: env.FTC_ALLOWED_ORIGIN, trustedHttps: true,
      environment: resolveRuntimeEnvironmentConfig(env), officerUserId: officerId });
    const handler = createPreviewOperatorHandler({ runtime: () => ({ pool, env, blobs }) });
    const pins = { timestamp: Date.now(), siteId: "site-test", deployId: "deploy-test", branch: "feature/demo", origin: "https://preview.example.test", operationId: "61000000-0000-4000-8000-000000000002" };
    const planBody = JSON.stringify({ action: "prepare", ...pins });
    const planResponse = await handler(signedRequest(planBody), context);
    const plan = z.object({ data: previewOperatorPlanSchema }).parse(await planResponse.json());
    const credentialsContents = JSON.stringify({ version: 1, target: "preview", markerId: plan.data.markerId, operationId: pins.operationId, createdAt: new Date().toISOString(), officerUserId: officerId,
      credentials: ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"].map((loginName) => ({ loginName, password: "1".repeat(64) })), drafts: plan.data.drafts });
    const applyBody = JSON.stringify({ action: "apply", ...pins, manifestId: plan.data.manifestId, credentialsContents });
    const response = await handler(signedRequest(applyBody), context);
    expect(response.status).toBe(503);
    const state = (await pool.query<{ status: string; credential_file_sha256: string }>("SELECT status,credential_file_sha256 FROM preview_environment_initialization")).rows[0];
    expect(state?.status).toBe("pending");
    const hashesBeforeTamper = await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name");
    expect((await request(app).post("/api/auth/login").set("Origin", env.FTC_ALLOWED_ORIGIN).send({ loginName: "taxpayer-demo-a", password: "1".repeat(64) })).body.error.code)
      .toBe("preview_initialization_required");

    const refreshedPrepare = await handler(signedRequest(JSON.stringify({ action: "prepare", ...pins, timestamp: Date.now() })), context);
    expect(refreshedPrepare.status).toBe(200);
    const refreshedPlan = z.object({ data: previewOperatorPlanSchema }).parse(await refreshedPrepare.json());
    const alteredContents = JSON.stringify({ ...JSON.parse(credentialsContents), credentials: ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"].map((loginName) => ({ loginName, password: "2".repeat(64) })) });
    const alteredBody = JSON.stringify({ action: "apply", ...pins, timestamp: Date.now(), manifestId: refreshedPlan.data.manifestId, credentialsContents: alteredContents });
    expect((await handler(signedRequest(alteredBody), context)).status).toBe(503);
    expect((await pool.query("SELECT login_name,password_hash FROM app_users ORDER BY login_name")).rows).toEqual(hashesBeforeTamper.rows);
    expect((await pool.query<{ status: string; credential_file_sha256: string }>("SELECT status,credential_file_sha256 FROM preview_environment_initialization")).rows[0])
      .toEqual(state);

    blobs.failWrites = false;
    const retryBody = JSON.stringify({ action: "apply", ...pins, timestamp: Date.now(), manifestId: refreshedPlan.data.manifestId, credentialsContents });
    expect((await handler(signedRequest(retryBody), context)).status).toBe(200);
    expect((await pool.query<{ status: string }>("SELECT status FROM preview_environment_initialization")).rows[0]?.status).toBe("ready");
  });
});
