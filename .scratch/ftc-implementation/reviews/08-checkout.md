# Independent rereview: migration checkout checksums

Reviewed exact clean candidate `01c6952e2ad2ef4ab739b9e068778164f4d73cba` in `tmp/worktrees/bootstrap` against ticket 08 and the checkout-drift note in `.scratch/ftc-implementation/reviews/08-bootstrap.md`.

**Verdict: PASS.** All four SQL Git blobs are byte-identical to commit `611da3adcd98e75a37bf6618743d6237142e9348`; none of the migration files changed. The four lock entries match SHA-256 of those exact LF Git blobs:

- `20261014000100_hosted_foundation.sql`: `56d403ad0481878f46628d2350bb75be0b27f84b646252671e60ed681e3d7ff0`
- `20261014000200_login_attempt_reservations.sql`: `262798b00be3ede89ec62dee73ce835e8adf3e71918981b6658bf60da1faca9a`
- `20261014000300_workflow_environment.sql`: `e624dda869b0a9099d7c22ef65cd431104039c349fd684e5998c8b9f695ebe87`
- `20261014000400_operator_credential_rotations.sql`: `a6de4037793e1ab169e90476b00fe2c03b028a3267bb00afe1a76de8e74fdbd1`

`git check-attr` reports `text` and `eol=lf` for each migration, the lock, and `.gitattributes`. I created disposable Git fixtures outside the repo and checked fresh Windows checkout behavior with `core.autocrlf=true` and `core.eol=crlf`, plus `core.autocrlf=false` with `core.eol` unset. Both checked out all four SQL files as LF and successfully applied all four migrations to blank PGlite. The public fresh-checkout test also passed on Windows. Deliberately converting a migration to CRLF and changing its SQL content each still fails with `Migration checksum changed`; the verifier hashes the SQL read from disk without normalizing line endings.

Full `npm run verify:release` passed: 83 tests across 12 files, typecheck, ordered migration/checksum verification with blank PGlite application, and build. Build produced only dependency annotation and bundle-size warnings. The candidate worktree is clean at the reviewed hash. Temporary fixtures were removed; no hosted database or cloud operations were used, so this is local verification rather than hosted deployment evidence.
