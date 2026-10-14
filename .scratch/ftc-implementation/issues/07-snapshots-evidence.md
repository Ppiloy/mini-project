# Snapshots, evidence and submission

Type: task
Status: open
Blocked by: 02, 03

Implement the remaining plan sections 6/7 workflow: revision-bound saved previews, shared decimal engine and server confirmation checks, current-policy checks, atomic retry-safe submission/assignment, immutable submitted inputs/evidence/snapshots, assigned officer queue/read-only detail/report with audit-before-read. Authorized Blobs with explicit consistent region, signature/type/size/count/case quotas and upload intents/finalization races; pending/failed cancellation; frozen metadata/object keys/digests; environment/verified database branch isolation. API tests must exercise tampering, response-loss retries, officer unavailable/unassigned, upload failure/races, freeze and audit failure. All network Blob I/O outside case-row-lock transactions; every child mutation locks and advances revision.
