import { randomUUID } from "node:crypto";
import { connectLambda } from "@netlify/blobs";
import serverless from "serverless-http";
import type { Express } from "express";
import { createApp, type CreateAppOptions } from "../../server/app.js";
import { makeRuntimePool } from "../../server/app.js";
import { resolveRuntimeEnvironmentConfig } from "../../server/runtime/environment.js";
import { netlifyBlobIO } from "../../server/storage/blob-io.js";

type NetlifyLambdaEvent = Record<string, unknown> & {
  path?: string;
  rawPath?: string;
  rawUrl?: string;
  requestPath?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: Record<string, unknown>;
};

interface BlobsLambdaEvent {
  blobs: string;
  headers: Record<string, string>;
}

interface FunctionResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  multiValueHeaders?: Record<string, string[]>;
  cookies?: string[];
  body: string;
  isBase64Encoded?: boolean;
}

const runtimePool = makeRuntimePool();
const runtimeApps = new Map<boolean, Express>();

function runtimeApp(trustedHttps: boolean): Express {
  const cached = runtimeApps.get(trustedHttps);
  if (cached) return cached;
  const sessionSecret = process.env.SESSION_SECRET;
  const allowedOrigin = process.env.FTC_ALLOWED_ORIGIN;
  if (!process.env.NETLIFY_DB_URL || !sessionSecret || sessionSecret.length < 32 || !allowedOrigin) {
    throw new Error("Hosted API environment is incomplete.");
  }
  const options: CreateAppOptions = { pool: runtimePool, sessionSecret, allowedOrigin, trustedHttps,
    environment: resolveRuntimeEnvironmentConfig(process.env), blobIO: netlifyBlobIO,
    officerUserId: process.env.FTC_OFFICER_USER_ID };
  const app = createApp(options);
  runtimeApps.set(trustedHttps, app);
  return app;
}

function eventRequestUrl(event: NetlifyLambdaEvent): URL | null {
  if (typeof event.rawUrl !== "string") return null;
  try {
    return new URL(event.rawUrl);
  } catch {
    return null;
  }
}

function trustedHttpsFromEvent(event: NetlifyLambdaEvent): boolean {
  const url = eventRequestUrl(event);
  const allowedOrigin = process.env.FTC_ALLOWED_ORIGIN;
  return Boolean(url && url.protocol === "https:" && allowedOrigin && url.origin === allowedOrigin && !url.username && !url.password);
}

function normalizedPath(event: NetlifyLambdaEvent, requestUrl: string): string {
  let path = eventRequestUrl(event)?.pathname;
  if (!path) {
    const eventPath = typeof event.requestPath === "string" ? event.requestPath
      : typeof event.rawPath === "string" ? event.rawPath
        : typeof event.path === "string" ? event.path : new URL(requestUrl, "http://localhost").pathname;
    path = eventPath;
  }
  const functionPrefix = "/.netlify/functions/api";
  if (path === functionPrefix || path.startsWith(`${functionPrefix}/`)) {
    const remainder = path.slice(functionPrefix.length);
    if (!remainder || remainder === "/") return "/api";
    return remainder === "/api" || remainder.startsWith("/api/") ? remainder : `/api${remainder}`;
  }
  return path;
}

function clearUntrustedForwardingHeaders(headers: Record<string, string | undefined>): void {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "forwarded" || name.toLowerCase().startsWith("x-forwarded-")) delete headers[name];
  }
}

function safeInitFailure() {
  const requestId = randomUUID();
  return {
    statusCode: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "x-request-id": requestId,
    },
    body: JSON.stringify({
      error: { code: "service_unavailable", message: "บริการไม่พร้อมใช้งาน", requestId },
    }),
    isBase64Encoded: false,
  };
}

function insecureHostedFailure() {
  const requestId = randomUUID();
  return {
    statusCode: 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", pragma: "no-cache" },
    body: JSON.stringify({ error: { code: "forbidden", message: "การเชื่อมต่อไม่ปลอดภัย", requestId } }),
    isBase64Encoded: false,
  };
}

/** Lambda compatibility mode requires this per invocation before using Blobs. */
function initializeBlobsFromEvent(event: NetlifyLambdaEvent): void {
  if (typeof event.blobs === "string" && event.headers && typeof event.headers === "object") {
    connectLambda(event as unknown as BlobsLambdaEvent);
  }
}

export function createFunctionHandler(appForRequest: (trustedHttps: boolean) => Express) {
  const wrapped = new Map<boolean, ReturnType<typeof serverless>>();
  return async (input: unknown, context: unknown = {}): Promise<FunctionResponse> => {
    try {
      if (!input || typeof input !== "object") throw new Error("Invalid function event.");
      const event = input as NetlifyLambdaEvent;
      initializeBlobsFromEvent(event);
      const configuredOrigin = process.env.FTC_ALLOWED_ORIGIN;
      if (configuredOrigin?.startsWith("https://") && !trustedHttpsFromEvent(event)) {
        return insecureHostedFailure();
      }
      const trustedHttps = trustedHttpsFromEvent(event);
      let handler = wrapped.get(trustedHttps);
      if (!handler) {
        handler = serverless(appForRequest(trustedHttps), {
          binary: ["application/pdf", "image/*", "application/octet-stream"],
          request: (request: import("node:http").IncomingMessage, lambdaEvent: unknown) => {
            const wrappedEvent = lambdaEvent as NetlifyLambdaEvent;
            const requestUrl = request.url ?? "/";
            const pathname = normalizedPath(wrappedEvent, requestUrl);
            const url = new URL(requestUrl, "http://localhost");
            request.url = `${pathname}${url.search}`;
            clearUntrustedForwardingHeaders(request.headers as Record<string, string | undefined>);
          },
        });
        wrapped.set(trustedHttps, handler);
      }
      return await handler(event, context as Record<string, unknown>) as FunctionResponse;
    } catch {
      return safeInitFailure();
    }
  };
}

/** App and store initialization is deferred until the first Function invocation. */
export const handler = createFunctionHandler(runtimeApp);
