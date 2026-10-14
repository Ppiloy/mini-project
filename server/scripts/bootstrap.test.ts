import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { PgPoolLike, PgQueryable } from "../postgres.js";
import { resolveRuntimeEnvironmentConfig } from "../runtime/environment.js";
import { runBootstrapCommand } from "./bootstrap.js";

class PGlitePool implements PgPoolLike {
  constructor(private readonly database: PGlite) {}

  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) operation.then((result) => callback(null, result), (error: Error) => callback(error));
    return operation;
  }

  async connect(): Promise<PgQueryable> {
    return {
      query: (text, values, callback) => this.query(text, values, callback),
      release: () => undefined,
    };
  }
}

class LostCommitAcknowledgementPool extends PGlitePool {
  private loseNextAccountCommit = false;
  private armForAccountWrite: RegExp | null;

  constructor(database: PGlite, trigger: RegExp | null = null) {
    super(database);
    this.armForAccountWrite = trigger;
  }

  armNextCommitOnAccountInsert(): void {
    this.armForAccountWrite = /INSERT INTO app_users/i;
  }

  armNextCommitOnAccountUpdate(): void {
    this.armForAccountWrite = /UPDATE app_users/i;
  }

  override async connect(): Promise<PgQueryable> {
    const client = await super.connect();
    return {
      query: async (text, values, callback) => {
        const result = await client.query(text, values, callback);
        if (this.armForAccountWrite?.test(text)) {
          this.loseNextAccountCommit = true;
          this.armForAccountWrite = null;
        }
        if (text.trim().toUpperCase() === "COMMIT" && this.loseNextAccountCommit) {
          this.loseNextAccountCommit = false;
          throw new Error("simulated lost COMMIT acknowledgement after the database committed");
        }
        return result;
      },
      release: () => client.release(),
    };
  }
}

class RollbackBeforeRotationCommitPool extends PGlitePool {
  failSessionInvalidation = false;

  override async connect(): Promise<PgQueryable> {
    const client = await super.connect();
    return {
      query: (text, values, callback) => {
        if (this.failSessionInvalidation && /^\s*DELETE FROM user_sessions/i.test(text)) {
          this.failSessionInvalidation = false;
          return Promise.reject(new Error("simulated pre-commit session invalidation failure"));
        }
        return client.query(text, values, callback);
      },
      release: () => client.release(),
    };
  }
}

const origin = "https://ftc.example.test";
const env: NodeJS.ProcessEnv = {
  FTC_DEPLOYMENT_CONTEXT: "dev",
  FTC_BLOB_REGION: "us-east-2",
  NETLIFY_DB_URL: "postgres://local-user:local-password@127.0.0.1/ftc-local",
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function setup(poolFactory?: (database: PGlite) => PgPoolLike) {
  const database = new PGlite();
  cleanups.push(() => database.close());
  for (const name of (await readdir("netlify/database/migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    await database.exec(await readFile(join("netlify/database/migrations", name), "utf8"));
  }
  const pool = poolFactory?.(database) ?? new PGlitePool(database);
  const credentialDirectory = await mkdtemp(join(tmpdir(), "ftc-bootstrap-"));
  cleanups.push(() => rm(credentialDirectory, { recursive: true, force: true }));
  const app = createApp({ pool, sessionSecret: "test-only-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false,
    environment: resolveRuntimeEnvironmentConfig(env) });
  const output: string[] = [];
  const run = (args: string[], file = join(credentialDirectory, `credentials-${output.length}.json`)) => runBootstrapCommand(args, {
    pool,
    env,
    credentialsPath: file,
    writeOutput: (message) => output.push(message),
    now: () => new Date("2026-10-14T00:00:00.000Z"),
  });
  return { app, pool, credentialDirectory, output, run };
}

async function login(app: ReturnType<typeof createApp>, loginName: string, password: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").set("Origin", origin).send({ loginName, password });
  return { agent, response };
}

describe("fictional account bootstrap operator command", () => {
  it("requires a matching explicit target before it writes to the database", async () => {
    const { pool, run } = await setup();
    await expect(run(["seed"])).rejects.toThrow("explicit --target");
    await expect(run(["seed", "--target", "production"])).rejects.toThrow("Target mismatch");
    expect((await pool.query("SELECT count(*)::int AS count FROM app_users")).rows[0]?.count).toBe(0);
  });

  it("seeds private scrypt credentials once, preserves password and case on rerun, and never prints secrets", async () => {
    const { app, pool, run, output, credentialDirectory } = await setup();
    const credentialFile = join(credentialDirectory, "seed.json");
    await run(["seed", "--target", "local"], credentialFile);
    const initial = JSON.parse(await readFile(credentialFile, "utf8")) as {
      credentials: Array<{ loginName: string; password: string }>;
      FTC_OFFICER_USER_ID: string;
    };
    const taxpayer = initial.credentials.find((value) => value.loginName === "taxpayer-demo-a");
    expect(taxpayer).toBeDefined();
    const signedIn = await login(app, "taxpayer-demo-a", taxpayer?.password ?? "");
    expect(signedIn.response.status).toBe(200);
    const createdCase = await signedIn.agent.post("/api/cases").set("Origin", origin)
      .set("X-CSRF-Token", signedIn.response.body.data.csrfToken).send({ requestId: "bootstrapped-case-01" });
    expect(createdCase.status).toBe(201);

    await run(["seed", "--target", "local"], join(credentialDirectory, "must-not-be-created.json"));
    expect(await readdir(credentialDirectory)).toEqual(["seed.json"]);
    expect((await signedIn.agent.get("/api/cases").set("Origin", origin)).body.data.cases.map((item: { id: string }) => item.id)).toContain(createdCase.body.data.case.id);
    expect((await login(app, "taxpayer-demo-a", taxpayer?.password ?? "")).response.status).toBe(200);
    expect((await pool.query("SELECT id FROM app_users WHERE login_name='officer-demo'")).rows[0]?.id).toBe(initial.FTC_OFFICER_USER_ID);
    expect(output.join("\n")).not.toContain(taxpayer?.password);
    expect(output.join("\n")).not.toContain('"password"');
  });

  it("rotates one demo credential, invalidates existing sessions, and verifies old and new HTTP logins", async () => {
    const { app, run, output, credentialDirectory } = await setup();
    await run(["seed", "--target", "local"], join(credentialDirectory, "seed.json"));
    const seedFile = JSON.parse(await readFile(join(credentialDirectory, "seed.json"), "utf8")) as {
      credentials: Array<{ loginName: string; password: string }>;
    };
    const oldPassword = seedFile.credentials.find((value) => value.loginName === "taxpayer-demo-b")?.password ?? "";
    const existing = await login(app, "taxpayer-demo-b", oldPassword);
    expect(existing.response.status).toBe(200);

    const rotatedFile = join(credentialDirectory, "rotated.json");
    const operationId = "8757e5a5-398f-4c8d-86c1-792299ca35bc";
    const rotateArgs = ["rotate", "--target", "local", "--login", "taxpayer-demo-b", "--operation-id", operationId];
    await run(rotateArgs, rotatedFile);
    const rotated = JSON.parse(await readFile(rotatedFile, "utf8")) as { credentials: Array<{ password: string }> };
    const newPassword = rotated.credentials[0]?.password ?? "";
    await expect(existing.agent.get("/api/auth/session").set("Origin", origin).then((response) => response.status)).resolves.toBe(401);
    expect((await login(app, "taxpayer-demo-b", oldPassword)).response.status).toBe(401);
    expect((await login(app, "taxpayer-demo-b", newPassword)).response.status).toBe(200);
    const activeAfterFirstRotation = await login(app, "taxpayer-demo-b", newPassword);
    expect(activeAfterFirstRotation.response.status).toBe(200);
    await run(rotateArgs, rotatedFile);
    await expect(activeAfterFirstRotation.agent.get("/api/auth/session").set("Origin", origin).then((response) => response.status)).resolves.toBe(200);
    const laterOperationId = "9b355b2b-a82e-4b61-a70f-75df3fd0452a";
    const laterFile = join(credentialDirectory, "later-rotation.json");
    await run(["rotate", "--target", "local", "--login", "taxpayer-demo-b", "--operation-id", laterOperationId], laterFile);
    await expect(run(rotateArgs, rotatedFile)).rejects.toThrow(/superseded by a later rotation/i);
    const latest = JSON.parse(await readFile(laterFile, "utf8")) as { credentials: Array<{ password: string }> };
    expect((await login(app, "taxpayer-demo-b", latest.credentials[0]?.password ?? "")).response.status).toBe(200);
    expect(output.join("\n")).not.toContain(newPassword);
    expect(output.join("\n")).not.toContain(oldPassword);
  });

  it("retains a private recovery file when COMMIT succeeds but its acknowledgement is lost", async () => {
    const { app, pool, run, output, credentialDirectory } = await setup((database) => new LostCommitAcknowledgementPool(database, /INSERT INTO app_users/i));
    const credentialFile = join(credentialDirectory, "uncertain-seed.json");
    await expect(run(["seed", "--target", "local"], credentialFile)).rejects.toThrow(/outcome is uncertain.*recovery file was retained/i);

    const recovery = JSON.parse(await readFile(credentialFile, "utf8")) as {
      credentials: Array<{ loginName: string; password: string }>;
      FTC_OFFICER_USER_ID: string;
    };
    expect(recovery.credentials).toHaveLength(3);
    expect((await login(app, "taxpayer-demo-a", recovery.credentials[0]?.password ?? "")).response.status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM app_users")).rows[0]?.count).toBe(3);
    expect(output.join("\n")).not.toContain(recovery.credentials[0]?.password);

    await run(["seed", "--target", "local"], join(credentialDirectory, "repeat.json"));
    expect(await readdir(credentialDirectory)).toEqual(["uncertain-seed.json"]);
    expect((await login(app, "taxpayer-demo-a", recovery.credentials[0]?.password ?? "")).response.status).toBe(200);
    expect(recovery.FTC_OFFICER_USER_ID).toBe((await pool.query("SELECT id FROM app_users WHERE login_name='officer-demo'")).rows[0]?.id);
  });

  it("replays a rotation after a lost COMMIT acknowledgement without invalidating sessions twice", async () => {
    let faultPool: LostCommitAcknowledgementPool | undefined;
    const { app, run, output, credentialDirectory } = await setup((database) => {
      faultPool = new LostCommitAcknowledgementPool(database);
      return faultPool;
    });
    await run(["seed", "--target", "local"], join(credentialDirectory, "seed.json"));
    const seed = JSON.parse(await readFile(join(credentialDirectory, "seed.json"), "utf8")) as {
      credentials: Array<{ loginName: string; password: string }>;
    };
    const oldPassword = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")?.password ?? "";
    const originalSession = await login(app, "taxpayer-demo-a", oldPassword);
    expect(originalSession.response.status).toBe(200);

    const operationId = "2d4b19b9-15c9-4926-9502-a9796162db4b";
    const args = ["rotate", "--target", "local", "--login", "taxpayer-demo-a", "--operation-id", operationId];
    const recoveryPath = join(credentialDirectory, `rotation-${operationId}.json`);
    faultPool?.armNextCommitOnAccountUpdate();
    await expect(run(args, recoveryPath)).rejects.toThrow(/outcome is uncertain.*recovery file was retained/i);
    const recovered = JSON.parse(await readFile(recoveryPath, "utf8")) as { credentials: Array<{ password: string }> };
    const newPassword = recovered.credentials[0]?.password ?? "";
    expect((await login(app, "taxpayer-demo-a", oldPassword)).response.status).toBe(401);
    const currentSession = await login(app, "taxpayer-demo-a", newPassword);
    expect(currentSession.response.status).toBe(200);

    await run(args, recoveryPath);
    await expect(currentSession.agent.get("/api/auth/session").set("Origin", origin).then((response) => response.status)).resolves.toBe(200);
    expect(output.join("\n")).not.toContain(newPassword);
    expect(output.join("\n")).toContain("Reused completed rotation");
  });

  it("removes a newly generated rotation file after a confirmed rollback and keeps the old password active", async () => {
    let faultPool: RollbackBeforeRotationCommitPool | undefined;
    const { app, run, credentialDirectory } = await setup((database) => {
      faultPool = new RollbackBeforeRotationCommitPool(database);
      return faultPool;
    });
    const seedPath = join(credentialDirectory, "seed.json");
    await run(["seed", "--target", "local"], seedPath);
    const seed = JSON.parse(await readFile(seedPath, "utf8")) as { credentials: Array<{ loginName: string; password: string }> };
    const oldPassword = seed.credentials.find((item) => item.loginName === "taxpayer-demo-a")?.password ?? "";
    const session = await login(app, "taxpayer-demo-a", oldPassword);
    expect(session.response.status).toBe(200);

    const recoveryPath = join(credentialDirectory, "rolled-back-rotation.json");
    faultPool!.failSessionInvalidation = true;
    await expect(run(["rotate", "--target", "local", "--login", "taxpayer-demo-a", "--operation-id", "c70d4aab-02f2-420b-bd34-8152fb81aa54"], recoveryPath))
      .rejects.toThrow(/transaction was rolled back/i);
    await expect(access(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await login(app, "taxpayer-demo-a", oldPassword)).response.status).toBe(200);
    await expect(session.agent.get("/api/auth/session").set("Origin", origin).then((response) => response.status)).resolves.toBe(200);
  });
});
