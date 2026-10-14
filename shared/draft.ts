import { Decimal } from "decimal.js";
import { z } from "zod";
import type { FtcCaseDraft, ForeignIncomeSourceDraft } from "./contracts.js";

const decimalInputPattern = /^\d{1,9}(?:\.\d{1,2})?$/;
const decimalDerivedPattern = /^\d{1,18}(?:\.\d{1,12})?$/;
const decimalRatePattern = /^\d{1,7}(?:\.\d{1,8})?$/;

function decimalString(pattern: RegExp, max: string, positive = false) {
  return z.string().regex(pattern).refine((value) => {
    try {
      const parsed = new Decimal(value);
      return parsed.lte(max) && (!positive || parsed.gt(0));
    } catch {
      return false;
    }
  });
}

const moneyInput = decimalString(decimalInputPattern, "999999999.99");
const moneyDerived = decimalString(decimalDerivedPattern, "999999999999999999.999999999999");
const rate = decimalString(decimalRatePattern, "1000000", true);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const safeText = z.string().refine((value) => !value.includes("\u0000"), "NUL characters are not supported");
const shortText = (maximum = 500) => safeText.max(maximum);
const nullableText = (maximum = 500) => nullable(shortText(maximum));

export const emptySource: ForeignIncomeSourceDraft = {
  id: null, countryCode: null, countryName: null, incomeType: null, subtype: null,
  earnedTaxYear: null, earnedDate: null, residenceDaysInEarnedYear: null, inputMode: null,
  grossIncomeAmount: null, currencyCode: null, grossIncomeThb: null,
  actualForeignTaxPaid: null, actualForeignTaxPaidThb: null, eligibleForeignTax: null, eligibleForeignTaxThb: null,
  eligibilityRationale: null, eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null,
  remittance: null, remittedIncomeAmount: null, remittedIncomeThb: null, fxReference: null,
  unsupportedClassification: null, unsupportedExplanation: null, evidenceChecklist: [],
};

export const emptyDraft: FtcCaseDraft = {
  id: null, taxYear: null, domesticAssessableIncome: null,
  thaiTax: { amountBeforeFtc: null, provenance: null, confirmedAt: null, confirmedInputFingerprint: null },
  sources: [], revision: 0, createdAt: null, updatedAt: null,
};

export function createEmptyDraft(): FtcCaseDraft {
  return { ...emptyDraft, thaiTax: { ...emptyDraft.thaiTax }, sources: [] };
}

export function createEmptySource(): ForeignIncomeSourceDraft {
  return { ...emptySource, evidenceChecklist: [] };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
});
const isoDateTime = z.string().datetime({ offset: true });

export const exchangeRateReferenceSchema = z.object({
  currencyCode: nullable(z.string().regex(/^[A-Z]{3}$/)),
  thbRate: nullable(rate),
  baseUnits: z.union([z.literal(1), z.literal(100)]).nullable(),
  effectiveDate: nullable(isoDate),
  rateType: z.enum(["bank_buying", "bot_average_buying", "manual", "fixture"]).nullable(),
  sourceKind: z.enum(["bank", "bot", "user_supplied", "fixture"]).nullable(),
  sourceLabel: nullableText(200),
  sourceUrl: nullableText(1000),
  educationalAssumption: nullableText(1000),
}).strict();

export const remittanceDraftSchema = z.object({
  remittanceDate: nullable(isoDate),
  transferTotalAmount: nullable(moneyInput),
  transferCurrencyCode: nullable(z.string().regex(/^[A-Z]{3}$/)),
  transferTotalThb: nullable(moneyDerived),
  classification: z.enum(["income_only", "mixed_principal_and_income", "gross_net_ambiguous", "tax_refund", "unknown"]).nullable(),
  classificationNote: nullableText(1000),
}).strict();

const foreignIncomeSourceBaseSchema = z.object({
  id: nullable(safeText.min(1).max(100)),
  countryCode: nullable(z.string().regex(/^[A-Z]{2}$/)),
  countryName: nullableText(100),
  incomeType: z.enum(["salary_40_1", "dividend_40_4", "other"]).nullable(),
  subtype: nullableText(100),
  earnedTaxYear: nullable(z.number().int().min(1900).max(2200)),
  earnedDate: nullable(isoDate),
  residenceDaysInEarnedYear: nullable(z.number().int().min(0).max(365)),
  inputMode: z.enum(["worksheet_thb", "original_currency"]).nullable(),
  grossIncomeAmount: nullable(moneyInput),
  currencyCode: nullable(z.string().regex(/^[A-Z]{3}$/)),
  grossIncomeThb: nullable(moneyDerived),
  actualForeignTaxPaid: nullable(moneyInput),
  actualForeignTaxPaidThb: nullable(moneyDerived),
  eligibleForeignTax: nullable(moneyInput),
  eligibleForeignTaxThb: nullable(moneyDerived),
  eligibilityRationale: nullableText(1000),
  eligibilityConfirmedAt: nullable(isoDateTime),
  eligibilityConfirmedInputFingerprint: nullable(safeText.max(100000)),
  remittance: nullable(remittanceDraftSchema),
  remittedIncomeAmount: nullable(moneyInput),
  remittedIncomeThb: nullable(moneyDerived),
  fxReference: nullable(exchangeRateReferenceSchema),
  unsupportedClassification: z.enum([
    "unsupported_tax_year",
    "cross_year_remittance",
    "nonresident_earned_income",
    "unsupported_income_type",
    "unknown_treaty_treatment",
    "mixed_principal_and_income",
    "ambiguous_gross_net",
    "tax_refund",
    "multiple_remittances",
    "other",
  ]).nullable(),
  unsupportedExplanation: nullableText(2000),
  evidenceChecklist: z.array(z.enum(["foreign_income", "foreign_tax", "remittance", "thai_tax", "other"])).max(5),
}).strict();

export const foreignIncomeSourceDraftSchema = foreignIncomeSourceBaseSchema;

export const thaiTaxConfirmationSchema = z.object({
  amountBeforeFtc: nullable(moneyInput),
  provenance: nullableText(1000),
  confirmedAt: nullable(isoDateTime),
  confirmedInputFingerprint: nullable(safeText.max(2000000)),
}).strict();

export const draftSchema = z.object({
  id: nullable(safeText.min(1).max(100)),
  taxYear: nullable(z.number().int().min(1900).max(2200)),
  domesticAssessableIncome: nullable(moneyInput),
  thaiTax: thaiTaxConfirmationSchema,
  sources: z.array(foreignIncomeSourceDraftSchema).max(20),
  revision: z.number().int().min(0),
  createdAt: nullable(isoDateTime),
  updatedAt: nullable(isoDateTime),
}).strict();

/** Parse the transport shape without filling nulls or coercing decimal inputs. */
export function parseDraft(value: unknown): FtcCaseDraft {
  return draftSchema.parse(value);
}
