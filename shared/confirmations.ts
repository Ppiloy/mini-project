import type { FtcCaseDraft, ForeignIncomeSourceDraft } from "./contracts.js";

function fingerprintableSource(source: ForeignIncomeSourceDraft): Record<string, unknown> {
  return {
    countryCode: source.countryCode,
    countryName: source.countryName,
    incomeType: source.incomeType,
    subtype: source.subtype,
    earnedTaxYear: source.earnedTaxYear,
    earnedDate: source.earnedDate,
    residenceDaysInEarnedYear: source.residenceDaysInEarnedYear,
    inputMode: source.inputMode,
    grossIncomeAmount: source.grossIncomeAmount,
    currencyCode: source.currencyCode,
    actualForeignTaxPaid: source.actualForeignTaxPaid,
    eligibleForeignTax: source.eligibleForeignTax,
    eligibilityRationale: source.eligibilityRationale,
    remittance: source.remittance === null ? null : {
      remittanceDate: source.remittance.remittanceDate,
      transferTotalAmount: source.remittance.transferTotalAmount,
      transferCurrencyCode: source.remittance.transferCurrencyCode,
      classification: source.remittance.classification,
      classificationNote: source.remittance.classificationNote,
    },
    remittedIncomeAmount: source.remittedIncomeAmount,
    fxReference: source.fxReference === null ? null : {
      currencyCode: source.fxReference.currencyCode,
      thbRate: source.fxReference.thbRate,
      baseUnits: source.fxReference.baseUnits,
      effectiveDate: source.fxReference.effectiveDate,
      rateType: source.fxReference.rateType,
      sourceKind: source.fxReference.sourceKind,
      sourceLabel: source.fxReference.sourceLabel,
      sourceUrl: source.fxReference.sourceUrl,
      educationalAssumption: source.fxReference.educationalAssumption,
    },
    unsupportedClassification: source.unsupportedClassification,
    unsupportedExplanation: source.unsupportedExplanation,
  };
}

/** Versioned canonical serialization; it detects changes and is not an auth token. */
export function sourceEligibilityFingerprint(source: ForeignIncomeSourceDraft): string {
  return `ftc-source-v1:${JSON.stringify(fingerprintableSource(source))}`;
}

/** Binds the supplied Thai tax and provenance to all tax-relevant raw inputs. */
export function taxInputFingerprint(draft: FtcCaseDraft): string {
  const sources = draft.sources.map(fingerprintableSource).sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return `ftc-tax-v1:${JSON.stringify({
    taxYear: draft.taxYear,
    domesticAssessableIncome: draft.domesticAssessableIncome,
    thaiTaxAmountBeforeFtc: draft.thaiTax.amountBeforeFtc,
    thaiTaxProvenance: draft.thaiTax.provenance,
    sources,
  })}`;
}

export function isThaiTaxConfirmationCurrent(draft: FtcCaseDraft): boolean {
  const confirmation = draft.thaiTax;
  return confirmation.amountBeforeFtc !== null
    && confirmation.provenance !== null
    && confirmation.confirmedAt !== null
    && confirmation.confirmedInputFingerprint === taxInputFingerprint(draft);
}

export function isSourceEligibilityConfirmationCurrent(source: ForeignIncomeSourceDraft): boolean {
  return source.eligibleForeignTax !== null
    && source.eligibilityRationale !== null
    && source.eligibilityConfirmedAt !== null
    && source.eligibilityConfirmedInputFingerprint === sourceEligibilityFingerprint(source);
}

/** Clears only stale confirmation metadata, retaining the taxpayer's entered values. */
export function stripStaleConfirmations(draft: FtcCaseDraft): FtcCaseDraft {
  const thaiTax = isThaiTaxConfirmationCurrent(draft)
    ? draft.thaiTax
    : { ...draft.thaiTax, confirmedAt: null, confirmedInputFingerprint: null };
  const sources = draft.sources.map((source) => isSourceEligibilityConfirmationCurrent(source)
    ? source
    : { ...source, eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null });
  return { ...draft, thaiTax, sources };
}
