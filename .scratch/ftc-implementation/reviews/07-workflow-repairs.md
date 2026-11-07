# Ticket 07 repair notes

This note supplements the independent review at `ftc-review-workflow.md`; it does not replace or edit that report.

- Added authenticated taxpayer-role gates to taxpayer case list/create/read/save, calculate, upload, delete, and submit routes. Snapshot and attachment owner reads now require both taxpayer role and owner ID; active assigned officers retain submitted case, snapshot, and ready-evidence reads. Public HTTP tests cover the full endpoint family, self-submit against a legacy officer-owned draft, no child writes, inaccessible owner branches, and continued assigned-officer reads.
- The browser upload helper now sends `displayName` from the selected file's original name. Tests verify the helper's multipart field and the server's public multipart handling of a Unicode filename.
- Environment resolution now requires explicit `FTC_DEPLOYMENT_CONTEXT` even when platform markers are absent. A Lambda wrapper regression with database/origin/session configuration but no context or platform indicators returns structured `503` before app construction.
- Added HTTP quota boundary checks for exactly 3 MiB/file, 20 files/case including pending/failed rows, 30 MiB/case, and five files/source. Added a deferred Blob-finalization-versus-submit regression.
- SQL permits only `cleanup_pending` and `storage_deleted_at` updates on deleted tombstones after submission. Evidence metadata, status, and tombstones remain immutable; no cleanup command was added because that command belongs to the operations ticket.

Verification on the candidate: `npm run typecheck` passed; `npm test -- --run` passed (10 files / 69 tests); `npm run build` passed with existing third-party annotation and bundle-size warnings. Hosted PostgreSQL and Netlify Blobs behavior remain outside these local checks.
