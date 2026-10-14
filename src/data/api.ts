import { z } from "zod";
import { apiErrorEnvelopeSchema, apiSuccessSchemas } from "../../shared/contracts.js";
import type {
  ApiError,
  ApiSuccess,
  ApiUser,
  AttachmentUploadResult,
  CaseWorkflowDetail,
  CalculationSnapshot,
  FtcCaseDraft,
  FtcCaseRecord,
  OfficerCaseDetail as SharedOfficerCaseDetail,
} from "../../shared/contracts.js";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: ApiError["error"]["fields"] = [],
    readonly requestId?: string,
    readonly authoritativeUnauthenticated = false,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type LogoutConfirmationResult =
  | { confirmed: true }
  | { confirmed: false; errors: unknown[] };

export interface AuthSession {
  user: ApiUser;
  csrfToken: string;
}

export interface CaseDraftSave {
  expectedRevision: number;
  requestId: string;
  data: FtcCaseDraft;
  confirmations?: {
    thaiTax: boolean;
    eligibleSourceIds?: string[];
    eligibleSourceIndexes?: number[];
  };
}

export type CaseDetail = CaseWorkflowDetail;
export type OfficerCaseDetail = SharedOfficerCaseDetail;

const authSessionEnvelopeSchema: z.ZodType<ApiSuccess<AuthSession>> = apiSuccessSchemas.session;
const logoutSuccessEnvelopeSchema: z.ZodType<ApiSuccess<{ loggedOut: true }>> = apiSuccessSchemas.logout;

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrfToken: string | undefined,
  successSchema: z.ZodType<ApiSuccess<T>>,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...init, headers, credentials: "include", cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorEnvelopeSchema.safeParse(body);
    const problem = parsedError.success ? parsedError.data.error : undefined;
    throw new ApiClientError(
      response.status,
      problem?.code ?? "service_unavailable",
      problem?.message ?? "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง",
      problem?.fields,
      problem?.requestId ?? errorRequestId(body),
      response.status === 401 && isJsonResponse(response) && problem?.code === "unauthenticated",
    );
  }
  const parsedSuccess = successSchema.safeParse(body);
  if (!parsedSuccess.success) throw new ApiClientError(response.status, "invalid_response", "ระบบส่งข้อมูลกลับมาไม่ครบ", [], responseRequestId(body));
  return parsedSuccess.data.data;
}

function responseRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("requestId" in value)) return undefined;
  const candidate = value.requestId;
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 128 ? candidate : undefined;
}

function errorRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("error" in value) || !value.error || typeof value.error !== "object") return undefined;
  const candidate = "requestId" in value.error ? value.error.requestId : undefined;
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 128 ? candidate : undefined;
}

/** Include the server support reference wherever an API failure is shown. */
export function apiFailureContext(error: unknown): string {
  return apiFailureContextFor([error]);
}

export function apiFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return `${message}${apiFailureContextFor([error])}`;
}

/** Keep recovery guidance, server messages, and support identifiers together without repeating policy context. */
export function apiFailureMessages(errors: readonly unknown[], fallback: string): string {
  const messages = [...new Set(errors.filter((error): error is Error => error instanceof Error).map((error) => error.message).filter(Boolean))];
  const details = messages.length ? ` (${messages.join("; ")})` : "";
  return `${fallback}${details}${apiFailureContextFor(errors)}`;
}

function apiFailureContextFor(errors: readonly unknown[]): string {
  const requestIds = [...new Set(errors.flatMap((error) => error instanceof ApiClientError && error.requestId ? [error.requestId] : []))];
  return `${requestIds.length ? ` (รหัสคำขอ: ${requestIds.join(", ")})` : ""} · รุ่นนโยบาย: rd-ftc-demo-2568-v1`;
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json" || Boolean(contentType?.startsWith("application/") && contentType.endsWith("+json"));
}

export const hostedApi = {
  async session(): Promise<AuthSession | null> {
    try {
      return await request<AuthSession>("/api/auth/session", {}, undefined, authSessionEnvelopeSchema);
    } catch (error) {
      if (error instanceof ApiClientError && error.authoritativeUnauthenticated) return null;
      throw error;
    }
  },
  login(loginName: string, password: string): Promise<AuthSession> {
    return request("/api/auth/login", { method: "POST", body: JSON.stringify({ loginName, password }) }, undefined, authSessionEnvelopeSchema);
  },
  logout(csrfToken: string): Promise<{ loggedOut: true }> {
    return request("/api/auth/logout", { method: "POST" }, csrfToken, logoutSuccessEnvelopeSchema);
  },
  listCases(): Promise<{ cases: FtcCaseRecord[] }> {
    return request("/api/cases", {}, undefined, apiSuccessSchemas.cases);
  },
  getCase(id: string): Promise<CaseDetail> {
    return request(`/api/cases/${encodeURIComponent(id)}`, {}, undefined, apiSuccessSchemas.caseDetail);
  },
  async createCase(csrfToken: string, requestId = crypto.randomUUID()): Promise<{ case: FtcCaseRecord }> {
    return request("/api/cases", { method: "POST", body: JSON.stringify({ requestId }) }, csrfToken, apiSuccessSchemas.case);
  },
  saveDraft(id: string, payload: CaseDraftSave, csrfToken: string): Promise<{ case: FtcCaseRecord }> {
    return request(`/api/cases/${encodeURIComponent(id)}/draft`, { method: "PUT", body: JSON.stringify(payload) }, csrfToken, apiSuccessSchemas.case);
  },
  calculate(id: string, expectedRevision: number, csrfToken: string): Promise<{ snapshot: CalculationSnapshot }> {
    return request(`/api/cases/${encodeURIComponent(id)}/calculate`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, requestId: crypto.randomUUID() }),
    }, csrfToken, apiSuccessSchemas.snapshot);
  },
  submit(id: string, expectedRevision: number, previewSnapshotId: string, csrfToken: string, requestId: string = crypto.randomUUID()): Promise<{ case: FtcCaseRecord; snapshot: CalculationSnapshot }> {
    return request(`/api/cases/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, previewSnapshotId, requestId }),
    }, csrfToken, apiSuccessSchemas.submission);
  },
  listOfficerCases(): Promise<{ cases: FtcCaseRecord[] }> {
    return request("/api/officer/cases", {}, undefined, apiSuccessSchemas.cases);
  },
  getOfficerCase(id: string): Promise<OfficerCaseDetail> {
    return request(`/api/officer/cases/${encodeURIComponent(id)}`, {}, undefined, apiSuccessSchemas.officerCaseDetail);
  },
  snapshot(id: string): Promise<{ snapshot: CalculationSnapshot }> {
    return request(`/api/snapshots/${encodeURIComponent(id)}`, {}, undefined, apiSuccessSchemas.snapshot);
  },
  uploadEvidence(caseId: string, file: File, metadata: { sourceId: string | null; kind: string; expectedRevision: number; requestId: string }, csrfToken: string): Promise<AttachmentUploadResult> {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("displayName", file.name);
    form.set("sourceId", metadata.sourceId ?? "");
    form.set("kind", metadata.kind);
    form.set("expectedRevision", String(metadata.expectedRevision));
    form.set("requestId", metadata.requestId);
    return request(`/api/cases/${encodeURIComponent(caseId)}/attachments`, { method: "POST", body: form }, csrfToken, apiSuccessSchemas.attachmentUpload);
  },
  removeEvidence(id: string, expectedRevision: number, csrfToken: string): Promise<{ deleted: true; revision: number }> {
    return request(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision, requestId: crypto.randomUUID() }) }, csrfToken, apiSuccessSchemas.attachmentDelete);
  },
  async downloadEvidence(id: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const parsed = apiErrorEnvelopeSchema.safeParse(body);
      const problem = parsed.success ? parsed.data.error : undefined;
      throw new ApiClientError(response.status, problem?.code ?? "service_unavailable", problem?.message ?? "ดาวน์โหลดไฟล์ไม่สำเร็จ", problem?.fields, problem?.requestId);
    }
    return response.blob();
  },
};

/** Confirms logout only after a valid logout response or an authoritative anonymous session response. */
export async function logoutAndConfirm(csrfToken: string): Promise<LogoutConfirmationResult> {
  let logoutError: unknown;
  try {
    await hostedApi.logout(csrfToken);
    return { confirmed: true };
  } catch (error) {
    logoutError = error;
  }
  try {
    if ((await hostedApi.session()) === null) return { confirmed: true };
    return { confirmed: false, errors: [logoutError] };
  } catch (statusError) {
    return { confirmed: false, errors: [logoutError, statusError] };
  }
}
