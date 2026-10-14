import { randomBytes, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, chmod, unlink, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { getDatabase } from "@netlify/database";
import { ensureEnvironmentMarker, resolveRuntimeEnvironmentConfig, type RuntimeEnvironmentConfig } from "../runtime/environment.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import type { PgPoolLike, PgQueryable } from "../postgres.js";

const execFile = promisify(execFileCallback);
const accounts = [
  { loginName: "taxpayer-demo-a", displayName: "ผู้เสียภาษีตัวอย่าง ก", role: "taxpayer", maskedReference: "***-1001" },
  { loginName: "taxpayer-demo-b", displayName: "ผู้เสียภาษีตัวอย่าง ข", role: "taxpayer", maskedReference: "***-1002" },
  { loginName: "officer-demo", displayName: "เจ้าหน้าที่ตัวอย่าง", role: "officer", maskedReference: null },
] as const;

type OperatorAction = "seed" | "rotate";
type TargetEnvironment = RuntimeEnvironmentConfig["kind"];

interface CredentialRecord {
  loginName: string;
  password: string;
}

interface CredentialFile {
  environment: TargetEnvironment;
  environmentMarkerId: string;
  createdAt: string;
  operationId?: string;
  credentials: CredentialRecord[];
  FTC_OFFICER_USER_ID?: string;
}

interface OperatorDependencies {
  pool?: PgPoolLike;
  env?: NodeJS.ProcessEnv;
  credentialsPath?: string;
  writeOutput?: (message: string) => void;
  now?: () => Date;
}

class OperatorTransactionFailure extends Error {
  constructor(readonly outcome: "rolled-back" | "unknown", cause: unknown) {
    super("The operator database transaction did not complete normally.", { cause });
  }
}

function safeTransactionError(error: unknown, credentialPath?: string): Error {
  if (error instanceof OperatorTransactionFailure && error.outcome === "unknown" && credentialPath) {
    return new Error(`Database outcome is uncertain. The private credential recovery file was retained at ${credentialPath}; inspect the target before retrying.`);
  }
  if (error instanceof OperatorTransactionFailure && error.outcome === "rolled-back") {
    return new Error("The operator transaction was rolled back; no account or credential change was committed.");
  }
  return error instanceof Error ? error : new Error("Operator command failed.");
}

function parseArguments(args: string[]): { action: OperatorAction; target: TargetEnvironment; loginName?: string; operationId?: string } {
  const [action, ...rest] = args;
  if (action !== "seed" && action !== "rotate") throw new Error("Use `seed` or `rotate` as the operator action.");
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith("--")) throw new Error("Operator options must use named flags.");
    const value = rest[index + 1];
    if (!value || value.startsWith("--") || values.has(key)) throw new Error(`Invalid or repeated option: ${key}`);
    values.set(key, value);
    index += 1;
  }
  const target = values.get("--target");
  if (target !== "local" && target !== "preview" && target !== "production") {
    throw new Error("Pass an explicit --target local, preview, or production.");
  }
  const loginName = values.get("--login");
  const operationId = values.get("--operation-id");
  if (action === "rotate" && (!loginName || !accounts.some((account) => account.loginName === loginName))) {
    throw new Error("Rotation requires --login with one of the three fictional demo accounts.");
  }
  if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error("--operation-id must be a UUIDv4.");
  }
  for (const key of values.keys()) {
    if (key !== "--target" && key !== "--login" && key !== "--operation-id") throw new Error(`Unknown option: ${key}`);
  }
  if (action === "seed" && (loginName || operationId)) throw new Error("Seed does not accept --login or --operation-id.");
  return { action, target, ...(loginName ? { loginName } : {}), ...(operationId ? { operationId } : {}) };
}

function poolFromEnvironment(env: NodeJS.ProcessEnv): PgPoolLike {
  if (!env.NETLIFY_DB_URL) throw new Error("NETLIFY_DB_URL is required; start the trusted Netlify database environment first.");
  return getDatabase({ connectionString: env.NETLIFY_DB_URL }).pool as unknown as PgPoolLike;
}

function credentialsPathFor(action: OperatorAction, target: TargetEnvironment, loginName?: string, operationId?: string, now = new Date()): string {
  const safeName = loginName?.replace(/[^a-z0-9-]/gi, "") ?? "all-demo-accounts";
  if (action === "rotate" && operationId) return resolve(homedir(), ".ftc-private", `demo-rotate-${safeName}-${operationId}.json`);
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "");
  return resolve(homedir(), ".ftc-private", `demo-${action}-${target}-${safeName}-${stamp}.json`);
}

async function readRotationCredential(path: string, target: TargetEnvironment, markerId: string, loginName: string, operationId: string): Promise<CredentialFile | null> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("The existing private rotation file is invalid; no database change was made.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("The existing private rotation file is invalid; no database change was made.");
  const file = parsed as CredentialFile;
  if (!Array.isArray(file.credentials) || file.environment !== target || file.environmentMarkerId !== markerId || file.operationId !== operationId ||
    file.credentials.length !== 1 || file.credentials[0]?.loginName !== loginName ||
    !/^[A-Za-z0-9_-]{32}$/.test(file.credentials[0]?.password ?? "")) {
    throw new Error("The existing private rotation file does not match this operation and target; no database change was made.");
  }
  return file;
}

async function secureCredentialWrite(path: string, payload: CredentialFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let created = false;
  try {
    const handle = await open(path, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(path, 0o600);
    if (process.platform === "win32") {
      const username = process.env.USERNAME;
      if (!username) throw new Error("USERNAME is required to protect the generated credential file with a Windows ACL.");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
      await execFile("icacls", [path, "/inheritance:r", "/grant:r", `${principal}:(F)`], { windowsHide: true });
    }
  } catch (error) {
    if (created) await unlink(path).catch(() => undefined);
    throw error;
  }
}

async function withTransaction<T>(pool: PgPoolLike, work: (client: PgQueryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    commitAttempted = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (commitAttempted) throw new OperatorTransactionFailure("unknown", error);
    try {
      await client.query("ROLLBACK");
      throw new OperatorTransactionFailure("rolled-back", error);
    } catch (rollbackError) {
      if (rollbackError instanceof OperatorTransactionFailure) throw rollbackError;
      throw new OperatorTransactionFailure("unknown", rollbackError);
    }
  } finally {
    client.release();
  }
}

function writeSafeSummary(writeOutput: (message: string) => void, message: string): void {
  writeOutput(message);
}

async function seedAccounts(
  pool: PgPoolLike,
  target: TargetEnvironment,
  markerId: string,
  path: string,
  now: () => Date,
): Promise<{ created: string[]; credentialPath?: string; officerId: string }> {
  const generated = await Promise.all(accounts.map(async (account) => {
    const password = randomBytes(24).toString("base64url");
    return { account, password, passwordHash: await hashPassword(password) };
  }));

  let credentialFileCreated = false;
  try {
    const result = await withTransaction(pool, async (client) => {
      const created: CredentialRecord[] = [];
      const ids = new Map<string, string>();
      for (const { account, password, passwordHash } of generated) {
        const id = randomUUID();
        const inserted = await client.query<{ id: string; role: string }>(
          `INSERT INTO app_users (id, login_name, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (login_name) DO NOTHING RETURNING id, role`,
          [id, account.loginName, account.displayName, passwordHash, account.role],
        );
        const existing = inserted.rows[0] ?? (await client.query<{ id: string; role: string; active: boolean }>(
          "SELECT id, role, active FROM app_users WHERE login_name = $1 FOR UPDATE", [account.loginName],
        )).rows[0];
        if (!existing || existing.role !== account.role || ("active" in existing && !existing.active)) {
          throw new Error(`Existing demo account ${account.loginName} has an unexpected or inactive identity; refusing to change it.`);
        }
        ids.set(account.loginName, existing.id);
        if (inserted.rows[0]) {
          created.push({ loginName: account.loginName, password });
          if (account.role === "taxpayer") {
            await client.query(
              "INSERT INTO user_profiles(user_id, masked_reference) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
              [existing.id, account.maskedReference],
            );
          }
        }
      }
      const officerId = ids.get("officer-demo");
      if (!officerId) throw new Error("Seeded officer identity could not be resolved.");
      if (created.length > 0) {
        const payload: CredentialFile = {
          environment: target,
          environmentMarkerId: markerId,
          createdAt: now().toISOString(),
          credentials: created,
          FTC_OFFICER_USER_ID: officerId,
        };
        await secureCredentialWrite(path, payload);
        credentialFileCreated = true;
      }
      return { created: created.map((credential) => credential.loginName), officerId };
    });
    return { ...result, ...(credentialFileCreated ? { credentialPath: path } : {}) };
  } catch (error) {
    if (credentialFileCreated && error instanceof OperatorTransactionFailure && error.outcome === "rolled-back") {
      await unlink(path).catch(() => undefined);
    }
    throw safeTransactionError(error, credentialFileCreated ? path : undefined);
  }
}

async function rotateAccount(
  pool: PgPoolLike,
  target: TargetEnvironment,
  markerId: string,
  loginName: string,
  operationId: string,
  path: string,
  now: () => Date,
): Promise<{ path: string; replayed: boolean }> {
  const operationResult = await pool.query<{ user_id: string; environment_marker_id: string }>(
    "SELECT user_id, environment_marker_id FROM operator_credential_rotations WHERE operation_id=$1", [operationId],
  );
  const priorOperation = operationResult.rows[0];
  const existingCredential = await readRotationCredential(path, target, markerId, loginName, operationId);
  if (priorOperation) {
    const user = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM app_users WHERE login_name=$1 AND active=true", [loginName],
    );
    if (priorOperation.environment_marker_id !== markerId || priorOperation.user_id !== user.rows[0]?.id) {
      throw new Error("This rotation operation ID belongs to a different account or environment; choose a new ID for a new rotation.");
    }
    if (!existingCredential) {
      throw new Error(`Rotation ${operationId} is already committed, but its private credential file is missing. Recover that file before acting on this account; do not repeat the rotation with this ID.`);
    }
    if (!await verifyPassword(existingCredential.credentials[0]!.password, user.rows[0]!.password_hash)) {
      throw new Error(`Rotation ${operationId} has been superseded by a later rotation. Its old credential file is not current; use a new operation ID only for a deliberate rotation.`);
    }
    return { path, replayed: true };
  }

  const password = existingCredential?.credentials[0]?.password ?? randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const credentialFileCreated = !existingCredential;
  if (credentialFileCreated) {
    await secureCredentialWrite(path, {
      environment: target,
      environmentMarkerId: markerId,
      operationId,
      createdAt: now().toISOString(),
      credentials: [{ loginName, password }],
    });
  }
  try {
    const replayed = await withTransaction(pool, async (client) => {
      const account = await client.query<{ id: string; role: string; active: boolean; password_hash: string }>(
        "SELECT id, role, active, password_hash FROM app_users WHERE login_name=$1 FOR UPDATE", [loginName],
      );
      const user = account.rows[0];
      if (!user || !user.active || user.role !== "taxpayer") throw new Error(`Active demo taxpayer ${loginName} was not found; no password was changed.`);
      const prior = await client.query<{ user_id: string; environment_marker_id: string }>(
        "SELECT user_id, environment_marker_id FROM operator_credential_rotations WHERE operation_id=$1 FOR UPDATE", [operationId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].user_id !== user.id || prior.rows[0].environment_marker_id !== markerId ||
          !await verifyPassword(password, user.password_hash)) {
          throw new Error("This rotation operation ID was already used; refusing to overwrite a later credential change.");
        }
        return true;
      }
      await client.query("UPDATE app_users SET password_hash=$2, updated_at=now() WHERE id=$1", [user.id, passwordHash]);
      await client.query("DELETE FROM user_sessions WHERE sess ->> 'userId' = $1", [user.id]);
      await client.query(
        "INSERT INTO operator_credential_rotations(operation_id, environment_marker_id, user_id) VALUES ($1,$2,$3)",
        [operationId, markerId, user.id],
      );
      return false;
    });
    return { path, replayed };
  } catch (error) {
    if (credentialFileCreated && error instanceof OperatorTransactionFailure && error.outcome === "rolled-back") {
      await unlink(path).catch(() => undefined);
    }
    throw safeTransactionError(error, credentialFileCreated ? path : undefined);
  }
}

/** Public operator-command seam, also used by the CLI entry point. */
export async function runBootstrapCommand(args: string[], dependencies: OperatorDependencies = {}): Promise<void> {
  const parsed = parseArguments(args);
  const env = dependencies.env ?? process.env;
  const runtime = resolveRuntimeEnvironmentConfig(env);
  if (runtime.kind !== parsed.target) {
    throw new Error(`Target mismatch: requested ${parsed.target}, trusted runtime identifies ${runtime.kind}. No database changes were made.`);
  }
  const pool = dependencies.pool ?? poolFromEnvironment(env);
  const marker = await ensureEnvironmentMarker(pool, runtime);
  if (marker.kind !== parsed.target) throw new Error("The database environment marker does not match the explicit target.");
  const writeOutput = dependencies.writeOutput ?? ((message: string) => process.stdout.write(`${message}\n`));
  const now = dependencies.now ?? (() => new Date());
  const operationId = parsed.action === "rotate" ? parsed.operationId ?? randomUUID() : undefined;
  const path = dependencies.credentialsPath ?? credentialsPathFor(parsed.action, parsed.target, parsed.loginName, operationId, now());
  if (parsed.action === "seed") {
    const result = await seedAccounts(pool, parsed.target, marker.id, path, now);
    if (result.created.length === 0) {
      writeSafeSummary(writeOutput, `All three fictional accounts already exist; credentials and cases were preserved. FTC_OFFICER_USER_ID=${result.officerId}`);
    } else {
      writeSafeSummary(writeOutput, `Created ${result.created.length} fictional account(s): ${result.created.join(", ")}. FTC_OFFICER_USER_ID=${result.officerId}. Private credentials: ${result.credentialPath}`);
    }
    return;
  }
  const loginName = parsed.loginName as string;
  const rotation = await rotateAccount(pool, parsed.target, marker.id, loginName, operationId as string, path, now);
  const verb = rotation.replayed ? "Reused completed rotation" : "Rotated credentials and invalidated existing sessions";
  writeSafeSummary(writeOutput, `${verb} for ${loginName}. Operation ID: ${operationId}. Private credentials: ${rotation.path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runBootstrapCommand(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Operator command failed."}\n`);
    process.exitCode = 1;
  }
}
