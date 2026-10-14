import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { PgPoolLike, PgQueryable } from "../postgres.js";
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

const origin = "https://ftc.example.test";
const env: NodeJS.ProcessEnv = {
  CONTEXT: "dev",
  NETLIFY_DB_URL: "postgres://local-user:local-password@127.0.0.1/ftc-local",
  FTC_BLOB_REGION: "us-east-2",
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function setup() {
  const database = new PGlite();
  cleanups.push(() => database.close());
  for (const name of (await readdir("netlify/database/migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    await database.exec(await readFile(join("netlify/database/migrations", name), "utf8"));
  }
  const pool = new PGlitePool(database);
  const credentialDirectory = await mkdtemp(join(tmpdir(), "ftc-bootstrap-"));
  cleanups.push(() => rm(credentialDirectory, { recursive: true, force: true }));
  const app = createApp({ pool, sessionSecret: "test-only-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false });
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
    await run(["rotate", "--target", "local", "--login", "taxpayer-demo-b"], rotatedFile);
    const rotated = JSON.parse(await readFile(rotatedFile, "utf8")) as { credentials: Array<{ password: string }> };
    const newPassword = rotated.credentials[0]?.password ?? "";
    await expect(existing.agent.get("/api/auth/session").set("Origin", origin).then((response) => response.status)).resolves.toBe(401);
    expect((await login(app, "taxpayer-demo-b", oldPassword)).response.status).toBe(401);
    expect((await login(app, "taxpayer-demo-b", newPassword)).response.status).toBe(200);
    expect(output.join("\n")).not.toContain(newPassword);
    expect(output.join("\n")).not.toContain(oldPassword);
  });
});
