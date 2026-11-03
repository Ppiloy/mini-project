import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDraft, createEmptySource } from "../shared/draft.js";
import type { FtcCaseDraft } from "../shared/contracts.js";
import { createApp } from "./app.js";
import { hashPasswordForTest } from "./passwords.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";
import type { BlobIO } from "./storage/blob-io.js";

class PGlitePool implements PgPoolLike {
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
const taxpayerId = "00000000-0000-4000-8000-000000000001";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function createTestApp() {
  const database = new PGlite();
  cleanup.push(() => database.close());
  const migrations = (await readdir("netlify/database/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) await database.exec(await readFile(`netlify/database/migrations/${name}`, "utf8"));
  const pool = new PGlitePool(database);
  const password = await hashPasswordForTest("residence-test-password");
  await pool.query("INSERT INTO app_users(id,login_name,display_name,password_hash,role) VALUES ($1,'residence-user','Residence User',$2,'taxpayer')", [taxpayerId, password]);
  const blobIO: BlobIO = { async put() {}, async get() { return null; }, async delete() {} };
  const app = createApp({ pool, sessionSecret: "residence-test-session-secret-with-sufficient-entropy", allowedOrigin: origin, trustedHttps: false, blobIO });
  return { app };
}

describe("residence-year draft HTTP workflow", () => {
  it("creates an explicit residence-year field and persists server-derived days across save and reload", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").set("Origin", origin).send({ loginName: "residence-user", password: "residence-test-password" });
    expect(login.status).toBe(200);
    const csrf = login.body.data.csrfToken as string;

    const created = await agent.post("/api/cases").set("Origin", origin).set("X-CSRF-Token", csrf).send({ requestId: "residence-case-create" });
    expect(created.status).toBe(201);
    expect(created.body.data.case.draft.residenceYears).toEqual([]);
    const caseId = created.body.data.case.id as string;

    const draft: FtcCaseDraft = { ...createEmptyDraft(), ...created.body.data.case.draft, sources: [createEmptySource()], residenceYears: [
      { earnedTaxYear: 2025, mode: "periods", periods: [{ startDate: "2025-01-01", endDate: "2025-06-29" }] },
    ] };
    draft.sources[0]!.earnedTaxYear = 2025;
    draft.sources[0]!.residenceDaysInEarnedYear = 9;
    const firstSave = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: 0, requestId: "residence-save-dates", data: draft, confirmations: { thaiTax: false, eligibleSourceIds: [], eligibleSourceIndexes: [] } });
    expect(firstSave.status, JSON.stringify(firstSave.body)).toBe(200);
    expect(firstSave.body.data.case.draft.residenceYears).toEqual(draft.residenceYears);
    expect(firstSave.body.data.case.draft.sources[0].residenceDaysInEarnedYear).toBe(180);

    const reload = await agent.get(`/api/cases/${caseId}`).set("Origin", origin);
    expect(reload.status).toBe(200);
    expect(reload.body.data.case.draft.residenceYears).toEqual(draft.residenceYears);
    expect(reload.body.data.case.draft.sources[0].residenceDaysInEarnedYear).toBe(180);

    const declaredDraft = {
      ...reload.body.data.case.draft,
      residenceYears: [{ earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days" }],
      sources: reload.body.data.case.draft.sources.map((source: FtcCaseDraft["sources"][number]) => ({ ...source, residenceDaysInEarnedYear: 366 })),
    } as FtcCaseDraft;
    const declaredSave = await agent.put(`/api/cases/${caseId}/draft`).set("Origin", origin).set("X-CSRF-Token", csrf)
      .send({ expectedRevision: firstSave.body.data.case.draft.revision, requestId: "residence-save-declaration", data: declaredDraft, confirmations: { thaiTax: false, eligibleSourceIds: [], eligibleSourceIndexes: [] } });
    expect(declaredSave.status, JSON.stringify(declaredSave.body)).toBe(200);
    expect(declaredSave.body.data.case.draft.residenceYears).toEqual(declaredDraft.residenceYears);
    expect(declaredSave.body.data.case.draft.sources[0].residenceDaysInEarnedYear).toBeNull();
  });
});
