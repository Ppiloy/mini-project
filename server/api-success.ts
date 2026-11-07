import type { Response } from "express";
import type { z } from "zod";
import type { ApiSuccess } from "../shared/contracts.js";

/** Check the same JSON contract used by the browser before emitting an API success. */
export function sendApiSuccess<T>(
  response: Response,
  schema: z.ZodType<ApiSuccess<T>>,
  data: T,
  requestId: string,
  status = 200,
): void {
  response.status(status).json(schema.parse({ data, requestId }));
}
