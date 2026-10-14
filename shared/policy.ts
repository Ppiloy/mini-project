import type { ExchangeRateReference, IsoDate, PolicyReference } from "./contracts.js";

/** Exact educational quote accepted by the demo engine; never a historical rate. */
export const SYNTHETIC_USD_PER_100_FX_REFERENCE: ExchangeRateReference = Object.freeze({
  currencyCode: "USD",
  thbRate: "3500.00000000",
  baseUnits: 100,
  effectiveDate: "2025-01-01",
  rateType: "fixture",
  sourceKind: "fixture",
  sourceLabel: "Synthetic educational FX value",
  sourceUrl: null,
  educationalAssumption: "Deliberately synthetic quote to demonstrate conversion per 100 units; not a historical market rate.",
});

export interface DemoPolicy extends Omit<PolicyReference, "sourceUrls" | "assumptions"> {
  readonly sourceUrls: readonly string[];
  readonly assumptions: readonly string[];
  readonly engineVersion: string;
  readonly supportedCountries: Readonly<Record<string, string>>;
  readonly supportedIncomeTypes: Readonly<Record<string, readonly string[]>>;
  readonly minimumResidenceDays: number;
  readonly maximumSources: number;
  readonly precision: number;
  readonly moneyInputMaximum: string;
  readonly rateMaximum: string;
  readonly roundingDigits: number;
  /** Exact references and their remittance dates; an empty list means none are verified. */
  readonly approvedFxReferences: readonly { reference: ExchangeRateReference; remittanceDate: IsoDate }[];
}

export const DEMO_POLICY: DemoPolicy = Object.freeze({
  id: "rd-ftc-demo-2568-v1",
  taxYear: 2025,
  effectiveFrom: "2025-01-01",
  effectiveTo: "2025-12-31",
  sourceUrls: Object.freeze([
    "https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf",
    "https://www.rd.go.th/english/2526.html",
    "https://www.rd.go.th/2607.html",
  ]),
  reviewedAt: "2026-10-14",
  assumptions: Object.freeze([
    "Educational worksheet demonstration only; not a tax assessment or legal eligibility opinion.",
    "Tax paid abroad is assumed eligible only when the user confirms E and records a rationale.",
    "Same-year earned income and remittance; one remittance per source; no cumulative prior-year tracking.",
    "A source supports salary under 40(1) or the demonstrated dividend subtype `dividend` under 40(4).",
    "Prepared THB worksheet inputs are already expressed in THB; original-currency D/E/F share one explicit FX quote.",
    "All fixture FX values are synthetic educational values unless the fixture itself identifies a checked source row.",
  ]),
  roundingPolicy: "40 significant digits; sum unrounded country credits, then round total half-up to 2 decimals; display each country at 2 decimals and reconcile the difference.",
  engineVersion: "ftc-engine-v1",
  supportedCountries: Object.freeze({ VN: "Vietnam", CN: "China" }),
  supportedIncomeTypes: Object.freeze({
    salary_40_1: Object.freeze(["salary"]),
    dividend_40_4: Object.freeze(["dividend"]),
  }),
  minimumResidenceDays: 180,
  maximumSources: 20,
  precision: 40,
  moneyInputMaximum: "999999999.99",
  rateMaximum: "1000000",
  roundingDigits: 2,
  approvedFxReferences: Object.freeze([Object.freeze({ reference: SYNTHETIC_USD_PER_100_FX_REFERENCE, remittanceDate: "2025-01-01" })]),
});

export function policyReference(policy: DemoPolicy = DEMO_POLICY): PolicyReference {
  return {
    id: policy.id,
    taxYear: policy.taxYear,
    effectiveFrom: policy.effectiveFrom,
    effectiveTo: policy.effectiveTo,
    sourceUrls: [...policy.sourceUrls],
    reviewedAt: policy.reviewedAt,
    assumptions: [...policy.assumptions],
    roundingPolicy: policy.roundingPolicy,
  };
}
