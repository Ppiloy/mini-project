import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("API scaffold", () => {
  it("returns a structured JSON error for an unknown API route", async () => {
    const response = await request(app).get("/api/no-such-route");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: "not_found",
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("does not serve the application shell for an unknown API route", async () => {
    const response = await request(app).get("/api/anything");

    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("returns a structured error for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/cases")
      .set("content-type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "invalid_input", requestId: expect.any(String) });
  });

  it("returns a structured error for JSON beyond the body limit", async () => {
    const response = await request(app)
      .post("/api/cases")
      .set("content-type", "application/json")
      .send(JSON.stringify({ payload: "x".repeat(1_050_000) }));

    expect(response.status).toBe(413);
    expect(response.body.error).toMatchObject({ code: "payload_too_large", requestId: expect.any(String) });
  });
});
