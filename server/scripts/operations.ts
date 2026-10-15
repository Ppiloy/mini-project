import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, chmod, unlink, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { ensureEnvironmentMarker, loadEnvironmentMarker, resolveRuntimeEnvironmentConfig, type EnvironmentMarker, type RuntimeEnvironmentConfig } from "../runtime/environment.js";
import type { PgPoolLike } from "../postgres.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import { createEmptyDraft } from "../../shared/draft.js";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

export interface OperatorBlobIO {
  /** True only when every read/write needed by the operation has documented strong semantics. */
  readonly supportsStrongReads?: boolean;
  get(marker: EnvironmentMarker, key: string): Promise<Uint8Array | null>;
  put(marker: EnvironmentMarker, key: string, bytes: Uint8Array): Promise<void>;
  delete(marker: EnvironmentMarker, key: string): Promise<void>;
  list(marker: EnvironmentMarker, prefix: string): Promise<{ key: string }[]>;
}

const localSandboxBlobIO = (): OperatorBlobIO => ({
  supportsStrongReads: true,
  async get(environment, key) {
    if (environment.kind !== "local") throw new Error("Netlify Dev Blob access requires a local marker.");
    const store = getStore({ name: environment.storageStore, consistency: "strong" });
    const bytes = await store.get(key, { type: "arrayBuffer", consistency: "strong" });
    return bytes === null ? null : new Uint8Array(bytes);
  },
  async put(environment, key, bytes) {
    if (environment.kind !== "local") throw new Error("Netlify Dev Blob access requires a local marker.");
    const store = getStore({ name: environment.storageStore, consistency: "strong" });
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await store.set(key, data, { onlyIfNew: true });
  },
  async delete(environment, key) {
    if (environment.kind !== "local") throw new Error("Netlify Dev Blob access requires a local marker.");
    const store = getStore({ name: environment.storageStore, consistency: "strong" });
    await store.delete(key);
  },
  async list(environment, prefix) {
    if (environment.kind !== "local") throw new Error("Netlify Dev Blob access requires a local marker.");
    const store = getStore({ name: environment.storageStore, consistency: "strong" });
    const page = await store.list({ prefix });
    return page.blobs.map((blob) => ({ key: blob.key })).sort((a, b) => a.key.localeCompare(b.key));
  },
});

const execFile = promisify(execFileCallback);

export type OperatorCliRunner = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;

function cliFailure(stderr: string | undefined): Error {
  const text = stderr ?? "";
  const status = text.match(/\b(?:status|http)\s*(?:code\s*)?(401|403|404|409|429|5\d\d)\b/i)?.[1];
  const reason = /not logged in|not authenticated/i.test(text) ? "authentication"
    : /not linked|no site|linked project/i.test(text) ? "site-link"
      : /permission|forbidden|unauthorized|authorization failed/i.test(text) ? "access"
        : /does not exist|not found/i.test(text) ? "missing-object"
          : "command";
  return new Error(`Authenticated Netlify CLI operation failed (${reason}${status ? `, status ${status}` : ""}); object state was not assumed.`);
}

function parseCliJson(stdout: string): unknown {
  const candidates = [...stdout.matchAll(/\{\s*"(?:account|blobs)"\s*:/g)].reverse();
  for (const match of candidates) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = match.index!; index < stdout.length; index += 1) {
      const character = stdout[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try { return JSON.parse(stdout.slice(match.index, index + 1)); } catch { break; }
      }
    }
  }
  throw new Error("Netlify CLI returned an unreadable JSON response.");
}

/**
 * Builds the authenticated CLI adapter over an injected child-process seam.
 * Netlify CLI 27.12.1's SDK lists every page. It omits edgeURL, so requests
 * route to the API origin; Netlify documents CLI Blob operations as strongly
 * consistent. Its set command has no compare-and-set option, so never force
 * an overwrite and accept only operation-keyed, byte-matching recovery.
 */
export function createAuthenticatedCliBlobIO(expectedSiteId: string, run: OperatorCliRunner): OperatorBlobIO {
  let siteChecked = false;
  const invoke = async (args: string[]) => {
    try { return await run(args); }
    catch (error) { throw cliFailure((error as { stderr?: string })?.stderr); }
  };
  const verifyLinkedSite = async () => {
    if (siteChecked) return;
    const result = await invoke(["status", "--json"]);
    const status = parseCliJson(result.stdout) as { loggedIn?: unknown; linked?: unknown; siteData?: Record<string, unknown> | null };
    if (status.loggedIn !== true || status.linked !== true || status.siteData?.["site-id"] !== expectedSiteId) {
      throw new Error("Authenticated Netlify CLI link does not match the trusted site ID; no Blob operation was attempted.");
    }
    siteChecked = true;
  };
  const privateTemp = async (contents?: Uint8Array): Promise<{ directory: string; path: string }> => {
    const root = resolve(homedir(), ".ftc-private", "netlify-cli-tmp");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(resolve(root, "op-"));
    await chmod(directory, 0o700);
    if (process.platform === "win32") {
      const username = process.env.USERNAME;
      if (!username) throw new Error("USERNAME is required to protect temporary Blob bytes with a Windows ACL.");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
      await execFile("icacls", [directory, "/inheritance:r", "/grant:r", `${principal}:(OI)(CI)(F)`], { windowsHide: true });
    }
    const path = resolve(directory, "object.bin");
    if (contents) await writeFile(path, contents, { mode: 0o600, flag: "wx" });
    return { directory, path };
  };
  return {
    supportsStrongReads: true,
    async list(marker, prefix) {
      await verifyLinkedSite();
      const { stdout } = await invoke(["blobs:list", marker.storageStore, "--json", "--prefix", prefix, "--region", marker.storageRegion]);
      const parsed = parseCliJson(stdout) as { blobs?: unknown } | unknown[];
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "blobs" in parsed ? (parsed as { blobs: unknown }).blobs : null;
      if (!Array.isArray(values)) throw new Error("Netlify CLI returned an unexpected Blob inventory shape.");
      const keys = values.map((value) => value && typeof value === "object" ? (value as { key?: unknown }).key : undefined);
      if (keys.some((key) => typeof key !== "string")) throw new Error("Netlify CLI returned an incomplete Blob inventory; state was not assumed.");
      return (keys as string[]).map((key) => ({ key })).sort((a, b) => a.key.localeCompare(b.key));
    },
    async get(marker, key) {
      await verifyLinkedSite();
      const temp = await privateTemp();
      try {
        try { await invoke(["blobs:get", marker.storageStore, key, "--region", marker.storageRegion, "--output", temp.path]); }
        catch (error) { if (error instanceof Error && error.message.includes("missing-object")) return null; throw error; }
        return new Uint8Array(await readFile(temp.path));
      } finally { await rm(temp.directory, { recursive: true, force: true }); }
    },
    async put(marker, key, bytes) {
      await verifyLinkedSite();
      const current = await this.get(marker, key);
      if (current) {
        if (Buffer.compare(Buffer.from(current), Buffer.from(bytes)) !== 0) throw new Error("Existing Blob key does not match the expected recovery bytes.");
        return;
      }
      const temp = await privateTemp(bytes);
      try { await invoke(["blobs:set", marker.storageStore, key, "--region", marker.storageRegion, "--input", temp.path]); }
      finally { await rm(temp.directory, { recursive: true, force: true }); }
    },
    async delete(marker, key) { await verifyLinkedSite(); await invoke(["blobs:delete", marker.storageStore, key, "--region", marker.storageRegion, "--force"]); },
  };
};

function netlifyCliRunner(): OperatorCliRunner {
  const appData = process.env.APPDATA;
  const prefix = process.env.NPM_CONFIG_PREFIX;
  const candidates = [
    process.env.FTC_NETLIFY_CLI_ENTRY,
    appData ? resolve(appData, "npm/node_modules/netlify-cli/bin/run.js") : undefined,
    prefix ? resolve(prefix, "node_modules/netlify-cli/bin/run.js") : undefined,
    prefix ? resolve(prefix, "lib/node_modules/netlify-cli/bin/run.js") : undefined,
    resolve(homedir(), ".npm-global/lib/node_modules/netlify-cli/bin/run.js"),
  ].filter((path): path is string => Boolean(path));
  const entry = candidates.find((path) => existsSync(path));
  if (!entry) throw new Error("Install Netlify CLI globally or set FTC_NETLIFY_CLI_ENTRY to its bin/run.js entrypoint.");
  return async (args) => execFile(process.execPath, [entry, ...args], { cwd: process.cwd(), windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

function operatorBlobIO(marker: EnvironmentMarker, env: NodeJS.ProcessEnv, injected?: OperatorBlobIO): OperatorBlobIO {
  if (injected) return injected;
  if (marker.kind === "local") {
    if (!["true", "1"].includes((env.NETLIFY_DEV ?? "").toLowerCase())) throw new Error("Local Blob operations require the Netlify Dev sandbox.");
    return localSandboxBlobIO();
  }
  const siteId = env.SITE_ID ?? env.NETLIFY_SITE_ID;
  if (!siteId) throw new Error("SITE_ID is required before any hosted CLI Blob operation.");
  return createAuthenticatedCliBlobIO(siteId, netlifyCliRunner());
}

function requireStrongBlobReads(blobs: OperatorBlobIO): void {
  if (blobs.supportsStrongReads !== true) {
    throw new Error("This operation requires strong Blob reads, but the selected adapter cannot guarantee them; no change was made.");
  }
}

interface OperatorDependencies {
  pool?: PgPoolLike;
  env?: NodeJS.ProcessEnv;
  blobs?: OperatorBlobIO;
  now?: () => Date;
  writeOutput?: (line: string) => void;
  artifactPath?: (command: string, operationId: string) => string;
  manifestPath?: (command: string, manifestId: string) => string;
  credentialsPath?: string;
}

export interface CleanupCandidate {
  attachmentId: string;
  caseId: string;
  caseStatus: string;
  storageKey: string;
  status: string;
  action: "delete-and-verify" | "verify-absent" | "blocked-ready-evidence" | "blocked-settle-period" | "blocked-snapshot-reference" | "blocked-marker-mismatch" | "blocked-active-lease";
  requestedAt: string | null;
  requestedAgeMs: number | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastErrorCategory: "none" | "prior-attempt-failed";
  leaseAgeMs: number | null;
  protection: "none" | "ready_evidence" | "submitted_snapshot_reference" | "marker_mismatch" | "active_claim_lease" | "upload_settle_period";
  snapshotReferences: { snapshotId: string; kind: string }[];
}
export interface CleanupManifest {
  version: 1;
  target: { kind: string; markerId: string; store: string; region: string };
  plannedAt: string;
  candidates: CleanupCandidate[];
  orphanKeys: string[];
}
export interface CleanupResult { status: "planned" | "completed" | "partial"; manifestId: string; manifest: CleanupManifest }

function parseOptions(args: string[], allowed: Set<string>): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith("--") || !allowed.has(option) || options.has(option)) {
      throw new Error("Use documented operator options with one value each.");
    }
    if (option === "--dry-run") { options.set(option, "true"); continue; }
    if (!value || value.startsWith("--")) throw new Error("Use documented operator options with one value each.");
    options.set(option, value);
    index += 1;
  }
  return options;
}

function validateTarget(options: Map<string, string>, env: NodeJS.ProcessEnv): { target: RuntimeEnvironmentConfig["kind"]; config: RuntimeEnvironmentConfig } {
  const requested = options.get("--target");
  if (requested !== "local" && requested !== "preview" && requested !== "production") throw new Error("Pass an explicit --target local, preview, or production.");
  const config = resolveRuntimeEnvironmentConfig(env);
  if (config.kind !== requested) throw new Error(`Target mismatch: requested ${requested}, trusted runtime identifies ${config.kind}.`);
  if (requested === "local" && !["true", "1"].includes((env.NETLIFY_DEV ?? "").toLowerCase())) {
    throw new Error("Local Blob operations must run inside the Netlify Dev sandbox with NETLIFY_DEV set; direct local processes are refused.");
  }
  return { target: requested, config };
}

function poolFromEnvironment(env: NodeJS.ProcessEnv): PgPoolLike {
  if (!env.NETLIFY_DB_URL) throw new Error("NETLIFY_DB_URL is required for the explicitly selected target.");
  return getDatabase({ connectionString: env.NETLIFY_DB_URL }).pool as unknown as PgPoolLike;
}

function canonical(value: unknown): string { return JSON.stringify(value); }
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

async function requireTargetMarker(pool: PgPoolLike, config: RuntimeEnvironmentConfig, target: string): Promise<EnvironmentMarker> {
  const marker = await loadEnvironmentMarker(pool, config);
  if (marker.kind !== target) throw new Error("Active environment marker does not match the explicit target.");
  return marker;
}

async function cleanupManifest(pool: PgPoolLike, blobs: OperatorBlobIO, marker: EnvironmentMarker, now: Date, settleMs: number, leaseMs: number): Promise<CleanupManifest> {
  const rows = await pool.query<{
    id: string; case_id: string; case_status: string; status: string; cleanup_pending: boolean; cleanup_requested_at: Date | string | null;
    cleanup_claimed_at: Date | string | null; cleanup_attempt_count: number; cleanup_last_attempt_at: Date | string | null;
    cleanup_last_error: string | null; storage_key: string; environment_marker_id: string | null;
  }>(`SELECT a.id,a.case_id,c.status AS case_status,a.status,a.cleanup_pending,a.cleanup_requested_at,a.cleanup_claimed_at,a.cleanup_attempt_count,
          a.cleanup_last_attempt_at,a.cleanup_last_error,a.storage_key,a.environment_marker_id
      FROM attachments a JOIN ftc_cases c ON c.id=a.case_id
      WHERE a.storage_environment=$1 AND a.storage_store=$2 AND a.storage_region=$3
      ORDER BY a.case_id,a.id`, [marker.kind, marker.storageStore, marker.storageRegion]);
  const objectKeys = await blobs.list(marker, "cases/");
  const known = new Set(rows.rows.map((row) => row.storage_key));
  const candidates: CleanupCandidate[] = [];
  for (const row of rows.rows) {
    const requested = row.cleanup_requested_at ? new Date(row.cleanup_requested_at).getTime() : Number.NaN;
    const claimed = row.cleanup_claimed_at ? new Date(row.cleanup_claimed_at).getTime() : Number.NaN;
    const references = await pool.query<{ snapshot_id: string; kind: string }>(
      `SELECT s.id AS snapshot_id,s.kind FROM calculation_snapshots s, jsonb_array_elements(s.evidence) item
        WHERE s.case_id=$1 AND item->>'id'=$2 ORDER BY s.kind,s.id`, [row.case_id, row.id]);
    let protection: CleanupCandidate["protection"] = "none";
    if (row.status !== "deleted") {
      protection = "ready_evidence";
    } else if (references.rows.some((reference) => reference.kind === "submitted")) {
      protection = "submitted_snapshot_reference";
    } else if (row.environment_marker_id !== marker.id) {
      protection = "marker_mismatch";
    } else if (Number.isFinite(claimed) && now.getTime() - claimed < leaseMs) {
      protection = "active_claim_lease";
    } else if (!Number.isFinite(requested) || now.getTime() - requested < settleMs) {
      protection = "upload_settle_period";
    }
    const object = protection === "none" ? await blobs.get(marker, row.storage_key) : null;
    const action: CleanupCandidate["action"] = protection === "ready_evidence" ? "blocked-ready-evidence"
      : protection === "submitted_snapshot_reference" ? "blocked-snapshot-reference"
        : protection === "marker_mismatch" ? "blocked-marker-mismatch"
          : protection === "active_claim_lease" ? "blocked-active-lease"
            : protection === "upload_settle_period" ? "blocked-settle-period"
              : object ? "delete-and-verify" : "verify-absent";
    candidates.push({ attachmentId: row.id, caseId: row.case_id, caseStatus: row.case_status, storageKey: row.storage_key, status: row.status, action,
      requestedAt: row.cleanup_requested_at ? new Date(row.cleanup_requested_at).toISOString() : null,
      requestedAgeMs: Number.isFinite(requested) ? now.getTime() - requested : null,
      attemptCount: row.cleanup_attempt_count, lastAttemptAt: row.cleanup_last_attempt_at ? new Date(row.cleanup_last_attempt_at).toISOString() : null,
      lastErrorCategory: row.cleanup_last_error ? "prior-attempt-failed" : "none",
      leaseAgeMs: Number.isFinite(claimed) ? now.getTime() - claimed : null, protection,
      snapshotReferences: references.rows.map((reference) => ({ snapshotId: reference.snapshot_id, kind: reference.kind })) });
  }
  const orphanKeys = objectKeys.map((item) => item.key).filter((key) => !known.has(key)).sort();
  return { version: 1, target: { kind: marker.kind, markerId: marker.id, store: marker.storageStore, region: marker.storageRegion },
    plannedAt: now.toISOString(), candidates, orphanKeys };
}

async function writeReviewManifest(command: string, manifestId: string, manifest: unknown, dependencies: OperatorDependencies, output: (line: string) => void): Promise<string> {
  const serialized = `${JSON.stringify({ manifestId, manifest }, null, 2)}\n`;
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  const path = dependencies.manifestPath?.(command, manifestId) ?? resolve(homedir(), ".ftc-private", `${command}-review-${manifestId}-${contentHash.slice(0, 12)}.json`);
  if (!dependencies.manifestPath) assertPrivateOutputPath(path);
  await writePrivateFile(path, serialized);
  output(`${command} dry run ${manifestId}; Review manifest: ${path}; sha256: ${contentHash}`);
  return path;
}

async function setCleanupResult(pool: PgPoolLike, candidate: CleanupCandidate, claim: string, success: boolean, now: Date): Promise<void> {
  await pool.query(`UPDATE attachments SET cleanup_pending=NOT $3,storage_deleted_at=CASE WHEN $3 THEN $4 ELSE storage_deleted_at END,
      cleanup_attempt_count=cleanup_attempt_count+1,cleanup_last_attempt_at=$4,cleanup_last_error=$5,cleanup_claim_token=NULL,cleanup_claimed_at=NULL
    WHERE id=$1 AND cleanup_claim_token=$2 AND status='deleted'`,
  [candidate.attachmentId, claim, success, now, success ? null : "delete_or_verify_failed"]);
}

/** Public cleanup operator seam: default plans are read-only; apply requires the exact fresh manifest ID. */
export async function runCleanupCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<CleanupResult> {
  const options = parseOptions(args, new Set(["--target", "--dry-run", "--confirm"]));
  const { target, config } = validateTarget(options, dependencies.env ?? process.env);
  if (options.has("--dry-run") && options.get("--dry-run") !== "true") throw new Error("Pass --dry-run true.");
  const confirming = options.has("--confirm");
  if (confirming === options.has("--dry-run")) throw new Error("Choose exactly one of --dry-run true or --confirm <manifest-id>.");
  const env = dependencies.env ?? process.env;
  const settleMs = Number(env.FTC_UPLOAD_SETTLE_MS);
  const leaseMs = Number(env.FTC_CLEANUP_CLAIM_LEASE_MS ?? "300000");
  if (!Number.isSafeInteger(settleMs) || settleMs < 0) throw new Error("FTC_UPLOAD_SETTLE_MS must be explicitly configured as a non-negative integer.");
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000) throw new Error("FTC_CLEANUP_CLAIM_LEASE_MS must be at least 1000 milliseconds.");
  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const marker = await requireTargetMarker(pool, config, target);
  const blobs = operatorBlobIO(marker, env, dependencies.blobs);
  requireStrongBlobReads(blobs);
  const now = (dependencies.now ?? (() => new Date()))();
  const manifest = await cleanupManifest(pool, blobs, marker, now, settleMs, leaseMs);
  const manifestId = digest({ ...manifest, plannedAt: undefined });
  const output = dependencies.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (!confirming) {
    await writeReviewManifest("cleanup", manifestId, manifest, dependencies, output);
    return { status: "planned", manifestId, manifest };
  }
  if (options.get("--confirm") !== manifestId) throw new Error("Cleanup manifest changed; review the new dry-run manifest before confirming.");
  let partial = false;
  for (const candidate of manifest.candidates.filter((item) => item.action === "delete-and-verify" || item.action === "verify-absent")) {
    const claim = randomUUID();
    const claimed = await pool.query(`UPDATE attachments SET cleanup_claim_token=$2,cleanup_claimed_at=$3,cleanup_last_attempt_at=$3
      WHERE id=$1 AND status='deleted' AND environment_marker_id=$4 AND
      (cleanup_claim_token IS NULL OR cleanup_claimed_at < $3::timestamptz - ($5::text || ' milliseconds')::interval)
      RETURNING id`, [candidate.attachmentId, claim, now, marker.id, leaseMs]);
    if (!claimed.rowCount) { partial = true; continue; }
    let success = false;
    try {
      if (candidate.action === "delete-and-verify") await blobs.delete(marker, candidate.storageKey);
      success = await blobs.get(marker, candidate.storageKey) === null;
    } catch { success = false; }
    try { await setCleanupResult(pool, candidate, claim, success, now); } catch { success = false; }
    if (!success) partial = true;
  }
  const status = partial ? "partial" : "completed";
  output(`Cleanup ${status}: ${manifestId}. Orphan keys and ready evidence were left untouched.`);
  return { status, manifestId, manifest };
}

interface PreviewCredentialFile {
  version: 1;
  target: "preview";
  markerId: string;
  operationId: string;
  createdAt: string;
  officerUserId: string;
  credentials: { loginName: string; password: string }[];
  drafts: { ownerLogin: string; caseId: string; attachmentId: string; storageKey: string }[];
}
export interface PreviewInitializationManifest {
  version: 1;
  operationId: string;
  target: { kind: "preview"; markerId: string | null; databaseFingerprint: string; store: string; region: string; deploymentContext: string };
  priorMarker: { id: string; kind: string; databaseFingerprint: string; store: string; region: string; deploymentContext: string } | null;
  action: "initialize" | "rotate-preview-branch" | "verify-existing-initialization";
  accounts: { id: string; loginName: string; role: string; active: boolean }[];
  initialization: { status: string | null; operationId: string | null };
  sessionsToInvalidate: number;
  drafts: { ownerLogin: string; caseId: string; attachmentId: string; storageKey: string }[];
  evidence: { sha256: string; byteSize: number; objectAction: "create-or-verify" };
  plannedAt: string;
}
export interface PreviewInitializationResult { status: "planned" | "initialized" | "replayed"; manifestId?: string; manifest?: PreviewInitializationManifest; credentialPath?: string; markerId?: string }

const previewAccounts = [
  { loginName: "taxpayer-demo-a", role: "taxpayer", displayName: "ผู้เสียภาษีตัวอย่าง ก", maskedReference: "***-1001" },
  { loginName: "taxpayer-demo-b", role: "taxpayer", displayName: "ผู้เสียภาษีตัวอย่าง ข", maskedReference: "***-1002" },
  { loginName: "officer-demo", role: "officer", displayName: "เจ้าหน้าที่ตัวอย่าง", maskedReference: null },
] as const;
const loadPreviewEvidenceBytes = (): Promise<Buffer> => readFile(resolve(process.cwd(), "server/fixtures/fictional-preview-evidence.pdf"));

function operationUuid(namespace: string): string {
  const bytes = createHash("sha256").update(namespace).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function previewInitializationManifest(pool: PgPoolLike, config: RuntimeEnvironmentConfig, operationId: string, now: Date, evidenceBytes: Uint8Array): Promise<PreviewInitializationManifest> {
  const active = await pool.query<{ id: string; kind: string; database_fingerprint: string; storage_store: string; storage_region: string; deployment_context: string }>(
    "SELECT marker.id,marker.kind,marker.database_fingerprint,marker.storage_store,marker.storage_region,marker.deployment_context FROM active_hosting_environment active JOIN hosting_environment_markers marker ON marker.id=active.marker_id WHERE active.singleton=true");
  const previous = active.rows[0] ?? null;
  const same = previous && previous.kind === config.kind && previous.database_fingerprint === config.databaseFingerprint &&
    previous.storage_store === config.storageStore && previous.storage_region === config.storageRegion && previous.deployment_context === config.deploymentContext;
  const canRotate = previous && config.kind === "preview" && previous.database_fingerprint !== config.databaseFingerprint;
  if (previous && !same && !canRotate) throw new Error("Stored hosting environment does not match this trusted runtime configuration.");
  const markerId = same ? previous.id : null;
  const users = await pool.query<{ id: string; login_name: string; role: string; active: boolean }>(
    "SELECT id,login_name,role,active FROM app_users WHERE login_name=ANY($1::text[]) ORDER BY login_name", [previewAccounts.map((account) => account.loginName)]);
  const initialization = markerId ? await pool.query<{ status: string; operation_id: string | null }>(
    "SELECT status,operation_id FROM preview_environment_initialization WHERE environment_marker_id=$1", [markerId]) : null;
  const sessions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM user_sessions");
  const drafts = previewAccounts.filter((account) => account.role === "taxpayer").map((account) => {
    const caseId = operationUuid(`ftc-preview-init:${operationId}:${account.loginName}:case`);
    const attachmentId = operationUuid(`ftc-preview-init:${operationId}:${account.loginName}:attachment`);
    return { ownerLogin: account.loginName, caseId, attachmentId, storageKey: `cases/${caseId}/${attachmentId}` };
  });
  return { version: 1, operationId, target: { kind: "preview", markerId, databaseFingerprint: config.databaseFingerprint,
    store: config.storageStore, region: config.storageRegion, deploymentContext: config.deploymentContext },
    priorMarker: previous ? { id: previous.id, kind: previous.kind, databaseFingerprint: previous.database_fingerprint,
      store: previous.storage_store, region: previous.storage_region, deploymentContext: previous.deployment_context } : null,
    action: same && initialization?.rows[0]?.status === "ready" ? "verify-existing-initialization" : canRotate ? "rotate-preview-branch" : "initialize",
    accounts: users.rows.map((row) => ({ id: row.id, loginName: row.login_name, role: row.role, active: row.active })),
    initialization: { status: initialization?.rows[0]?.status ?? null, operationId: initialization?.rows[0]?.operation_id ?? null },
    sessionsToInvalidate: sessions.rows[0]?.count ?? 0, drafts,
    evidence: { sha256: createHash("sha256").update(evidenceBytes).digest("hex"), byteSize: evidenceBytes.byteLength, objectAction: "create-or-verify" },
    plannedAt: now.toISOString() };
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  try {
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await chmod(path, 0o600);
    if (process.platform === "win32") {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const username = process.env.USERNAME;
      if (!username) throw new Error("USERNAME is required to protect the preview credential file with a Windows ACL.");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
      await promisify(execFile)("icacls", [path, "/inheritance:r", "/grant:r", `${principal}:(F)`], { windowsHide: true });
    }
  } catch (error) { await unlink(path).catch(() => undefined); throw error; }
}

async function readPreviewFile(path: string): Promise<{ file: PreviewCredentialFile; sha256: string } | null> {
  let contents: string;
  try { contents = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let file: PreviewCredentialFile;
  try { file = JSON.parse(contents) as PreviewCredentialFile; }
  catch { throw new Error("The private preview recovery file is invalid; initialization remains gated."); }
  if (file.version !== 1 || file.target !== "preview" || !Array.isArray(file.credentials) || file.credentials.length !== 3 ||
    !Array.isArray(file.drafts) || file.drafts.length !== 2) {
    throw new Error("The private preview recovery file does not match the initialization format; initialization remains gated.");
  }
  return { file, sha256: createHash("sha256").update(contents).digest("hex") };
}

async function withOperatorTransaction<T>(pool: PgPoolLike, work: (client: Awaited<ReturnType<PgPoolLike["connect"]>>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; }
  catch (error) { try { await client.query("ROLLBACK"); } catch { /* retain original error */ } throw error; }
  finally { client.release(); }
}

/** One-time preview initializer. Authentication stays closed until all private credentials, draft rows, and bytes verify. */
export async function runPreviewInitializationCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<PreviewInitializationResult> {
  const options = parseOptions(args, new Set(["--target", "--operation-id", "--dry-run", "--confirm"]));
  const env = dependencies.env ?? process.env;
  const { target, config } = validateTarget(options, env);
  if (target !== "preview") throw new Error("Preview initialization is allowed only for an explicitly selected preview environment.");
  const operationId = options.get("--operation-id");
  if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error("Preview initialization requires an explicit --operation-id UUIDv4; reuse it to recover an interrupted run.");
  }
  const dryRun = options.has("--dry-run");
  const confirming = options.has("--confirm");
  if (dryRun === confirming || (dryRun && options.get("--dry-run") !== "true")) throw new Error("Choose exactly one of --dry-run true or --confirm <manifest-id>.");
  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const now = (dependencies.now ?? (() => new Date()))();
  const previewEvidenceBytes = await loadPreviewEvidenceBytes();
  const manifest = await previewInitializationManifest(pool, config, operationId, now, previewEvidenceBytes);
  const manifestId = digest({ ...manifest, plannedAt: undefined });
  const output = dependencies.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (dryRun) {
    await writeReviewManifest("preview-init", manifestId, manifest, dependencies, output);
    return { status: "planned", manifestId, manifest };
  }
  if (options.get("--confirm") !== manifestId) throw new Error("Preview initialization scope changed; review the new dry-run manifest before confirming.");
  if (manifest.accounts.length !== previewAccounts.length || previewAccounts.some((account) => {
    const user = manifest.accounts.find((row) => row.loginName === account.loginName);
    return !user || !user.active || user.role !== account.role;
  })) throw new Error("Expected active fictional demo accounts are missing or mismatched; preview remains gated.");
  if (manifest.initialization.operationId && manifest.initialization.operationId !== operationId) throw new Error("Preview initialization already belongs to another operation; the existing preview was preserved.");
  const marker = await ensureEnvironmentMarker(pool, config);
  if (marker.kind !== "preview") throw new Error("Active environment marker is not a preview marker.");
  const blobs = operatorBlobIO(marker, env, dependencies.blobs);
  requireStrongBlobReads(blobs);
  await pool.query(`INSERT INTO preview_environment_initialization(environment_marker_id,status) VALUES ($1,'pending')
    ON CONFLICT (environment_marker_id) DO NOTHING`, [marker.id]);
  const credentialPath = dependencies.credentialsPath ?? dependencies.artifactPath?.("preview-init", operationId) ??
    resolve(homedir(), ".ftc-private", `preview-init-${operationId}.json`);
  let recovery = await readPreviewFile(credentialPath);
  const initState = await pool.query<{ status: string; operation_id: string | null; credential_file_sha256: string | null }>(
    "SELECT status,operation_id,credential_file_sha256 FROM preview_environment_initialization WHERE environment_marker_id=$1", [marker.id]);
  const state = initState.rows[0];
  if (!state) throw new Error("Preview initialization state is missing; authentication remains gated.");
  if (state.operation_id && state.operation_id !== operationId) throw new Error("Preview initialization already belongs to another operation; the existing preview was preserved.");
  if (state.status === "ready") {
    if (!recovery || state.operation_id !== operationId || state.credential_file_sha256 !== recovery.sha256 ||
      recovery.file.markerId !== marker.id || recovery.file.operationId !== operationId) {
      throw new Error("Preview initialization is complete but its matching private credential file is unavailable or changed; no rotation was attempted.");
    }
    const stored = await pool.query<{ login_name: string; password_hash: string }>(
      "SELECT login_name,password_hash FROM app_users WHERE login_name=ANY($1::text[])", [previewAccounts.map((account) => account.loginName)]);
    for (const credential of recovery.file.credentials) {
      const account = stored.rows.find((row) => row.login_name === credential.loginName);
      if (!account || !await verifyPassword(credential.password, account.password_hash)) throw new Error("Preview credentials were superseded; the gate state was not changed.");
    }
    for (const item of recovery.file.drafts) {
      const bytes = await blobs.get(marker, item.storageKey);
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== createHash("sha256").update(previewEvidenceBytes).digest("hex")) {
        throw new Error("Preview evidence verification failed; the initialization gate remains closed.");
      }
    }
    output(`Preview initialization replay verified for operation ${operationId}; private credentials remain at ${credentialPath}.`);
    return { status: "replayed", manifestId, manifest, credentialPath, markerId: marker.id };
  }
  if (state.operation_id === operationId && state.credential_file_sha256 && state.credential_file_sha256 !== recovery?.sha256) {
    throw new Error("Pending preview initialization requires the original unchanged private recovery file; no rotation was attempted.");
  }
  if (recovery && (recovery.file.markerId !== marker.id || recovery.file.operationId !== operationId)) {
    throw new Error("The existing private file belongs to another preview initialization; no account changes were made.");
  }
  if (!recovery && state.operation_id === operationId) throw new Error("Initialization is pending but its private recovery file is missing; restore that file before retrying.");
  if (!recovery) {
    const users = await pool.query<{ login_name: string; id: string; role: string; active: boolean }>(
      "SELECT login_name,id,role,active FROM app_users WHERE login_name=ANY($1::text[])", [previewAccounts.map((account) => account.loginName)]);
    if (users.rows.length !== previewAccounts.length || previewAccounts.some((account) => {
      const user = users.rows.find((row) => row.login_name === account.loginName);
      return !user || !user.active || user.role !== account.role;
    })) throw new Error("Expected active fictional demo accounts are missing or mismatched; preview remains gated.");
    const file: PreviewCredentialFile = { version: 1, target: "preview", markerId: marker.id, operationId,
      createdAt: now.toISOString(), officerUserId: users.rows.find((user) => user.login_name === "officer-demo")!.id,
      credentials: await Promise.all(previewAccounts.map(async (account) => ({ loginName: account.loginName,
        password: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` }))),
      drafts: manifest.drafts };
    try { await writePrivateFile(credentialPath, `${JSON.stringify(file, null, 2)}\n`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    recovery = await readPreviewFile(credentialPath);
    if (!recovery || recovery.file.markerId !== marker.id || recovery.file.operationId !== operationId) throw new Error("Could not create a recoverable private preview credential file.");
  }
  const recoverySha256 = recovery.sha256;
  const passwordHashes = await Promise.all(recovery.file.credentials.map(async (credential) => ({ ...credential, passwordHash: await hashPassword(credential.password) })));
  await withOperatorTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ftc-preview-initialization'))");
    const locked = await client.query<{ status: string; operation_id: string | null; credential_file_sha256: string | null }>(
      "SELECT status,operation_id,credential_file_sha256 FROM preview_environment_initialization WHERE environment_marker_id=$1 FOR UPDATE", [marker.id]);
    if (!locked.rows[0] || locked.rows[0].operation_id && locked.rows[0].operation_id !== operationId || locked.rows[0].status === "ready" ||
      locked.rows[0].credential_file_sha256 && locked.rows[0].credential_file_sha256 !== recoverySha256) {
      throw new Error("Preview initialization state changed; no new rotation was applied.");
    }
    await client.query("UPDATE preview_environment_initialization SET operation_id=$2,credential_file_sha256=$3,updated_at=now() WHERE environment_marker_id=$1",
      [marker.id, operationId, recoverySha256]);
    for (const account of previewAccounts) {
      const user = await client.query<{ id: string; role: string; active: boolean }>("SELECT id,role,active FROM app_users WHERE login_name=$1 FOR UPDATE", [account.loginName]);
      if (!user.rows[0] || user.rows[0].role !== account.role || !user.rows[0].active) throw new Error("A seeded preview account changed during initialization.");
      const password = passwordHashes.find((item) => item.loginName === account.loginName)!;
      await client.query("UPDATE app_users SET password_hash=$2,updated_at=now() WHERE id=$1", [user.rows[0].id, password.passwordHash]);
      if (account.role === "taxpayer") await client.query("INSERT INTO user_profiles(user_id,masked_reference) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING", [user.rows[0].id, account.maskedReference]);
    }
    await client.query("DELETE FROM user_sessions");
    for (const item of recovery!.file.drafts) {
      const userId = (await client.query<{ id: string }>("SELECT id FROM app_users WHERE login_name=$1", [item.ownerLogin])).rows[0]!.id;
      const draft = createEmptyDraft(); draft.id = item.caseId;
      const existing = await client.query<{ owner_id: string; environment_marker_id: string; status: string }>("SELECT owner_id,environment_marker_id,status FROM ftc_cases WHERE id=$1", [item.caseId]);
      if (existing.rows[0]) {
        if (existing.rows[0].owner_id !== userId || existing.rows[0].environment_marker_id !== marker.id || existing.rows[0].status !== "draft") throw new Error("Preview draft recovery identity does not match.");
      } else {
        await client.query("INSERT INTO ftc_cases(id,owner_id,draft,create_request_id,environment_marker_id) VALUES ($1,$2,$3::jsonb,$4,$5)",
          [item.caseId, userId, JSON.stringify(draft), `preview-init-${operationId}-${item.ownerLogin}`, marker.id]);
      }
      const sha256 = createHash("sha256").update(previewEvidenceBytes).digest("hex");
      const attachment = await client.query<{ id: string }>("SELECT id FROM attachments WHERE id=$1", [item.attachmentId]);
      if (!attachment.rows[0]) await client.query(`INSERT INTO attachments(id,case_id,storage_environment,storage_store,storage_region,storage_key,display_name,media_type,byte_size,sha256,kind,status,environment_marker_id)
        VALUES ($1,$2,'preview',$3,$4,$5,'fictional-preview-example.pdf','application/pdf',$6,$7,'other','ready',$8)`,
      [item.attachmentId, item.caseId, marker.storageStore, marker.storageRegion, item.storageKey, previewEvidenceBytes.length, sha256, marker.id]);
    }
  });
  for (const item of recovery.file.drafts) {
    await blobs.put(marker, item.storageKey, previewEvidenceBytes);
    const bytes = await blobs.get(marker, item.storageKey);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== createHash("sha256").update(previewEvidenceBytes).digest("hex")) throw new Error("Preview evidence verification failed; authentication remains gated.");
  }
  await pool.query(`UPDATE preview_environment_initialization SET status='ready',initialized_at=now(),updated_at=now()
    WHERE environment_marker_id=$1 AND operation_id=$2 AND credential_file_sha256=$3`, [marker.id, operationId, recovery.sha256]);
  output(`Preview initialization verified for operation ${operationId}; private credentials are at ${credentialPath}.`);
  return { status: "initialized", manifestId, manifest, credentialPath, markerId: marker.id };
}

export interface BackupManifest {
  version: 1;
  target: { kind: string; markerId: string; store: string; region: string; databaseFingerprint: string };
  plannedAt: string;
  tables: { name: string; rows: number }[];
  objects: { key: string; state: "ready" | "pending" | "deleted" | "failed" | "orphan"; sha256: string | null; byteSize: number | null }[];
  databaseSnapshotSha256: string;
}
export interface BackupResult { status: "planned" | "written"; manifestId: string; manifest: BackupManifest; outputPath?: string; artifactSha256?: string }
interface BackupArtifact { manifest: BackupManifest; tables: Record<string, Record<string, unknown>[]>; blobs: { key: string; bytesBase64: string; sha256: string }[] }

const excludedBackupTables = new Set([
  "user_sessions", "login_attempt_reservations", "hosting_environment_markers", "active_hosting_environment",
  "login_attempt_limits", "operator_credential_rotations", "preview_environment_initialization",
  "operator_demo_resets", "operator_environment_gates",
]);

async function readSnapshotTables(pool: PgPoolLike, marker?: EnvironmentMarker): Promise<Record<string, Record<string, unknown>[]>> {
  const names = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  const tables: Record<string, Record<string, unknown>[]> = {};
  const includedNames = names.rows.map((row) => row.table_name).filter((name) => !excludedBackupTables.has(name));
  const scopedCaseRows = marker ? await pool.query<{ id: string; owner_id: string; assigned_officer_id: string | null }>(
    "SELECT id,owner_id,assigned_officer_id FROM ftc_cases WHERE environment_marker_id=$1 ORDER BY id", [marker.id]) : null;
  const caseIds = scopedCaseRows?.rows.map((row) => row.id) ?? [];
  const userIds = new Set<string>();
  for (const row of scopedCaseRows?.rows ?? []) { userIds.add(row.owner_id); if (row.assigned_officer_id) userIds.add(row.assigned_officer_id); }
  for (const name of includedNames.filter((table) => table !== "app_users" && table !== "user_profiles")) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Database table name failed the export allowlist check.");
    const keys = await pool.query<{ column_name: string }>(`SELECT kcu.column_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema AND kcu.table_name=tc.table_name
      WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='PRIMARY KEY' ORDER BY kcu.ordinal_position`, [name]);
    const order = keys.rows.map((key) => `"${key.column_name.replaceAll('"', '""')}"`).join(",") || "ctid";
    const columns = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [name]);
    const columnNames = new Set(columns.rows.map((column) => column.column_name));
    let scopeClause = "";
    let scopeValues: unknown[] = [];
    if (marker && name === "ftc_cases") { scopeClause = " WHERE environment_marker_id=$1"; scopeValues = [marker.id]; }
    else if (marker && columnNames.has("case_id")) { scopeClause = " WHERE case_id=ANY($1::uuid[])"; scopeValues = [caseIds]; }
    else if (marker && name !== "rule_sets") throw new Error(`Backup cannot establish active-marker scope for table ${name}.`);
    const rows = await pool.query<Record<string, unknown>>(`SELECT * FROM "${name}"${scopeClause} ORDER BY ${order}`, scopeValues);
    tables[name] = rows.rows;
    for (const row of rows.rows) {
      for (const field of ["owner_id", "assigned_officer_id", "officer_id", "assigned_by", "actor_id"]) {
        if (typeof row[field] === "string") userIds.add(row[field] as string);
      }
    }
  }
  if (marker) {
    const ids = [...userIds].sort();
    const users = marker.kind === "preview"
      ? await pool.query<Record<string, unknown>>("SELECT * FROM app_users WHERE id=ANY($1::uuid[]) OR login_name=ANY($2::text[]) ORDER BY id", [ids, previewAccounts.map((account) => account.loginName)])
      : await pool.query<Record<string, unknown>>("SELECT * FROM app_users ORDER BY id");
    tables.app_users = users.rows;
    const includedUserIds = users.rows.map((row) => String(row.id)).sort();
    tables.user_profiles = (await pool.query<Record<string, unknown>>("SELECT * FROM user_profiles WHERE user_id=ANY($1::uuid[]) ORDER BY user_id", [includedUserIds])).rows;
  } else {
    for (const name of ["app_users", "user_profiles"]) {
      if (includedNames.includes(name)) {
        const keys = await pool.query<{ column_name: string }>(`SELECT kcu.column_name FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema AND kcu.table_name=tc.table_name
          WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='PRIMARY KEY' ORDER BY kcu.ordinal_position`, [name]);
        const order = keys.rows.map((key) => `"${key.column_name.replaceAll('"', '""')}"`).join(",") || "ctid";
        tables[name] = (await pool.query<Record<string, unknown>>(`SELECT * FROM "${name}" ORDER BY ${order}`)).rows;
      }
    }
  }
  return tables;
}

async function captureBackup(pool: PgPoolLike, blobs: OperatorBlobIO, marker: EnvironmentMarker, now: Date): Promise<{ artifact: BackupArtifact; manifestId: string }> {
  const client = await pool.connect();
  let tables: Record<string, Record<string, unknown>[]>;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    tables = await readSnapshotTables({ query: client.query.bind(client), connect: async () => client } as unknown as PgPoolLike, marker);
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch { /* keep original */ } throw error; }
  finally { client.release(); }
  const databaseSnapshotSha256 = digest(tables);
  const attachmentRows = tables.attachments ?? [];
  for (const row of attachmentRows) {
    if (row.storage_environment !== marker.kind || row.storage_store !== marker.storageStore || row.storage_region !== marker.storageRegion ||
      row.environment_marker_id !== marker.id) {
      throw new Error("A backed-up evidence reference has a different storage identity from the active target; backup was refused.");
    }
  }
  const attached = new Map(attachmentRows.map((row) => [String(row.storage_key), row]));
  const listed = await blobs.list(marker, "");
  const objects: BackupManifest["objects"] = [];
  const saved: BackupArtifact["blobs"] = [];
  for (const { key } of listed) {
    const row = attached.get(key);
    const state = row ? String(row.status) as "ready" | "pending" | "deleted" | "failed" : "orphan";
    const bytes = await blobs.get(marker, key);
    if (!bytes) throw new Error("Strong Blob listing returned an object that could not be read; backup was not written.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const expected = row?.sha256 ? String(row.sha256) : null;
    if (state === "ready" && expected !== sha256) throw new Error("A ready evidence object failed its recorded digest; backup was not written.");
    if (expected && state !== "deleted" && state !== "failed" && expected !== sha256) throw new Error("A tracked evidence object failed its recorded digest; backup was not written.");
    objects.push({ key, state, sha256, byteSize: bytes.byteLength });
    saved.push({ key, bytesBase64: Buffer.from(bytes).toString("base64"), sha256 });
  }
  for (const [key, row] of attached) {
    if (!objects.some((object) => object.key === key)) {
      objects.push({ key, state: String(row.status) as BackupManifest["objects"][number]["state"], sha256: null, byteSize: null });
      if (row.status === "ready") throw new Error("A ready evidence row has no Blob; backup was not written.");
    }
  }
  objects.sort((left, right) => left.key.localeCompare(right.key));
  const manifest: BackupManifest = { version: 1,
    target: { kind: marker.kind, markerId: marker.id, store: marker.storageStore, region: marker.storageRegion, databaseFingerprint: marker.databaseFingerprint },
    plannedAt: now.toISOString(), tables: Object.entries(tables).map(([name, rows]) => ({ name, rows: rows.length })), objects, databaseSnapshotSha256 };
  const currentTables = await readSnapshotTables(pool, marker);
  if (digest(currentTables) !== databaseSnapshotSha256) throw new Error("Database rows changed during backup capture; retry from a fresh dry run.");
  const markerAfter = await loadEnvironmentMarker(pool, marker);
  if (markerAfter.id !== marker.id) throw new Error("Active environment marker changed during backup capture; retry against the new target.");
  const manifestId = digest({ ...manifest, plannedAt: undefined });
  return { artifact: { manifest, tables, blobs: saved }, manifestId };
}

function artifactPathFor(command: string, operationId: string): string {
  return resolve(homedir(), ".ftc-private", command, `${operationId}.json`);
}

function assertPrivateOutputPath(path: string): string {
  const normalized = resolve(path);
  const privateRoot = resolve(homedir(), ".ftc-private");
  if (normalized !== privateRoot && !normalized.startsWith(`${privateRoot}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Operator backup artifacts must remain under the private .ftc-private directory.");
  }
  return normalized;
}

/** Produces a private coordinated database and Blob export; dry-run is the default. */
export async function runBackupCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<BackupResult> {
  const options = parseOptions(args, new Set(["--target", "--dry-run", "--confirm", "--output", "--operation-id"]));
  const env = dependencies.env ?? process.env;
  const { target, config } = validateTarget(options, env);
  const confirming = options.has("--confirm");
  if (confirming === options.has("--dry-run")) throw new Error("Choose exactly one of --dry-run or --confirm <manifest-id>.");
  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const marker = await requireTargetMarker(pool, config, target);
  const operationId = options.get("--operation-id") ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new Error("--operation-id must be a UUIDv4.");
  const requestedPath = options.get("--output") ?? dependencies.credentialsPath ?? dependencies.artifactPath?.("backups", operationId) ?? artifactPathFor("backups", operationId);
  const outputPath = dependencies.credentialsPath || dependencies.artifactPath ? resolve(requestedPath) : assertPrivateOutputPath(requestedPath);
  const blobs = operatorBlobIO(marker, env, dependencies.blobs);
  requireStrongBlobReads(blobs);
  const capture = await captureBackup(pool, blobs, marker, (dependencies.now ?? (() => new Date()))());
  const manifest = capture.artifact.manifest;
  const output = dependencies.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (!confirming) {
    await writeReviewManifest("backup", capture.manifestId, manifest, dependencies, output);
    return { status: "planned", manifestId: capture.manifestId, manifest };
  }
  if (options.get("--confirm") !== capture.manifestId) throw new Error("Backup inventory changed; review the new manifest before writing the private file.");
  const serialized = `${JSON.stringify(capture.artifact, null, 2)}\n`;
  const artifactSha256 = createHash("sha256").update(serialized).digest("hex");
  await writePrivateFile(outputPath, serialized);
  output(`Backup written and verified: ${capture.manifestId}. Private artifact: ${outputPath}; SHA-256: ${artifactSha256}`);
  return { status: "written", manifestId: capture.manifestId, manifest, outputPath, artifactSha256 };
}

interface RestoreCredentialFile { version: 1; target: "local"; markerId: string; operationId: string; backupSha256: string; credentials: { loginName: string; password: string }[] }
export interface RestoreResult { status: "planned" | "restored" | "replayed"; manifestId?: string; markerId: string; credentialPath?: string }
const restoreOrder = ["rule_sets", "app_users", "user_profiles", "ftc_cases", "foreign_income_sources", "remittances",
  "exchange_rate_references", "officer_case_assignments", "calculation_snapshots", "attachments", "audit_events", "api_mutation_requests"];
const jsonColumns = new Set(["draft", "source_data", "fx_reference", "inputs", "result", "evidence", "policy", "metadata", "response", "sess", "source_urls", "assumptions"]);

function verifyRestoredRelationalSnapshot(actual: Record<string, Record<string, unknown>[]>, artifact: BackupArtifact, marker: EnvironmentMarker): void {
  const expected = structuredClone(Object.fromEntries(Object.entries(artifact.tables).filter(([name]) => !excludedBackupTables.has(name))));
  for (const row of expected.ftc_cases ?? []) row.environment_marker_id = marker.id;
  for (const row of expected.attachments ?? []) {
    row.environment_marker_id = marker.id;
    row.storage_environment = "local";
    row.storage_store = marker.storageStore;
    row.storage_region = marker.storageRegion;
  }
  const currentUsers = new Map((actual.app_users ?? []).map((row) => [String(row.id), row]));
  expected.app_users = (expected.app_users ?? []).map((row) => {
    const current = currentUsers.get(String(row.id));
    if (!current || typeof current.password_hash !== "string") throw new Error("Restored account facts are missing from the target database.");
    return { ...row, password_hash: current.password_hash };
  });
  if (digest(actual) !== digest(expected)) throw new Error("Restored relational snapshot differs from the source facts.");
}

/** Restore a coherent private export only into a blank, newly identified local DB/store. */
export async function runRestoreRehearsalCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<RestoreResult> {
  const options = parseOptions(args, new Set(["--target", "--backup", "--backup-sha256", "--confirm", "--operation-id", "--dry-run"]));
  const env = dependencies.env ?? process.env;
  const { target, config } = validateTarget(options, env);
  if (target !== "local") throw new Error("Restore rehearsal is restricted to a fresh isolated local database and Netlify Dev Blob sandbox.");
  const operationId = options.get("--operation-id");
  if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new Error("Restore requires an explicit --operation-id UUIDv4 for recovery.");
  const backupPath = options.get("--backup"); const backupSha = options.get("--backup-sha256")?.toLowerCase();
  if (!backupPath || !backupSha || !/^[0-9a-f]{64}$/.test(backupSha)) throw new Error("Pass the private backup path and its exact SHA-256.");
  const dryRun = options.has("--dry-run");
  const confirming = options.has("--confirm");
  if (dryRun === confirming || (dryRun && options.get("--dry-run") !== "true")) throw new Error("Choose exactly one of --dry-run true or --confirm <restore-manifest-id>.");
  if (!dependencies.credentialsPath && !dependencies.artifactPath) assertPrivateOutputPath(resolve(backupPath));
  let serialized: string;
  try { serialized = await readFile(resolve(backupPath), "utf8"); } catch { throw new Error("Private backup file is unavailable; restore was refused."); }
  if (createHash("sha256").update(serialized).digest("hex") !== backupSha) throw new Error("Backup SHA-256 did not match; restore was refused.");
  let artifact: BackupArtifact;
  try { artifact = JSON.parse(serialized) as BackupArtifact; } catch { throw new Error("Backup artifact is invalid."); }
  if (artifact.manifest?.version !== 1 || !artifact.tables || !Array.isArray(artifact.blobs) || digest(artifact.tables) !== artifact.manifest.databaseSnapshotSha256 ||
    !artifact.manifest.tables.every((table) => artifact.tables[table.name]?.length === table.rows)) throw new Error("Backup database snapshot failed integrity verification.");
  for (const object of artifact.blobs) {
    const bytes = Buffer.from(object.bytesBase64, "base64");
    if (bytes.toString("base64") !== object.bytesBase64 || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error("Backup contains an invalid object digest.");
    const expected = artifact.manifest.objects.find((item) => item.key === object.key);
    if (!expected || expected.sha256 !== object.sha256 || expected.byteSize !== bytes.length) throw new Error("Backup object inventory does not match its bytes.");
  }
  for (const object of artifact.manifest.objects.filter((item) => item.state === "ready")) if (!artifact.blobs.some((entry) => entry.key === object.key)) throw new Error("Backup is missing a ready evidence object.");

  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const marker = await requireTargetMarker(pool, config, "local");
  if (artifact.manifest.target.markerId === marker.id || artifact.manifest.target.databaseFingerprint === marker.databaseFingerprint) throw new Error("Restore requires a different fresh database identity from the source backup.");
  const blobs = operatorBlobIO(marker, env, dependencies.blobs);
  const credentialPath = dependencies.credentialsPath ?? dependencies.artifactPath?.("restore", operationId) ?? artifactPathFor("restore", operationId);
  const accounts = artifact.tables.app_users ?? [];
  if (!accounts.length || accounts.some((row) => typeof row.login_name !== "string" || typeof row.password_hash !== "string")) throw new Error("Backup has no valid accounts to restore.");
  const prior = await pool.query<{ operation_id: string; status: string; credential_file_sha256: string; backup_sha256: string }>(
    "SELECT operation_id,status,credential_file_sha256,backup_sha256 FROM operator_environment_gates WHERE environment_marker_id=$1", [marker.id]);
  if (prior.rows[0] && (prior.rows[0].operation_id !== operationId || prior.rows[0].backup_sha256 !== backupSha)) throw new Error("Restore gate belongs to another operation or backup; refusing overwrite.");
  if (!prior.rows[0]) {
    const current = await readSnapshotTables(pool);
    if (Object.entries(current).some(([name, rows]) => !excludedBackupTables.has(name) && rows.length > 0)) throw new Error("Restore target is not blank; use a newly created disposable local database and store.");
    if ((await blobs.list(marker, "")).length) throw new Error("Restore target Blob store is not empty; create a fresh database-derived local store.");
  }
  const manifestId = digest({ operationId, backupSha256: backupSha, target: { markerId: marker.id, databaseFingerprint: marker.databaseFingerprint, store: marker.storageStore, region: marker.storageRegion },
    tables: artifact.manifest.tables, objects: artifact.blobs.map(({ key, sha256 }) => ({ key, sha256 })) });
  const output = dependencies.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (dryRun) {
    await writeReviewManifest("restore", manifestId, { target: { kind: marker.kind, markerId: marker.id, store: marker.storageStore,
      region: marker.storageRegion, databaseFingerprint: marker.databaseFingerprint }, source: artifact.manifest,
      objects: artifact.blobs.map(({ key, sha256 }) => ({ key, sha256 })) }, dependencies, output);
    return { status: "planned", manifestId, markerId: marker.id };
  }
  if (options.get("--confirm") !== manifestId) throw new Error("Restore target or source inventory changed; review the exact restore dry-run manifest before confirming.");
  let credentials: RestoreCredentialFile;
  let credentialSha: string;
  if (prior.rows[0]) {
    let contents: string;
    try { contents = await readFile(credentialPath, "utf8"); } catch { throw new Error("Restore state is gated but its private credential file is missing; recover that exact file before retrying."); }
    if (createHash("sha256").update(contents).digest("hex") !== prior.rows[0].credential_file_sha256) throw new Error("Restore private credential file changed; authentication remains gated.");
    try { credentials = JSON.parse(contents) as RestoreCredentialFile; } catch { throw new Error("Restore private credential file is invalid; authentication remains gated."); }
    credentialSha = prior.rows[0].credential_file_sha256;
    if (credentials.operationId !== operationId || credentials.markerId !== marker.id) throw new Error("Restore gate belongs to another operation; refusing overwrite.");
    if (prior.rows[0].status === "ready") {
      for (const item of credentials.credentials) {
        const row = accounts.find((account) => account.login_name === item.loginName);
        const current = await pool.query<{ password_hash: string }>("SELECT password_hash FROM app_users WHERE login_name=$1", [item.loginName]);
        if (!row || !current.rows[0] || !await verifyPassword(item.password, current.rows[0].password_hash)) throw new Error("Restored credentials were superseded; no changes were made.");
      }
      for (const object of artifact.blobs) {
        const expected = Buffer.from(object.bytesBase64, "base64"); const current = await blobs.get(marker, object.key);
        if (!current || Buffer.compare(Buffer.from(current), expected) !== 0) throw new Error("A restored Blob changed; the completed restore is not equivalent.");
      }
      const keys = (await blobs.list(marker, "")).map((item) => item.key).sort();
      if (canonical(keys) !== canonical(artifact.blobs.map((item) => item.key).sort())) throw new Error("Completed restore store has extra or missing objects.");
      verifyRestoredRelationalSnapshot(await readSnapshotTables(pool), artifact, marker);
      return { status: "replayed", manifestId, markerId: marker.id, credentialPath };
    }
  } else {
    if (!dependencies.credentialsPath && !dependencies.artifactPath) assertPrivateOutputPath(credentialPath);
    let contents: string;
    try { contents = await readFile(credentialPath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const allCredentials = await Promise.all(accounts.map(async (row) => ({ loginName: String(row.login_name), password: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` })));
      credentials = { version: 1, target: "local", markerId: marker.id, operationId, backupSha256: backupSha, credentials: allCredentials };
      contents = `${JSON.stringify(credentials, null, 2)}\n`;
      await writePrivateFile(credentialPath, contents);
    }
    try { credentials = JSON.parse(contents) as RestoreCredentialFile; } catch { throw new Error("Private restore recovery file is invalid; no target mutation occurred."); }
    if (credentials.version !== 1 || credentials.target !== "local" || credentials.markerId !== marker.id || credentials.operationId !== operationId || credentials.backupSha256 !== backupSha ||
      credentials.credentials.length !== accounts.length || accounts.some((account) => !credentials.credentials.some((item) => item.loginName === account.login_name && /^[A-Za-z0-9_-]{40,64}$/.test(item.password)))) {
      throw new Error("Existing private restore recovery file belongs to a different operation or backup.");
    }
    credentialSha = createHash("sha256").update(contents).digest("hex");
    await pool.query("INSERT INTO operator_environment_gates(environment_marker_id,operation_id,status,credential_file_sha256,backup_sha256) VALUES ($1,$2,'closed',$3,$4)", [marker.id, operationId, credentialSha, backupSha]);
  }
  // Replays can finish an interrupted idempotent copy while authentication is gated.
  for (const object of artifact.blobs) {
    const bytes = Buffer.from(object.bytesBase64, "base64");
    const existing = await blobs.get(marker, object.key);
    if (existing && Buffer.compare(Buffer.from(existing), bytes) !== 0) throw new Error("Fresh restore store contains an unexpected object; refusing to overwrite it.");
    if (!existing) await blobs.put(marker, object.key, bytes);
    const verified = await blobs.get(marker, object.key);
    if (!verified || Buffer.compare(Buffer.from(verified), bytes) !== 0) throw new Error("Restored Blob failed strong read-back verification.");
  }
  const copiedKeys = (await blobs.list(marker, "")).map((item) => item.key).sort();
  const expectedKeys = artifact.blobs.map((item) => item.key).sort();
  if (canonical(copiedKeys) !== canonical(expectedKeys)) throw new Error("Fresh restore store contains extra or missing case objects; the authentication gate remains closed.");
  const hashes = new Map(await Promise.all(credentials.credentials.map(async (item) => [item.loginName, await hashPassword(item.password)] as const)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of restoreOrder) {
      const rows = artifact.tables[table] ?? [];
      for (const original of rows) {
        const row = { ...original };
        if (table === "ftc_cases") { row.environment_marker_id = marker.id; row.status = "draft"; row.submitted_snapshot_id = null; row.submitted_at = null; }
        if (table === "attachments") { row.environment_marker_id = marker.id; row.storage_environment = "local"; row.storage_store = marker.storageStore; row.storage_region = marker.storageRegion; }
        if (table === "app_users") row.password_hash = hashes.get(String(row.login_name))!;
        const keys = Object.keys(row);
        const values = keys.map((key) => jsonColumns.has(key) && row[key] !== null && typeof row[key] !== "string" ? JSON.stringify(row[key]) : row[key]);
        const placeholders = keys.map((key, index) => `$${index + 1}${jsonColumns.has(key) ? "::jsonb" : ""}`).join(",");
        await client.query(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
    }
    for (const row of artifact.tables.ftc_cases ?? []) if (row.status === "submitted") {
      await client.query("UPDATE ftc_cases SET status='submitted',submitted_snapshot_id=$2,submitted_at=$3 WHERE id=$1", [row.id, row.submitted_snapshot_id, row.submitted_at]);
    }
    await client.query("DELETE FROM user_sessions");
    const sessionCount = await client.query<{ count: string }>("SELECT count(*)::text count FROM user_sessions");
    if (Number(sessionCount.rows[0]?.count) !== 0) throw new Error("Restored session invalidation could not be verified.");
    const restoredTables = await readSnapshotTables({ query: client.query.bind(client), connect: async () => client } as unknown as PgPoolLike);
    // Password hashes and environment bindings are intentionally new. All other facts stay equivalent.
    verifyRestoredRelationalSnapshot(restoredTables, artifact, marker);
    const confirmed = await client.query("UPDATE operator_environment_gates SET status='ready',updated_at=now() WHERE environment_marker_id=$1 AND operation_id=$2 AND credential_file_sha256=$3 AND backup_sha256=$4 AND status='closed' RETURNING environment_marker_id", [marker.id, operationId, credentialSha, backupSha]);
    if (!confirmed.rowCount) throw new Error("Restore operation gate changed unexpectedly.");
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch { /* preserve the original failure; gate remains closed */ } throw error; }
  finally { client.release(); }
  output(`Restore completed and verified for manifest ${manifestId}; generated credentials are private at ${credentialPath}.`);
  return { status: "restored", manifestId, markerId: marker.id, credentialPath };
}

export interface ResetManifest {
  version: 1;
  target: { kind: string; markerId: string; store: string; region: string };
  accounts: { loginName: string; id: string; role: string }[];
  cases: { id: string; status: string; submittedAt: string | null;
    attachments: { id: string; status: string; storageKey: string; sha256: string; byteSize: number;
      storageEnvironment: string; storageStore: string; storageRegion: string; environmentMarkerId: string | null }[];
    snapshots: { id: string; kind: string; revision: number; createdAt: string; evidenceAttachmentIds: string[] }[];
    auditEvents: { id: string; eventType: string; createdAt: string }[] }[];
  objects: { key: string; sha256: string | null; byteSize: number | null; state: "present" | "missing"; scope: "attachment" | "untracked-case-object" }[];
  retentionGuard: { configuredCutoff: string | null; submittedEligible: boolean | null };
  uploadBarrier: { settleMs: number; unresolvedAttachmentIds: string[] };
  plannedAt: string;
}
export interface ResetResult { status: "planned" | "completed" | "partial" | "replayed"; manifestId: string; manifest: ResetManifest; credentialPath?: string }
interface ResetCredentialFile { version: 1; target: string; markerId: string; operationId: string; createdAt: string; credentials: { loginName: string; password: string }[] }

const demoLogins = ["taxpayer-demo-a", "taxpayer-demo-b", "officer-demo"] as const;

async function resetInventory(pool: PgPoolLike, blobs: OperatorBlobIO, marker: EnvironmentMarker, now: Date, settleMs: number): Promise<ResetManifest> {
  const users = await pool.query<{ id: string; login_name: string; role: string }>("SELECT id,login_name,role FROM app_users WHERE login_name=ANY($1::text[]) ORDER BY login_name", [demoLogins]);
  const cases = await pool.query<{ id: string; status: string; submitted_at: Date | string | null }>(
    `SELECT id,status,submitted_at FROM ftc_cases WHERE environment_marker_id=$1 AND owner_id=ANY($2::uuid[]) ORDER BY id`,
    [marker.id, users.rows.map((row) => row.id)]);
  const detail = await Promise.all(cases.rows.map(async (item) => {
    const attachments = await pool.query<{ id: string; status: string; storage_key: string; sha256: string; byte_size: number;
      storage_environment: string; storage_store: string; storage_region: string; environment_marker_id: string | null }>(
      "SELECT id,status,storage_key,sha256,byte_size,storage_environment,storage_store,storage_region,environment_marker_id FROM attachments WHERE case_id=$1 ORDER BY id", [item.id]);
    for (const attachment of attachments.rows) {
      if (attachment.storage_environment !== marker.kind || attachment.storage_store !== marker.storageStore ||
        attachment.storage_region !== marker.storageRegion || attachment.environment_marker_id !== marker.id) {
        throw new Error(`Attachment ${attachment.id} storage identity does not match the active target; reset was refused.`);
      }
    }
    const snapshots = await pool.query<{ id: string; kind: string; revision: number; created_at: Date | string; evidence: unknown }>(
      "SELECT id,kind,revision,created_at,evidence FROM calculation_snapshots WHERE case_id=$1 ORDER BY created_at,id", [item.id]);
    const auditEvents = await pool.query<{ id: string; event_type: string; occurred_at: Date | string }>(
      "SELECT id,event_type,occurred_at FROM audit_events WHERE case_id=$1 ORDER BY occurred_at,id", [item.id]);
    return { id: item.id, status: item.status, submittedAt: item.submitted_at ? new Date(item.submitted_at).toISOString() : null,
      attachments: attachments.rows.map((attachment) => ({ id: attachment.id, status: attachment.status, storageKey: attachment.storage_key,
        sha256: attachment.sha256, byteSize: Number(attachment.byte_size), storageEnvironment: attachment.storage_environment,
        storageStore: attachment.storage_store, storageRegion: attachment.storage_region, environmentMarkerId: attachment.environment_marker_id })),
      snapshots: snapshots.rows.map((snapshot) => ({ id: snapshot.id, kind: snapshot.kind, revision: snapshot.revision,
        createdAt: new Date(snapshot.created_at).toISOString(), evidenceAttachmentIds: Array.isArray(snapshot.evidence)
          ? snapshot.evidence.flatMap((entry) => entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string" ? [entry.id] : []) : [] })),
      auditEvents: auditEvents.rows.map((event) => ({ id: event.id, eventType: event.event_type, createdAt: new Date(event.occurred_at).toISOString() })) };
  }));
  const keys = await blobs.list(marker, "");
  const attachedKeys = new Set(detail.flatMap((item) => item.attachments.map((attachment) => attachment.storageKey)));
  const casePrefixes = cases.rows.map((item) => `cases/${item.id}/`);
  const caseKeys = [...new Set([
    ...keys.map((item) => item.key).filter((key) => casePrefixes.some((prefix) => key.startsWith(prefix))),
    ...detail.flatMap((item) => item.attachments.map((attachment) => attachment.storageKey)),
  ])].sort();
  const objects = await Promise.all(caseKeys.map(async (key) => {
    const bytes = await blobs.get(marker, key);
    return { key, sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
      byteSize: bytes?.byteLength ?? null, state: bytes ? "present" as const : "missing" as const,
      scope: attachedKeys.has(key) ? "attachment" as const : "untracked-case-object" as const };
  }));
  const recentUploads = await pool.query<{ id: string }>(`SELECT a.id FROM attachments a JOIN ftc_cases c ON c.id=a.case_id
    WHERE c.environment_marker_id=$1 AND c.owner_id=ANY($2::uuid[])
      AND (a.status='pending' OR a.created_at > $3::timestamptz - ($4::text || ' milliseconds')::interval) ORDER BY a.id`,
  [marker.id, users.rows.map((row) => row.id), now, settleMs]);
  return { version: 1, target: { kind: marker.kind, markerId: marker.id, store: marker.storageStore, region: marker.storageRegion },
    accounts: users.rows.map((row) => ({ id: row.id, loginName: row.login_name, role: row.role })), cases: detail, objects,
    retentionGuard: { configuredCutoff: null, submittedEligible: null },
    uploadBarrier: { settleMs, unresolvedAttachmentIds: recentUploads.rows.map((row) => row.id) }, plannedAt: now.toISOString() };
}

async function verifiedBackup(path: string, expectedSha: string, marker: EnvironmentMarker, pool: PgPoolLike, injectedPath: boolean): Promise<BackupArtifact> {
  if (!injectedPath) assertPrivateOutputPath(path);
  if (!/^[0-9a-f]{64}$/i.test(expectedSha)) throw new Error("Pass the exact SHA-256 printed for a private backup artifact.");
  let serialized: string;
  try { serialized = await readFile(path, "utf8"); } catch { throw new Error("The private backup artifact could not be read; reset was refused."); }
  if (createHash("sha256").update(serialized).digest("hex") !== expectedSha.toLowerCase()) throw new Error("Backup artifact SHA-256 did not match the explicit confirmation.");
  let artifact: BackupArtifact;
  try { artifact = JSON.parse(serialized) as BackupArtifact; } catch { throw new Error("Backup artifact is invalid; reset was refused."); }
  if (artifact.manifest?.version !== 1 || artifact.manifest.target.markerId !== marker.id || artifact.manifest.target.kind !== marker.kind ||
    artifact.manifest.target.store !== marker.storageStore || artifact.manifest.target.region !== marker.storageRegion ||
    artifact.manifest.target.databaseFingerprint !== marker.databaseFingerprint || !artifact.tables || !Array.isArray(artifact.blobs)) {
    throw new Error("Backup artifact does not cover this exact trusted environment marker.");
  }
  if (!artifact.manifest.tables.every((table) => artifact.tables[table.name]?.length === table.rows) || digest(artifact.tables) !== artifact.manifest.databaseSnapshotSha256) {
    throw new Error("Backup artifact failed table-count or database digest verification.");
  }
  for (const item of artifact.blobs) {
    const bytes = Buffer.from(item.bytesBase64, "base64");
    if (bytes.toString("base64") !== item.bytesBase64 || createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Backup artifact contains an invalid Blob digest.");
    const manifestObject = artifact.manifest.objects.find((object) => object.key === item.key);
    if (!manifestObject || manifestObject.sha256 !== item.sha256 || manifestObject.byteSize !== bytes.length) throw new Error("Backup object inventory does not match its recorded bytes.");
  }
  for (const object of artifact.manifest.objects.filter((item) => item.state === "ready")) {
    if (!artifact.blobs.some((blob) => blob.key === object.key)) throw new Error("Backup is missing a ready evidence object.");
  }
  const currentRows = await readSnapshotTables(pool, marker);
  if (digest(currentRows) !== artifact.manifest.databaseSnapshotSha256) throw new Error("Backup does not match the current database snapshot; create a fresh backup first.");
  return artifact;
}

async function readResetCredential(path: string, marker: EnvironmentMarker, operationId: string): Promise<{ file: ResetCredentialFile; sha256: string } | null> {
  let serialized: string;
  try { serialized = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let file: ResetCredentialFile;
  try { file = JSON.parse(serialized) as ResetCredentialFile; } catch { throw new Error("Private reset recovery file is invalid; no further reset was attempted."); }
  if (file.version !== 1 || file.markerId !== marker.id || file.target !== marker.kind || file.operationId !== operationId ||
    !Array.isArray(file.credentials) || file.credentials.length !== demoLogins.length || demoLogins.some((loginName) => !file.credentials.some((item) => item.loginName === loginName && /^[A-Za-z0-9_-]{40,64}$/.test(item.password)))) {
    throw new Error("Private reset recovery file does not match the confirmed operation and target.");
  }
  return { file, sha256: createHash("sha256").update(serialized).digest("hex") };
}

async function recoverResetBlobs(pool: PgPoolLike, blobs: OperatorBlobIO, marker: EnvironmentMarker, operationId: string, writeOutput: (line: string) => void): Promise<ResetResult["status"]> {
  const reset = await pool.query<{ environment_marker_id: string; manifest_sha256: string; backup_sha256: string | null; case_ids: string[]; blob_keys: string[]; completed_at: Date | string | null }>(
    "SELECT environment_marker_id,manifest_sha256,backup_sha256,case_ids,blob_keys,completed_at FROM operator_demo_resets WHERE operation_id=$1", [operationId]);
  const operation = reset.rows[0];
  if (!operation) throw new Error("Reset operation was not recorded.");
  if (operation.environment_marker_id !== marker.id) throw new Error("Reset operation belongs to a different environment marker.");
  const blobKeys = operation.blob_keys;
  let partial = false;
  for (const key of blobKeys) {
    try {
      const current = await blobs.get(marker, key);
      if (current) await blobs.delete(marker, key);
      if (await blobs.get(marker, key)) partial = true;
    } catch { partial = true; }
  }
  if (!partial) {
    await pool.query("UPDATE operator_demo_resets SET completed_at=coalesce(completed_at,now()) WHERE operation_id=$1", [operationId]);
    writeOutput(`Demo reset completed for operation ${operationId}; submitted records were covered by the verified private backup.`);
    return "completed";
  }
  writeOutput(`Demo reset is recoverable for operation ${operationId}; retry with the same operation ID and private files.`);
  return "partial";
}

class ResetTransactionFailure extends Error { constructor(readonly outcome: "rolled-back" | "unknown", cause: unknown) { super("Reset database transaction did not finish normally.", { cause }); } }
async function resetTransaction<T>(pool: PgPoolLike, work: (client: Awaited<ReturnType<PgPoolLike["connect"]>>) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let committing = false;
  try { await client.query("BEGIN"); const result = await work(client); committing = true; await client.query("COMMIT"); return result; }
  catch (error) {
    if (committing) throw new ResetTransactionFailure("unknown", error);
    try { await client.query("ROLLBACK"); } catch (rollbackError) { throw new ResetTransactionFailure("unknown", rollbackError); }
    throw new ResetTransactionFailure("rolled-back", error);
  } finally { client.release(); }
}

/** Dedicated-demo reset requires marker pinning and a fresh manifest confirmation. */
export async function runResetDemoCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<ResetResult> {
  const options = parseOptions(args, new Set(["--target", "--dry-run", "--confirm", "--operation-id", "--backup", "--backup-sha256", "--retention-cutoff"]));
  const env = dependencies.env ?? process.env;
  const { target, config } = validateTarget(options, env);
  if (target === "production") throw new Error("Demo reset is prohibited in production.");
  const operationId = options.get("--operation-id");
  if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new Error("Demo reset requires an explicit --operation-id UUIDv4 for recovery.");
  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const marker = await requireTargetMarker(pool, config, target);
  if (env.FTC_DEMO_RESET_MARKER_ID !== marker.id) throw new Error("FTC_DEMO_RESET_MARKER_ID must exactly match the active dedicated-demo marker.");
  const prior = await pool.query<{ manifest_sha256: string; credential_file_sha256: string; completed_at: Date | string | null; backup_sha256: string | null }>(
    "SELECT manifest_sha256,credential_file_sha256,completed_at,backup_sha256 FROM operator_demo_resets WHERE operation_id=$1 AND environment_marker_id=$2", [operationId, marker.id]);
  const credentialPath = dependencies.credentialsPath ?? dependencies.artifactPath?.("demo-reset", operationId) ?? resolve(homedir(), ".ftc-private", `demo-reset-${operationId}.json`);
  const recovery = await readResetCredential(credentialPath, marker, operationId);
  const blobs = operatorBlobIO(marker, env, dependencies.blobs);
  requireStrongBlobReads(blobs);
  const output = dependencies.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (prior.rows[0]) {
    if (!recovery || recovery.sha256 !== prior.rows[0].credential_file_sha256) throw new Error("Reset database outcome is recorded but the exact private credential file is missing or changed; restore that file before retrying.");
    const stored = await pool.query<{ login_name: string; password_hash: string }>("SELECT login_name,password_hash FROM app_users WHERE login_name=ANY($1::text[])", [demoLogins]);
    for (const credential of recovery.file.credentials) {
      const account = stored.rows.find((item) => item.login_name === credential.loginName);
      if (!account || !await verifyPassword(credential.password, account.password_hash)) throw new Error("Reset credential file was superseded; use the current operation record.");
    }
    if (!prior.rows[0].completed_at && prior.rows[0].backup_sha256) {
      const backupPath = options.get("--backup");
      const backupHash = options.get("--backup-sha256");
      if (!backupPath || backupHash?.toLowerCase() !== prior.rows[0].backup_sha256) throw new Error("Incomplete reset recovery requires the same verified backup file and SHA-256 used for the operation.");
      if (!dependencies.credentialsPath && !dependencies.artifactPath) assertPrivateOutputPath(resolve(backupPath));
      let backupBytes: string;
      try { backupBytes = await readFile(resolve(backupPath), "utf8"); } catch { throw new Error("The reset backup recovery file is missing; restore it before retrying Blob cleanup."); }
      if (createHash("sha256").update(backupBytes).digest("hex") !== prior.rows[0].backup_sha256) throw new Error("The reset backup recovery file changed; Blob cleanup was not retried.");
    }
    const status = prior.rows[0].completed_at ? "replayed" : await recoverResetBlobs(pool, blobs, marker, operationId, output);
    return { status, manifestId: prior.rows[0].manifest_sha256, manifest: { version: 1,
      target: { kind: marker.kind, markerId: marker.id, store: marker.storageStore, region: marker.storageRegion },
      accounts: [], cases: [], objects: [], retentionGuard: { configuredCutoff: null, submittedEligible: null },
      uploadBarrier: { settleMs: 0, unresolvedAttachmentIds: [] }, plannedAt: new Date().toISOString() }, credentialPath };
  }
  const settleMs = Number(env.FTC_UPLOAD_SETTLE_MS);
  if (!Number.isSafeInteger(settleMs) || settleMs < 0) throw new Error("FTC_UPLOAD_SETTLE_MS must be explicitly configured as a non-negative integer before demo reset.");
  const manifest = await resetInventory(pool, blobs, marker, (dependencies.now ?? (() => new Date()))(), settleMs);
  const configuredCutoff = env.FTC_DEMO_RETENTION_CUTOFF ?? null;
  const submittedCases = manifest.cases.filter((item) => item.status === "submitted");
  const cutoffTime = configuredCutoff ? Date.parse(configuredCutoff) : Number.NaN;
  manifest.retentionGuard = { configuredCutoff,
    submittedEligible: submittedCases.length ? Number.isFinite(cutoffTime) && submittedCases.every((item) => Boolean(item.submittedAt && Date.parse(item.submittedAt) <= cutoffTime)) : null };
  if (manifest.accounts.length !== demoLogins.length || demoLogins.some((login) => !manifest.accounts.some((account) => account.loginName === login))) {
    throw new Error("Dedicated-demo reset requires all three expected fictional accounts to be present.");
  }
  const manifestId = digest({ ...manifest, plannedAt: undefined });
  const confirming = options.has("--confirm");
  if (confirming === options.has("--dry-run")) throw new Error("Choose exactly one of --dry-run or --confirm <manifest-id>.");
  if (!confirming) {
    await writeReviewManifest("demo-reset", manifestId, manifest, dependencies, output);
    return { status: "planned", manifestId, manifest };
  }
  if (options.get("--confirm") !== manifestId) throw new Error("Demo reset scope changed; review a new dry-run manifest.");
  if (manifest.uploadBarrier.unresolvedAttachmentIds.length) throw new Error("Recent or pending uploads have not passed the configured settle period; wait, inspect, and run a fresh dry run.");
  let retentionCutoff: Date | null = null;
  const submitted = manifest.cases.filter((item) => item.status === "submitted");
  let backupSha256: string | null = null;
  if (submitted.length) {
    const configured = env.FTC_DEMO_RETENTION_CUTOFF;
    const supplied = options.get("--retention-cutoff");
    if (!configured || !supplied || configured !== supplied || !Number.isFinite(Date.parse(configured))) throw new Error("Submitted demo records require an exact FTC_DEMO_RETENTION_CUTOFF value passed again with --retention-cutoff.");
    retentionCutoff = new Date(configured);
    if (submitted.some((item) => !item.submittedAt || new Date(item.submittedAt) > retentionCutoff!)) throw new Error("A submitted demo case is newer than the configured retention cutoff; reset was refused.");
  }
  const backupPath = options.get("--backup"); const backupHash = options.get("--backup-sha256");
  if (!backupPath || !backupHash) throw new Error("Every whole-demo reset requires a verified complete backup with its exact private path and SHA-256.");
  const artifact = await verifiedBackup(resolve(backupPath), backupHash, marker, pool, Boolean(dependencies.credentialsPath || dependencies.artifactPath));
  backupSha256 = backupHash.toLowerCase();
  const backedCases = artifact.tables.ftc_cases ?? [];
  if (!manifest.cases.every((item) => backedCases.some((row) => row.id === item.id && row.environment_marker_id === marker.id))) {
    throw new Error("Verified backup does not contain the complete scoped demo cases.");
  }
  const passwords = await Promise.all(demoLogins.map(async (loginName) => ({ loginName, password: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` })));
  const file: ResetCredentialFile = { version: 1, target, markerId: marker.id, operationId, createdAt: (dependencies.now ?? (() => new Date()))().toISOString(), credentials: passwords };
  let created = false;
  try { await writePrivateFile(credentialPath, `${JSON.stringify(file, null, 2)}\n`); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const resetFile = await readResetCredential(credentialPath, marker, operationId);
  if (!resetFile) throw new Error("Private reset credential recovery file could not be verified.");
  const hashes = await Promise.all(resetFile.file.credentials.map(async (item) => ({ ...item, hash: await hashPassword(item.password) })));
  try {
    await resetTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ftc-demo-reset'))");
      await client.query("LOCK TABLE app_users,user_sessions,ftc_cases,attachments,foreign_income_sources,remittances,exchange_rate_references,officer_case_assignments,audit_events,api_mutation_requests,calculation_snapshots IN SHARE ROW EXCLUSIVE MODE");
      const fresh = await resetInventory(pool, blobs, marker, (dependencies.now ?? (() => new Date()))(), settleMs);
      const freshSubmitted = fresh.cases.filter((item) => item.status === "submitted");
      const freshCutoff = env.FTC_DEMO_RETENTION_CUTOFF ?? null;
      const freshCutoffTime = freshCutoff ? Date.parse(freshCutoff) : Number.NaN;
      fresh.retentionGuard = { configuredCutoff: freshCutoff,
        submittedEligible: freshSubmitted.length ? Number.isFinite(freshCutoffTime) && freshSubmitted.every((item) => Boolean(item.submittedAt && Date.parse(item.submittedAt) <= freshCutoffTime)) : null };
      if (digest({ ...fresh, plannedAt: undefined }) !== manifestId) throw new Error("Demo reset scope changed while awaiting the transaction barrier.");
      const caseIds = manifest.cases.map((item) => item.id);
      const blobRows = await client.query<{ storage_key: string }>("SELECT a.storage_key FROM attachments a WHERE a.case_id=ANY($1::uuid[]) ORDER BY a.storage_key", [caseIds]);
      await client.query("INSERT INTO operator_demo_resets(operation_id,environment_marker_id,manifest_sha256,backup_sha256,retention_cutoff,case_ids,blob_keys,credential_file_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [operationId, marker.id, manifestId, backupSha256, retentionCutoff, caseIds, blobRows.rows.map((row) => row.storage_key), resetFile.sha256]);
      await client.query("SELECT set_config('ftc.demo_reset_operation',$1,true)", [operationId]);
      for (const account of demoLogins) {
        const hash = hashes.find((item) => item.loginName === account)!.hash;
        await client.query("UPDATE app_users SET password_hash=$2,updated_at=now() WHERE login_name=$1 AND active=true", [account, hash]);
      }
      await client.query("DELETE FROM user_sessions WHERE sess ->> 'userId'=ANY($1::text[])", [manifest.accounts.map((item) => item.id)]);
      await client.query("UPDATE ftc_cases SET status='draft',submitted_snapshot_id=NULL,submitted_at=NULL WHERE id=ANY($1::uuid[]) AND status='submitted'", [caseIds]);
      for (const table of ["attachments", "exchange_rate_references", "remittances", "foreign_income_sources", "officer_case_assignments", "audit_events", "api_mutation_requests", "calculation_snapshots"]) {
        await client.query(`DELETE FROM ${table} WHERE case_id=ANY($1::uuid[])`, [caseIds]);
      }
      await client.query("DELETE FROM ftc_cases WHERE id=ANY($1::uuid[])", [caseIds]);
    });
  } catch (error) {
    if (created && error instanceof ResetTransactionFailure && error.outcome === "rolled-back") await unlink(credentialPath).catch(() => undefined);
    if (error instanceof ResetTransactionFailure && error.outcome === "unknown") throw new Error(`Database commit outcome is uncertain. Retain private recovery file at ${credentialPath} and retry operation ${operationId}.`);
    throw error;
  }
  const status = await recoverResetBlobs(pool, blobs, marker, operationId, output);
  return { status, manifestId, manifest, credentialPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && ["cleanup", "preview-init", "backup", "reset-demo", "restore"].includes(process.argv[2] ?? "")) {
  try {
    const command = process.argv[2];
    if (command === "cleanup") await runCleanupCommand(process.argv.slice(3));
    else if (command === "preview-init") await runPreviewInitializationCommand(process.argv.slice(3));
    else if (command === "backup") await runBackupCommand(process.argv.slice(3));
    else if (command === "reset-demo") await runResetDemoCommand(process.argv.slice(3));
    else await runRestoreRehearsalCommand(process.argv.slice(3));
  }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Operator command failed."}\n`); process.exitCode = 1; }
}
