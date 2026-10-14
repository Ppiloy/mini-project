import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Express } from "express";

/** Express application scaffold; feature routes are mounted by the hosted API work. */
export const app: Express = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ data: { status: "ok" }, requestId: randomUUID() });
});

app.use("/api", (_request, response) => {
  response.status(404).json({
    error: {
      code: "not_found",
      message: "ไม่พบเส้นทาง API",
      requestId: randomUUID(),
    },
  });
});

app.use((_request, response) => {
  response.status(404).send("Not found");
});

const structuredApiErrors: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (request.path !== "/api" && !request.path.startsWith("/api/")) {
    next(error);
    return;
  }

  const parserError = error as { status?: number; type?: string };
  const status = parserError.status === 413 ? 413 : parserError.status === 400 ? 400 : 503;
  const code = status === 413 ? "payload_too_large" : status === 400 ? "invalid_input" : "service_unavailable";
  response.status(status).json({
    error: {
      code,
      message: status === 400 ? "ข้อมูล JSON ไม่ถูกต้อง" : status === 413 ? "ข้อมูลมีขนาดใหญ่เกินกำหนด" : "บริการไม่พร้อมใช้งาน",
      requestId: randomUUID(),
    },
  });
};

app.use(structuredApiErrors);
