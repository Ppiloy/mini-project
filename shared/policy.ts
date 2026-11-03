import type { ExchangeRateReference, IsoDate, PolicyReference } from "./contracts.js";
import { COUNTRY_CHOICES, SUPPORTED_INCOME_TYPES } from "./coverage.js";

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
  id: "rd-ftc-2024plus-v2",
  taxYear: 2025,
  effectiveFrom: "2024-01-01",
  effectiveTo: null,
  sourceUrls: Object.freeze([
    "https://www.rd.go.th/english/766.html",
    "https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf",
    "https://www.rd.go.th/5937.html",
    "https://www.bot.or.th/th/statistics/exchange-rate.html",
  ]),
  reviewedAt: "2026-11-03",
  assumptions: Object.freeze([
    "Educational worksheet demonstration for individual personal income tax cases; not a tax assessment or legal eligibility opinion.",
    "The RD tool scope begins on 1 January 2024 for foreign income and remittance. Income may be earned in an earlier year than the selected claim year, but the remittance must occur in the selected claim year.",
    "Residence is assessed under the Section 41 180-day test in the year the income was earned.",
    "All Section 40(1)–(8) categories use separate income entries and the same ordinary-credit worksheet formula. The selected DTA and the income's actual nature determine eligibility; the country list alone does not establish eligibility.",
    "E represents foreign income tax actually paid. Penalties, surcharges and taxes other than income tax are not creditable through this tool.",
    "The user supplies Thai tax before foreign tax credit from their prepared tax calculation; the calculator does not derive L from domestic income alone.",
    "An exceptional adjustment to E is shown with its user-supplied rationale and must not exceed tax actually paid.",
    "One remittance and one shared FX quote per source are recorded; cumulative prior-year tracking is not represented.",
    "Prepared THB worksheet inputs are already expressed in THB; original-currency D/E/F share one explicit FX quote.",
    "All fixture FX values are synthetic educational values unless the fixture itself identifies a checked source row.",
  ]),
  roundingPolicy: "40 significant digits; sum unrounded country credits, then round total half-up to 2 decimals; display each country at 2 decimals and reconcile the difference.",
  engineVersion: "ftc-engine-v4",
  supportedCountries: Object.freeze(Object.fromEntries(COUNTRY_CHOICES.map(({ code, storedName }) => [code, storedName]))),
  supportedIncomeTypes: SUPPORTED_INCOME_TYPES,
  minimumResidenceDays: 180,
  maximumSources: 20,
  precision: 40,
  moneyInputMaximum: "999999999.99",
  rateMaximum: "1000000",
  roundingDigits: 2,
  approvedFxReferences: Object.freeze([Object.freeze({ reference: SYNTHETIC_USD_PER_100_FX_REFERENCE, remittanceDate: "2025-01-01" })]),
});

export function policyReference(policy: DemoPolicy = DEMO_POLICY, taxYear = policy.taxYear): PolicyReference {
  return {
    id: policy.id,
    taxYear,
    effectiveFrom: `${taxYear}-01-01`,
    effectiveTo: `${taxYear}-12-31`,
    sourceUrls: [...policy.sourceUrls],
    reviewedAt: policy.reviewedAt,
    assumptions: [...policy.assumptions],
    roundingPolicy: policy.roundingPolicy,
  };
}
