# Snapshots, evidence and submission

Type: task
Status: resolved
Blocked by: 02, 03

Implement the remaining plan sections 6/7 workflow: revision-bound saved previews, shared decimal engine and server confirmation checks, current-policy checks, atomic retry-safe submission/assignment, immutable submitted inputs/evidence/snapshots, assigned officer queue/read-only detail/report with audit-before-read. Authorized Blobs with explicit consistent region, signature/type/size/count/case quotas and upload intents/finalization races; pending/failed cancellation; frozen metadata/object keys/digests; environment/verified database branch isolation. API tests must exercise tampering, response-loss retries, officer unavailable/unassigned, upload failure/races, freeze and audit failure. All network Blob I/O outside case-row-lock transactions; every child mutation locks and advances revision.

## Agreed implementation decisions

- Keep the planned single-file multipart `POST /api/cases/:id/attachments`. Reservation, Blob write and finalization are internal phases, with Blob I/O outside database transactions. Do not introduce public intent/token/content/finalize routes. Compute SHA-256 from the actual received bytes before reservation; client digests are not authoritative. Successful upload replies include the attachment and the authoritative case/revision.
- Preserve the upload operation's request ID across retries. A failed response followed by an older attachment with the same display name does not prove success. Replays must distinguish the actual operation and received bytes.
- The case `revision` versions inputs and evidence. Draft saves, upload reservation/finalization and cancellation advance it under the case lock. Preview snapshots and audit appends lock as needed but do not advance this revision. A freshly calculated preview must remain current.
- Deleting draft evidence releases source/remittance foreign-key references; a soft-deleted tombstone must not prevent subsequent removal of those inputs. Track physical Blob cleanup separately. Submitted evidence remains frozen.
- Extend bounded case detail and officer responses in the existing shared API contract. Keep stable source/remittance IDs. Split workflow code into cohesive services rather than extending the authentication/draft composition file indefinitely.
- The external `ftc-workflow-contract.md` is exploratory. These decisions supersede its proposed public three-phase upload endpoints and nullable client-claimed digest shape.
- Do not claim preview persistence across a replaced database branch. Verify the actual Netlify branch lifecycle and environment identity at the hosted gate; fail closed on incompatible stored environment mappings.

## Answer

Implemented and independently adversarially rereviewed along workflow and storage/environment scopes at `7586c645d902bbee13c7f4d2930f086640064ac9`, merged as `c2f1f671d69d21935539ebc2520a23a78d7119e6`. Officer self-submission, actual UI multipart metadata, and Function context fallback findings are repaired. Independent quota, replay, cancellation, finalization/submission, frozen-state, audit, role and marker checks pass; integration typecheck, 69 tests and build pass. Evidence: [workflow review](../reviews/07-workflow.md) and [storage review](../reviews/07-evidence.md). Cleanup retry tooling is required by ticket 05 and remains open; actual Netlify/PostgreSQL/Blobs and branch-lifecycle checks remain ticket 06 gates.
