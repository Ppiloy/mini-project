import { describe, expect, it } from "vitest";
import type { AttachmentMetadata, FtcCaseDraft, ForeignIncomeSourceDraft } from "./contracts.js";
import { isSourceEligibilityConfirmationCurrent, isThaiTaxConfirmationCurrent, sourceEligibilityFingerprint, taxInputFingerprint } from "./confirmations.js";
import { calculateFTC, validateSubmission, withCanonicalThbAmounts } from "./calculator.js";
import { DEMO_POLICY } from "./policy.js";
import {
  countryLimitAboveFixture,
  countryLimitBelowFixture,
  partialRemittanceFixture,
  quotationPerHundredFixture,
  roundingBoundaryFixture,
  slideDiscrepancyFixture,
  zeroRemittanceFixture,
} from "../src/fixtures/domain.js";

function slideSource(
  id: string,
  countryCode: "VN" | "CN",
  countryName: string,
  income: string,
  eligibleTax: string,
  remitted: string,
): ForeignIncomeSourceDraft {
  const source: ForeignIncomeSourceDraft = {
    id,
    countryCode,
    countryName,
    incomeType: "salary_40_1",
    subtype: null,
    earnedTaxYear: 2025,
    earnedDate: "2025-01-01",
    residenceDaysInEarnedYear: 365,
    inputMode: "worksheet_thb",
    grossIncomeAmount: income,
    currencyCode: "THB",
    grossIncomeThb: "999999.999999",
    actualForeignTaxPaid: eligibleTax,
    actualForeignTaxPaidThb: "999999.999999",
    eligibleForeignTax: eligibleTax,
    eligibleForeignTaxThb: "999999.999999",
    eligibilityRationale: "Prepared slide example; eligibility assumed for education",
    eligibilityConfirmedAt: "2026-10-14T00:00:00.000Z",
    eligibilityConfirmedInputFingerprint: null,
    remittance: {
      remittanceDate: "2025-01-01",
      transferTotalAmount: remitted,
      transferCurrencyCode: "THB",
      transferTotalThb: "999999.999999",
      classification: "income_only",
      classificationNote: null,
    },
    remittedIncomeAmount: remitted,
    remittedIncomeThb: "999999.999999",
    fxReference: null,
    unsupportedClassification: null,
    unsupportedExplanation: null,
    evidenceChecklist: ["foreign_income", "foreign_tax", "remittance"],
  };
  return { ...source, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) };
}

const slideDraftBase: FtcCaseDraft = {
  id: "slide-case",
  taxYear: 2025,
  domesticAssessableIncome: "1000000.00",
  thaiTax: {
    amountBeforeFtc: "318750.00",
    provenance: "Prepared slide example; supplied tax, not computed from J",
    confirmedAt: "2026-10-14T00:00:00.000Z",
    confirmedInputFingerprint: null,
  },
  sources: [
    slideSource("vn", "VN", "Vietnam", "750000.00", "225000.00", "750000.00"),
    slideSource("cn", "CN", "China", "225000.00", "22500.00", "225000.00"),
  ],
  revision: 1,
  createdAt: null,
  updatedAt: null,
};
const slideDraft = {
  ...slideDraftBase,
  thaiTax: { ...slideDraftBase.thaiTax, confirmedInputFingerprint: taxInputFingerprint(slideDraftBase) },
};

function reconfirm(draft: FtcCaseDraft): FtcCaseDraft {
  const sources = draft.sources.map((source) => {
    const next = { ...source, eligibilityConfirmedAt: "2026-10-14T00:00:00.000Z", eligibilityConfirmedInputFingerprint: null };
    return { ...next, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(next) };
  });
  const base = { ...draft, sources, thaiTax: { ...draft.thaiTax, confirmedAt: "2026-10-14T00:00:00.000Z", confirmedInputFingerprint: null } };
  return { ...base, thaiTax: { ...base.thaiTax, confirmedInputFingerprint: taxInputFingerprint(base) } };
}

function withSource(draft: FtcCaseDraft, index: number, changes: Partial<ForeignIncomeSourceDraft>, refresh = true): FtcCaseDraft {
  const sources = draft.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...changes } : source);
  const next = { ...draft, sources };
  return refresh ? reconfirm(next) : next;
}

describe("FTC calculator", () => {
  it("recomputes the slide's displayed formula instead of its discrepant printed total", () => {
    expect(isThaiTaxConfirmationCurrent(slideDraft)).toBe(true);
    expect(slideDraft.sources.every(isSourceEligibilityConfirmationCurrent)).toBe(true);
    const result = calculateFTC(slideDiscrepancyFixture.draft);

    expect(result.outcome).toBe("ready");
    expect(result.totalAssessableIncome).toBe("1975000");
    expect(result.allowableCredit).toBe("143544.30");
    expect(result.countries.map(({ countryCode, displayedAllowableCredit }) => [countryCode, displayedAllowableCredit])).toEqual([
      ["CN", "22500.00"],
      ["VN", "121044.30"],
    ]);
    expect(result.lines.filter(({ code }) => code === "source_D")).toHaveLength(4);
    expect(result.countries.find(({ countryCode }) => countryCode === "VN")?.remittedIncome).toBe("750000");
  });

  it("allocates tax to a partial remittance from original D/E and keeps the source contribution", () => {
    const result = calculateFTC(partialRemittanceFixture.draft);
    expect(result.lines.find(({ code }) => code === "source_share")?.value).toBe("0.5");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(result.countries[0]?.attributableForeignTax).toBe("2500");
  });

  it("caps each country independently below and above its Thai limit", () => {
    const below = calculateFTC(countryLimitBelowFixture.draft);
    const above = calculateFTC(countryLimitAboveFixture.draft);
    expect(below.countries[0]).toMatchObject({ thaiTaxLimit: "10000", attributableForeignTax: "5000", allowableCredit: "5000", displayedAllowableCredit: "5000.00" });
    expect(above.countries[0]).toMatchObject({ thaiTaxLimit: "10000", attributableForeignTax: "15000", allowableCredit: "10000", displayedAllowableCredit: "10000.00" });
  });

  it("rounds the sum of unrounded country credits once and reconciles displayed rows", () => {
    const result = calculateFTC(roundingBoundaryFixture.draft);
    expect(result.countries.map((country) => country.allowableCredit)).toEqual(["0.005", "0.005"]);
    expect(result.countries.map((country) => country.displayedAllowableCredit)).toEqual(["0.01", "0.01"]);
    expect(result.unroundedCountryCreditTotal).toBe("0.01");
    expect(result.allowableCredit).toBe("0.01");
    expect(result.displayRoundingReconciliation).toBe("-0.01");
  });

  it("converts original D/E/F with one quote and its declared per-100 unit, ignoring client THB totals", () => {
    const draft = quotationPerHundredFixture.draft;
    const withForgedTotals = {
      ...draft,
      sources: [{ ...draft.sources[0]!, grossIncomeThb: "999999.999999999999", eligibleForeignTaxThb: "888888.888888888888", remittedIncomeThb: "777777.777777777777" }],
    };
    const result = calculateFTC(withForgedTotals);
    expect(result.totalRemittedIncome).toBe("3500");
    expect(result.lines.find(({ code }) => code === "source_D")?.value).toBe("3500");
    expect(result.lines.find(({ code }) => code === "source_E_eligible")?.value).toBe("1050");
    expect(result.lines.find(({ code }) => code === "source_share")?.value).toBe("1");
    expect(result.lines.find(({ code }) => code === "source_D")?.explanation).toContain("3500.00000000 THB ต่อ 100 USD");
    const canonical = withCanonicalThbAmounts(withForgedTotals).sources[0]!;
    expect(canonical.grossIncomeThb).toBe("3500");
    expect(canonical.eligibleForeignTaxThb).toBe("1050");
    expect(canonical.remittedIncomeThb).toBe("3500");
  });

  it("preserves an explanatory zero-credit calculation for L=0 and zero remittance", () => {
    const zeroRemittanceResult = calculateFTC(zeroRemittanceFixture.draft);
    expect(zeroRemittanceResult.outcome).toBe("ready");
    expect(zeroRemittanceResult.allowableCredit).toBe(zeroRemittanceFixture.expected.allowableCredit);
    expect(zeroRemittanceResult.lines.some(({ code }) => code === "source.zero_contribution")).toBe(true);

    const zeroTax = reconfirm({ ...partialRemittanceFixture.draft, thaiTax: { ...partialRemittanceFixture.draft.thaiTax, amountBeforeFtc: "0.00", confirmedInputFingerprint: null } });
    const zeroTaxResult = calculateFTC(zeroTax);
    expect(zeroTaxResult.outcome).toBe("ready");
    expect(zeroTaxResult.allowableCredit).toBe("0.00");

    const zeroF = reconfirm({
      ...partialRemittanceFixture.draft,
      sources: [{
        ...partialRemittanceFixture.draft.sources[0]!,
        remittedIncomeAmount: "0.00",
        remittance: { ...partialRemittanceFixture.draft.sources[0]!.remittance!, transferTotalAmount: "0.00" },
      }],
    });
    const zeroFResult = calculateFTC(zeroF);
    expect(zeroFResult.outcome).toBe("ready");
    expect(zeroFResult.allowableCredit).toBe("0.00");
    expect(zeroFResult.lines.some(({ code }) => code === "source.zero_contribution")).toBe(true);
  });

  it("rejects a zero D denominator even when F and E are zero", () => {
    const zeroInputs = withSource(partialRemittanceFixture.draft, 0, {
      grossIncomeAmount: "0.00",
      actualForeignTaxPaid: "0.00",
      eligibleForeignTax: "0.00",
      remittedIncomeAmount: "0.00",
    });
    const result = calculateFTC(zeroInputs);
    expect(result.outcome).toBe("needs_review");
    expect(result.allowableCredit).toBeNull();
    expect(result.validationMessages.map(({ code }) => code)).toContain("source.zero_income_denominator");
  });

  it("returns actionable review states for zero denominator, F>D and unsupported residence", () => {
    const base = partialRemittanceFixture.draft;
    const zeroDenominator = withSource(base, 0, { grossIncomeAmount: "0.00" });
    const tooMuchRemitted = withSource(base, 0, { remittedIncomeAmount: "50000.01" });
    const belowResidence = withSource(base, 0, { residenceDaysInEarnedYear: 179 });
    const supportedResidence = withSource(base, 0, { residenceDaysInEarnedYear: 180 });
    expect(calculateFTC(zeroDenominator).validationMessages.map(({ code }) => code)).toContain("source.zero_income_denominator");
    expect(calculateFTC(tooMuchRemitted).validationMessages.map(({ code }) => code)).toContain("source.remitted_exceeds_income");
    expect(calculateFTC(belowResidence).validationMessages.map(({ code }) => code)).toContain("source.nonresident_earned_income");
    expect(calculateFTC(zeroDenominator).allowableCredit).toBeNull();
    expect(calculateFTC(supportedResidence).outcome).toBe("ready");
  });

  it("rejects cross-year facts, mismatched common FX and missing original-currency references", () => {
    const fxDraft = quotationPerHundredFixture.draft;
    const crossYear = withSource(fxDraft, 0, { earnedTaxYear: 2024, earnedDate: "2024-12-31" });
    const mismatchedFx = withSource(fxDraft, 0, { fxReference: { ...fxDraft.sources[0]!.fxReference!, currencyCode: "EUR" } });
    const missingFx = withSource(fxDraft, 0, { fxReference: null });
    expect(calculateFTC(crossYear).validationMessages.map(({ code }) => code)).toContain("source.unsupported_income_year");
    expect(calculateFTC(mismatchedFx).validationMessages.map(({ code }) => code)).toContain("fx.currency_mismatch");
    expect(calculateFTC(missingFx).outcome).toBe("incomplete");
  });

  it("accepts only the exact educational FX fixture and never treats edited quotes as verified", () => {
    const draft = quotationPerHundredFixture.draft;
    const source = draft.sources[0]!;
    const fx = source.fxReference!;
    const editedQuote = withSource(draft, 0, { fxReference: { ...fx, thbRate: "3501.00000000" } });
    const relabeledBankQuote = withSource(draft, 0, {
      fxReference: { ...fx, rateType: "bank_buying", sourceKind: "bank", sourceLabel: "Bank rate" },
    });
    const unverifiedBotQuote = withSource(draft, 0, {
      fxReference: { ...fx, rateType: "bot_average_buying", sourceKind: "bot", sourceLabel: "BOT average buying" },
    });
    const fixtureForDifferentRemittanceDate = withSource(draft, 0, {
      remittance: { ...source.remittance!, remittanceDate: "2025-01-02" },
    });

    expect(calculateFTC(draft).outcome).toBe("ready");
    for (const changed of [editedQuote, relabeledBankQuote, unverifiedBotQuote, fixtureForDifferentRemittanceDate]) {
      const result = calculateFTC(changed);
      expect(result.outcome).toBe("needs_review");
      expect(result.allowableCredit).toBeNull();
      expect(result.validationMessages.map(({ code }) => code)).toContain("fx.reference_unverified");
    }
  });

  it("allows a clearly identified manual quote while keeping it distinct from a verified source", () => {
    const draft = quotationPerHundredFixture.draft;
    const source = draft.sources[0]!;
    const manualFx = {
      ...source.fxReference!,
      rateType: "manual" as const,
      sourceKind: "user_supplied" as const,
      effectiveDate: "2025-01-02",
      sourceLabel: "User supplied bank statement quote, dated 2025-01-02",
      sourceUrl: null,
      educationalAssumption: "User-entered rate for demonstration only; not independently verified.",
    };
    const manual = withSource(draft, 0, { fxReference: manualFx });
    expect(calculateFTC(manual).outcome).toBe("ready");

    const disguisedBot = withSource(draft, 0, {
      fxReference: { ...manualFx, rateType: "bot_average_buying", sourceKind: "bot" },
    });
    expect(calculateFTC(disguisedBot).validationMessages.map(({ code }) => code)).toContain("fx.reference_unverified");
    const missingSource = withSource(draft, 0, {
      fxReference: { ...manualFx, sourceLabel: " " },
    });
    expect(calculateFTC(missingSource).validationMessages.map(({ code }) => code)).toContain("fx.manual_provenance_missing");
  });

  it("blocks contradictory transfer-total facts instead of trusting a free-text note", () => {
    const draft = withSource(partialRemittanceFixture.draft, 0, {
      remittance: { ...partialRemittanceFixture.draft.sources[0]!.remittance!, transferTotalAmount: "30000.00", classificationNote: "F is income only." },
    });
    const result = calculateFTC(draft);
    expect(result.outcome).toBe("needs_review");
    expect(result.allowableCredit).toBeNull();
    expect(result.validationMessages.map(({ code }) => code)).toContain("source.transfer_total_mismatch");

    const internallyConsistent = calculateFTC(partialRemittanceFixture.draft);
    expect(internallyConsistent.lines.find(({ code }) => code === "source_F")?.value).toBe("25000");
    expect(internallyConsistent.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
  });

  it("rejects inherited country keys from a custom policy", () => {
    const usDraft = withSource(partialRemittanceFixture.draft, 0, { countryCode: "US", countryName: "United States" });
    const inheritedCountries = Object.assign(Object.create({ US: "United States" }), DEMO_POLICY.supportedCountries) as Record<string, string>;
    const policy = { ...DEMO_POLICY, supportedCountries: inheritedCountries };
    const result = calculateFTC(usDraft, policy);
    expect(result.outcome).toBe("needs_review");
    expect(result.allowableCredit).toBeNull();
    expect(result.validationMessages.map(({ code }) => code)).toContain("source.unsupported_country");
  });

  it("requires THB explicitly for a ready worksheet source and canonical totals", () => {
    const draft = withSource(partialRemittanceFixture.draft, 0, { currencyCode: null });
    const result = calculateFTC(draft);
    expect(result.outcome).toBe("incomplete");
    expect(result.validationMessages.some(({ code, path }) => code === "input.required" && path?.join(".") === "sources.0.currencyCode")).toBe(true);
    const canonical = withCanonicalThbAmounts(draft).sources[0]!;
    expect(canonical.grossIncomeThb).toBeNull();
    expect(canonical.remittedIncomeThb).toBeNull();
  });

  it("requires all sources to be supported and the Thai tax confirmation to match current inputs", () => {
    const unsupported = withSource(slideDiscrepancyFixture.draft, 3, { unsupportedClassification: "unknown_treaty_treatment", unsupportedExplanation: "Needs treaty review" });
    const staleL = { ...slideDraft, domesticAssessableIncome: "1000001.00" };
    expect(calculateFTC(unsupported).outcome).toBe("needs_review");
    expect(calculateFTC(unsupported).allowableCredit).toBeNull();
    expect(calculateFTC(staleL).validationMessages.map(({ code }) => code)).toContain("confirmation.thai_tax_stale");
  });

  it("separates calculation readiness from submission confirmation, evidence and preview checks", () => {
    const draft = partialRemittanceFixture.draft;
    const result = calculateFTC(draft);
    const messages = validateSubmission(draft, result, { currentRevision: 2, previewRevision: 1, attachments: [] });
    expect(messages.map(({ code }) => code)).toContain("submit.preview_stale");
    expect(messages.map(({ code }) => code)).toContain("submit.source_evidence_missing");
    const noRemittance = withSource(draft, 0, { remittedIncomeAmount: "0.00" });
    expect(validateSubmission(noRemittance, calculateFTC(noRemittance), { currentRevision: 2, previewRevision: 2, attachments: [] }).map(({ code }) => code)).toContain("submit.no_positive_remittance");
  });

  it("applies evidence requirements conditionally and accepts one combined file", () => {
    const base = partialRemittanceFixture.draft;
    const positiveNoTax = withSource(base, 0, {
      eligibleForeignTax: "0.00",
      evidenceChecklist: ["foreign_income", "remittance"],
    });
    const zeroFSource = {
      ...positiveNoTax.sources[0]!,
      id: "zero-f-source",
      remittedIncomeAmount: "0.00",
      remittance: { ...positiveNoTax.sources[0]!.remittance!, transferTotalAmount: "0.00" },
      evidenceChecklist: [],
      eligibilityConfirmedAt: "2026-10-14T00:00:00.000Z",
      eligibilityConfirmedInputFingerprint: null,
    };
    const draft = reconfirm({ ...positiveNoTax, sources: [...positiveNoTax.sources, zeroFSource] });
    const result = calculateFTC(draft);
    const combinedReadyFile: AttachmentMetadata = {
      id: "combined-evidence", caseId: draft.id!, sourceId: draft.sources[0]!.id!, kind: "other",
      displayName: "Combined income and remittance evidence", mediaType: "application/pdf", byteSize: 100,
      sha256: "a".repeat(64), status: "ready", createdAt: "2026-10-14T00:00:00.000Z",
    };
    const messages = validateSubmission(draft, result, {
      currentRevision: draft.revision,
      previewRevision: draft.revision,
      attachments: [combinedReadyFile],
    });
    expect(messages).toEqual([]);

    const eligibleTaxMissingChecklist = withSource(base, 0, { evidenceChecklist: ["foreign_income", "remittance"] });
    const eligibleTaxMessages = validateSubmission(eligibleTaxMissingChecklist, calculateFTC(eligibleTaxMissingChecklist), {
      currentRevision: eligibleTaxMissingChecklist.revision,
      previewRevision: eligibleTaxMissingChecklist.revision,
      attachments: [combinedReadyFile],
    });
    expect(eligibleTaxMessages.map(({ code }) => code)).toContain("submit.source_checklist_missing");
  });

  it("blocks submission while an upload is pending or failed", () => {
    const draft = partialRemittanceFixture.draft;
    const result = calculateFTC(draft);
    const pending: AttachmentMetadata = {
      id: "pending", caseId: draft.id!, sourceId: draft.sources[0]!.id!, kind: "other",
      displayName: "Uploading evidence", mediaType: "application/pdf", byteSize: 100,
      sha256: "b".repeat(64), status: "pending", createdAt: "2026-10-14T00:00:00.000Z",
    };
    const failed = { ...pending, id: "failed", status: "failed" as const };
    for (const evidence of [pending, failed]) {
      const messages = validateSubmission(draft, result, {
        currentRevision: draft.revision,
        previewRevision: draft.revision,
        attachments: [evidence],
      });
      expect(messages.map(({ code }) => code)).toContain("submit.evidence_unresolved");
    }
  });
});
