import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { PgPoolLike } from "../postgres.js";
import { runBootstrapCommand } from "../scripts/bootstrap.js";
import { runPreviewInitializationCommand } from "../scripts/operations.js";
import { loadEnvironmentMarker, resolveRuntimeEnvironmentConfig } from "./environment.js";
import type { OperatorBlobIO } from "../scripts/operations.js";

const accountNames = ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"] as const;
const uuidV4 = z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const recoverySchema = z.object({
  version: z.literal(1), target: z.literal("preview"), markerId: z.string().uuid(), operationId: uuidV4,
  createdAt: z.string().datetime(), officerUserId: z.string().uuid(),
  credentials: z.array(z.object({ loginName: z.enum(accountNames), password: z.string().regex(/^[0-9a-f]{64}$/i) }).strict()).length(3),
  drafts: z.array(z.object({ ownerLogin: z.enum(["taxpayer-demo-a", "taxpayer-demo-b"]), caseId: z.string().uuid(),
    attachmentId: z.string().uuid(), storageKey: z.string().min(1).max(256) }).strict()).length(2),
}).strict().superRefine((file, ctx) => {
  if (new Set(file.credentials.map((item) => item.loginName)).size !== accountNames.length) ctx.addIssue({ code: "custom", message: "credentials must contain each demo login exactly once" });
  if (file.credentials.some((item, index) => item.loginName !== accountNames[index])) ctx.addIssue({ code: "custom", message: "credentials must use the canonical demo login order" });
  if (new Set(file.drafts.map((item) => item.ownerLogin)).size !== 2) ctx.addIssue({ code: "custom", message: "drafts must contain both taxpayer logins" });
});
export const previewCredentialFileSchema = recoverySchema;

const pins = { siteId: z.string().min(1).max(128), deployId: z.string().min(1).max(128), branch: z.string().min(1).max(256),
  origin: z.string().url(), operationId: uuidV4, timestamp: z.number().int() };
const prepareSchema = z.object({ action: z.literal("prepare"), ...pins }).strict();
const inspectSchema = z.object({ action: z.literal("inspect"), ...pins, nonce: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
const applySchema = z.object({ action: z.literal("apply"), ...pins, manifestId: z.string().regex(/^[a-f0-9]{64}$/i), credentialsContents: z.string().max(12_000) }).strict();
const requestSchema = z.discriminatedUnion("action", [inspectSchema, prepareSchema, applySchema]);
type PreviewOperatorPlan = { markerId: string; officerUserId: string; operationId: string; manifestId: string; drafts: z.infer<typeof recoverySchema>["drafts"]; status: "planned" | "initialized" | "replayed" };
export const previewOperatorPlanSchema = z.object({ markerId: z.string().uuid(), officerUserId: z.string().uuid(), operationId: uuidV4,
  manifestId: z.string().regex(/^[a-f0-9]{64}$/i), drafts: recoverySchema.shape.drafts, status: z.enum(["planned", "initialized", "replayed"]) }).strict();

export function signPreviewOperatorRequest(body: string, sessionSecret: string): string {
  const key = Buffer.from(hkdfSync("sha256", sessionSecret, Buffer.from("ftc-preview-operator-v1"), Buffer.from("request-authentication"), 32));
  return createHmac("sha256", key).update("ftc-preview-operator-v1\n").update(body, "utf8").digest("hex");
}

export function createPreviewCredentialProof(connectionString: string, nonce: string, sessionSecret: string): string {
  const connection = new URL(connectionString);
  if (!/^[a-f0-9]{32}$/.test(nonce) || sessionSecret.length < 32 ||
    !["postgres:", "postgresql:"].includes(connection.protocol) || !connection.username || !connection.password) {
    throw new Error("Invalid credential proof input.");
  }
  const key = Buffer.from(hkdfSync("sha256", sessionSecret, Buffer.from("ftc-preview-operator-v1"), Buffer.from("credential-provenance"), 32));
  return createHmac("sha256", key).update(JSON.stringify(["ftc-preview-credential-provenance-v1", nonce,
    decodeURIComponent(connection.username), decodeURIComponent(connection.password), connection.pathname]), "utf8").digest("hex");
}

export interface PreviewOperatorRuntime { pool: PgPoolLike; env: NodeJS.ProcessEnv; blobs: OperatorBlobIO; }
export interface PreviewOperatorHandlerOptions { runtime: () => Promise<PreviewOperatorRuntime> | PreviewOperatorRuntime; now?: () => number; }
export interface PreviewOperatorContext { site?: { id?: string }; deploy?: { id?: string; branch?: string; context?: string; published?: boolean }; }

const responseHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", pragma: "no-cache" };
function json(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status, headers: responseHeaders }); }
function contextMatches(context: PreviewOperatorContext, body: z.infer<typeof requestSchema>, env: NodeJS.ProcessEnv, request: Request): boolean {
  const siteId = context.site?.id;
  const deploy = context.deploy;
  const configuredOrigin = env.FTC_ALLOWED_ORIGIN;
  let origin: string;
  try { origin = new URL(request.url).origin; } catch { return false; }
  return Boolean(siteId && deploy && deploy.id && deploy.branch && deploy.context === "deploy-preview" && !deploy.published &&
    context.deploy?.context === "deploy-preview" && env.FTC_DEPLOYMENT_CONTEXT === "deploy-preview" &&
    env.SITE_ID === siteId && configuredOrigin && origin === configuredOrigin && body.origin === configuredOrigin &&
    origin.startsWith("https://") && body.origin.startsWith("https://") && deploy.published === false &&
    body.siteId === siteId && body.deployId === deploy.id && body.branch === deploy.branch);
}

export function createPreviewOperatorHandler(options: PreviewOperatorHandlerOptions) {
  const now = options.now ?? Date.now;
  return async (request: Request, context: PreviewOperatorContext): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: { code: "method_not_allowed" } });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > 16_384) return json(413, { error: { code: "request_too_large" } });
    let bodyText: string;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: { code: "invalid_request" } });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16_384) { await reader.cancel(); return json(413, { error: { code: "request_too_large" } }); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch { return json(400, { error: { code: "invalid_request" } }); }
    const secret = process.env.SESSION_SECRET;
    const supplied = request.headers.get("x-ftc-preview-operator-signature") ?? "";
    if (!secret || secret.length < 32 || !/^[a-f0-9]{64}$/i.test(supplied)) return json(401, { error: { code: "unauthorized" } });
    const expected = signPreviewOperatorRequest(bodyText, secret);
    const suppliedBytes = Buffer.from(supplied, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return json(401, { error: { code: "unauthorized" } });
    let unknownBody: unknown;
    try { unknownBody = JSON.parse(bodyText); } catch { return json(400, { error: { code: "invalid_request" } }); }
    const parsed = requestSchema.safeParse(unknownBody);
    if (!parsed.success) return json(400, { error: { code: "invalid_request" } });
    const body = parsed.data;
    if (Math.abs(now() - body.timestamp) > 120_000) return json(401, { error: { code: "expired_request" } });
    if (!contextMatches(context, body, process.env, request)) return json(403, { error: { code: "forbidden" } });
    let stagedDirectory: string | undefined;
    let phase: "runtime" | "marker" | "accounts" | "prepare" | "apply" = "runtime";
    try {
      const runtime = await options.runtime();
      const env = runtime.env;
      if (env.FTC_DEPLOYMENT_CONTEXT !== "deploy-preview" || env.SITE_ID !== context.site?.id || env.FTC_ALLOWED_ORIGIN !== body.origin) return json(403, { error: { code: "forbidden" } });
      const config = resolveRuntimeEnvironmentConfig(env);
      if (config.kind !== "preview" || config.deploymentContext !== "deploy-preview") return json(403, { error: { code: "forbidden" } });
      phase = "marker";
      const marker = await loadEnvironmentMarker(runtime.pool, config);
      if (marker.kind !== "preview" || marker.deploymentContext !== "deploy-preview") return json(403, { error: { code: "forbidden" } });
      if (body.action === "inspect") {
        if (!env.NETLIFY_DB_URL || !env.SESSION_SECRET) return json(503, { error: { code: "unavailable", phase: "runtime" } });
        return json(200, { data: { credentialProof: createPreviewCredentialProof(env.NETLIFY_DB_URL, body.nonce, env.SESSION_SECRET) } });
      }
      if (runtime.blobs.supportsStrongReads !== true) return json(503, { error: { code: "unavailable", phase: "storage" } });

      phase = "accounts";
      const expectedRoles = new Map([["taxpayer-demo-a", "taxpayer"], ["taxpayer-demo-b", "taxpayer"], ["officer-demo", "officer"]]);
      const users = await runtime.pool.query<{ id: string; login_name: string; role: string; active: boolean }>(
        "SELECT id,login_name,role,active FROM app_users ORDER BY login_name");
      if (users.rows.some((user) => !expectedRoles.has(user.login_name)) || users.rows.some((user) => {
        const role = expectedRoles.get(user.login_name);
        return !role || user.role !== role || !user.active;
      })) return json(409, { error: { code: "account_state_conflict", phase: "accounts" } });
      const officer = users.rows.find((user) => user.login_name === "officer-demo");
      if (!env.FTC_OFFICER_USER_ID || !z.string().uuid().safeParse(env.FTC_OFFICER_USER_ID).success ||
        (officer && env.FTC_OFFICER_USER_ID !== officer.id)) return json(409, { error: { code: "account_state_conflict", phase: "accounts" } });
      const init = await runtime.pool.query<{ status: string; operation_id: string | null }>("SELECT status,operation_id FROM preview_environment_initialization WHERE environment_marker_id=$1", [marker.id]);
      if (init.rows[0]?.operation_id && init.rows[0].operation_id !== body.operationId) return json(409, { error: { code: "operation_conflict", phase: "accounts" } });

      stagedDirectory = await mkdtemp(join(tmpdir(), "ftc-preview-operator-"));
      const operationDirectory = stagedDirectory;
      const manifestPath = (_command: string, _name: string) => join(operationDirectory, `${randomUUID()}.json`);
      if (body.action === "prepare") {
        phase = "prepare";
        if (users.rows.length < 3) {
          await runBootstrapCommand(["seed", "--target", "preview"], { pool: runtime.pool, env, credentialsPath: join(operationDirectory, "seed-credentials.json"), writeOutput: () => undefined });
        }
        const plan = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", body.operationId, "--dry-run"], {
          pool: runtime.pool, env, blobs: runtime.blobs, manifestPath, writeOutput: () => undefined,
        });
        if (!plan.manifestId || !plan.manifest || plan.manifest.target.markerId !== marker.id) return json(409, { error: { code: "scope_changed", phase: "prepare" } });
        const prepared = previewOperatorPlanSchema.safeParse({ markerId: marker.id, officerUserId: officer?.id ?? plan.manifest.accounts.find((item) => item.loginName === "officer-demo")?.id,
          operationId: body.operationId, manifestId: plan.manifestId, drafts: plan.manifest.drafts, status: plan.status });
        if (!prepared.success) return json(409, { error: { code: "account_state_conflict", phase: "prepare" } });
        return json(200, { data: prepared.data satisfies PreviewOperatorPlan });
      }

      phase = "apply";
      let recoveryUnknown: unknown;
      try { recoveryUnknown = JSON.parse(body.credentialsContents); } catch { return json(400, { error: { code: "invalid_credentials" } }); }
      const recovery = previewCredentialFileSchema.safeParse(recoveryUnknown);
      if (!recovery.success) return json(400, { error: { code: "invalid_credentials" } });
      if (recovery.data.operationId !== body.operationId || recovery.data.markerId !== marker.id || recovery.data.officerUserId !== officer?.id) return json(409, { error: { code: "recovery_identity_mismatch", phase: "apply" } });
      const plan = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", body.operationId, "--dry-run"], { pool: runtime.pool, env, blobs: runtime.blobs, manifestPath, writeOutput: () => undefined });
      if (!plan.manifestId || !plan.manifest || plan.manifest.target.markerId !== marker.id || plan.manifestId !== body.manifestId ||
        JSON.stringify(plan.manifest.drafts) !== JSON.stringify(recovery.data.drafts)) return json(409, { error: { code: "scope_changed", phase: "apply" } });
      const credentialsPath = join(operationDirectory, "preview-credentials.json");
      await writeFile(credentialsPath, body.credentialsContents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const result = await runPreviewInitializationCommand(["--target", "preview", "--operation-id", body.operationId, "--confirm", body.manifestId], {
        pool: runtime.pool, env, blobs: runtime.blobs, credentialsPath, writeOutput: () => undefined,
      });
      return json(200, { data: { status: result.status, markerId: marker.id } });
    } catch {
      return json(503, { error: { code: "unavailable", phase } });
    } finally {
      if (stagedDirectory) await rm(stagedDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
