import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedApi } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("hosted evidence upload contract", () => {
  it("sends the original Unicode file name as displayName multipart metadata", async () => {
    const filename = "ใบรับรองภาษี.pdf";
    const file = new File([new Uint8Array([37, 80, 68, 70, 45])], filename, { type: "application/pdf" });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      data: { attachment: { displayName: filename }, case: {} }, requestId: "response-request-id",
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
