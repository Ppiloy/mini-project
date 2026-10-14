# Authentication and durable drafts

Type: task
Status: resolved
Blocked by: 01

Implement the authentication/draft foundation in plan sections 6/7: PostgreSQL migrations/repositories and state-protection constraints, scrypt/persistent sessions/rate limits/CSRF, owner-scoped nullable drafts, retry-safe creation and optimistic revisions, structured API errors and failure recovery. Provide the migration tables and repository seams for ticket 07 without speculative endpoints. Use actual PostgreSQL-compatible integration tests where feasible; no authoritative MemoryStore or SQLite. Verify identity/ownership/revision/session/account-switching acceptance cases.

## Answer

Implemented and independently adversarially reviewed at `e3d965064482d06bb0bf5c090fab45d65a7ef243`, merged as `fcf39b71d2ee167e619b7e4c9778e9e13600a65a`. Four original findings were repaired and independently rechecked. Integration typecheck, 51 tests and build pass. Evidence: [review](../reviews/03-hosted.md). This resolves the local authentication/draft unit; actual hosted PostgreSQL/session and later evidence/submission checks remain ticket 06 gates.
