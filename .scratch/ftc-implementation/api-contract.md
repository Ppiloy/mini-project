# FTC hosted API contract

All JSON replies include an opaque `requestId`. Successful replies use `{ data, requestId }`; failures use `{ error: { code, message, fields?, requestId } }`. Every `/api` response is `Cache-Control: private, no-store`. Money, rates and computed decimals are strings. Missing draft facts are explicit `null` values. The browser never chooses a role, officer, status, storage key, rule set or derived total.

Mutations require the exact configured same-origin `Origin` header. Authenticated mutations also require `X-CSRF-Token`, returned by login/session. The hosted cookie is `ftc.sid`, host-only, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`; local HTTP development omits `Secure`. JSON request bodies are limited to 1 MiB.

## Authentication and drafts (ticket 03)

| Request | Body | Success |
|---|---|---|
| `POST /api/auth/login` | `{ loginName, password }` | `200 { data: { user: ApiUser, csrfToken }, requestId }`; session cookie is regenerated and persisted before success |
| `GET /api/auth/session` | — | `200 { data: { user: ApiUser, csrfToken }, requestId }`; unauthenticated is `401` |
| `POST /api/auth/logout` | `{}` | `200 { data: { loggedOut: true }, requestId }`; requires CSRF and destroys the PostgreSQL session |
| `GET /api/cases` | — | `200 { data: { cases: FtcCaseRecord[] }, requestId }`; owner-scoped |
| `POST /api/cases` | `{ requestId }` | New case: `201 { data: { case: FtcCaseRecord }, requestId }`; same owner/request ID retry: `200` with the same case |
| `GET /api/cases/:id` | — | `200 { data: CaseWorkflowDetail, requestId }`; inaccessible and missing IDs both return `404` |
| `PUT /api/cases/:id/draft` | `{ expectedRevision, requestId, data: FtcCaseDraft, confirmations? }` | `200 { data: { case: FtcCaseRecord }, requestId }`; a successful save advances revision once |

`confirmations` is optional and shaped as `{ thaiTax: boolean, eligibleSourceIds?: string[], eligibleSourceIndexes?: number[] }`. Indexes refer to the corresponding `data.sources` order and support first-save sources with `id: null`; the server generates their IDs before writing. The server ignores submitted confirmation times/fingerprints. It stamps a confirmation only when the matching explicit flag is set, and preserves an earlier server confirmation only while its fingerprint still matches. Tax-input edits stale the supplied Thai-tax confirmation. Evidence-only updates do not affect that fingerprint.

`POST /api/cases` serializes quota checks by owner and permits ten cases per taxpayer. Case-creation retries are scoped to owner plus request ID. Draft saves require an exact `expectedRevision`; stale revisions return `409` without overwriting data. A successful request ID is replayable with the original response; reusing it with a different body is `409`.

## Snapshot and evidence families (ticket 07)

These route names follow plan section 7 and are implemented by ticket 07. Taxpayer `GET /api/cases/:id` returns `{ data: { case, attachments: AttachmentMetadata[], currentPreview: CalculationSnapshot | null, snapshotSummaries, auditEvents }, requestId }`, which is the reload source for authoritative pending/ready/failed attachment metadata; there is no separate list endpoint. Arrays are bounded by case quotas and snapshot summaries omit full result/input JSON.

| Request | Request contract | Success envelope |
|---|---|---|
| `POST /api/cases/:id/attachments` | Multipart one file plus `AttachmentUploadMetadata` fields `expectedRevision`, `requestId`, `sourceId`, `kind`, `displayName` | `201 { data: { attachment: AttachmentMetadata, case: FtcCaseRecord, revision }, requestId }`; identical retry is `200` with the original response |
| `DELETE /api/attachments/:id` | JSON `{ expectedRevision, requestId }` | `200 { data: { deleted: true, revision }, requestId }` |
| `GET /api/attachments/:id` | — | authorized byte response with attachment disposition and `nosniff` |
| `POST /api/cases/:id/calculate` | `{ expectedRevision, requestId }` | `200 { data: { snapshot: CalculationSnapshot }, requestId }` |
| `POST /api/cases/:id/submit` | `SubmitCaseRequest`: `{ expectedRevision, previewSnapshotId, requestId }` | `200 { data: { case, snapshot }, requestId }`; retry returns the same committed result |
| `GET /api/officer/cases` | — | `200 { data: { cases: FtcCaseRecord[] }, requestId }`; assigned submitted records only |
| `GET /api/officer/cases/:id` | — | `200 { data: { case, attachments, snapshot, auditEvents }, requestId }`; records access before reading/returning protected data |
| `GET /api/snapshots/:id` | — | `200 { data: { snapshot: CalculationSnapshot }, requestId }`; owner or assigned officer only |

`CaseWorkflowDetail` is `{ case, attachments, currentPreview, snapshotSummaries, auditEvents }`. Attachments exclude deleted tombstones but retain pending/failed state; snapshot summaries and audit events are newest-first and capped at 20. `AuditEventSummary` uses display strings `{ id, event, actor, occurredAt }` for the taxpayer and officer views. Evidence upload advances revision once when reserved and once when finalized; deletion advances it once. Preview and audit append do not advance the input/evidence revision.

## Hosted environment setup

Hosted Functions require the server-only `FTC_DEPLOYMENT_CONTEXT` value: `production`, `deploy-preview`, or `branch-deploy`. Local development uses `dev`. Hosted startup fails closed if this value or `NETLIFY_DB_URL` is missing; the Function must not infer local mode from missing platform context. `FTC_BLOB_REGION` selects the verified Netlify Blobs region and should match the linked Function region (`us-east-2` for this site). `FTC_OFFICER_USER_ID` is the seeded active officer's database UUID; submissions fail with `503` until it names an active `officer` account.

The runtime identifies a database branch by hashing the PostgreSQL protocol, username, host, port, database path, and sorted connection query parameters; it never stores or returns the password or raw connection URL. Provision distinct role/database identities for production and preview branches when the provider routes branches through a shared endpoint. Blob stores are generated from trusted server configuration: production uses one stable site store, while preview uses a site-and-database-fingerprint namespace; the browser never selects a store, region, context, or branch. The first trusted initialization stores an immutable environment mapping and an active marker in `hosting_environment_markers` / `active_hosting_environment`. A cloned preview database can switch to a new marker only when its actual database fingerprint differs; that one-time switch invalidates cloned sessions and scopes new cases/evidence to the new marker. Same-database store, region, or context drift fails closed, and preview configuration cannot rotate a production marker that has the same database fingerprint. Old cloned references remain inaccessible; preview initialization never reads or deletes production Blob objects.

## Error status mapping

| Status | `error.code` | Meaning |
|---:|---|---|
| 400 | `invalid_input` | Malformed JSON or envelope |
| 401 | `unauthenticated` | Missing/expired session or invalid credentials |
| 403 | `forbidden` | Origin, CSRF or role denial |
| 404 | `not_found` | Missing or inaccessible object |
| 409 | `conflict` | Stale revision/state or conflicting retry ID |
| 413 | `payload_too_large` | Request body exceeds limit |
| 415 | `unsupported_media_type` | Unsupported upload media |
| 422 | `invalid_input`, `incomplete_case`, or `unsupported_case` | Shared schema or calculation validation; optional `fields` paths |
| 429 | `rate_limited` | Persistent authentication limit or case quota |
| 503 | `service_unavailable` | Transient database or storage failure |
