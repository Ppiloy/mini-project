import { describe, expect, it } from "vitest";
import type { AttachmentMetadata, FtcCaseDraft, ForeignIncomeSourceDraft } from "./contracts.js";
import { isSourceEligibilityConfirmationCurrent, isThaiTaxConfirmationCurrent, sourceEligibilityFingerprint, taxInputFingerprint } from "./confirmations.js";
import { calculateFTC, validateSubmission, withCanonicalThbAmounts } from "./calculator.js";
import { COUNTRY_CHOICES, INCOME_CHOICES } from "./coverage.js";
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
  it("uses the remittance date for a manually entered commercial-bank buying rate", () => {
    const base = quotationPerHundredFixture.draft;
    const reference = { ...base.sources[0]!.fxReference!, rateType: "bank_buying" as const, sourceKind: "user_supplied" as const,
      sourceLabel: "ธนาคารที่ผู้ใช้ระบุ", educationalAssumption: "ผู้ใช้กรอกเอง ยังไม่ตรวจสอบ" };
    expect(calculateFTC(withSource(base, 0, { fxReference: reference })).outcome).toBe("ready");
    const mismatch = calculateFTC(withSource(base, 0, { fxReference: { ...reference, effectiveDate: "2024-12-31" } }));
    expect(mismatch.validationMessages).toContainEqual(expect.objectContaining({ code: "fx.bank_date_mismatch", path: ["sources", 0, "fxReference", "effectiveDate"] }));
    expect(mismatch.allowableCredit).toBeNull();
  });
  it("converts D E and F with one user-entered BOT reference from before remittance", () => {
    const source = partialRemittanceFixture.draft.sources[0]!;
    const draft = withSource(partialRemittanceFixture.draft, 0, {
      inputMode: "original_currency", currencyCode: "USD", grossIncomeAmount: "1000", actualForeignTaxPaid: "100",
      eligibleForeignTax: null, eligibilityRationale: null, remittedIncomeAmount: "500",
      remittance: { ...source.remittance!, remittanceDate: "2025-10-01", transferTotalAmount: "500", transferCurrencyCode: "USD" },
      fxReference: { currencyCode: "USD", thbRate: "36.15", baseUnits: 1, effectiveDate: "2025-09-30",
        rateType: "bot_average_buying", sourceKind: "user_supplied", sourceLabel: "ธปท. อัตราเฉลี่ยรับซื้อ",
        sourceUrl: "https://www.bot.or.th/th/statistics/exchange-rate.html", educationalAssumption: "ผู้ใช้กรอกเอง ยังไม่ตรวจสอบ" },
    });
    const result = calculateFTC(draft);
    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_D")?.value).toBe("36150");
    expect(result.lines.find(({ code }) => code === "source_E_paid")?.value).toBe("3615");
    expect(result.lines.find(({ code }) => code === "source_F")?.value).toBe("18075");
    expect(result.allowableCredit).toBe("1807.50");
  });
  it("identifies an earned date after the claim year beside the earned-date field", () => {
    const draft = withSource(partialRemittanceFixture.draft, 0, { earnedDate: "2026-01-01", earnedTaxYear: 2026 });
    const result = calculateFTC(draft);
    expect(result.validationMessages).toContainEqual(expect.objectContaining({
      code: "source.earned_after_claim_year", path: ["sources", 0, "earnedDate"],
    }));
    expect(result.allowableCredit).toBeNull();
  });
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

  it("uses paid foreign tax as E when no exceptional adjustment is supplied", () => {
    const draft = withSource(partialRemittanceFixture.draft, 0, {
      actualForeignTaxPaid: "5000.00",
      actualForeignTaxPaidThb: "999999.999999",
      eligibleForeignTax: null,
      eligibleForeignTaxThb: "999999.999999",
      eligibilityRationale: null,
    });

    expect(isSourceEligibilityConfirmationCurrent(draft.sources[0]!)).toBe(true);
    const result = calculateFTC(draft);

    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_E_paid")?.value).toBe("5000");
    expect(result.lines.find(({ code }) => code === "source_E_eligible")?.value).toBe("5000");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(withCanonicalThbAmounts(draft).sources[0]?.eligibleForeignTaxThb).toBe("5000");
  });

  it("uses the paid amount for original-currency E when no adjustment is stored", () => {
    const draft = withSource(quotationPerHundredFixture.draft, 0, {
      eligibleForeignTax: null,
      eligibleForeignTaxThb: null,
      eligibilityRationale: null,
    });
    const result = calculateFTC(draft);

    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_E_paid")?.value).toBe("1050");
    expect(result.lines.find(({ code }) => code === "source_E_eligible")?.value).toBe("1050");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("1050");
    expect(withCanonicalThbAmounts(draft).sources[0]?.eligibleForeignTaxThb).toBe("1050");
    expect(calculateFTC(draft).validationMessages).toEqual([]);
    expect(draft.sources[0]?.eligibleForeignTax).toBeNull();
  });

  it("preserves a legacy E adjustment explicitly and requires a reason only for that difference", () => {
    const adjusted = withSource(partialRemittanceFixture.draft, 0, {
      actualForeignTaxPaid: "5000.00",
      eligibleForeignTax: "3000.00",
      eligibilityRationale: "Prior record documents the exceptional adjustment.",
    });
    const withoutReason = withSource(adjusted, 0, { eligibilityRationale: null });
    const result = calculateFTC(adjusted);

    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_E_paid")?.value).toBe("5000");
    expect(result.lines.find(({ code }) => code === "source_E_eligible")?.value).toBe("3000");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("1500");
    expect(withCanonicalThbAmounts(adjusted).sources[0]?.eligibleForeignTaxThb).toBe("3000");
    expect(calculateFTC(withoutReason).validationMessages.some(({ path }) => path?.join(".") === "sources.0.eligibilityRationale")).toBe(true);
  });

  it("accepts the supplied L amount without requiring free-text provenance", () => {
    const withoutLNote = reconfirm({
      ...partialRemittanceFixture.draft,
      thaiTax: { ...partialRemittanceFixture.draft.thaiTax, provenance: null },
    });

    expect(isThaiTaxConfirmationCurrent(withoutLNote)).toBe(true);
    expect(calculateFTC(withoutLNote).outcome).toBe("ready");
  });

  it("keeps I and K available when a source amount is known but E is incomplete", () => {
    const source = partialRemittanceFixture.draft.sources[0]!;
    const draft = reconfirm({
      ...partialRemittanceFixture.draft,
      domesticAssessableIncome: "1000000.00",
      sources: [{
        ...source,
      actualForeignTaxPaid: null,
      eligibleForeignTax: null,
      eligibilityRationale: null,
      }],
    });

    const result = calculateFTC(draft);

    expect(result.outcome).toBe("incomplete");
    expect(result.totalRemittedIncome).toBe("25000");
    expect(result.totalAssessableIncome).toBe("1025000");
    expect(result.allowableCredit).toBeNull();
    expect(result.countries).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("shows an explicit zero remittance as zero and leaves unknown remittance totals blank", () => {
    const source = partialRemittanceFixture.draft.sources[0]!;
    const zeroF = reconfirm({
      ...partialRemittanceFixture.draft,
      domesticAssessableIncome: "100000.00",
      sources: [{ ...source, actualForeignTaxPaid: null, eligibleForeignTax: null, remittedIncomeAmount: "0.00" }],
    });
    const unknownF = reconfirm({
      ...partialRemittanceFixture.draft,
      domesticAssessableIncome: "100000.00",
      sources: [{ ...source, actualForeignTaxPaid: null, eligibleForeignTax: null, remittedIncomeAmount: null }],
    });

    expect(calculateFTC(zeroF)).toMatchObject({ totalRemittedIncome: "0", totalAssessableIncome: "100000" });
    const unknownResult = calculateFTC(unknownF);
    expect(unknownResult.totalRemittedIncome).toBeNull();
    expect(unknownResult.totalAssessableIncome).toBeNull();
    expect(unknownResult.validationMessages.some(({ path }) => path?.join(".") === "sources.0.remittedIncomeAmount")).toBe(true);
  });

  it("leaves I and K blank when an original-currency source has no numeric FX rate", () => {
    const source = quotationPerHundredFixture.draft.sources[0]!;
    const draft = reconfirm({
      ...quotationPerHundredFixture.draft,
      sources: [{ ...source, actualForeignTaxPaid: null, eligibleForeignTax: null, fxReference: { ...source.fxReference!, thbRate: null } }],
    });

    const result = calculateFTC(draft);

    expect(result.totalRemittedIncome).toBeNull();
    expect(result.totalAssessableIncome).toBeNull();
    expect(result.validationMessages.some(({ path }) => path?.join(".") === "sources.0.fxReference.thbRate")).toBe(true);
  });

  it("allocates tax to a partial remittance from original D/E and keeps the source contribution", () => {
    const result = calculateFTC(partialRemittanceFixture.draft);
    expect(result.lines.find(({ code }) => code === "source_share")?.value).toBe("0.5");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(result.countries[0]?.attributableForeignTax).toBe("2500");
  });

  it("calculates from D/E/F and remittance date when legacy transfer-summary facts are absent", () => {
    const source = partialRemittanceFixture.draft.sources[0]!;
    const draft = withSource(partialRemittanceFixture.draft, 0, {
      remittance: {
        ...source.remittance!,
        transferTotalAmount: null,
        transferCurrencyCode: null,
        classification: null,
        classificationNote: null,
      },
    });

    const result = calculateFTC(draft);

    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_F")?.value).toBe("25000");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(result.allowableCredit).toBe("2500.00");

    const missingDate = withSource(partialRemittanceFixture.draft, 0, {
      remittance: { ...source.remittance!, remittanceDate: null, transferTotalAmount: null, transferCurrencyCode: null, classification: null, classificationNote: null },
    });
    const missingDateResult = calculateFTC(missingDate);
    expect(missingDateResult.outcome).toBe("incomplete");
    expect(missingDateResult.validationMessages.some(({ code, path }) =>
      code === "input.required" && path?.join(".") === "sources.0.remittance.remittanceDate")).toBe(true);
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

  it("calculates separate Section 40 entries with one shared formula", () => {
    const base = partialRemittanceFixture.draft;
    const source = base.sources[0]!;
    const sources = INCOME_CHOICES.map((choice, index) => ({
      ...source,
      id: `income-${index}`,
      incomeType: choice.incomeType,
      subtype: choice.subtype,
    }));
    const draft = reconfirm({ ...base, sources });
    const result = calculateFTC(draft);

    expect(result.outcome).toBe("ready");
    expect(result.totalRemittedIncome).toBe("225000");
    expect(result.lines.filter(({ code }) => code === "source_D")).toHaveLength(9);
    expect(result.lines.filter(({ code }) => code === "source_G").map(({ value }) => value)).toEqual(Array(9).fill("2500"));
    expect(result.countries).toEqual([expect.objectContaining({
      countryCode: "CN",
      remittedIncome: "225000",
      attributableForeignTax: "22500",
      thaiTaxLimit: "100000",
      allowableCredit: "22500",
    })]);
  });

  it("limits each country's credit independently without pooling excess foreign tax", () => {
    const aboveLimit = countryLimitAboveFixture.draft.sources[0]!;
    const belowLimit = countryLimitBelowFixture.draft.sources[0]!;
    const draft = reconfirm({
      ...countryLimitAboveFixture.draft,
      sources: [
        { ...aboveLimit, countryCode: "US", countryName: "United States" },
        { ...belowLimit, countryCode: "SG", countryName: "Singapore" },
      ],
    });
    const result = calculateFTC(draft);
    const us = result.countries.find(({ countryCode }) => countryCode === "US")!;
    const singapore = result.countries.find(({ countryCode }) => countryCode === "SG")!;

    expect(result.outcome).toBe("ready");
    expect(us.attributableForeignTax).toBe("15000");
    expect(singapore.attributableForeignTax).toBe("5000");
    expect(us.thaiTaxLimit).toBe(singapore.thaiTaxLimit);
    expect(us.displayedAllowableCredit).toBe("6666.67");
    expect(singapore.displayedAllowableCredit).toBe("5000.00");
    expect(result.allowableCredit).toBe("11666.67");
  });

  it("continues calculating a saved legacy other income subtype", () => {
    const legacy = withSource(partialRemittanceFixture.draft, 0, { incomeType: "other", subtype: "40_2" });
    const result = calculateFTC(legacy);

    expect(result.outcome).toBe("ready");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(result.allowableCredit).toBe("2500.00");
  });

  it("accepts category-level entries without subtypes and preserves legacy Section 40(4) interest", () => {
    const base = partialRemittanceFixture.draft;
    for (const choice of INCOME_CHOICES.filter(({ incomeType }) => incomeType !== "dividend_40_4")) {
      const result = calculateFTC(withSource(base, 0, { incomeType: choice.incomeType, subtype: null }));
      expect(result.outcome).toBe("ready");
      expect(result.allowableCredit).toBe("2500.00");
    }

    const legacyInterest = withSource(base, 0, { incomeType: "other", subtype: "40_4_interest" });
    expect(calculateFTC(legacyInterest).outcome).toBe("ready");
    const legacyInvestmentInterest = withSource(base, 0, { incomeType: "investment_40_4", subtype: "interest" });
    expect(calculateFTC(legacyInvestmentInterest).outcome).toBe("ready");
    const unclassifiedDividend = withSource(base, 0, { incomeType: "dividend_40_4", subtype: null });
    expect(calculateFTC(unclassifiedDividend).outcome).toBe("needs_review");
  });

  it("uses the common calculation for every RD DTA country and excludes nonpartners", () => {
    for (const country of COUNTRY_CHOICES) {
      const source = { ...partialRemittanceFixture.draft.sources[0]!, countryCode: country.code, countryName: country.storedName };
      const draft = reconfirm({ ...partialRemittanceFixture.draft, sources: [source] });
      const result = calculateFTC(draft);
      expect(result.outcome).toBe("ready");
      expect(result.allowableCredit).toBe("2500.00");
      expect(result.countries[0]?.countryCode).toBe(country.code);
    }

    for (const code of ["XX", "SA"]) {
      const source = { ...partialRemittanceFixture.draft.sources[0]!, countryCode: code, countryName: "ประเทศอื่น" };
      const result = calculateFTC(reconfirm({ ...partialRemittanceFixture.draft, sources: [source] }));
      expect(result.outcome).toBe("needs_review");
      expect(result.allowableCredit).toBeNull();
      expect(result.validationMessages.map(({ code }) => code)).toContain("source.unsupported_country");
    }
  });

  it("accepts qualifying foreign income earned in 2024 and remitted in the 2025 claim year", () => {
    const base = partialRemittanceFixture.draft;
    const source = {
      ...base.sources[0]!,
      earnedTaxYear: 2024,
      earnedDate: "2024-12-31",
      remittance: { ...base.sources[0]!.remittance!, remittanceDate: "2025-01-01" },
    };
    const result = calculateFTC(reconfirm({ ...base, sources: [source] }));

    expect(result.outcome).toBe("ready");
    expect(result.validationMessages).toEqual([]);
    expect(result.allowableCredit).toBe("2500.00");
  });

  it("supports the 2024 tax year when the income and remittance meet that selected year", () => {
    const base = partialRemittanceFixture.draft;
    const source = {
      ...base.sources[0]!,
      earnedTaxYear: 2024,
      earnedDate: "2024-02-01",
      remittance: { ...base.sources[0]!.remittance!, remittanceDate: "2024-12-01" },
    };
    const result = calculateFTC(reconfirm({ ...base, taxYear: 2024, sources: [source] }));

    expect(result.outcome).toBe("ready");
    expect(result.validationMessages).toEqual([]);
    expect(result.allowableCredit).toBe("2500.00");
  });

  it("uses the selected year for a 2026 remittance without a 2025 policy-year block", () => {
    const base = partialRemittanceFixture.draft;
    const source = {
      ...base.sources[0]!,
      earnedTaxYear: 2024,
      earnedDate: "2024-02-01",
      remittance: { ...base.sources[0]!.remittance!, remittanceDate: "2026-07-01" },
    };
    const result = calculateFTC(reconfirm({ ...base, taxYear: 2026, sources: [source] }));

    expect(result.outcome).toBe("ready");
    expect(result.allowableCredit).toBe("2500.00");
  });

  it("explains that foreign income earned before 2024 falls outside the RD tool window", () => {
    const base = partialRemittanceFixture.draft;
    const source = {
      ...base.sources[0]!,
      earnedTaxYear: 2023,
      earnedDate: "2023-12-31",
      remittance: { ...base.sources[0]!.remittance!, remittanceDate: "2024-01-01" },
    };
    const result = calculateFTC(reconfirm({ ...base, taxYear: 2024, sources: [source] }));

    expect(result.outcome).toBe("needs_review");
    expect(result.allowableCredit).toBeNull();
    expect(result.validationMessages.map(({ code }) => code)).toContain("source.income_before_tool_window");
  });

  it("explains the RD DTA, Section 40 filing and residence criteria", () => {
    const base = partialRemittanceFixture.draft;
    const unknownCountry = withSource(base, 0, { countryCode: "XX", countryName: "ประเทศอื่น" });
    const unclassifiedIncome = withSource(base, 0, { incomeType: "other", subtype: "other_unclassified" });
    const belowResidence = withSource(base, 0, { residenceDaysInEarnedYear: 179 });
    const countryMessage = calculateFTC(unknownCountry).validationMessages.find(({ code }) => code === "source.unsupported_country")?.message ?? "";
    const incomeMessage = calculateFTC(unclassifiedIncome).validationMessages.find(({ code }) => code === "source.unsupported_type")?.message ?? "";
    const residenceMessage = calculateFTC(belowResidence).validationMessages.find(({ code }) => code === "source.nonresident_earned_income")?.message ?? "";

    expect(countryMessage).toContain("DTA กับไทย");
    expect(countryMessage).toContain("กรมสรรพากร");
    expect(incomeMessage).toContain("ภ.ง.ด.90/91");
    expect(incomeMessage).toContain("มาตรา 40");
    expect(residenceMessage).toContain("180 วัน");
    expect(residenceMessage).toContain("มาตรา 41");
  });

  it("rejects dates inconsistent with their declared years, mismatched FX and missing references", () => {
    const fxDraft = quotationPerHundredFixture.draft;
    const mismatchedEarnedYear = withSource(fxDraft, 0, { earnedTaxYear: 2024, earnedDate: "2025-01-01" });
    const mismatchedRemittanceYear = withSource(fxDraft, 0, {
      remittance: { ...fxDraft.sources[0]!.remittance!, remittanceDate: "2024-12-31" },
    });
    const mismatchedFx = withSource(fxDraft, 0, { fxReference: { ...fxDraft.sources[0]!.fxReference!, currencyCode: "EUR" } });
    const missingFx = withSource(fxDraft, 0, { fxReference: null });
    expect(calculateFTC(mismatchedEarnedYear).validationMessages.map(({ code }) => code)).toContain("source.earned_date_year_mismatch");
    expect(calculateFTC(mismatchedRemittanceYear).validationMessages.map(({ code }) => code)).toContain("source.cross_year_remittance");
    expect(calculateFTC(mismatchedRemittanceYear).validationMessages.map(({ code }) => code)).toContain("source.remittance_before_earned");
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
    const dateMismatchedQuote = withSource(draft, 0, {
      fxReference: { ...fx, effectiveDate: "2025-01-02" },
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
    const dateMismatchResult = calculateFTC(dateMismatchedQuote);
    expect(dateMismatchResult.outcome).toBe("needs_review");
    expect(dateMismatchResult.totalRemittedIncome).toBe("3500");
    expect(dateMismatchResult.totalAssessableIncome).toBe("3500");
    expect(dateMismatchResult.validationMessages.map(({ code }) => code)).toContain("fx.reference_unverified");
  });

  it("allows a clearly identified manual quote while keeping it distinct from a verified source", () => {
    const draft = quotationPerHundredFixture.draft;
    const source = draft.sources[0]!;
    const manualFx = {
      ...source.fxReference!,
      rateType: "manual" as const,
      sourceKind: "user_supplied" as const,
      effectiveDate: source.remittance!.remittanceDate!,
      sourceLabel: "User supplied rate for the remittance date",
      sourceUrl: null,
      educationalAssumption: "User-entered rate for demonstration only; not independently verified.",
    };
    const manual = withSource(draft, 0, { fxReference: manualFx });
    const manualForWrongDate = withSource(draft, 0, { fxReference: { ...manualFx, effectiveDate: "2025-01-02" } });
    expect(calculateFTC(manual).outcome).toBe("ready");
    const wrongDateResult = calculateFTC(manualForWrongDate);
    expect(wrongDateResult.outcome).toBe("needs_review");
    expect(wrongDateResult.allowableCredit).toBeNull();
    expect(wrongDateResult.validationMessages.map(({ code }) => code)).toContain("fx.manual_date_mismatch");

    const disguisedBot = withSource(draft, 0, {
      fxReference: { ...manualFx, rateType: "bot_average_buying", sourceKind: "bot" },
    });
    expect(calculateFTC(disguisedBot).validationMessages.map(({ code }) => code)).toContain("fx.reference_unverified");
    const missingSource = withSource(draft, 0, {
      fxReference: { ...manualFx, sourceLabel: " " },
    });
    expect(calculateFTC(missingSource).validationMessages.map(({ code }) => code)).toContain("fx.manual_provenance_missing");
  });

  it("does not let retired transfer-summary facts override the D/E/F allocation", () => {
    const draft = withSource(partialRemittanceFixture.draft, 0, {
      remittance: {
        ...partialRemittanceFixture.draft.sources[0]!.remittance!,
        transferTotalAmount: "30000.00",
        transferCurrencyCode: "USD",
        classification: "mixed_principal_and_income",
        classificationNote: "F is income only.",
      },
    });
    const result = calculateFTC(draft);
    expect(result.outcome).toBe("ready");
    expect(result.validationMessages).toEqual([]);
    expect(result.lines.find(({ code }) => code === "source_F")?.value).toBe("25000");
    expect(result.lines.find(({ code }) => code === "source_G")?.value).toBe("2500");
    expect(result.allowableCredit).toBe("2500.00");
  });

  it("rejects inherited nonpartner country keys from a custom policy", () => {
    const nonpartnerDraft = withSource(partialRemittanceFixture.draft, 0, { countryCode: "XX", countryName: "ประเทศอื่น" });
    const inheritedCountries = Object.assign(Object.create({ XX: "ประเทศอื่น" }), DEMO_POLICY.supportedCountries) as Record<string, string>;
    const policy = { ...DEMO_POLICY, supportedCountries: inheritedCountries };
    const result = calculateFTC(nonpartnerDraft, policy);
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
    expect(messages.map(({ code }) => code)).not.toContain("submit.source_evidence_missing");
    expect(messages.map(({ code }) => code)).not.toContain("submit.source_checklist_missing");
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
    expect(eligibleTaxMessages).toEqual([]);
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
