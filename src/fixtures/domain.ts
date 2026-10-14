import type { FtcCaseDraft, ForeignIncomeSourceDraft } from "../../shared/contracts.js";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "../../shared/confirmations.js";
import type { ExchangeRateReference, IncomeType } from "../../shared/contracts.js";
import { SYNTHETIC_USD_PER_100_FX_REFERENCE } from "../../shared/policy.js";

const FIXTURE_CONFIRMATION_TIME = "2026-10-14T00:00:00.000Z";

export const emptySource: ForeignIncomeSourceDraft = {
  id: null,
  countryCode: null,
  countryName: null,
  incomeType: null,
  subtype: null,
  earnedTaxYear: null,
  earnedDate: null,
  residenceDaysInEarnedYear: null,
  inputMode: null,
  grossIncomeAmount: null,
  currencyCode: null,
  grossIncomeThb: null,
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
};

export const emptyDraft: FtcCaseDraft = {
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

export function createEmptyDraft(): FtcCaseDraft {
  return { ...emptyDraft, thaiTax: { ...emptyDraft.thaiTax }, sources: [] };
}

export function createEmptySource(): ForeignIncomeSourceDraft {
  return { ...emptySource, evidenceChecklist: [] };
}

interface SourceFixtureInput {
  id: string;
  countryCode: "VN" | "CN";
  incomeType: IncomeType;
  subtype?: string | null;
  grossIncomeAmount: string;
  actualForeignTaxPaid: string;
  eligibleForeignTax: string;
  remittedIncomeAmount: string;
  eligibilityRationale?: string;
  inputMode?: "worksheet_thb" | "original_currency";
  currencyCode?: string;
  fxReference?: ExchangeRateReference | null;
  earnedDate?: string;
  remittanceDate?: string;
  residenceDaysInEarnedYear?: number;
}

function sourceFixture(input: SourceFixtureInput): ForeignIncomeSourceDraft {
  const countryName = input.countryCode === "VN" ? "Vietnam" : "China";
  const currencyCode = input.currencyCode ?? (input.inputMode === "original_currency" ? "USD" : "THB");
  const remittanceDate = input.remittanceDate ?? "2025-01-01";
  const source: ForeignIncomeSourceDraft = {
    ...createEmptySource(),
    id: input.id,
    countryCode: input.countryCode,
    countryName,
    incomeType: input.incomeType,
    subtype: input.subtype ?? null,
    earnedTaxYear: 2025,
    earnedDate: input.earnedDate ?? "2025-01-01",
    residenceDaysInEarnedYear: input.residenceDaysInEarnedYear ?? 365,
    inputMode: input.inputMode ?? "worksheet_thb",
    grossIncomeAmount: input.grossIncomeAmount,
    currencyCode,
    actualForeignTaxPaid: input.actualForeignTaxPaid,
    eligibleForeignTax: input.eligibleForeignTax,
    eligibilityRationale: input.eligibilityRationale ?? "Assumed eligible solely for this mathematical educational example.",
    eligibilityConfirmedAt: FIXTURE_CONFIRMATION_TIME,
    remittance: {
      remittanceDate,
      transferTotalAmount: input.remittedIncomeAmount,
      transferCurrencyCode: currencyCode,
      transferTotalThb: null,
      classification: "income_only",
      classificationNote: null,
    },
    remittedIncomeAmount: input.remittedIncomeAmount,
    fxReference: input.fxReference ?? null,
    evidenceChecklist: ["foreign_income", "foreign_tax", "remittance"],
  };
  return { ...source, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) };
}

interface DraftFixtureInput {
  id: string;
  domesticAssessableIncome: string;
  thaiTax: string;
  sources: ForeignIncomeSourceDraft[];
  taxProvenance: string;
}

function confirmedDraft(input: DraftFixtureInput): FtcCaseDraft {
  const draft: FtcCaseDraft = {
    ...createEmptyDraft(),
    id: input.id,
    taxYear: 2025,
    domesticAssessableIncome: input.domesticAssessableIncome,
    thaiTax: {
      amountBeforeFtc: input.thaiTax,
      provenance: input.taxProvenance,
      confirmedAt: FIXTURE_CONFIRMATION_TIME,
      confirmedInputFingerprint: null,
    },
    sources: input.sources,
    revision: 1,
  };
  return { ...draft, thaiTax: { ...draft.thaiTax, confirmedInputFingerprint: taxInputFingerprint(draft) } };
}

export interface CalculationFixture {
  id: string;
  title: string;
  description: string;
  provenance: string[];
  draft: FtcCaseDraft;
  expected: Record<string, string>;
}

const vnSalary = sourceFixture({ id: "vn-salary", countryCode: "VN", incomeType: "salary_40_1", grossIncomeAmount: "500000.00", actualForeignTaxPaid: "150000.00", eligibleForeignTax: "150000.00", remittedIncomeAmount: "500000.00" });
const vnDividend = sourceFixture({ id: "vn-dividend", countryCode: "VN", incomeType: "dividend_40_4", subtype: "dividend", grossIncomeAmount: "250000.00", actualForeignTaxPaid: "75000.00", eligibleForeignTax: "75000.00", remittedIncomeAmount: "250000.00" });
const cnSalary = sourceFixture({ id: "cn-salary", countryCode: "CN", incomeType: "salary_40_1", grossIncomeAmount: "200000.00", actualForeignTaxPaid: "20000.00", eligibleForeignTax: "20000.00", remittedIncomeAmount: "200000.00" });
const cnDividend = sourceFixture({ id: "cn-dividend", countryCode: "CN", incomeType: "dividend_40_4", subtype: "dividend", grossIncomeAmount: "25000.00", actualForeignTaxPaid: "2500.00", eligibleForeignTax: "2500.00", remittedIncomeAmount: "25000.00" });

export const slideDiscrepancyFixture: CalculationFixture & { sourcePrintedTotal: string; sourceDiscrepancy: string } = {
  id: "slide-discrepancy-2568",
  title: "Slide arithmetic discrepancy",
  description: "Four source/type lines aggregate to the published Vietnam and China figures, then independently recompute the displayed formula.",
  provenance: [
    "Income and foreign-tax numbers transcribed from the project slide example as documented in .scratch/ftc-prototype/research/tax-rules.md.",
    "The source displays 143,554.30 THB; independent arithmetic gives 143,544.30 THB. This fixture preserves both values and adds no 10 THB adjustment.",
    "Country/type grouping follows the educational formula and does not validate treaty eligibility.",
  ],
  draft: confirmedDraft({ id: "slide-discrepancy-2568", domesticAssessableIncome: "1000000.00", thaiTax: "318750.00", sources: [vnSalary, vnDividend, cnSalary, cnDividend], taxProvenance: "Prepared educational slide example; supplied L is not inferred from J." }),
  expected: { totalAssessableIncome: "1975000", vnIncome: "750000", vnAttributableTax: "225000", vnLimit: "121044.3037974683544303797468354430379747", vnCreditDisplayed: "121044.30", cnIncome: "225000", cnAttributableTax: "22500", cnLimit: "36313.29113924050632911392405063291139241", cnCreditDisplayed: "22500.00", allowableCredit: "143544.30" },
  sourcePrintedTotal: "143554.30",
  sourceDiscrepancy: "The slide prints 143,554.30 THB, which is 10.00 THB above the recomputed 143,544.30 THB.",
};

const partialSource = sourceFixture({ id: "cn-dividend-partial", countryCode: "CN", incomeType: "dividend_40_4", subtype: "dividend", grossIncomeAmount: "50000.00", actualForeignTaxPaid: "5000.00", eligibleForeignTax: "5000.00", remittedIncomeAmount: "25000.00", eligibilityRationale: "Manual-derived D/E row; eligible tax is still an explicit educational assumption." });
export const partialRemittanceFixture: CalculationFixture = {
  id: "manual-partial-remittance",
  title: "Partial remittance allocation",
  description: "China dividend example keeps original D/E separate from the remitted F amount.",
  provenance: [
    "D=50,000 and E=5,000 are documented as values checked against the RD manual row on printed page 21 in .scratch/ftc-prototype/research/tax-rules.md.",
    "F=25,000 and the 50% share are the documented partial-remittance example; G=2,500 follows the formula.",
    "No legal treaty eligibility conclusion is implied.",
  ],
  draft: confirmedDraft({ id: "manual-partial-remittance", domesticAssessableIncome: "0.00", thaiTax: "100000.00", sources: [partialSource], taxProvenance: "Prepared allocation example; L is supplied." }),
  expected: { share: "0.5", attributableTax: "2500", allowableCredit: "2500.00" },
};

const zeroRemittanceSource = sourceFixture({ id: "cn-dividend-zero-remittance", countryCode: "CN", incomeType: "dividend_40_4", subtype: "dividend", grossIncomeAmount: "50000.00", actualForeignTaxPaid: "5000.00", eligibleForeignTax: "5000.00", remittedIncomeAmount: "0.00", eligibilityRationale: "No remittance in the educational example; D remains positive so the allocation denominator is defined." });
export const zeroRemittanceFixture: CalculationFixture = {
  id: "zero-remittance-explanation",
  title: "Zero remittance with positive original income",
  description: "A positive original income D and zero F explain zero contribution without dividing by zero; this remains ineligible for submission.",
  provenance: ["Synthetic fixture for the plan's explicit zero-contribution path; this is not an actual tax case."],
  draft: confirmedDraft({ id: "zero-remittance-explanation", domesticAssessableIncome: "0.00", thaiTax: "100000.00", sources: [zeroRemittanceSource], taxProvenance: "Synthetic supplied Thai tax for a no-remittance explanation." }),
  expected: { share: "0", attributableTax: "0", allowableCredit: "0.00" },
};

const belowCapSource = sourceFixture({ id: "cap-below", countryCode: "VN", incomeType: "salary_40_1", grossIncomeAmount: "100000.00", actualForeignTaxPaid: "5000.00", eligibleForeignTax: "5000.00", remittedIncomeAmount: "100000.00" });
export const countryLimitBelowFixture: CalculationFixture = {
  id: "country-limit-below",
  title: "Foreign tax below the Thai country limit",
  description: "The attributable foreign tax O is below P.",
  provenance: ["Independent literal acceptance case from plan section 9; values are synthetic, not evidence of tax paid."],
  draft: confirmedDraft({ id: "country-limit-below", domesticAssessableIncome: "100000.00", thaiTax: "20000.00", sources: [belowCapSource], taxProvenance: "Synthetic supplied Thai tax for formula test." }),
  expected: { countryLimit: "10000", attributableTax: "5000", allowableCredit: "5000.00" },
};

const aboveCapSource = sourceFixture({ id: "cap-above", countryCode: "VN", incomeType: "salary_40_1", grossIncomeAmount: "100000.00", actualForeignTaxPaid: "15000.00", eligibleForeignTax: "15000.00", remittedIncomeAmount: "100000.00" });
export const countryLimitAboveFixture: CalculationFixture = {
  id: "country-limit-above",
  title: "Foreign tax above the Thai country limit",
  description: "The attributable foreign tax O is above P.",
  provenance: ["Independent literal acceptance case from plan section 9; values are synthetic, not evidence of tax paid."],
  draft: confirmedDraft({ id: "country-limit-above", domesticAssessableIncome: "100000.00", thaiTax: "20000.00", sources: [aboveCapSource], taxProvenance: "Synthetic supplied Thai tax for formula test." }),
  expected: { countryLimit: "10000", attributableTax: "15000", allowableCredit: "10000.00" },
};

const halfSatangVn = sourceFixture({ id: "rounding-vn", countryCode: "VN", incomeType: "salary_40_1", grossIncomeAmount: "1.00", actualForeignTaxPaid: "1.00", eligibleForeignTax: "1.00", remittedIncomeAmount: "1.00" });
const halfSatangCn = sourceFixture({ id: "rounding-cn", countryCode: "CN", incomeType: "salary_40_1", grossIncomeAmount: "1.00", actualForeignTaxPaid: "1.00", eligibleForeignTax: "1.00", remittedIncomeAmount: "1.00" });
export const roundingBoundaryFixture: CalculationFixture = {
  id: "two-country-half-satang",
  title: "Final total rounding boundary",
  description: "Each country has Q=0.005; round the combined total once, then reconcile the two displayed rows.",
  provenance: ["Independent literal regression case from plan section 5; values are synthetic."],
  draft: confirmedDraft({ id: "two-country-half-satang", domesticAssessableIncome: "0.00", thaiTax: "0.01", sources: [halfSatangVn, halfSatangCn], taxProvenance: "Synthetic one-satang supplied Thai tax for rounding test." }),
  expected: { countryCreditEach: "0.005", allowableCredit: "0.01", displayedCountryCreditEach: "0.01", displayRoundingReconciliation: "-0.01" },
};

const fx100Reference: ExchangeRateReference = { ...SYNTHETIC_USD_PER_100_FX_REFERENCE };
const fx100Source = sourceFixture({ id: "fx-100-usd", countryCode: "VN", incomeType: "salary_40_1", grossIncomeAmount: "100.00", actualForeignTaxPaid: "30.00", eligibleForeignTax: "30.00", remittedIncomeAmount: "100.00", inputMode: "original_currency", currencyCode: "USD", fxReference: fx100Reference });
export const quotationPerHundredFixture: CalculationFixture = {
  id: "synthetic-fx-per-100",
  title: "Original currency with a quote per 100 units",
  description: "D/E/F use one synthetic USD quote per 100 units; full remittance must retain a 100% share.",
  provenance: ["All FX values are synthetic and explicitly labelled; this fixture tests quotation units, not FX accuracy."],
  draft: confirmedDraft({ id: "synthetic-fx-per-100", domesticAssessableIncome: "0.00", thaiTax: "100.00", sources: [fx100Source], taxProvenance: "Synthetic supplied Thai tax for FX conversion test." }),
  expected: { incomeThb: "3500", eligibleTaxThb: "1050", remittedIncomeThb: "3500", share: "1", allowableCredit: "100.00" },
};
