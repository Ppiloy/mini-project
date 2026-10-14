# Authentication and durable drafts

Type: task
Status: open
Blocked by: 01

Implement the authentication/draft foundation in plan sections 6/7: PostgreSQL migrations/repositories and state-protection constraints, scrypt/persistent sessions/rate limits/CSRF, owner-scoped nullable drafts, retry-safe creation and optimistic revisions, structured API errors and failure recovery. Provide the migration tables and repository seams for ticket 07 without speculative endpoints. Use actual PostgreSQL-compatible integration tests where feasible; no authoritative MemoryStore or SQLite. Verify identity/ownership/revision/session/account-switching acceptance cases.
