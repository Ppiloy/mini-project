# Independent rereview: ticket 08 bootstrap checks

Reviewed exact clean candidate `611da3adcd98e75a37bf6618743d6237142e9348` in `tmp/worktrees/bootstrap` against ticket 08 and the prototype plan.

**Verdict: PASS for the requested local implementation checks.** The officer-rotation defect from the prior review is fixed: the command validates the role expected for each seeded login and accepts both taxpayer and officer identities. A missing operation ID now fails before environment-marker or account mutation, and the setup guide documents the requirement.

Evidence:

- Focused `server/scripts/bootstrap.test.ts`: 9 tests passed. The PGlite/HTTP tests rotate taxpayer A, taxpayer B, and the officer; verify each old password and session are rejected; verify new-password login; and replay the same operation ID while preserving the new session.
- Disposable PGlite probes outside the repository confirmed a wrong-role seeded identity refuses rotation, leaves its password hash and rotation table unchanged, and removes the uncommitted credential file. Reusing an operation ID for another account or marker fails closed. Removing a committed rotation’s private file blocks replay without changing the current password; the current credential still logs in.
- The existing lost-COMMIT-acknowledgement rotation test retains its recovery file, permits recovery by the same operation ID, and does not invalidate the recovered current session on replay. Existing coverage also rejects a superseded operation ID and removes a generated rotation file after confirmed rollback.
- A disposable Windows ACL check of a newly generated private credential file showed one explicit ACE for `MRSMITHZ\Decha:(F)`, no inherited ACEs, and no broad read entry. The probe printed ACL metadata only, never credential contents.
- Full `npm run verify:release`: typecheck passed; 78 tests across 11 files passed; four ordered migrations applied to blank PGlite and checksums verified; Vite build passed. The build emitted only dependency annotation and bundle-size warnings.
- `git status --short` is empty and HEAD is the reviewed hash. All probes used local PGlite and temporary files; this does not establish hosted Netlify Database or deployed CI behavior.

