import { describe, expect, it } from "vitest";
import type { FtcCaseDraft, ForeignIncomeSourceDraft } from "./contracts.js";
import {
  isSourceEligibilityConfirmationCurrent,
  isThaiTaxConfirmationCurrent,
  sourceEligibilityFingerprint,
  stripStaleConfirmations,
  taxInputFingerprint,
} from "./confirmations.js";

const emptySource: ForeignIncomeSourceDraft = {
  id: "source-a",
  countryCode: "VN",
  countryName: "Vietnam",
  incomeType: "salary_40_1",
  subtype: null,
  earnedTaxYear: 2025,
  earnedDate: "2025-01-01",
  residenceDaysInEarnedYear: 365,
  inputMode: "worksheet_thb",
  grossIncomeAmount: "50000.00",
  currencyCode: "THB",
  grossIncomeThb: "50000.00",
  actualForeignTaxPaid: "5000.00",
  actualForeignTaxPaidThb: "5000.00",
  eligibleForeignTax: "5000.00",
  eligibleForeignTaxThb: "5000.00",
  eligibilityRationale: "Prepared educational example",
  eligibilityConfirmedAt: "2026-10-14T00:00:00.000Z",
  eligibilityConfirmedInputFingerprint: null,
  remittance: null,
  remittedIncomeAmount: "25000.00",
  remittedIncomeThb: "25000.00",
  fxReference: null,
  unsupportedClassification: null,
  unsupportedExplanation: null,
  evidenceChecklist: ["foreign_income"],
};

const confirmedDraft: FtcCaseDraft = {
  id: "case-a",
  taxYear: 2025,
  domesticAssessableIncome: "100000.00",
  thaiTax: {
    amountBeforeFtc: "10000.00",
    provenance: "Prepared worksheet",
    confirmedAt: "2026-10-14T00:00:00.000Z",
    confirmedInputFingerprint: null,
  },
  sources: [emptySource],
  revision: 1,
  createdAt: null,
  updatedAt: null,
};

describe("FTC confirmation fingerprints", () => {
  it("binds L and provenance to tax inputs while ignoring transport and derived fields", () => {
    const fingerprint = taxInputFingerprint(confirmedDraft);
    const confirmed = {
      ...confirmedDraft,
      thaiTax: { ...confirmedDraft.thaiTax, confirmedInputFingerprint: fingerprint },
    };
    expect(isThaiTaxConfirmationCurrent(confirmed)).toBe(true);
    expect(taxInputFingerprint({
      ...confirmed,
      id: "different-id",
      revision: 9,
      updatedAt: "2026-10-14T01:00:00.000Z",
      sources: [{ ...emptySource, id: "different-source", grossIncomeThb: "98765.4321", evidenceChecklist: ["foreign_tax"] }],
    })).toBe(fingerprint);
    expect(isThaiTaxConfirmationCurrent({
      ...confirmed,
      thaiTax: { ...confirmed.thaiTax, amountBeforeFtc: "10000.01" },
    })).toBe(false);
    expect(isThaiTaxConfirmationCurrent({
      ...confirmed,
      thaiTax: { ...confirmed.thaiTax, provenance: "Different worksheet" },
    })).toBe(false);
  });

  it("binds eligibility rationale and input facts, excluding checklist and derived amounts", () => {
    const fingerprint = sourceEligibilityFingerprint(emptySource);
    const confirmed = { ...emptySource, eligibilityConfirmedInputFingerprint: fingerprint };
    expect(isSourceEligibilityConfirmationCurrent(confirmed)).toBe(true);
    expect(isSourceEligibilityConfirmationCurrent({ ...confirmed, evidenceChecklist: ["remittance"] })).toBe(true);
    expect(isSourceEligibilityConfirmationCurrent({ ...confirmed, grossIncomeThb: "2.123456" })).toBe(true);
    expect(isSourceEligibilityConfirmationCurrent({ ...confirmed, eligibilityRationale: "Changed basis" })).toBe(false);
    expect(isSourceEligibilityConfirmationCurrent({ ...confirmed, remittedIncomeThb: "3.123456" })).toBe(true);
  });

  it("strips stale confirmation metadata while preserving entered tax and rationale", () => {
    const result = stripStaleConfirmations(confirmedDraft);
    expect(result.thaiTax).toMatchObject({ amountBeforeFtc: "10000.00", provenance: "Prepared worksheet", confirmedAt: null, confirmedInputFingerprint: null });
    expect(result.sources[0]).toMatchObject({ eligibilityRationale: "Prepared educational example", eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null });
  });
});
