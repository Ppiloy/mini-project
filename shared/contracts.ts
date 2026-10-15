import { z } from "zod";
import { draftSchema } from "./draft.js";

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

const dateTime = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.string().regex(/^-?\d{1,18}(?:\.\d{1,12})?$/);
const nullableDecimal = decimal.nullable();

export const apiUserSchema: z.ZodType<ApiUser> = z.object({
  id: z.string().min(1).max(100), loginName: z.string().min(1), displayName: z.string().min(1),
  role: z.enum(["taxpayer", "officer"]), maskedReference: z.string().nullable(),
}).strict();

export const caseRecordSchema: z.ZodType<FtcCaseRecord> = z.object({
  id: z.string().min(1).max(100), ownerId: z.string().min(1).max(100), status: z.enum(["draft", "submitted"]),
  draft: draftSchema, assignedOfficerId: z.string().min(1).max(100).nullable(),
  submittedSnapshotId: z.string().min(1).max(100).nullable(), submittedAt: dateTime.nullable(),
  createdAt: dateTime, updatedAt: dateTime,
}).strict();

export const attachmentMetadataSchema: z.ZodType<AttachmentMetadata> = z.object({
  id: z.string().min(1).max(100), caseId: z.string().min(1).max(100), sourceId: z.string().min(1).max(100).nullable(),
  kind: z.enum(["foreign_income", "foreign_tax", "remittance", "thai_tax", "other"]),
  displayName: z.string().min(1).max(180), mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  byteSize: z.number().int().nonnegative().max(3 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "ready", "failed", "deleted"]), createdAt: dateTime,
}).strict();

const frozenEvidenceSchema: z.ZodType<FrozenEvidenceReference> = z.object({
  id: z.string().min(1).max(100), sourceId: z.string().min(1).max(100).nullable(),
  kind: z.enum(["foreign_income", "foreign_tax", "remittance", "thai_tax", "other"]),
  displayName: z.string().min(1).max(180), mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  byteSize: z.number().int().positive().max(3 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const policyReferenceSchema: z.ZodType<PolicyReference> = z.object({
  id: z.string().min(1), taxYear: z.number().int(), effectiveFrom: date.nullable(), effectiveTo: date.nullable(),
  sourceUrls: z.array(z.string().url()), reviewedAt: date.nullable(), assumptions: z.array(z.string()), roundingPolicy: z.string(),
}).strict();

const calculationLineSchema: z.ZodType<CalculationLine> = z.object({
  code: z.string().min(1), label: z.string(), countryCode: z.string().nullable(), sourceId: z.string().nullable(),
  value: nullableDecimal, explanation: z.string(),
}).strict();

const countryResultSchema: z.ZodType<CountryCalculationResult> = z.object({
  countryCode: z.string(), countryName: z.string(), remittedIncome: decimal, attributableForeignTax: decimal,
  thaiTaxLimit: decimal, allowableCredit: decimal, displayedAllowableCredit: decimal,
}).strict();

export const calculationResultSchema: z.ZodType<CalculationResult> = z.object({
  outcome: z.enum(["ready", "incomplete", "needs_review"]), allowableCredit: nullableDecimal,
  unroundedCountryCreditTotal: nullableDecimal, displayRoundingReconciliation: nullableDecimal,
  domesticAssessableIncome: nullableDecimal, totalRemittedIncome: nullableDecimal, totalAssessableIncome: nullableDecimal,
  thaiTaxBeforeFtc: nullableDecimal, countries: z.array(countryResultSchema), lines: z.array(calculationLineSchema),
  validationMessages: z.array(validationMessageSchema), assumptions: z.array(z.string()),
  policyVersion: z.string().min(1), engineVersion: z.string().min(1), roundingPolicy: z.string(),
}).strict();

export const calculationSnapshotSchema: z.ZodType<CalculationSnapshot> = z.object({
  id: z.string().min(1).max(100), caseId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
  kind: z.enum(["preview", "submitted"]), inputs: draftSchema, result: calculationResultSchema,
  evidence: z.array(frozenEvidenceSchema), policy: policyReferenceSchema, createdAt: dateTime,
}).strict();

const auditEventSchema: z.ZodType<AuditEventSummary> = z.object({
  id: z.string().min(1), event: z.string().min(1), actor: z.string(), occurredAt: dateTime,
}).strict();

const snapshotSummarySchema: z.ZodType<SnapshotSummary> = z.object({
  id: z.string().min(1), revision: z.number().int().nonnegative(), kind: z.enum(["preview", "submitted"]),
  policyId: z.string().min(1), engineVersion: z.string().min(1), outcome: z.enum(["ready", "incomplete", "needs_review"]),
  createdAt: dateTime,
}).strict();

export const caseWorkflowDetailSchema: z.ZodType<CaseWorkflowDetail> = z.object({
  case: caseRecordSchema, attachments: z.array(attachmentMetadataSchema), currentPreview: calculationSnapshotSchema.nullable(),
  snapshotSummaries: z.array(snapshotSummarySchema), auditEvents: z.array(auditEventSchema),
}).strict();

export interface OfficerCaseDetail {
  case: FtcCaseRecord; attachments: AttachmentMetadata[]; snapshot: CalculationSnapshot; auditEvents: AuditEventSummary[];
}

export const officerCaseDetailSchema: z.ZodType<OfficerCaseDetail> = z.object({ case: caseRecordSchema, attachments: z.array(attachmentMetadataSchema), snapshot: calculationSnapshotSchema,
  auditEvents: z.array(auditEventSchema) }).strict();

export function apiSuccessSchema<T>(data: z.ZodType<T>): z.ZodType<ApiSuccess<T>> {
  return z.object({ data, requestId: z.string().min(1).max(128) }).strict();
}

export const apiSuccessSchemas = {
  health: apiSuccessSchema(z.object({ status: z.literal("ok") }).strict()),
  session: apiSuccessSchema(z.object({ user: apiUserSchema, csrfToken: z.string() }).strict()),
  logout: apiSuccessSchema(z.object({ loggedOut: z.literal(true) }).strict()),
  cases: apiSuccessSchema(z.object({ cases: z.array(caseRecordSchema) }).strict()),
  case: apiSuccessSchema(z.object({ case: caseRecordSchema }).strict()),
  caseDetail: apiSuccessSchema(caseWorkflowDetailSchema),
  snapshot: apiSuccessSchema(z.object({ snapshot: calculationSnapshotSchema }).strict()),
  submission: apiSuccessSchema(z.object({ case: caseRecordSchema, snapshot: calculationSnapshotSchema }).strict()),
  officerCaseDetail: apiSuccessSchema(officerCaseDetailSchema),
  attachmentUpload: apiSuccessSchema(z.object({ attachment: attachmentMetadataSchema, case: caseRecordSchema, revision: z.number().int().nonnegative() }).strict()),
  attachmentDelete: apiSuccessSchema(z.object({ deleted: z.literal(true), revision: z.number().int().nonnegative() }).strict()),
} as const;

/** JSON success responses carry an explicit request ID for support and retries. */
export interface ApiSuccess<T> {
  data: T;
  requestId: RequestId;
}

/** Upload requests carry one file per request; object keys are server generated. */
export interface AttachmentUploadMetadata {
  expectedRevision: number;
  requestId: RequestId;
  sourceId: SourceId | null;
  kind: EvidenceKind;
  displayName: string;
}

export interface DeleteAttachmentRequest {
  expectedRevision: number;
  requestId: RequestId;
}

export interface AuditEventSummary {
  id: string;
  event: string;
  actor: string;
  occurredAt: IsoDateTime;
}

export interface SnapshotSummary {
  id: SnapshotId;
  revision: number;
  kind: SnapshotKind;
  policyId: string;
  engineVersion: string;
  outcome: CalculationResult["outcome"];
  createdAt: IsoDateTime;
}

export interface CaseWorkflowDetail {
  case: FtcCaseRecord;
  attachments: AttachmentMetadata[];
  currentPreview: CalculationSnapshot | null;
  snapshotSummaries: SnapshotSummary[];
  auditEvents: AuditEventSummary[];
}

export interface AttachmentUploadResult {
  attachment: AttachmentMetadata;
  case: FtcCaseRecord;
  revision: number;
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
