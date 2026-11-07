import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../../shared/draft.js";
import { createCalculationSnapshot } from "../../shared/snapshot.js";
import { hostedApi } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("hosted evidence upload contract", () => {
  it("sends the original Unicode file name as displayName multipart metadata", async () => {
    const filename = "ใบรับรองภาษี.pdf";
    const file = new File([new Uint8Array([37, 80, 68, 70, 45])], filename, { type: "application/pdf" });
    const now = "2026-10-14T00:00:00.000Z";
    const record = { id: "case-1", ownerId: "taxpayer-1", status: "draft" as const, draft: { ...createEmptyDraft(), id: "case-1", createdAt: now, updatedAt: now }, assignedOfficerId: null, submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now };
    const attachment = { id: "attachment-1", caseId: record.id, sourceId: null, kind: "other" as const, displayName: filename, mediaType: "application/pdf", byteSize: 5, sha256: "a".repeat(64), status: "ready" as const, createdAt: now };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      data: { attachment, case: record, revision: 1 }, requestId: "response-request-id",
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await hostedApi.uploadEvidence("00000000-0000-4000-8000-000000000001", file,
      { sourceId: null, kind: "other", expectedRevision: 0, requestId: "upload-request" }, "csrf-token");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe("/api/cases/00000000-0000-4000-8000-000000000001/attachments");
    expect((init?.body as FormData).get("displayName")).toBe(filename);
  });
});

describe("hosted success response validation", () => {
  it("recovers from a malformed case list and preserves its request ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { cases: [{}] }, requestId: "malformed-case-list" })));

    await expect(hostedApi.listCases()).rejects.toMatchObject({ code: "invalid_response", requestId: "malformed-case-list" });
  });

  it("recovers from a malformed snapshot and preserves its request ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { snapshot: { id: "bad-snapshot" } }, requestId: "malformed-snapshot" })));

    await expect(hostedApi.snapshot("bad-snapshot")).rejects.toMatchObject({ code: "invalid_response", requestId: "malformed-snapshot" });
  });

  it("accepts case and snapshot DTOs created by the shared server domain model", async () => {
    const now = "2026-10-14T00:00:00.000Z";
    const record = { id: "case-2", ownerId: "taxpayer-1", status: "draft" as const, draft: { ...createEmptyDraft(), id: "case-2", createdAt: now, updatedAt: now }, assignedOfficerId: null, submittedSnapshotId: null, submittedAt: null, createdAt: now, updatedAt: now };
    const snapshot = createCalculationSnapshot({ id: "snapshot-1", caseId: record.id, revision: 0, kind: "preview", inputs: record.draft, evidence: [], createdAt: now });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("snapshots")
      ? Response.json({ data: { snapshot }, requestId: "snapshot-request" })
      : Response.json({ data: { cases: [record] }, requestId: "case-list-request" })));

    await expect(hostedApi.listCases()).resolves.toEqual({ cases: [record] });
    await expect(hostedApi.snapshot(snapshot.id)).resolves.toEqual({ snapshot });
  });
});
