import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createApp } from "../../server/app.js";
import { runBootstrapCommand } from "../../server/scripts/bootstrap.js";
import type { BlobIO } from "../../server/storage/blob-io.js";
import { resolveRuntimeEnvironmentConfig } from "../../server/runtime/environment.js";
import type { EnvironmentMarker } from "../../server/runtime/environment.js";
import type { PgPoolLike, PgQueryable } from "../../server/postgres.js";

class PGlitePool implements PgPoolLike {
  constructor(private readonly database: PGlite) {}

  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values)
      .then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }

  async connect(): Promise<PgQueryable> {
    return { query: (text, values, callback) => this.query(text, values, callback), release: () => undefined };
  }
}

class MemoryBlobIO implements BlobIO {
  private readonly objects = new Map<string, Uint8Array>();
  private objectKey(marker: EnvironmentMarker, key: string) { return `${marker.id}:${key}`; }

  async put(marker: EnvironmentMarker, key: string, bytes: Uint8Array) {
    const objectKey = this.objectKey(marker, key);
    const existing = this.objects.get(objectKey);
    if (existing && Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
      throw new Error("Reserved evidence key already contains different bytes.");
    }
    this.objects.set(objectKey, new Uint8Array(bytes));
  }

  async get(marker: EnvironmentMarker, key: string) {
    const bytes = this.objects.get(this.objectKey(marker, key));
    return bytes ? new Uint8Array(bytes) : null;
  }

  async delete(marker: EnvironmentMarker, key: string) {
    this.objects.delete(this.objectKey(marker, key));
  }
}

function safeRunPaths() {
  const directory = process.env.FTC_REAL_BROWSER_RUN_DIRECTORY;
  const credentialsFile = process.env.FTC_REAL_BROWSER_CREDENTIALS_FILE;
  const runToken = process.env.FTC_REAL_BROWSER_RUN_TOKEN;
  const expectedTemporaryRoot = resolve(tmpdir()) + sep;
  if (!directory || !isAbsolute(directory) || resolve(dirname(credentialsFile ?? "")) !== resolve(directory) ||
      basename(directory) !== basename(resolve(directory)) || !/^ftc-real-backend-browser-\d+$/.test(basename(directory)) ||
      !resolve(directory).startsWith(expectedTemporaryRoot) || credentialsFile !== join(directory, "credentials.json") ||
      !runToken || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runToken)) {
    throw new Error("The real-backend acceptance requires its exact private temporary credential path.");
  }
  return { directory, credentialsFile, runToken };
}

async function preparePrivateRunDirectory(directory: string, runToken: string) {
  await mkdir(directory, { recursive: false, mode: 0o700 });
  try {
    await writeFile(join(directory, ".ftc-run-owner"), runToken, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const { directory, credentialsFile, runToken } = safeRunPaths();
  const port = Number(process.env.PORT);
  const webOrigin = process.env.FTC_REAL_WEB_ORIGIN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !webOrigin || new URL(webOrigin).hostname !== "127.0.0.1") {
    throw new Error("The real-backend acceptance server needs its local API and browser origins.");
  }
  await preparePrivateRunDirectory(directory, runToken);
  const database = new PGlite();
  const pool = new PGlitePool(database);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FTC_DEPLOYMENT_CONTEXT: "dev",
    FTC_BLOB_REGION: "us-east-2",
    NETLIFY_DB_URL: "postgres://local-user:local-password@127.0.0.1/ftc-real-browser",
    SESSION_SECRET: "local-real-backend-browser-only-session-secret-not-a-deployed-secret",
    FTC_ALLOWED_ORIGIN: webOrigin,
  };
  let server: Server | undefined;
  let closePromise: Promise<void> | undefined;
  try {
    const migrationsDirectory = resolve("netlify/database/migrations");
    const migrations = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    if (migrations.length === 0) throw new Error("Acceptance did not find committed SQL migrations.");
    for (const migration of migrations) await database.exec(await readFile(join(migrationsDirectory, migration), "utf8"));

    const environment = resolveRuntimeEnvironmentConfig(env);
    await runBootstrapCommand(["seed", "--target", "local"], {
      pool,
      env,
      credentialsPath: credentialsFile,
      writeOutput: () => undefined,
    });
    const credentialFile = JSON.parse(await readFile(credentialsFile, "utf8")) as { FTC_OFFICER_USER_ID?: string };
    if (!credentialFile.FTC_OFFICER_USER_ID) throw new Error("The private operator seed did not return an officer identity.");
    const app = createApp({
      pool,
      sessionSecret: env.SESSION_SECRET!,
      allowedOrigin: webOrigin,
      trustedHttps: false,
      environment,
      blobIO: new MemoryBlobIO(),
      officerUserId: credentialFile.FTC_OFFICER_USER_ID,
    });
    server = app.listen(port, "127.0.0.1");

    const close = () => {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolveClose) => {
        server?.close(() => resolveClose());
      }).then(async () => {
        await database.close();
        await rm(directory, { recursive: true, force: true });
      });
      return closePromise;
    };
    process.once("SIGTERM", () => { void close().finally(() => { process.exitCode = 0; }); });
    process.once("SIGINT", () => { void close().finally(() => { process.exitCode = 0; }); });
    process.once("beforeExit", () => { void close(); });
  } catch (error) {
    await database.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "unknown startup error";
    throw new Error(`Real-backend browser acceptance startup failed: ${message}`);
  }
}

await main();
