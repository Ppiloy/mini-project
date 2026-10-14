import { z } from "zod";
import { apiErrorEnvelopeSchema } from "../../shared/contracts.js";
import type {
  ApiError,
  ApiSuccess,
  ApiUser,
  AttachmentMetadata,
  CalculationSnapshot,
  FtcCaseDraft,
  FtcCaseRecord,
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

export interface CaseDetail {
  case: FtcCaseRecord;
  attachments?: AttachmentMetadata[];
  currentPreview?: CalculationSnapshot | null;
  snapshotSummaries?: Array<{ id: string; revision: number; kind: "preview" | "submitted"; createdAt: string }>;
  auditEvents?: Array<{ event: string; actor: string; occurredAt: string }>;
}

export interface OfficerCaseDetail {
  case: FtcCaseRecord;
  attachments: AttachmentMetadata[];
  snapshot: CalculationSnapshot;
  auditEvents: Array<{ event: string; actor: string; occurredAt: string }>;
}

const authSessionSchema: z.ZodType<AuthSession> = z.object({
  user: z.object({
    id: z.string(),
    loginName: z.string(),
    displayName: z.string(),
    role: z.enum(["taxpayer", "officer"]),
    maskedReference: z.string().nullable(),
  }),
  csrfToken: z.string(),
});

const authSessionEnvelopeSchema: z.ZodType<ApiSuccess<AuthSession>> = z.object({ data: authSessionSchema, requestId: z.string() });
const logoutSuccessEnvelopeSchema: z.ZodType<ApiSuccess<{ loggedOut: true }>> = z.object({ data: z.object({ loggedOut: z.literal(true) }), requestId: z.string() });

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string,
  successSchema?: z.ZodType<ApiSuccess<T>>,
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
      problem?.requestId,
      response.status === 401 && isJsonResponse(response) && problem?.code === "unauthenticated",
    );
  }
  if (successSchema) {
    const parsedSuccess = successSchema.safeParse(body);
    if (!parsedSuccess.success) throw new ApiClientError(response.status, "invalid_response", "ระบบส่งข้อมูลกลับมาไม่ครบ");
    return parsedSuccess.data.data;
  }
  if (!body || typeof body !== "object" || !("data" in body)) throw new ApiClientError(response.status, "invalid_response", "ระบบส่งข้อมูลกลับมาไม่ครบ");
  return body.data as T;
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
    return request("/api/cases");
  },
  getCase(id: string): Promise<CaseDetail> {
    return request(`/api/cases/${encodeURIComponent(id)}`);
  },
  async createCase(csrfToken: string, requestId = crypto.randomUUID()): Promise<{ case: FtcCaseRecord }> {
    return request("/api/cases", { method: "POST", body: JSON.stringify({ requestId }) }, csrfToken);
  },
  saveDraft(id: string, payload: CaseDraftSave, csrfToken: string): Promise<{ case: FtcCaseRecord }> {
    return request(`/api/cases/${encodeURIComponent(id)}/draft`, { method: "PUT", body: JSON.stringify(payload) }, csrfToken);
  },
  calculate(id: string, expectedRevision: number, csrfToken: string): Promise<{ snapshot: CalculationSnapshot }> {
    return request(`/api/cases/${encodeURIComponent(id)}/calculate`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, requestId: crypto.randomUUID() }),
    }, csrfToken);
  },
  submit(id: string, expectedRevision: number, previewSnapshotId: string, csrfToken: string, requestId: string = crypto.randomUUID()): Promise<{ case: FtcCaseRecord; snapshot: CalculationSnapshot }> {
    return request(`/api/cases/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, previewSnapshotId, requestId }),
    }, csrfToken);
  },
  listOfficerCases(): Promise<{ cases: FtcCaseRecord[] }> {
    return request("/api/officer/cases");
  },
  getOfficerCase(id: string): Promise<OfficerCaseDetail> {
    return request(`/api/officer/cases/${encodeURIComponent(id)}`);
  },
  snapshot(id: string): Promise<{ snapshot: CalculationSnapshot }> {
    return request(`/api/snapshots/${encodeURIComponent(id)}`);
  },
  uploadEvidence(caseId: string, file: File, metadata: { sourceId: string | null; kind: string; expectedRevision: number; requestId: string }, csrfToken: string): Promise<{ attachment: AttachmentMetadata; case: FtcCaseRecord }> {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("displayName", file.name);
    form.set("sourceId", metadata.sourceId ?? "");
    form.set("kind", metadata.kind);
    form.set("expectedRevision", String(metadata.expectedRevision));
    form.set("requestId", metadata.requestId);
    return request(`/api/cases/${encodeURIComponent(caseId)}/attachments`, { method: "POST", body: form }, csrfToken);
  },
  removeEvidence(id: string, expectedRevision: number, csrfToken: string): Promise<{ deleted: true; revision: number }> {
    return request(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision, requestId: crypto.randomUUID() }) }, csrfToken);
  },
  async downloadEvidence(id: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiError | null;
      throw new ApiClientError(response.status, body?.error.code ?? "service_unavailable", body?.error.message ?? "ดาวน์โหลดไฟล์ไม่สำเร็จ", body?.error.fields, body?.error.requestId);
    }
    return response.blob();
  },
};

/** Returns true only when logout succeeded or the session endpoint confirms anonymity. */
export async function logoutAndConfirm(csrfToken: string): Promise<boolean> {
  try {
    await hostedApi.logout(csrfToken);
    return true;
  } catch {
    try {
      return (await hostedApi.session()) === null;
    } catch {
      return false;
    }
  }
}
