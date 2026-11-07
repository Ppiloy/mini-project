import type { Context } from "@netlify/functions";
import { getConnectionString } from "@netlify/database";
import { makeRuntimePool } from "../../server/app.js";
import { createPreviewOperatorHandler } from "../../server/runtime/preview-operator.js";
import { netlifyBlobIO } from "../../server/storage/blob-io.js";

const runtimePool = makeRuntimePool({ usePlatformContext: true });
const handler = createPreviewOperatorHandler({
  runtime: () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NETLIFY_DB_URL: getConnectionString() };
    return { pool: runtimePool, env, blobs: { ...netlifyBlobIO, supportsStrongReads: true, async list() { throw new Error("List is not used by preview initialization."); } } };
  },
});

export default async function previewOperator(request: Request, context: Context): Promise<Response> {
  return handler(request, context);
}
