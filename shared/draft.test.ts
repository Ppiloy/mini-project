import { describe, expect, it } from "vitest";
import type { FtcCaseDraft } from "./contracts.js";
import { createEmptyDraft, createEmptySource, draftSchema, parseDraft } from "./draft.js";

const emptyDraft: FtcCaseDraft = {
  id: null,
  taxYear: null,
  domesticAssessableIncome: null,
  thaiTax: {
    amountBeforeFtc: null,
    provenance: null,
    confirmedAt: null,
    confirmedInputFingerprint: null,
  },
  sources: [],
  revision: 0,
  createdAt: null,
  updatedAt: null,
};

describe("FTC draft parsing", () => {
  it("exports canonical empty draft and source constructors from shared domain", () => {
    expect(createEmptyDraft()).toEqual(emptyDraft);
    expect(createEmptySource().evidenceChecklist).toEqual([]);
    expect(createEmptySource().grossIncomeAmount).toBeNull();
  });

  it("preserves an empty draft with missing amounts as null rather than zero", () => {
    expect(parseDraft(emptyDraft)).toEqual(emptyDraft);
  });

  it("rejects numeric money values and raw money beyond two decimal places", () => {
    expect(() => parseDraft({ ...emptyDraft, domesticAssessableIncome: 100 })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, domesticAssessableIncome: "1.001" })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, domesticAssessableIncome: "NaN" })).toThrow();
    expect(parseDraft({ ...emptyDraft, domesticAssessableIncome: "999999999.99" }).domesticAssessableIncome).toBe("999999999.99");
    expect(() => parseDraft({ ...emptyDraft, domesticAssessableIncome: "1000000000.00" })).toThrow();
  });

  it("allows converted precision only for derived THB values in original-currency mode", () => {
    const source = {
      id: "s1",
      countryCode: null,
      countryName: null,
      incomeType: null,
      subtype: null,
      earnedTaxYear: null,
      earnedDate: null,
      residenceDaysInEarnedYear: null,
      inputMode: "original_currency",
      grossIncomeAmount: "2.00",
      currencyCode: "USD",
      grossIncomeThb: "70.123456789012",
      actualForeignTaxPaid: null,
      actualForeignTaxPaidThb: null,
      eligibleForeignTax: null,
      eligibleForeignTaxThb: null,
      eligibilityRationale: null,
      eligibilityConfirmedAt: null,
      eligibilityConfirmedInputFingerprint: null,
      remittance: null,
      remittedIncomeAmount: null,
      remittedIncomeThb: null,
      fxReference: null,
      unsupportedClassification: null,
      unsupportedExplanation: null,
      evidenceChecklist: [],
    } as const;
    expect(parseDraft({ ...emptyDraft, sources: [source] }).sources[0]?.grossIncomeThb).toBe("70.123456789012");
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, grossIncomeAmount: "2.001" }] })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, inputMode: "worksheet_thb", currencyCode: "THB", grossIncomeAmount: "2.001" }] })).toThrow();
    expect(parseDraft({ ...emptyDraft, sources: [{ ...source, inputMode: "worksheet_thb", currencyCode: "THB", grossIncomeThb: "70.123456789012" }] }).sources[0]?.grossIncomeThb).toBe("70.123456789012");
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, earnedDate: "2025-02-30" }] })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, grossIncomeThb: "1000000000000000000" }] })).toThrow();
  });

  it("enforces exact FX rate precision, positivity, maximum and quotation units", () => {
    const source = {
      id: "fx-source", countryCode: null, countryName: null, incomeType: null, subtype: null,
      earnedTaxYear: null, earnedDate: null, residenceDaysInEarnedYear: null, inputMode: "original_currency",
      grossIncomeAmount: null, currencyCode: "USD", grossIncomeThb: null,
      actualForeignTaxPaid: null, actualForeignTaxPaidThb: null, eligibleForeignTax: null, eligibleForeignTaxThb: null,
      eligibilityRationale: null, eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null,
      remittance: null, remittedIncomeAmount: null, remittedIncomeThb: null,
      fxReference: { currencyCode: "USD", thbRate: "1000000.00000000", baseUnits: 100, effectiveDate: "2025-01-01", rateType: "manual", sourceKind: "user_supplied", sourceLabel: "test", sourceUrl: null, educationalAssumption: "test" },
      unsupportedClassification: null, unsupportedExplanation: null, evidenceChecklist: [],
    } as const;
    expect(parseDraft({ ...emptyDraft, sources: [source] }).sources[0]?.fxReference?.baseUnits).toBe(100);
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, fxReference: { ...source.fxReference, thbRate: "1000000.00000001" } }] })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, fxReference: { ...source.fxReference, thbRate: "0" } }] })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, fxReference: { ...source.fxReference, thbRate: "1.000000001" } }] })).toThrow();
    expect(() => parseDraft({ ...emptyDraft, sources: [{ ...source, fxReference: { ...source.fxReference, baseUnits: 10 } }] })).toThrow();
  });

  it("rejects NUL characters in text at the shared PostgreSQL transport boundary", () => {
    const invalid = { ...emptyDraft, thaiTax: { ...emptyDraft.thaiTax, provenance: "prepared\u0000source" } };
    const result = draftSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("NUL"))).toBe(true);
  });
});
