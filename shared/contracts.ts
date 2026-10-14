import { z } from "zod";

/** Values crossing browser, API, PostgreSQL JSON and snapshot boundaries. */
export type DecimalString = string;
export type IsoDate = string;
export type IsoDateTime = string;
export type UserId = string;
export type CaseId = string;
export type SourceId = string;
export type AttachmentId = string;
export type SnapshotId = string;
export type RequestId = string;

export type UserRole = "taxpayer" | "officer";
export type CaseStatus = "draft" | "submitted";
export type SnapshotKind = "preview" | "submitted";
export type InputMode = "worksheet_thb" | "original_currency";
export type IncomeType = "salary_40_1" | "dividend_40_4" | "other";
export type FxRateType = "bank_buying" | "bot_average_buying" | "manual" | "fixture";
export type FxSourceKind = "bank" | "bot" | "user_supplied" | "fixture";
export type EvidenceKind = "foreign_income" | "foreign_tax" | "remittance" | "thai_tax" | "other";
export type AttachmentStatus = "pending" | "ready" | "failed" | "deleted";
export type UnsupportedClassification =
  | "unsupported_tax_year"
  | "cross_year_remittance"
  | "nonresident_earned_income"
  | "unsupported_income_type"
  | "unknown_treaty_treatment"
  | "mixed_principal_and_income"
  | "ambiguous_gross_net"
  | "tax_refund"
  | "multiple_remittances"
  | "other";

/** Nullable fields are intentional: a draft may preserve an unfinished form. */
export interface ExchangeRateReference {
  currencyCode: string | null;
  thbRate: DecimalString | null;
  baseUnits: 1 | 100 | null;
  effectiveDate: IsoDate | null;
  rateType: FxRateType | null;
  sourceKind: FxSourceKind | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  educationalAssumption: string | null;
}

export interface RemittanceDraft {
  remittanceDate: IsoDate | null;
  /** Total transfer facts may differ from F, the assessable-income portion. */
  transferTotalAmount: DecimalString | null;
  transferCurrencyCode: string | null;
  transferTotalThb: DecimalString | null;
  /** Identifies ambiguous mixed-principal or gross/net facts for review. */
  classification: "income_only" | "mixed_principal_and_income" | "gross_net_ambiguous" | "tax_refund" | "unknown" | null;
  classificationNote: string | null;
}

export interface ForeignIncomeSourceDraft {
  id: SourceId | null;
  countryCode: string | null;
  countryName: string | null;
  incomeType: IncomeType | null;
  subtype: string | null;
  earnedTaxYear: number | null;
  earnedDate: IsoDate | null;
  residenceDaysInEarnedYear: number | null;
  inputMode: InputMode | null;
  /** D: assessable income amount, stored as a decimal string. */
  grossIncomeAmount: DecimalString | null;
  currencyCode: string | null;
  grossIncomeThb: DecimalString | null;
  /** Foreign tax actually paid, distinct from the amount assumed eligible. */
  actualForeignTaxPaid: DecimalString | null;
  actualForeignTaxPaidThb: DecimalString | null;
  /** E: foreign tax treated as eligible under a stated demo assumption. */
  eligibleForeignTax: DecimalString | null;
  eligibleForeignTaxThb: DecimalString | null;
  eligibilityRationale: string | null;
  eligibilityConfirmedAt: IsoDateTime | null;
  eligibilityConfirmedInputFingerprint: string | null;
  remittance: RemittanceDraft | null;
  /** F: assessable-income portion remitted; independent of transfer principal. */
  remittedIncomeAmount: DecimalString | null;
  remittedIncomeThb: DecimalString | null;
  /** One shared quote for D/E/F; differing earned/remittance rates are unsupported. */
  fxReference: ExchangeRateReference | null;
  unsupportedClassification: UnsupportedClassification | null;
  unsupportedExplanation: string | null;
  evidenceChecklist: EvidenceKind[];
}

export interface ThaiTaxConfirmation {
  amountBeforeFtc: DecimalString | null;
  provenance: string | null;
  confirmedAt: IsoDateTime | null;
  confirmedInputFingerprint: string | null;
}

export interface FtcCaseDraft {
  id: CaseId | null;
  taxYear: number | null;
  domesticAssessableIncome: DecimalString | null;
  thaiTax: ThaiTaxConfirmation;
  sources: ForeignIncomeSourceDraft[];
  revision: number;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

export interface ApiUser {
  id: UserId;
  loginName: string;
  displayName: string;
  role: UserRole;
  maskedReference: string | null;
}

export interface FtcCaseRecord {
  id: CaseId;
  ownerId: UserId;
  status: CaseStatus;
  draft: FtcCaseDraft;
  assignedOfficerId: UserId | null;
  submittedSnapshotId: SnapshotId | null;
  submittedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AttachmentMetadata {
  id: AttachmentId;
  caseId: CaseId;
  sourceId: SourceId | null;
  kind: EvidenceKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  status: AttachmentStatus;
  createdAt: IsoDateTime;
}

/** Immutable attachment facts frozen into a calculation/submission snapshot. */
export interface FrozenEvidenceReference {
  id: AttachmentId;
  sourceId: SourceId | null;
  kind: EvidenceKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

export interface PolicyReference {
  id: string;
  taxYear: number;
  effectiveFrom: IsoDate | null;
  effectiveTo: IsoDate | null;
  sourceUrls: string[];
  reviewedAt: IsoDate | null;
  assumptions: string[];
  roundingPolicy: string;
}

export interface CalculationLine {
  code: string;
  label: string;
  countryCode: string | null;
  sourceId: SourceId | null;
  value: DecimalString | null;
  explanation: string;
}

export interface CountryCalculationResult {
  countryCode: string;
  countryName: string;
  remittedIncome: DecimalString;
  attributableForeignTax: DecimalString;
  thaiTaxLimit: DecimalString;
  allowableCredit: DecimalString;
  displayedAllowableCredit: DecimalString;
}

export interface CalculationResult {
  outcome: "ready" | "incomplete" | "needs_review";
  allowableCredit: DecimalString | null;
  unroundedCountryCreditTotal: DecimalString | null;
  displayRoundingReconciliation: DecimalString | null;
  domesticAssessableIncome: DecimalString | null;
  totalRemittedIncome: DecimalString | null;
  totalAssessableIncome: DecimalString | null;
  thaiTaxBeforeFtc: DecimalString | null;
  countries: CountryCalculationResult[];
  lines: CalculationLine[];
  validationMessages: ValidationMessage[];
  assumptions: string[];
  policyVersion: string;
  engineVersion: string;
  roundingPolicy: string;
}

export interface CalculationSnapshot {
  id: SnapshotId;
  caseId: CaseId;
  revision: number;
  kind: SnapshotKind;
  inputs: FtcCaseDraft;
  result: CalculationResult;
  evidence: FrozenEvidenceReference[];
  policy: PolicyReference;
  createdAt: IsoDateTime;
}

export interface ValidationMessage {
  code: string;
  message: string;
  path?: Array<string | number>;
}

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid_input"
  | "incomplete_case"
  | "unsupported_case"
  | "rate_limited"
  | "service_unavailable";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: ValidationMessage[];
    requestId: RequestId;
  };
}

export const validationMessageSchema: z.ZodType<ValidationMessage> = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

export const apiErrorEnvelopeSchema: z.ZodType<ApiError> = z.object({
  error: z.object({
    code: z.enum([
      "unauthenticated", "forbidden", "not_found", "conflict", "payload_too_large",
      "unsupported_media_type", "invalid_input", "incomplete_case", "unsupported_case",
      "rate_limited", "service_unavailable",
    ]),
    message: z.string(),
    fields: z.array(validationMessageSchema).optional(),
    requestId: z.string(),
  }),
});

/** JSON success responses carry an explicit request ID for support and retries. */
export interface ApiSuccess<T> {
  data: T;
  requestId: RequestId;
}

/** Upload requests carry one file per request; object keys are server generated. */
export interface AttachmentUploadMetadata {
  sourceId: SourceId | null;
  kind: EvidenceKind;
  displayName: string;
}

export interface RevisionMutationRequest<T> {
  expectedRevision: number;
  requestId: RequestId;
  data: T;
}

/** Explicit confirmation intent; the server always replaces time/fingerprint metadata. */
export interface DraftSaveConfirmations {
  thaiTax: boolean;
  /** Use IDs after the server has assigned stable source IDs. */
  eligibleSourceIds?: SourceId[];
  /** First-save selections before server-generated source IDs are available. */
  eligibleSourceIndexes?: number[];
}

export interface DraftSaveRequest extends RevisionMutationRequest<FtcCaseDraft> {
  confirmations?: DraftSaveConfirmations;
}

export interface CreateCaseRequest {
  requestId: RequestId;
}

export interface SubmitCaseRequest {
  expectedRevision: number;
  previewSnapshotId: SnapshotId;
  requestId: RequestId;
}
