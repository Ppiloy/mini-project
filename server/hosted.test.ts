import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "../shared/confirmations.js";
import { createEmptySource } from "../shared/draft.js";
import type { ForeignIncomeSourceDraft } from "../shared/contracts.js";
import { createApp } from "./app.js";
import { hashPasswordForTest } from "./passwords.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";
import { createFunctionHandler } from "../netlify/functions/api.js";
import { resolveRuntimeEnvironmentConfig } from "./runtime/environment.js";

class PGlitePool implements PgPoolLike {
  constructor(private readonly database: PGlite) {}

  query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = this.database.query<Row>(text, values).then(({ rows, affectedRows }) => ({ rows, rowCount: affectedRows ?? rows.length }));
    if (callback) {
      operation.then((result) => callback(null, result), (error: Error) => callback(error));
    }
    return operation;
  }

  async connect(): Promise<PgQueryable> {
    return {
      query: (text, values, callback) => this.query(text, values, callback),
      release: () => undefined,
    };
  }
}

class DelayedUserLookupPool implements PgPoolLike {
  private releaseLookup!: () => void;
  private lookupStarted!: () => void;
  readonly lookupReady = new Promise<void>((resolve) => { this.lookupStarted = resolve; });
  private readonly lookupGate = new Promise<void>((resolve) => { this.releaseLookup = resolve; });

  constructor(private readonly pool: PgPoolLike) {}

  release() { this.releaseLookup(); }

  async query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
    const operation = (async () => {
      const result = await this.pool.query<Row>(text, values);
      if (/^\s*SELECT users\.id, users\.login_name, users\.display_name, profiles\.masked_reference, users\.role, users\.active/i.test(text)) {
        this.lookupStarted();
        await this.lookupGate;
      }
      return result;
    })();
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
const afterEachCallbacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (afterEachCallbacks.length) await afterEachCallbacks.pop()?.();
});

async function setup(trustedHttps = false, clock?: () => number) {
  const database = new PGlite();
  afterEachCallbacks.push(() => database.close());
  const migrations = (await readdir("netlify/database/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationName of migrations) {
    await database.exec(await readFile(`netlify/database/migrations/${migrationName}`, "utf8"));
  }
  const pool = new PGlitePool(database);
  const passwordHash = await hashPasswordForTest("demo-password-1");
  await pool.query(
    `INSERT INTO app_users (id, login_name, display_name, password_hash, role)
     VALUES ($1, 'taxpayer-a', 'Taxpayer A', $2, 'taxpayer'),
            ($3, 'taxpayer-b', 'Taxpayer B', $2, 'taxpayer'),
            ($4, 'officer-a', 'Officer A', $2, 'officer')`,
    ["00000000-0000-4000-8000-000000000001", passwordHash, "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"],
  );
  await pool.query("INSERT INTO user_profiles(user_id, masked_reference) VALUES ($1, '***-01'), ($2, '***-02')", ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
  const app = createApp({ pool, sessionSecret: "test-only-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps, clock });
  return { app, pool };
}

async function login(app: ReturnType<typeof createApp>, loginName: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").set("Origin", origin).send({ loginName, password: "demo-password-1" });
  expect(response.status).toBe(200);
  return { agent, csrfToken: response.body.data.csrfToken as string, user: response.body.data.user, cookie: String(response.headers["set-cookie"]?.[0] ?? "") };
}

describe("hosted authentication and durable draft API", () => {
  it("restores a server identity from the regenerated secure session and destroys it on logout", async () => {
    const { app } = await setup();
    const { agent, csrfToken, user, cookie } = await login(app, "taxpayer-a");

    expect(user).toEqual({ id: "00000000-0000-4000-8000-000000000001", loginName: "taxpayer-a", displayName: "Taxpayer A", role: "taxpayer", maskedReference: "***-01" });
    expect(JSON.stringify(user)).not.toContain("password");
    expect(cookie).toContain("ftc.sid=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");

    const restored = await agent.get("/api/auth/session").set("Origin", origin);
    expect(restored.status).toBe(200);
    expect(restored.body.data.user).toEqual(user);
    expect(restored.headers["set-cookie"]).toBeUndefined();
    const cases = await agent.get("/api/cases").set("Origin", origin);
    expect(cases.status).toBe(200);
    expect(cases.headers["set-cookie"]).toBeUndefined();

    const logout = await agent.post("/api/auth/logout").set("Origin", origin).set("X-CSRF-Token", csrfToken);
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"]).toBeUndefined();
    expect((await agent.get("/api/auth/session").set("Origin", origin)).status).toBe(401);
  });

  it("does not resurrect a session when an authenticated lookup finishes after logout", async () => {
    const { app, pool } = await setup();
    const loggedIn = await login(app, "taxpayer-a");
    const delayedPool = new DelayedUserLookupPool(pool);
    const delayedApp = createApp({ pool: delayedPool, sessionSecret: "test-only-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false });
    const lateRequest = request(delayedApp).get("/api/auth/session").set("Origin", origin).set("Cookie", loggedIn.cookie.split(";")[0] ?? "");
    const pendingResponse = lateRequest.then((response) => response);

    await delayedPool.lookupReady;
    const logout = await loggedIn.agent.post("/api/auth/logout").set("Origin", origin).set("X-CSRF-Token", loggedIn.csrfToken);
    expect(logout.status).toBe(200);
    delayedPool.release();
    const lateResponse = await pendingResponse;
    expect(lateResponse.status).toBe(401);
    expect(lateResponse.headers["set-cookie"]).toBeUndefined();

    const afterLateResponse = await request(app).get("/api/auth/session").set("Origin", origin).set("Cookie", loggedIn.cookie.split(";")[0] ?? "");
    expect(afterLateResponse.status).toBe(401);
  });

  it("sets a Secure host-only cookie when the trusted adapter marks hosted HTTPS", async () => {
    const { app } = await setup(true);
    const response = await request(app).post("/api/auth/login").set("Origin", origin).send({ loginName: "taxpayer-a", password: "demo-password-1" });
    const cookie = String(response.headers["set-cookie"]?.[0] ?? "");
    expect(response.status).toBe(200);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });

  it("serves the public API through the Netlify Lambda wrapper and normalizes direct function URLs", async () => {
    vi.stubEnv("FTC_ALLOWED_ORIGIN", origin);
    const { app } = await setup(true);
    const handler = createFunctionHandler(() => app);
    const response = await handler({
      httpMethod: "POST",
      path: "/.netlify/functions/api/auth/login",
      rawUrl: `${origin}/.netlify/functions/api/auth/login`,
      headers: {
        host: "ftc.example.test",
        origin,
        "content-type": "application/json",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "attacker.example",
      },
      requestContext: { identity: { sourceIp: "127.0.0.1" }, requestId: "netlify-test-request" },
      body: JSON.stringify({ loginName: "taxpayer-a", password: "demo-password-1" }),
      isBase64Encoded: false,
    }, {});
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(String(response.body)).data.user.loginName).toBe("taxpayer-a");
    const cookie = response.multiValueHeaders?.["set-cookie"]?.join("; ") ?? response.cookies?.join("; ") ?? "";
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");

    const health = await handler({
      httpMethod: "GET",
      path: "/.netlify/functions/api/api/health",
      rawUrl: `${origin}/.netlify/functions/api/api/health`,
      headers: { host: "ftc.example.test", "x-forwarded-proto": "http" },
      requestContext: { identity: { sourceIp: "127.0.0.1" } }, body: "", isBase64Encoded: false,
    }, {});
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(String(health.body)).data.status).toBe("ok");
    expect(String(health.headers["cache-control"])).toContain("no-store");

    for (const rawUrl of [undefined, "http://ftc.example.test/api/health", "https://attacker.example/api/health"]) {
      const insecure = await handler({
        httpMethod: "GET", path: "/api/health", ...(rawUrl ? { rawUrl } : {}),
        headers: { host: "ftc.example.test", "x-forwarded-proto": "https" },
        requestContext: { identity: { sourceIp: "127.0.0.1" } }, body: "", isBase64Encoded: false,
      }, {});
      expect(insecure.statusCode).toBe(403);
      expect(JSON.parse(String(insecure.body)).error.code).toBe("forbidden");
      expect(String(insecure.headers["cache-control"])).toContain("no-store");
    }
  });

  it("fails closed through the Lambda boundary when deployment context and platform markers are absent", async () => {
    vi.stubEnv("FTC_ALLOWED_ORIGIN", origin);
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-with-sufficient-entropy");
    const { app } = await setup(true);
    const functionEnvironment = {
      NETLIFY_DB_URL: "postgres://ftc_role:synthetic-secret@db.example.test/production",
      FTC_ALLOWED_ORIGIN: origin,
      SESSION_SECRET: "test-only-session-secret-with-sufficient-entropy",
    } as NodeJS.ProcessEnv;
    let appWasBuilt = false;
    const handler = createFunctionHandler(() => {
      resolveRuntimeEnvironmentConfig(functionEnvironment);
      appWasBuilt = true;
      return app;
    });
    const response = await handler({
      httpMethod: "GET", path: "/api/health", rawUrl: `${origin}/api/health`,
      headers: { host: "ftc.example.test" }, body: "", isBase64Encoded: false,
    }, {});
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(String(response.body)).error.code).toBe("service_unavailable");
    expect(String(response.headers["cache-control"])).toContain("no-store");
    expect(appWasBuilt).toBe(false);
  });

  it("restores the authenticated identity from PostgreSQL in a separate app instance", async () => {
    const { app, pool } = await setup();
    const { cookie, user } = await login(app, "taxpayer-a");
    const otherInstance = createApp({ pool, sessionSecret: "test-only-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false });
    const persisted = await request(otherInstance).get("/api/auth/session").set("Origin", origin).set("Cookie", cookie.split(";")[0] ?? "");
    expect(persisted.status).toBe(200);
    expect(persisted.body.data.user).toEqual(user);
  });

  it("expires sessions at the 30-minute idle limit and eight-hour absolute limit", async () => {
    let currentTime = Date.now();
    const { app } = await setup(false, () => currentTime);
    const idleLogin = await login(app, "taxpayer-a");
    currentTime += 30 * 60 * 1000 + 1;
    expect((await idleLogin.agent.get("/api/auth/session").set("Origin", origin)).status).toBe(401);

    currentTime = Date.now();
    const absoluteLogin = await login(app, "taxpayer-b");
    for (let interval = 0; interval < 17; interval += 1) {
      currentTime += 25 * 60 * 1000;
      expect((await absoluteLogin.agent.get("/api/auth/session").set("Origin", origin)).status).toBe(200);
    }
    currentTime += 60 * 60 * 1000 + 1;
    expect((await absoluteLogin.agent.get("/api/auth/session").set("Origin", origin)).status).toBe(401);
  });

  it("requires allowed origin and the session CSRF token for authenticated writes", async () => {
    const { app } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");

    expect((await agent.post("/api/cases").set("Origin", "https://attacker.test").send({ requestId: "create-1" })).status).toBe(403);
    expect((await agent.post("/api/cases").set("Origin", origin).send({ requestId: "create-1" })).status).toBe(403);
    expect((await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "create-1" })).status).toBe(201);
  });

  it("maps shared-boundary NUL rejection to a private structured 422 response", async () => {
    const { app } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const created = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "nul-case-1" });
    const draft = created.body.data.case.draft;
    draft.thaiTax.provenance = "invalid\u0000text";
    const response = await agent.put(`/api/cases/${created.body.data.case.id}/draft`)
      .set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 0, requestId: "nul-save-1", data: draft });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("invalid_input");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["thaiTax", "provenance"] })]));
  });

  it("rejects NUL characters in login names and persisted request identifiers as client errors", async () => {
    const { app } = await setup();
    const badLogin = await request(app).post("/api/auth/login").set("Origin", origin)
      .send({ loginName: "taxpayer\u0000-a", password: "demo-password-1" });
    expect(badLogin.status).toBe(400);
    expect(badLogin.body.error.code).toBe("invalid_input");

    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const badRequestId = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ requestId: "case\u0000id" });
    expect(badRequestId.status).toBe(400);
    expect(badRequestId.body.error.code).toBe("invalid_input");
    expect(badRequestId.headers["cache-control"]).toContain("no-store");
  });

  it("keeps cases owner-scoped, makes create retries idempotent, and rejects stale draft revisions", async () => {
    const { app } = await setup();
    const taxpayerA = await login(app, "taxpayer-a");
    const taxpayerB = await login(app, "taxpayer-b");

    const created = await taxpayerA.agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", taxpayerA.csrfToken).send({ requestId: "create-retry-1" });
    const retried = await taxpayerA.agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", taxpayerA.csrfToken).send({ requestId: "create-retry-1" });
    expect(created.status).toBe(201);
    expect(retried.status).toBe(200);
    expect(retried.body.data.case.id).toBe(created.body.data.case.id);

    const id = created.body.data.case.id as string;
    expect((await taxpayerB.agent.get(`/api/cases/${id}`).set("Origin", origin)).status).toBe(404);
    const current = await taxpayerA.agent.get(`/api/cases/${id}`).set("Origin", origin);
    expect(current.body.data.case.draft.revision).toBe(0);
    expect(current.body.data.case.draft.domesticAssessableIncome).toBeNull();

    const body = { expectedRevision: 0, requestId: "save-1", data: current.body.data.case.draft };
    const crossOwnerWrite = await taxpayerB.agent.put(`/api/cases/${id}/draft`).set("Origin", origin).set("X-CSRF-Token", taxpayerB.csrfToken).send({ ...body, requestId: "steal-case" });
    expect(crossOwnerWrite.status).toBe(404);
    const saved = await taxpayerA.agent.put(`/api/cases/${id}/draft`).set("Origin", origin).set("X-CSRF-Token", taxpayerA.csrfToken).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.case.draft.revision).toBe(1);
    const stale = await taxpayerA.agent.put(`/api/cases/${id}/draft`).set("Origin", origin).set("X-CSRF-Token", taxpayerA.csrfToken).send({ ...body, requestId: "save-stale-1" });
    expect(stale.status).toBe(409);
    expect((await taxpayerA.agent.get(`/api/cases/${id}`).set("Origin", origin)).body.data.case.draft.revision).toBe(1);
  });

  it("rejects client role escalation, saves exact nullable monetary facts, and enforces the ten-case owner quota", async () => {
    const { app } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const elevated = await agent.post("/api/auth/login").set("Origin", origin).send({ loginName: "taxpayer-a", password: "demo-password-1", role: "officer" });
    expect(elevated.status).toBe(400);

    const first = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "quota-0" });
    const caseId = first.body.data.case.id as string;
    const draft = first.body.data.case.draft;
    draft.domesticAssessableIncome = "123456.78";
    draft.thaiTax.amountBeforeFtc = null;
    const saved = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ expectedRevision: 0, requestId: "save-exact", data: draft });
    expect(saved.status).toBe(200);
    const reloaded = await agent.get(`/api/cases/${caseId}`).set("Origin", origin);
    expect(reloaded.body.data.case.draft.domesticAssessableIncome).toBe("123456.78");
    expect(reloaded.body.data.case.draft.thaiTax.amountBeforeFtc).toBeNull();

    for (let index = 1; index < 10; index += 1) {
      expect((await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: `quota-${index}` })).status).toBe(201);
    }
    const overQuota = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "quota-10" });
    expect(overQuota.status).toBe(429);
    expect((await agent.get(`/api/cases/${caseId}`).set("Origin", origin)).body.data.case.draft.domesticAssessableIncome).toBe("123456.78");
  });

  it("persists relational date/decimal facts and stamps confirmations only from explicit server-side intent", async () => {
    const { app } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const created = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "confirm-case-1" });
    const caseId = created.body.data.case.id as string;
    const draft = created.body.data.case.draft;
    draft.taxYear = 2025;
    draft.domesticAssessableIncome = "100000.12";
    draft.thaiTax.amountBeforeFtc = "125.12";
    draft.thaiTax.provenance = "Tax statement supplied by taxpayer";
    draft.thaiTax.confirmedAt = "1999-01-01T00:00:00.000Z";
    draft.thaiTax.confirmedInputFingerprint = "forged";
    const source: ForeignIncomeSourceDraft = {
      id: null, countryCode: null, countryName: null, incomeType: null, subtype: null,
      earnedTaxYear: null, earnedDate: null, residenceDaysInEarnedYear: null, inputMode: null,
      grossIncomeAmount: null, currencyCode: null, grossIncomeThb: null,
      actualForeignTaxPaid: null, actualForeignTaxPaidThb: null, eligibleForeignTax: null, eligibleForeignTaxThb: null,
      eligibilityRationale: null, eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null,
      remittance: null, remittedIncomeAmount: null, remittedIncomeThb: null, fxReference: null,
      unsupportedClassification: null, unsupportedExplanation: null, evidenceChecklist: [],
    };
    source.countryCode = "US";
    source.countryName = "United States";
    source.incomeType = "salary_40_1";
    source.earnedTaxYear = 2025;
    source.earnedDate = "2025-01-15";
    source.residenceDaysInEarnedYear = 365;
    source.inputMode = "original_currency";
    source.grossIncomeAmount = "98765.43";
    source.currencyCode = "USD";
    source.grossIncomeThb = "999999999.99";
    source.actualForeignTaxPaid = "1234.56";
    source.eligibleForeignTax = "1234.56";
    source.eligibilityRationale = "Explicit educational assumption";
    source.eligibilityConfirmedAt = "1999-01-01T00:00:00.000Z";
    source.eligibilityConfirmedInputFingerprint = "forged";
    source.remittance = { remittanceDate: "2025-02-28", transferTotalAmount: "98765.43", transferCurrencyCode: "USD", transferTotalThb: "999999999999999999.999999999999", classification: "income_only", classificationNote: null };
    source.remittedIncomeAmount = "98765.43";
    source.fxReference = { currencyCode: "USD", thbRate: "35.12345678", baseUnits: 1, effectiveDate: "2025-02-28", rateType: "manual", sourceKind: "user_supplied", sourceLabel: "User quote", sourceUrl: null, educationalAssumption: "Synthetic for persistence test" };
    const secondSource = structuredClone(source);
    secondSource.countryCode = "CA";
    secondSource.countryName = "Canada";
    secondSource.grossIncomeAmount = "1.25";
    draft.sources = [source, secondSource];

    const saved = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken).send({
      expectedRevision: 0, requestId: "confirm-save-1", data: draft,
      confirmations: { thaiTax: true, eligibleSourceIndexes: [0] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.case.draft.thaiTax.confirmedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(saved.body.data.case.draft.thaiTax.confirmedInputFingerprint).toBe(taxInputFingerprint(saved.body.data.case.draft));
    expect(saved.body.data.case.draft.sources[0].eligibilityConfirmedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(saved.body.data.case.draft.sources[0].eligibilityConfirmedInputFingerprint).toBe(sourceEligibilityFingerprint(saved.body.data.case.draft.sources[0]));

    const reloaded = await agent.get(`/api/cases/${caseId}`).set("Origin", origin);
    const roundTripped = reloaded.body.data.case.draft;
    expect(roundTripped.domesticAssessableIncome).toBe("100000.12");
    expect(roundTripped.sources[0].grossIncomeAmount).toBe("98765.43");
    expect(roundTripped.sources[0].countryCode).toBe("US");
    expect(roundTripped.sources[1].countryCode).toBe("CA");
    expect(roundTripped.sources[0].grossIncomeThb).toBe("3468983.3119631154");
    expect(roundTripped.sources[0].earnedDate).toBe("2025-01-15");
    expect(roundTripped.sources[0].remittance.remittanceDate).toBe("2025-02-28");
    expect(roundTripped.sources[0].remittance.transferTotalThb).toBe("3468983.3119631154");
    expect(roundTripped.sources[0].fxReference.effectiveDate).toBe("2025-02-28");

    roundTripped.domesticAssessableIncome = "100001";
    roundTripped.sources[0].grossIncomeAmount = "98766";
    const changed = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken).send({
      expectedRevision: 1, requestId: "confirm-save-2", data: roundTripped,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.case.draft.thaiTax.confirmedAt).toBeNull();
    expect(changed.body.data.case.draft.thaiTax.confirmedInputFingerprint).toBeNull();
    expect(changed.body.data.case.draft.sources[0].eligibilityConfirmedAt).toBeNull();
    expect(changed.body.data.case.draft.sources[0].eligibilityConfirmedInputFingerprint).toBeNull();
  });

  it("rejects duplicate canonical source UUIDs atomically and refuses caller-created source IDs", async () => {
    const { app } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const created = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "duplicate-source-case" });
    const caseId = created.body.data.case.id as string;
    const draft = created.body.data.case.draft;
    const unsupported = createEmptySource();
    unsupported.id = "a1111111-1111-4111-8111-111111111111";
    unsupported.unsupportedClassification = "other";
    const otherwiseSupported = createEmptySource();
    otherwiseSupported.id = "a1111111-1111-4111-8111-111111111111".toUpperCase();
    draft.sources = [unsupported, otherwiseSupported];

    const duplicateSave = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 0, requestId: "duplicate-source-save", data: draft });
    expect(duplicateSave.status).toBe(400);
    expect(duplicateSave.body.error.code).toBe("invalid_input");
    const afterDuplicate = await agent.get(`/api/cases/${caseId}`).set("Origin", origin);
    expect(afterDuplicate.body.data.case.draft.sources).toEqual([]);
    expect(afterDuplicate.body.data.case.draft.revision).toBe(0);

    draft.sources = [otherwiseSupported];
    const unownedId = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 0, requestId: "caller-source-id", data: draft });
    expect(unownedId.status).toBe(409);
    expect((await agent.get(`/api/cases/${caseId}`).set("Origin", origin)).body.data.case.draft.sources).toEqual([]);
  });

  it("returns a conflict before clearing or removing remittances referenced by evidence", async () => {
    const { app, pool } = await setup();
    const { agent, csrfToken } = await login(app, "taxpayer-a");
    const created = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({ requestId: "remittance-evidence-case" });
    const caseId = created.body.data.case.id as string;
    const draft = created.body.data.case.draft;
    const source = createEmptySource();
    source.remittance = {
      remittanceDate: "2025-02-01", transferTotalAmount: "100", transferCurrencyCode: "USD", transferTotalThb: null,
      classification: "income_only", classificationNote: null,
    };
    draft.sources = [source];
    const saved = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 0, requestId: "remittance-evidence-save", data: draft });
    expect(saved.status).toBe(200);
    const persistedSource = saved.body.data.case.draft.sources[0] as ForeignIncomeSourceDraft;
    const remittance = await pool.query<{ id: string }>("SELECT id FROM remittances WHERE source_id=$1", [persistedSource.id]);
    expect(remittance.rows).toHaveLength(1);
    await pool.query(
      `INSERT INTO attachments(case_id, source_id, remittance_id, storage_environment, storage_store, storage_region,
         storage_key, display_name, media_type, byte_size, sha256, kind, status)
       VALUES ($1, NULL, $2, 'production', 'test-store', 'us-east-2', 'test/remittance-evidence', 'proof.pdf',
         'application/pdf', 1, 'test-digest', 'remittance', 'ready')`,
      [caseId, remittance.rows[0]!.id],
    );

    const cleared = structuredClone(saved.body.data.case.draft);
    cleared.sources[0].remittance = null;
    const clearResponse = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 1, requestId: "clear-linked-remittance", data: cleared });
    expect(clearResponse.status).toBe(409);
    expect(clearResponse.body.error.code).toBe("conflict");
    expect(clearResponse.body.error.message).toContain("หลักฐาน");

    const removed = structuredClone(saved.body.data.case.draft);
    removed.sources = [];
    const removeResponse = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrfToken)
      .send({ expectedRevision: 1, requestId: "remove-linked-remittance", data: removed });
    expect(removeResponse.status).toBe(409);
    expect(removeResponse.body.error.code).toBe("conflict");
    const reloaded = await agent.get(`/api/cases/${caseId}`).set("Origin", origin);
    expect(reloaded.body.data.case.draft.revision).toBe(1);
    expect(reloaded.body.data.case.draft.sources[0].id).toBe(persistedSource.id);
    expect(reloaded.body.data.case.draft.sources[0].remittance).not.toBeNull();
  });

  it("blocks repeated bad passwords using persistent account-level limits", async () => {
    const { app } = await setup();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await request(app).post("/api/auth/login").set("Origin", origin).send({ loginName: "taxpayer-a", password: "wrong" });
      expect(failed.status).toBe(401);
    }
    const limited = await request(app).post("/api/auth/login").set("Origin", origin).send({ loginName: "taxpayer-a", password: "demo-password-1" });
    expect(limited.status).toBe(429);
  });

  it("reserves login attempt capacity before password work under a concurrent wrong-password burst", async () => {
    const { app } = await setup();
    const attempts = await Promise.all(Array.from({ length: 20 }, () => request(app)
      .post("/api/auth/login").set("Origin", origin).send({ loginName: "taxpayer-a", password: "wrong" })));
    expect(attempts.filter((attempt) => attempt.status === 401)).toHaveLength(10);
    expect(attempts.filter((attempt) => attempt.status === 429)).toHaveLength(10);
    expect(attempts.every((attempt) => [401, 429].includes(attempt.status))).toBe(true);
    expect((await request(app).post("/api/auth/login").set("Origin", origin)
      .send({ loginName: "taxpayer-a", password: "demo-password-1" })).status).toBe(429);
  });
});
