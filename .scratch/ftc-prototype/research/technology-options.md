# Netlify technology choices for the FTC prototype

Updated 13 October 2026 after the user requested Netlify hosting, including its database if supported. This replaces the earlier local-only SQLite architecture. The target remains one developer, four weeks, approximately 80–120 hours, with a fixture-first milestone. All vendor facts below were checked against primary documentation; no Netlify account, project, entitlement, dependency combination or live integration has been inspected or provisioned.

Review addendum, 14 October 2026: the [main plan](../../../FTC-PROTOTYPE-PLAN.md) now puts a 4–6 hour deployed integration gate alongside the week-one fixture milestone. It also specifies API contracts, automatic officer assignment, evidence quotas, nullable drafts, precise decimal storage and idempotent seeding. The [review](../plan-review.md) separates fixed specification gaps from remaining runtime/account checks.

## Selected architecture

| Layer | Selection |
|---|---|
| Frontend | React + TypeScript + Vite, published as static assets on Netlify |
| Backend | Express 5 + TypeScript adapted with serverless-http to Netlify Functions |
| Relational data | Netlify Database, which is managed PostgreSQL |
| Database access | @netlify/database; parameterized queries and pooled transactions |
| Authentication | Seeded application users, scrypt password hashes, express-session and connect-pg-simple |
| Sessions | PostgreSQL session table, not memory or local disk |
| Documents | Netlify Blobs with database access metadata and authorized Function routes |
| Calculations | Shared decimal.js module and Zod validation |
| Schema | SQL files in netlify/database/migrations/ |
| Verification | Vitest, Playwright, deployed API/permission tests and recovery rehearsal |
| Development | Netlify Dev's local PostgreSQL-compatible environment and Blob sandbox; fixture-only fallback |

The current Netlify offering includes a fully managed Postgres database. It is appropriate for the project's relational cases and calculation history. Database branches are connected to the deployment workflow, and the SDK selects environment-specific connections. [Database overview](https://docs.netlify.com/build/data-and-storage/netlify-database/), [Database SDK](https://docs.netlify.com/build/data-and-storage/netlify-database/api/).

The user requested database hosting if supported; therefore the chosen hosted database is PostgreSQL rather than the previous SQLite file. There is no existing implemented SQLite database to migrate. Netlify Functions run in ephemeral environments, so the design must not depend on a local database file, uploads directory, or process-memory sessions surviving requests. [Function execution model](https://docs.netlify.com/build/functions/overview/).

## Account and cost boundary

Netlify Database is available on credit-based plans. Published account limits include a Free tier, but that does not establish this account's eligibility or guarantee that the project costs nothing. Compute and bandwidth consume credits. The documentation still refers to a storage offer ending 1 July 2026; that date has passed, so confirm actual storage charges and account limits before enabling the database. Keep sleep-on-inactivity enabled for the prototype, review usage after rehearsal, and do not promise an always-on free service. [Billing and usage](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/).

Provisioning is a future implementation step. If the account cannot enable Netlify Database, resolve the account option or agree on another managed PostgreSQL provider while retaining Netlify hosting. Do not silently revive SQLite in the serverless filesystem. The plan update itself purchases nothing and changes no account settings.

## Backend and database contract

Retain Express because Netlify explicitly documents deploying it with serverless-http. Export the application through a Function entry point without app.listen. Publish Vite's dist directory, configure /api routing before the SPA fallback, and test the deployed wrapper rather than assuming local behavior proves hosted compatibility. [Express on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/).

Use the SDK for the current database context, parameterize queries, and keep credentials out of browser code. For a transaction, acquire one client from the SDK pool and use that client for all statements; release it after commit/rollback. The SDK documents a pg.Pool-compatible pool for transaction control. [Database API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/).

Application submission design: authenticate the taxpayer, lock the owned case, compare the expected revision, load and calculate with the shared engine, and save the immutable snapshot, state change and audit event in one transaction. Child mutations must lock the same parent and increment its revision. A valid duplicate submit returns the existing snapshot. Keep Blob I/O outside database transactions.

Use PostgreSQL NUMERIC for amounts/rates, DATE for business dates, TIMESTAMPTZ for events and JSONB for complete snapshots. Preserve decimal strings in API/JSON representations and ensure the driver does not silently convert monetary values to JavaScript Number. The source tax-year and rounding assumptions remain unchanged.

Place SQL migrations under netlify/database/migrations/. Netlify applies them at the appropriate production/preview deploy stage; a migration failure blocks publication. Prefer backward-compatible schema changes because rolling back code does not reverse schema changes. [Migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).

## Authentication and permissions

The prototype's taxpayer/officer accounts are application accounts, distinct from Netlify team members. Host the app's users and password hashes in PostgreSQL. Use express-session with connect-pg-simple and a compatible environment-specific pool; its supported pool option avoids creating a separate unmanaged connection path. Test the exact Express/Function/SDK/session-store versions during implementation. [Session store documentation](https://github.com/voxpelli/node-connect-pg-simple).

Create the session table through migrations, use explicit expiry, and avoid relying on per-process cleanup timers. Keep secrets stable across production deploys but distinct in preview contexts. Hosted cookies are Secure, HttpOnly, SameSite and host-only. Regenerate sessions on sign-in, invalidate on sign-out, verify Origin/CSRF protections and persist login-attempt limits. Disable public registration for the seeded demonstration.

Validate proxy/HTTPS detection in the deployed adapter before treating authentication as working: Secure cookies require correct HTTPS recognition. Use a constrained trusted proxy configuration, save the login session before success, disable uninitialized session saving, and verify server-enforced idle/absolute expiry. Clear user-scoped browser caches when the account changes. [Express sessions](https://expressjs.com/en/resources/middleware/session/), [Express proxy handling](https://expressjs.com/en/guide/behind-proxies/).

Each case, line, snapshot and evidence request checks ownership or protected officer assignment in the API. Do not expose a generic SQL endpoint or trust a user-editable role. Avoid shared caching of authenticated results. Platform dashboard roles govern builders' database access; they do not implement the taxpayer/officer authorization model. [Netlify database access control](https://docs.netlify.com/build/data-and-storage/netlify-database/access-control/).

## Evidence storage and limits

Netlify Blobs provides durable object storage. A site-wide store survives redeploys and is shared across deploy contexts; a deploy-specific store follows a particular deploy's lifecycle. Choose a stable site-wide production evidence store, and separate preview namespaces. Use strong reads where immediate visibility is required. The application must authorize sensitive data access. [Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

Proposed workflow: authorize/reserve an upload intent, write a generated object key, then lock/recheck the draft before marking its metadata ready. Preserve the object digest and key in the submitted snapshot. An upload racing with submission becomes an unlinked object for safe cleanup, not late evidence. Delete a draft's authorized metadata link before object cleanup; do not overwrite/delete submitted evidence. These are application design choices; PostgreSQL and object storage are not a single transaction.

Use a maximum of 3 MiB per file, one file per upload request, five files per income record. Netlify documents a 6 MB buffered request/response ceiling and a 4.5 MB effective limit for binary requests after encoding overhead. The smaller app limit leaves multipart headroom; verify uploads and downloads through the deployed Express adapter. [Function configuration](https://docs.netlify.com/build/functions/configuration/).

Access files only through authenticated Function routes that look up an attachment ID in the current database context. Never accept an arbitrary store/key from the client or publish a raw evidence directory. Set private/no-store responses and safe MIME/download headers. Confirm SDK context and binary handling with the serverless-http adapter in the first integration spike.

## Preview isolation, development and recovery

Database preview branching does not also branch site-wide Blob objects. Design explicit environment namespaces for evidence and clear/reseed copied attachment references in preview databases. Validate the environment before all reads, writes and deletions. Avoid copying usable production sessions into previews. Treat preview namespacing as application isolation, not protection against malicious code with site credentials; only trusted project changes receive backend access.

Use Netlify Dev or its Vite integration for the local PostgreSQL-compatible environment. Apply local migrations explicitly and seed fictional data; keep production credentials out of normal local development. The local environment does not replace tests against the actual Function deployment and managed database. [Local database development](https://docs.netlify.com/build/data-and-storage/netlify-database/local-development/).

Netlify documents scheduled and publish-triggered database backups with plan-dependent retention. Rolling back the deployed code leaves the database unchanged. A database restore is a separate operation, and restored data may discard newer activity. Keep a separate evidence export/manifest and rehearse coordinated recovery in a disposable environment; database backups do not establish that Blob objects were backed up. [Database recovery](https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/).

The hosted application needs internet. Bundle a fixture-only local demo for outages, clearly separated from the live review queue. Do not promise offline synchronization or live data access through that fallback.

## Required implementation checks

1. Confirm account eligibility, current usage terms, supported runtime and region choices before provisioning.
2. Deploy a minimal Express Function that performs an authorized database query, session round trip and Blob upload/download.
3. Validate exact decimal round trips, all arithmetic fixtures and the authoritative submit transaction.
4. Verify cross-account and officer restrictions through direct HTTP requests, including report and file endpoints.
5. Exercise concurrent edits, retries, upload/submit races, expired sessions and serverless cold starts.
6. Prove a preview cannot alter production cases or evidence; deploy a new production version and confirm old records/files remain available.
7. Rehearse data-plus-evidence recovery and check every manifest reference.
8. Measure the demonstration's usage and latency; document failures and the local fixture fallback.

These are planned checks. No dependency installation, account provisioning, migrations, deployed service or runtime tests were performed during this update.
