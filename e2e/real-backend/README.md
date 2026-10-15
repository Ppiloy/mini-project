# Real-backend browser acceptance

Run `npm run test:e2e:real` to launch this isolated acceptance environment. It starts the actual Express app on `FTC_REAL_API_PORT` (default `19111`) and Vite on `FTC_REAL_WEB_PORT` (default `15191`); both servers use strict ports and never reuse an existing listener. Set `CI=true` in local/CI invocations so the runner uses the same no-reuse behavior as CI. The default `npm run test:e2e` suite excludes `e2e/real-backend`; run this dedicated command to exercise these 11 acceptance journeys.

The harness applies every committed SQL migration to a fresh PGlite database and seeds only the operator's three fictional accounts. Generated passwords live in a per-run private temporary file; Playwright traces, screenshots, video and credential output are disabled, and teardown removes that file/directory. Tests navigate the real browser UI and real local HTTP API. They do not stub API responses.

Evidence bytes use the harness-only in-memory `BlobIO` adapter. This proves browser-to-Express upload/download composition and database metadata linkage; it does not prove Netlify Blobs durability, real PostgreSQL concurrency, the Netlify wrapper, redeploy persistence, preview isolation or cloud behavior. Those remain separate hosting acceptance gates.
