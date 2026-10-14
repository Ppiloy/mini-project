# Authorized durable workflow

Type: task
Status: open
Blocked by: 01

Implement every API family and storage requirement in plan sections 6/7: PostgreSQL migrations/repositories, scrypt/persistent sessions/rate limits/CSRF, partial drafts and optimistic revisions, current previews, atomic retry-safe submit/assignment, frozen snapshots and evidence, audit-before-read, Blobs upload intents/signature/quotas, namespace isolation. Use actual PostgreSQL-compatible integration tests where feasible; no authoritative MemoryStore or SQLite. Verify API permission/race/error acceptance cases.
