import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import connectPgSimple from "connect-pg-simple";
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from "express";
import { withCanonicalThbAmounts } from "../shared/calculator.js";
import session from "express-session";
import { createEmptyDraft, draftSchema } from "../shared/draft.js";
import {
  isSourceEligibilityConfirmationCurrent,
  isThaiTaxConfirmationCurrent,
  sourceEligibilityFingerprint,
  taxInputFingerprint,
  stripStaleConfirmations,
} from "../shared/confirmations.js";
import type { ApiUser, FtcCaseDraft, FtcCaseRecord, UserRole } from "../shared/contracts.js";
import { apiSuccessSchemas } from "../shared/contracts.js";
import type { PgPoolLike, PgQueryable } from "./postgres.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { ApiFailure } from "./api-failure.js";
import { sendApiSuccess } from "./api-success.js";
import { ensureEnvironmentMarker, type EnvironmentMarker, type RuntimeEnvironmentConfig } from "./runtime/environment.js";
import { registerWorkflowRoutes } from "./workflow/routes.js";
import type { BlobIO } from "./storage/blob-io.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_RESERVATION_MS = 2 * 60 * 1000;
const PG_SESSION = connectPgSimple(session);
const dummyPasswordHash = hashPassword("fixed-non-account-password");

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    createdAt?: number;
    lastActiveAt?: number;
  }
}

interface AppUserRow {
  id: string;
  login_name: string;
  display_name: string;
  masked_reference: string | null;
  role: UserRole;
  active: boolean;
  password_hash?: string;
}

export interface CaseRow {
  id: string;
  owner_id: string;
  status: "draft" | "submitted";
  tax_year: number | null;
  domestic_assessable_income: string | null;
  thai_tax_before_ftc: string | null;
  thai_tax_provenance: string | null;
  thai_tax_confirmed_at: Date | string | null;
  thai_tax_confirmed_input_fingerprint: string | null;
  draft: FtcCaseDraft | string;
  revision: number;
  assigned_officer_id: string | null;
  submitted_snapshot_id: string | null;
  submitted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateAppOptions {
  pool: PgPoolLike;
  sessionSecret: string;
  allowedOrigin: string;
  /** Set only by the hosting adapter after it establishes public HTTPS. */
  trustedHttps: boolean;
  sessionCookieName?: string;
  clock?: () => number;
  environment?: RuntimeEnvironmentConfig;
  blobIO?: BlobIO;
  officerUserId?: string;
}

export function makeRuntimePool(): PgPoolLike {
  let databasePool: PgPoolLike | undefined;
  const getPool = (): PgPoolLike => {
    if (databasePool) return databasePool;
    const connectionString = process.env.NETLIFY_DB_URL;
    if (!connectionString) throw new Error("NETLIFY_DB_URL is required for the hosted API runtime.");
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
    if (!process.env.FTC_ALLOWED_ORIGIN) throw new Error("FTC_ALLOWED_ORIGIN is required for the hosted API runtime.");
    const database = getDatabase({ connectionString });
    databasePool = database.pool as unknown as PgPoolLike;
    return databasePool;
  };
  return {
    query<Row = Record<string, unknown>>(text: string, values?: unknown[], callback?: (error: Error | null, result?: { rows: Row[]; rowCount: number }) => void) {
      const operation = getPool().query<Row>(text, values, callback);
      return operation;
    },
    async connect() {
      return getPool().connect();
    },
  };
}

function apiError(response: Response, status: number, code: string, message: string, fields?: unknown): void {
  response.status(status).json({ error: { code, message, ...(fields ? { fields } : {}), requestId: response.locals.requestId } });
}

function asDraft(value: FtcCaseDraft | string): FtcCaseDraft {
  return typeof value === "string" ? JSON.parse(value) as FtcCaseDraft : value;
}

function caseRecord(row: CaseRow, ownerId = row.owner_id): FtcCaseRecord {
  const draft = asDraft(row.draft);
  draft.id = row.id;
  draft.taxYear = row.tax_year;
  draft.domesticAssessableIncome = canonicalNumeric(row.domestic_assessable_income);
  draft.thaiTax.amountBeforeFtc = canonicalNumeric(row.thai_tax_before_ftc);
  draft.thaiTax.provenance = row.thai_tax_provenance;
  draft.thaiTax.confirmedAt = row.thai_tax_confirmed_at ? new Date(row.thai_tax_confirmed_at).toISOString() : null;
  draft.thaiTax.confirmedInputFingerprint = row.thai_tax_confirmed_input_fingerprint;
  draft.revision = row.revision;
  draft.createdAt = new Date(row.created_at).toISOString();
  draft.updatedAt = new Date(row.updated_at).toISOString();
  return {
    id: row.id,
    ownerId,
    status: row.status,
    draft,
    assignedOfficerId: row.assigned_officer_id,
    submittedSnapshotId: row.submitted_snapshot_id,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

type StoredSourceRow = {
  id: string;
  position: number;
  source_data: FtcCaseDraft["sources"][number] | string;
  country_code: string | null;
  country_name: string | null;
  income_type: FtcCaseDraft["sources"][number]["incomeType"];
  subtype: string | null;
  earned_tax_year: number | null;
  earned_date: Date | string | null;
  residence_days_in_earned_year: number | null;
  input_mode: FtcCaseDraft["sources"][number]["inputMode"];
  gross_income_amount: string | null;
  currency_code: string | null;
  gross_income_thb: string | null;
  actual_foreign_tax_paid: string | null;
  actual_foreign_tax_paid_thb: string | null;
  eligible_foreign_tax: string | null;
  eligible_foreign_tax_thb: string | null;
  eligibility_rationale: string | null;
  eligibility_confirmed_at: Date | string | null;
  eligibility_confirmed_input_fingerprint: string | null;
  remitted_income_amount: string | null;
  remitted_income_thb: string | null;
  unsupported_classification: FtcCaseDraft["sources"][number]["unsupportedClassification"];
  unsupported_explanation: string | null;
  remittance_id: string | null;
  remittance_date: Date | string | null;
  transfer_total_amount: string | null;
  transfer_currency_code: string | null;
  transfer_total_thb: string | null;
  remittance_classification: "income_only" | "mixed_principal_and_income" | "gross_net_ambiguous" | "tax_refund" | "unknown" | null;
  classification_note: string | null;
  fx_currency_code: string | null;
  fx_thb_rate: string | null;
  fx_base_units: 1 | 100 | null;
  fx_effective_date: Date | string | null;
  fx_reference_id: string | null;
  fx_rate_type: "bank_buying" | "bot_average_buying" | "manual" | "fixture" | null;
  fx_source_kind: "bank" | "bot" | "user_supplied" | "fixture" | null;
  fx_source_label: string | null;
  fx_source_url: string | null;
  fx_educational_assumption: string | null;
};

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function canonicalNumeric(value: string | null): string | null {
  if (value === null) return null;
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export async function loadCaseRecord(queryable: Pick<PgQueryable, "query">, row: CaseRow): Promise<FtcCaseRecord> {
  const draft = asDraft(row.draft);
  const sourceRows = await queryable.query<StoredSourceRow>(
    `SELECT s.id, s.position, s.source_data, s.country_code, s.country_name, s.income_type, s.subtype, s.earned_tax_year,
       s.earned_date, s.residence_days_in_earned_year, s.input_mode,
       s.gross_income_amount::text AS gross_income_amount, s.currency_code,
       s.gross_income_thb::text AS gross_income_thb, s.actual_foreign_tax_paid::text AS actual_foreign_tax_paid,
       s.actual_foreign_tax_paid_thb::text AS actual_foreign_tax_paid_thb,
       s.eligible_foreign_tax::text AS eligible_foreign_tax, s.eligible_foreign_tax_thb::text AS eligible_foreign_tax_thb,
       s.eligibility_rationale, s.eligibility_confirmed_at, s.eligibility_confirmed_input_fingerprint,
       s.remitted_income_amount::text AS remitted_income_amount, s.remitted_income_thb::text AS remitted_income_thb,
       s.unsupported_classification, s.unsupported_explanation,
       r.id AS remittance_id, r.remittance_date, r.transfer_total_amount::text AS transfer_total_amount,
       r.transfer_currency_code, r.transfer_total_thb::text AS transfer_total_thb,
       r.classification AS remittance_classification, r.classification_note,
       fx.id AS fx_reference_id, fx.currency_code AS fx_currency_code, fx.thb_rate::text AS fx_thb_rate, fx.base_units AS fx_base_units,
       fx.effective_date AS fx_effective_date, fx.rate_type AS fx_rate_type, fx.source_kind AS fx_source_kind,
       fx.source_label AS fx_source_label, fx.source_url AS fx_source_url, fx.educational_assumption AS fx_educational_assumption
     FROM foreign_income_sources s LEFT JOIN remittances r ON r.case_id=s.case_id AND r.source_id=s.id
       LEFT JOIN exchange_rate_references fx ON fx.case_id=s.case_id AND fx.source_id=s.id
     WHERE s.case_id=$1 ORDER BY s.position, s.id`,
    [row.id],
  );
  draft.sources = sourceRows.rows.map((stored) => {
    const source = (typeof stored.source_data === "string" ? JSON.parse(stored.source_data) : stored.source_data) as FtcCaseDraft["sources"][number];
    source.id = stored.id;
    source.countryCode = stored.country_code;
    source.countryName = stored.country_name;
    source.incomeType = stored.income_type;
    source.subtype = stored.subtype;
    source.earnedTaxYear = stored.earned_tax_year;
    source.earnedDate = dateOnly(stored.earned_date);
    source.residenceDaysInEarnedYear = stored.residence_days_in_earned_year;
    source.inputMode = stored.input_mode;
    source.grossIncomeAmount = canonicalNumeric(stored.gross_income_amount);
    source.currencyCode = stored.currency_code;
    source.grossIncomeThb = canonicalNumeric(stored.gross_income_thb);
    source.actualForeignTaxPaid = canonicalNumeric(stored.actual_foreign_tax_paid);
    source.actualForeignTaxPaidThb = canonicalNumeric(stored.actual_foreign_tax_paid_thb);
    source.eligibleForeignTax = canonicalNumeric(stored.eligible_foreign_tax);
    source.eligibleForeignTaxThb = canonicalNumeric(stored.eligible_foreign_tax_thb);
    source.eligibilityRationale = stored.eligibility_rationale;
    source.eligibilityConfirmedAt = stored.eligibility_confirmed_at ? new Date(stored.eligibility_confirmed_at).toISOString() : null;
    source.eligibilityConfirmedInputFingerprint = stored.eligibility_confirmed_input_fingerprint;
    source.remittedIncomeAmount = canonicalNumeric(stored.remitted_income_amount);
    source.remittedIncomeThb = canonicalNumeric(stored.remitted_income_thb);
    source.unsupportedClassification = stored.unsupported_classification;
    source.unsupportedExplanation = stored.unsupported_explanation;
    source.remittance = stored.remittance_id ? {
      remittanceDate: dateOnly(stored.remittance_date), transferTotalAmount: canonicalNumeric(stored.transfer_total_amount),
      transferCurrencyCode: stored.transfer_currency_code, transferTotalThb: canonicalNumeric(stored.transfer_total_thb),
      classification: stored.remittance_classification, classificationNote: stored.classification_note,
    } : null;
    source.fxReference = stored.fx_reference_id === null ? null : {
      currencyCode: stored.fx_currency_code, thbRate: canonicalNumeric(stored.fx_thb_rate), baseUnits: stored.fx_base_units,
      effectiveDate: dateOnly(stored.fx_effective_date), rateType: stored.fx_rate_type, sourceKind: stored.fx_source_kind,
      sourceLabel: stored.fx_source_label, sourceUrl: stored.fx_source_url, educationalAssumption: stored.fx_educational_assumption,
    };
    return source;
  });
  return caseRecord({ ...row, draft }, row.owner_id);
}

function toApiUser(row: AppUserRow): ApiUser {
  return { id: row.id, loginName: row.login_name, displayName: row.display_name, role: row.role, maskedReference: row.masked_reference };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function routeCaseId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isUuid(candidate) ? candidate : null;
}

function isExactWebOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.origin === value
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

function requireExactFields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ApiFailure(400, "invalid_input", "รูปแบบคำขอไม่ถูกต้อง");
  }
  return value;
}

function requireString(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.includes("\u0000")) {
    throw new ApiFailure(400, "invalid_input", `ข้อมูล ${field} ไม่ถูกต้อง`);
  }
  return value;
}

function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function secureEquals(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function inTransaction<T>(pool: PgPoolLike, work: (client: PgQueryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function reserveLoginAttempt(pool: PgPoolLike, loginName: string): Promise<string | null> {
  return inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO login_attempt_limits(login_name, attempt_count, window_started_at, blocked_until, updated_at)
       VALUES ($1, 0, now(), NULL, now()) ON CONFLICT (login_name) DO NOTHING`,
      [loginName],
    );
    const selected = await client.query<{ attempt_count: number; window_started_at: Date | string; blocked_until: Date | string | null }>(
      "SELECT attempt_count, window_started_at, blocked_until FROM login_attempt_limits WHERE login_name=$1 FOR UPDATE",
      [loginName],
    );
    const limit = selected.rows[0]!;
    const timestamp = Date.now();
    let attemptCount = limit.attempt_count;
    if (new Date(limit.window_started_at).getTime() + LOGIN_WINDOW_MS <= timestamp) {
      attemptCount = 0;
      await client.query(
        "UPDATE login_attempt_limits SET attempt_count=0, window_started_at=now(), blocked_until=NULL, updated_at=now() WHERE login_name=$1",
        [loginName],
      );
    } else if (limit.blocked_until && new Date(limit.blocked_until).getTime() > timestamp) {
      return null;
    }
    await client.query("DELETE FROM login_attempt_reservations WHERE login_name=$1 AND expires_at<=now()", [loginName]);
    const reservations = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM login_attempt_reservations WHERE login_name=$1",
      [loginName],
    );
    if (attemptCount + (reservations.rows[0]?.count ?? 0) >= LOGIN_LIMIT) return null;
    const reservationId = randomUUID();
    await client.query(
      "INSERT INTO login_attempt_reservations(reservation_id, login_name, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 millisecond'))",
      [reservationId, loginName, LOGIN_RESERVATION_MS],
    );
    return reservationId;
  });
}

async function finishLoginAttempt(pool: PgPoolLike, loginName: string, reservationId: string, succeeded: boolean): Promise<void> {
  await inTransaction(pool, async (client) => {
    await client.query("SELECT login_name FROM login_attempt_limits WHERE login_name=$1 FOR UPDATE", [loginName]);
    await client.query("DELETE FROM login_attempt_reservations WHERE reservation_id=$1 AND login_name=$2", [reservationId, loginName]);
    if (succeeded) {
      await client.query(
        "UPDATE login_attempt_limits SET attempt_count=0, window_started_at=now(), blocked_until=NULL, updated_at=now() WHERE login_name=$1",
        [loginName],
      );
      return;
    }
    await client.query(
      `UPDATE login_attempt_limits SET
         attempt_count=CASE WHEN window_started_at < now() - interval '1 hour' THEN 1 ELSE attempt_count + 1 END,
         window_started_at=CASE WHEN window_started_at < now() - interval '1 hour' THEN now() ELSE window_started_at END,
         blocked_until=CASE WHEN (CASE WHEN window_started_at < now() - interval '1 hour' THEN 1 ELSE attempt_count + 1 END) >= ${LOGIN_LIMIT}
           THEN now() + interval '1 hour' ELSE NULL END,
         updated_at=now() WHERE login_name=$1`,
      [loginName],
    );
  });
}

function normalizeSourceIds(draft: FtcCaseDraft): FtcCaseDraft {
  const result = structuredClone(draft);
  const suppliedIds = result.sources.flatMap((source) => source.id === null ? [] : [source.id.toLowerCase()]);
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    throw new ApiFailure(400, "invalid_input", "รหัสแหล่งเงินได้ซ้ำกัน");
  }
  for (const source of result.sources) source.id = source.id?.toLowerCase() ?? randomUUID();
  return result;
}

function addExplicitConfirmations(
  candidate: FtcCaseDraft,
  saved: FtcCaseDraft,
  flags: { thaiTax: boolean; eligibleSourceIds: string[]; eligibleSourceIndexes: number[] },
): FtcCaseDraft {
  const clean = stripStaleConfirmations(structuredClone(candidate));
  // Confirmation stamps are server-owned even when a caller submits a current-looking fingerprint.
  clean.thaiTax.confirmedAt = null;
  clean.thaiTax.confirmedInputFingerprint = null;
  for (const source of clean.sources) {
    source.eligibilityConfirmedAt = null;
    source.eligibilityConfirmedInputFingerprint = null;
  }
  const savedSources = new Map(saved.sources.filter((source) => source.id).map((source) => [source.id as string, source]));

  if (flags.thaiTax) {
    if (clean.thaiTax.amountBeforeFtc === null || !clean.thaiTax.provenance?.trim()) {
      throw new ApiFailure(422, "invalid_input", "กรุณาระบุภาษีไทยและแหล่งที่มาก่อนยืนยัน");
    }
    clean.thaiTax.confirmedAt = new Date().toISOString();
    clean.thaiTax.confirmedInputFingerprint = taxInputFingerprint(clean);
  } else if (isThaiTaxConfirmationCurrent(saved)) {
    const oldFingerprint = taxInputFingerprint(saved);
    if (oldFingerprint === taxInputFingerprint(clean)) {
      clean.thaiTax.confirmedAt = saved.thaiTax.confirmedAt;
      clean.thaiTax.confirmedInputFingerprint = saved.thaiTax.confirmedInputFingerprint;
    }
  }

  for (const [index, source] of clean.sources.entries()) {
    const previous = source.id ? savedSources.get(source.id) : undefined;
    const askedToConfirm = Boolean((source.id && flags.eligibleSourceIds.includes(source.id)) || flags.eligibleSourceIndexes.includes(index));
    if (askedToConfirm) {
      if (source.eligibleForeignTax === null || !source.eligibilityRationale?.trim()) {
        throw new ApiFailure(422, "invalid_input", "กรุณาระบุภาษีที่ใช้เป็นฐานและเหตุผลก่อนยืนยัน");
      }
      source.eligibilityConfirmedAt = new Date().toISOString();
      source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
    } else if (previous && isSourceEligibilityConfirmationCurrent(previous) && sourceEligibilityFingerprint(previous) === sourceEligibilityFingerprint(source)) {
      source.eligibilityConfirmedAt = previous.eligibilityConfirmedAt;
      source.eligibilityConfirmedInputFingerprint = previous.eligibilityConfirmedInputFingerprint;
    }
  }
  return clean;
}

async function persistSourceRows(client: PgQueryable, caseId: string, draft: FtcCaseDraft): Promise<void> {
  const retained = draft.sources.map((source) => source.id as string);
  const clearedRemittanceIds = draft.sources.flatMap((source) => source.id && !source.remittance ? [source.id] : []);
  const referencedEvidence = retained.length
    ? await client.query<{ id: string }>(
      `SELECT a.id FROM attachments a
       LEFT JOIN remittances r ON r.case_id=a.case_id AND r.id=a.remittance_id
       WHERE a.case_id=$1 AND (
         (a.source_id IS NOT NULL AND NOT (a.source_id=ANY($2::uuid[]))) OR
         (r.id IS NOT NULL AND (NOT (r.source_id=ANY($2::uuid[])) OR r.source_id=ANY($3::uuid[])))
       ) LIMIT 1`,
      [caseId, retained, clearedRemittanceIds],
    )
    : await client.query<{ id: string }>(
      `SELECT a.id FROM attachments a
       LEFT JOIN remittances r ON r.case_id=a.case_id AND r.id=a.remittance_id
       WHERE a.case_id=$1 AND (a.source_id IS NOT NULL OR r.id IS NOT NULL) LIMIT 1`,
      [caseId],
    );
  if (referencedEvidence.rows.length) {
    throw new ApiFailure(409, "conflict", "กรุณาจัดการหลักฐานที่เชื่อมกับแหล่งเงินได้หรือรายการโอนก่อนลบหรือแก้ไขรายการนั้น");
  }
  if (retained.length) {
    await client.query("DELETE FROM exchange_rate_references WHERE case_id=$1 AND NOT (source_id = ANY($2::uuid[]))", [caseId, retained]);
    await client.query("DELETE FROM remittances WHERE case_id=$1 AND NOT (source_id = ANY($2::uuid[]))", [caseId, retained]);
    await client.query("DELETE FROM foreign_income_sources WHERE case_id = $1 AND NOT (id = ANY($2::uuid[]))", [caseId, retained]);
  } else {
    await client.query("DELETE FROM exchange_rate_references WHERE case_id=$1", [caseId]);
    await client.query("DELETE FROM remittances WHERE case_id=$1", [caseId]);
    await client.query("DELETE FROM foreign_income_sources WHERE case_id = $1", [caseId]);
  }

  for (const [position, source] of draft.sources.entries()) {
    const id = source.id as string;
    await client.query(
      `INSERT INTO foreign_income_sources (
        id, case_id, position, country_code, country_name, income_type, subtype, earned_tax_year, earned_date, residence_days_in_earned_year,
        input_mode, gross_income_amount, currency_code, gross_income_thb, actual_foreign_tax_paid, actual_foreign_tax_paid_thb,
        eligible_foreign_tax, eligible_foreign_tax_thb, eligibility_rationale, eligibility_confirmed_at,
        eligibility_confirmed_input_fingerprint, remitted_income_amount, remitted_income_thb, fx_reference,
        unsupported_classification, unsupported_explanation, source_data
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12::numeric, $13, $14::numeric,
        $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19, $20::timestamptz, $21,
        $22::numeric, $23::numeric, $24::jsonb, $25, $26, $27::jsonb
      ) ON CONFLICT (id) DO UPDATE SET
        case_id=EXCLUDED.case_id, position=EXCLUDED.position, country_code=EXCLUDED.country_code, country_name=EXCLUDED.country_name,
        income_type=EXCLUDED.income_type, subtype=EXCLUDED.subtype, earned_tax_year=EXCLUDED.earned_tax_year,
        earned_date=EXCLUDED.earned_date, residence_days_in_earned_year=EXCLUDED.residence_days_in_earned_year,
        input_mode=EXCLUDED.input_mode, gross_income_amount=EXCLUDED.gross_income_amount, currency_code=EXCLUDED.currency_code,
        gross_income_thb=EXCLUDED.gross_income_thb, actual_foreign_tax_paid=EXCLUDED.actual_foreign_tax_paid,
        actual_foreign_tax_paid_thb=EXCLUDED.actual_foreign_tax_paid_thb, eligible_foreign_tax=EXCLUDED.eligible_foreign_tax,
        eligible_foreign_tax_thb=EXCLUDED.eligible_foreign_tax_thb, eligibility_rationale=EXCLUDED.eligibility_rationale,
        eligibility_confirmed_at=EXCLUDED.eligibility_confirmed_at,
        eligibility_confirmed_input_fingerprint=EXCLUDED.eligibility_confirmed_input_fingerprint,
        remitted_income_amount=EXCLUDED.remitted_income_amount, remitted_income_thb=EXCLUDED.remitted_income_thb,
        fx_reference=EXCLUDED.fx_reference, unsupported_classification=EXCLUDED.unsupported_classification,
        unsupported_explanation=EXCLUDED.unsupported_explanation, source_data=EXCLUDED.source_data, updated_at=now()`,
      [id, caseId, position, source.countryCode, source.countryName, source.incomeType, source.subtype, source.earnedTaxYear,
        source.earnedDate, source.residenceDaysInEarnedYear, source.inputMode, source.grossIncomeAmount, source.currencyCode,
        source.grossIncomeThb, source.actualForeignTaxPaid, source.actualForeignTaxPaidThb, source.eligibleForeignTax,
        source.eligibleForeignTaxThb, source.eligibilityRationale, source.eligibilityConfirmedAt,
        source.eligibilityConfirmedInputFingerprint, source.remittedIncomeAmount, source.remittedIncomeThb,
        JSON.stringify(source.fxReference), source.unsupportedClassification, source.unsupportedExplanation, JSON.stringify(source)],
    );

    if (source.remittance) {
      await client.query(
        `INSERT INTO remittances (case_id, source_id, remittance_date, transfer_total_amount, transfer_currency_code,
          transfer_total_thb, classification, classification_note)
         VALUES ($1::uuid, $2::uuid, $3::date, $4::numeric, $5, $6::numeric, $7, $8)
         ON CONFLICT (source_id) DO UPDATE SET remittance_date=EXCLUDED.remittance_date,
          transfer_total_amount=EXCLUDED.transfer_total_amount, transfer_currency_code=EXCLUDED.transfer_currency_code,
          transfer_total_thb=EXCLUDED.transfer_total_thb, classification=EXCLUDED.classification,
          classification_note=EXCLUDED.classification_note, updated_at=now()`,
        [caseId, id, source.remittance.remittanceDate, source.remittance.transferTotalAmount, source.remittance.transferCurrencyCode,
          source.remittance.transferTotalThb, source.remittance.classification, source.remittance.classificationNote],
      );
    } else {
      await client.query("DELETE FROM remittances WHERE source_id = $1", [id]);
    }

    if (source.fxReference) {
      const fx = source.fxReference;
      await client.query(
        `INSERT INTO exchange_rate_references (case_id, source_id, currency_code, thb_rate, base_units, effective_date,
          rate_type, source_kind, source_label, source_url, educational_assumption)
         VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5, $6::date, $7, $8, $9, $10, $11)
         ON CONFLICT (source_id) DO UPDATE SET currency_code=EXCLUDED.currency_code, thb_rate=EXCLUDED.thb_rate,
          base_units=EXCLUDED.base_units, effective_date=EXCLUDED.effective_date, rate_type=EXCLUDED.rate_type,
          source_kind=EXCLUDED.source_kind, source_label=EXCLUDED.source_label, source_url=EXCLUDED.source_url,
          educational_assumption=EXCLUDED.educational_assumption`,
        [caseId, id, fx.currencyCode, fx.thbRate, fx.baseUnits, fx.effectiveDate, fx.rateType,
          fx.sourceKind, fx.sourceLabel, fx.sourceUrl, fx.educationalAssumption],
      );
    } else {
      await client.query("DELETE FROM exchange_rate_references WHERE source_id = $1", [id]);
    }
  }
}

export function createApp(options: CreateAppOptions): Express {
  if (!options.pool || options.sessionSecret.length < 32 || !isExactWebOrigin(options.allowedOrigin) ||
    (options.trustedHttps && !options.allowedOrigin.startsWith("https://"))) {
    throw new Error("The hosted API requires a database pool, a 32-character session secret, and one allowed origin.");
  }

  const app = express();
  const now = options.clock ?? Date.now;
  const environment: RuntimeEnvironmentConfig = options.environment ?? {
    kind: "local",
    databaseFingerprint: createHash("sha256").update(`local:${options.allowedOrigin}`).digest("hex"),
    storageStore: "ftc-evidence-local",
    storageRegion: "us-east-2",
    deploymentContext: "dev",
  };
  const cookieName = options.sessionCookieName ?? "ftc.sid";
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((request, response, next) => {
    response.locals.requestId = randomUUID();
    if (request.path === "/api" || request.path.startsWith("/api/")) {
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Vary", "Cookie, Origin");
    }
    next();
  });
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(async (request, response, next) => {
    if (!/^\/api\/(auth|cases|attachments|officer|snapshots)(\/|$)/.test(request.path)) { next(); return; }
    try {
      response.locals.environmentMarker = await ensureEnvironmentMarker(options.pool, environment);
      next();
    } catch (error) {
      next(error);
    }
  });
  // HTTPS is asserted by the Netlify adapter configuration, never inferred from
  // forwarding headers that an incoming client could supply.
  app.use((request, _response, next) => {
    if (options.trustedHttps) Object.defineProperty(request, "secure", { configurable: true, value: true });
    next();
  });
  const sessionMiddleware = session({
    name: cookieName,
    store: new PG_SESSION({ pool: options.pool as never, tableName: "user_sessions", createTableIfMissing: false, pruneSessionInterval: false }),
    secret: options.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: options.trustedHttps, sameSite: "lax", path: "/", maxAge: SESSION_IDLE_MS },
  });

  app.use("/api", (request, response, next) => {
    if (isMutation(request.method) && request.get("Origin") !== options.allowedOrigin) {
      apiError(response, 403, "forbidden", "ไม่อนุญาตต้นทางคำขอนี้");
      return;
    }
    next();
  });

  app.get("/api/health", (_request, response) => {
    sendApiSuccess(response, apiSuccessSchemas.health, { status: "ok" }, response.locals.requestId);
  });
  app.use(["/api/auth/login", "/api/auth/session", "/api/auth/logout", "/api/cases", "/api/cases/:id", "/api/cases/:id/draft", "/api/attachments", "/api/officer", "/api/snapshots"], sessionMiddleware);

  const authenticated = async (request: Request, response: Response, next: (error?: unknown) => void) => {
    const sessionData = request.session;
    const timestamp = now();
    if (!sessionData.userId || !sessionData.createdAt || !sessionData.lastActiveAt ||
      timestamp - sessionData.lastActiveAt > SESSION_IDLE_MS || timestamp - sessionData.createdAt > SESSION_ABSOLUTE_MS) {
      if (sessionData.userId) await new Promise<void>((resolve) => sessionData.destroy(() => resolve()));
      apiError(response, 401, "unauthenticated", "กรุณาเข้าสู่ระบบอีกครั้ง");
      return;
    }
    try {
      const result = await options.pool.query<AppUserRow>(
        `SELECT users.id, users.login_name, users.display_name, profiles.masked_reference, users.role, users.active
         FROM app_users AS users LEFT JOIN user_profiles AS profiles ON profiles.user_id=users.id WHERE users.id=$1`,
        [sessionData.userId],
      );
      const user = result.rows[0];
      if (!user || !user.active) {
        await new Promise<void>((resolve) => sessionData.destroy(() => resolve()));
        apiError(response, 401, "unauthenticated", "กรุณาเข้าสู่ระบบอีกครั้ง");
        return;
      }
      sessionData.lastActiveAt = timestamp;
      response.locals.user = toApiUser(user);
      sessionData.save((error) => error ? next(error) : next());
    } catch (error) {
      next(error);
    }
  };

  const csrf = (request: Request, response: Response, next: (error?: unknown) => void) => {
    if (!secureEquals(request.session.csrfToken, request.get("X-CSRF-Token"))) {
      apiError(response, 403, "forbidden", "โทเคนความปลอดภัยของคำขอไม่ถูกต้อง");
      return;
    }
    next();
  };

  const taxpayerOnly = (_request: Request, response: Response, next: (error?: unknown) => void) => {
    if ((response.locals.user as ApiUser | undefined)?.role !== "taxpayer") {
      apiError(response, 403, "forbidden", "ไม่มีสิทธิ์เข้าถึงรายการผู้เสียภาษี");
      return;
    }
    next();
  };

  app.post("/api/auth/login", async (request, response, next) => {
    try {
      const body = requireExactFields(request.body, ["loginName", "password"]);
      const loginName = requireString(body.loginName, "ชื่อผู้ใช้", 80).trim().toLowerCase();
      const password = requireString(body.password, "รหัสผ่าน", 1024);
      const reservationId = await reserveLoginAttempt(options.pool, loginName);
      if (!reservationId) {
        apiError(response, 429, "rate_limited", "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่");
        return;
      }
      const result = await options.pool.query<AppUserRow>(
        `SELECT users.id, users.login_name, users.display_name, profiles.masked_reference, users.role, users.active, users.password_hash
         FROM app_users AS users LEFT JOIN user_profiles AS profiles ON profiles.user_id=users.id WHERE users.login_name=$1`,
        [loginName],
      );
      const user = result.rows[0];
      const passwordValid = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash);
      const succeeded = Boolean(user && user.active && passwordValid);
      await finishLoginAttempt(options.pool, loginName, reservationId, succeeded);
      if (!user || !user.active || !passwordValid) {
        apiError(response, 401, "unauthenticated", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
        return;
      }
      await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
      const sessionTimestamp = now();
      request.session.userId = user.id;
      request.session.csrfToken = randomBytes(32).toString("hex");
      request.session.createdAt = sessionTimestamp;
      request.session.lastActiveAt = sessionTimestamp;
      request.session.cookie.maxAge = SESSION_IDLE_MS;
      await new Promise<void>((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
      sendApiSuccess(response, apiSuccessSchemas.session, { user: toApiUser(user), csrfToken: request.session.csrfToken }, response.locals.requestId);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/session", authenticated, (request, response) => {
    sendApiSuccess(response, apiSuccessSchemas.session, { user: response.locals.user as ApiUser, csrfToken: request.session.csrfToken }, response.locals.requestId);
  });

  app.post("/api/auth/logout", authenticated, csrf, async (request, response, next) => {
    try {
      await new Promise<void>((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
      response.clearCookie(cookieName, { path: "/", httpOnly: true, secure: options.trustedHttps, sameSite: "lax" });
      sendApiSuccess(response, apiSuccessSchemas.logout, { loggedOut: true }, response.locals.requestId);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cases", authenticated, taxpayerOnly, async (_request, response, next) => {
    try {
      const result = await options.pool.query<CaseRow>(
        "SELECT * FROM ftc_cases WHERE owner_id=$1 AND environment_marker_id=$2 ORDER BY updated_at DESC, id",
        [(response.locals.user as ApiUser).id, (response.locals.environmentMarker as EnvironmentMarker).id],
      );
      const cases = await Promise.all(result.rows.map((row) => loadCaseRecord(options.pool, row)));
      sendApiSuccess(response, apiSuccessSchemas.cases, { cases }, response.locals.requestId);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/cases", authenticated, taxpayerOnly, csrf, async (request, response, next) => {
    try {
      const body = requireExactFields(request.body, ["requestId"]);
      const requestId = requireString(body.requestId, "requestId", 128);
      const user = response.locals.user as ApiUser;
      const marker = response.locals.environmentMarker as EnvironmentMarker;
      const result = await inTransaction(options.pool, async (client) => {
        await client.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [user.id]);
        const existing = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE owner_id=$1 AND environment_marker_id=$2 AND create_request_id=$3", [user.id, marker.id, requestId]);
        if (existing.rows[0]) return { row: existing.rows[0], created: false };
        const count = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM ftc_cases WHERE owner_id=$1 AND environment_marker_id=$2", [user.id, marker.id]);
        if ((count.rows[0]?.count ?? 0) >= 10) throw new ApiFailure(429, "rate_limited", "บัญชีนี้มีแบบร่างครบ 10 รายการแล้ว");
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        const draft = createEmptyDraft();
        draft.id = id;
        draft.revision = 0;
        draft.createdAt = timestamp;
        draft.updatedAt = timestamp;
        const created = await client.query<CaseRow>(
          `INSERT INTO ftc_cases(id, owner_id, draft, create_request_id, environment_marker_id)
           VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, $5::uuid) RETURNING *`,
          [id, user.id, JSON.stringify(draft), requestId, marker.id],
        );
        return { row: created.rows[0] as CaseRow, created: true };
      });
      const record = await loadCaseRecord(options.pool, result.row);
      sendApiSuccess(response, apiSuccessSchemas.case, { case: record }, response.locals.requestId, result.created ? 201 : 200);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/cases/:id/draft", authenticated, taxpayerOnly, csrf, async (request, response, next) => {
    try {
      const id = routeCaseId(request.params.id);
      if (!id) throw new ApiFailure(404, "not_found", "ไม่พบข้อมูลรายการนี้");
      const body = requireExactFields(request.body, ["expectedRevision", "requestId", "data", "confirmations"]);
      if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) throw new ApiFailure(400, "invalid_input", "expectedRevision ไม่ถูกต้อง");
      const requestId = requireString(body.requestId, "requestId", 128);
      const confirmations = body.confirmations === undefined ? { thaiTax: false, eligibleSourceIds: [], eligibleSourceIndexes: [] } : body.confirmations;
      if (!isRecord(confirmations) || Object.keys(confirmations).some((key) => !["thaiTax", "eligibleSourceIds", "eligibleSourceIndexes"].includes(key)) ||
        typeof confirmations.thaiTax !== "boolean" ||
        (confirmations.eligibleSourceIds !== undefined && (!Array.isArray(confirmations.eligibleSourceIds) ||
          confirmations.eligibleSourceIds.some((id) => typeof id !== "string"))) ||
        (confirmations.eligibleSourceIndexes !== undefined && (!Array.isArray(confirmations.eligibleSourceIndexes) ||
          confirmations.eligibleSourceIndexes.some((index) => !Number.isSafeInteger(index) || (index as number) < 0)))) {
        throw new ApiFailure(400, "invalid_input", "ข้อมูลการยืนยันไม่ถูกต้อง");
      }
      const parsed = draftSchema.safeParse(body.data);
      if (!parsed.success) {
        throw new ApiFailure(422, "invalid_input", "ข้อมูลแบบร่างไม่ถูกต้อง", parsed.error.issues.map((issue) => ({
          code: issue.code, message: issue.message, path: issue.path,
        })));
      }
      const canonicalDraft = withCanonicalThbAmounts(parsed.data);
      if (canonicalDraft.sources.some((source) => source.id !== null && !isUuid(source.id))) {
        throw new ApiFailure(400, "invalid_input", "รหัสแหล่งเงินได้ไม่ถูกต้อง");
      }
      for (const source of canonicalDraft.sources) {
        if (source.id !== null) source.id = source.id.toLowerCase();
      }
      const suppliedSourceIds = canonicalDraft.sources.flatMap((source) => source.id === null ? [] : [source.id]);
      if (new Set(suppliedSourceIds).size !== suppliedSourceIds.length) {
        throw new ApiFailure(400, "invalid_input", "รหัสแหล่งเงินได้ซ้ำกัน");
      }
      const confirmedIds = ((confirmations.eligibleSourceIds ?? []) as string[]).map((id) => id.toLowerCase());
      const confirmedIndexes = (confirmations.eligibleSourceIndexes ?? []) as number[];
      if (new Set(confirmedIds).size !== confirmedIds.length || new Set(confirmedIndexes).size !== confirmedIndexes.length ||
        confirmedIndexes.some((index) => index >= canonicalDraft.sources.length) ||
        confirmedIds.some((id) => !canonicalDraft.sources.some((source) => source.id === id)) ||
        confirmedIndexes.some((index) => {
          const id = canonicalDraft.sources[index]?.id;
          return id !== null && id !== undefined && confirmedIds.includes(id);
        })) {
        throw new ApiFailure(400, "invalid_input", "รายการแหล่งเงินได้ที่เลือกยืนยันไม่ถูกต้อง");
      }
      const user = response.locals.user as ApiUser;
      const marker = response.locals.environmentMarker as EnvironmentMarker;
      const normalizedConfirmations = { thaiTax: confirmations.thaiTax as boolean, eligibleSourceIds: confirmedIds, eligibleSourceIndexes: confirmedIndexes };
      const payloadDigest = digest({ expectedRevision: body.expectedRevision, data: canonicalDraft, confirmations: normalizedConfirmations });
      const result = await inTransaction(options.pool, async (client) => {
        const locked = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1 AND owner_id=$2 AND environment_marker_id=$3 FOR UPDATE", [id, user.id, marker.id]);
        const row = locked.rows[0];
        if (!row) throw new ApiFailure(404, "not_found", "ไม่พบข้อมูลรายการนี้");
        const prior = await client.query<{ request_digest: string; response: { case: FtcCaseRecord } }>(
          "SELECT request_digest, response FROM api_mutation_requests WHERE case_id=$1 AND operation='save-draft' AND request_id=$2",
          [row.id, requestId],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].request_digest !== payloadDigest) throw new ApiFailure(409, "conflict", "requestId นี้ถูกใช้กับคำขออื่นแล้ว");
          return { record: prior.rows[0].response.case, replayed: true };
        }
        if (row.status !== "draft") throw new ApiFailure(409, "conflict", "รายการที่ส่งแล้วแก้ไขไม่ได้");
        if (row.revision !== body.expectedRevision) throw new ApiFailure(409, "conflict", "ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดแบบร่างล่าสุด");
        if (suppliedSourceIds.length) {
          const ownedSourceRows = await client.query<{ id: string }>(
            "SELECT id FROM foreign_income_sources WHERE id=ANY($1::uuid[]) AND case_id=$2",
            [suppliedSourceIds, row.id],
          );
          if (ownedSourceRows.rows.length !== suppliedSourceIds.length) {
            throw new ApiFailure(409, "conflict", "รหัสแหล่งเงินได้ต้องเป็นรหัสที่ระบบสร้างไว้ในรายการนี้");
          }
        }
        const incoming = normalizeSourceIds(canonicalDraft);
        incoming.id = row.id;
        incoming.revision = row.revision + 1;
        incoming.createdAt = new Date(row.created_at).toISOString();
        incoming.updatedAt = new Date().toISOString();
        const current = asDraft(row.draft);
        const updated = addExplicitConfirmations(incoming, current, normalizedConfirmations);
        updated.revision = row.revision + 1;
        updated.id = row.id;
        updated.createdAt = incoming.createdAt;
        updated.updatedAt = incoming.updatedAt;
        await client.query(
          `UPDATE ftc_cases SET tax_year=$3, domestic_assessable_income=$4::numeric,
             thai_tax_before_ftc=$5::numeric, thai_tax_provenance=$6, thai_tax_confirmed_at=$7::timestamptz,
             thai_tax_confirmed_input_fingerprint=$8, draft=$9::jsonb, revision=revision+1, updated_at=now()
           WHERE id=$1 AND owner_id=$2`,
          [row.id, user.id, updated.taxYear, updated.domesticAssessableIncome, updated.thaiTax.amountBeforeFtc,
            updated.thaiTax.provenance, updated.thaiTax.confirmedAt, updated.thaiTax.confirmedInputFingerprint, JSON.stringify(updated)],
        );
        await persistSourceRows(client, row.id, updated);
        const refreshed = await client.query<CaseRow>("SELECT * FROM ftc_cases WHERE id=$1", [row.id]);
        const record = await loadCaseRecord(client, refreshed.rows[0] as CaseRow);
        await client.query(
          `INSERT INTO api_mutation_requests(case_id, request_id, operation, request_digest, response)
           VALUES ($1, $2, 'save-draft', $3, $4::jsonb)`,
          [row.id, requestId, payloadDigest, JSON.stringify({ case: record })],
        );
        return { record, replayed: false };
      });
      sendApiSuccess(response, apiSuccessSchemas.case, { case: result.record }, response.locals.requestId);
    } catch (error) { next(error); }
  });

  registerWorkflowRoutes(app, {
    pool: options.pool,
    authenticated,
    taxpayerOnly,
    csrf,
    blobIO: options.blobIO,
    officerUserId: options.officerUserId,
    environmentMarker: (response) => response.locals.environmentMarker as EnvironmentMarker,
    apiError,
  });

  app.use("/api", (_request, response) => apiError(response, 404, "not_found", "ไม่พบเส้นทาง API"));
  app.use((_request, response) => response.status(404).send("Not found"));

  const structuredApiErrors: ErrorRequestHandler = (error: unknown, request, response, next) => {
    if (!request.path.startsWith("/api")) {
      next(error);
      return;
    }
    if (response.headersSent) return;
    if (error instanceof ApiFailure) {
      apiError(response, error.status, error.code, error.message, error.fields);
      return;
    }
    const parserError = error as { status?: number; type?: string };
    if (parserError.status === 400 && parserError.type === "entity.parse.failed") {
      apiError(response, 400, "invalid_input", "ข้อมูล JSON ไม่ถูกต้อง");
      return;
    }
    if (parserError.status === 413) {
      apiError(response, 413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินกำหนด");
      return;
    }
    const multipartError = error as { name?: string; code?: string };
    if (multipartError.name === "MulterError") {
      if (multipartError.code === "LIMIT_FILE_SIZE") apiError(response,413,"payload_too_large","ไฟล์มีขนาดใหญ่เกินกำหนด");
      else apiError(response,400,"invalid_input","ข้อมูลไฟล์แนบไม่ถูกต้อง");
      return;
    }
    apiError(response, 503, "service_unavailable", "บริการไม่พร้อมใช้งาน");
  };
  app.use(structuredApiErrors);
  return app;
}

/** Default application uses the Netlify Database SDK with its explicit legacy Function URL. */
export const app = createApp({
  pool: makeRuntimePool(),
  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString("hex"),
  allowedOrigin: process.env.FTC_ALLOWED_ORIGIN ?? "https://invalid.invalid",
  trustedHttps: process.env.NETLIFY === "true",
});
