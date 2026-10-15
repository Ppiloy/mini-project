# FTC ticket 07 repair rereview

**Verdict: PASS** for exact clean candidate `7586c645d902bbee13c7f4d2930f086640064ac9` in `tmp/worktrees/workflow-repairs`. No application files were changed. Local verification was rerun on this hash: `npm run typecheck` passed; `npm test -- --run` passed (10 files / 69 tests); `npm run build` passed; `git diff --check` passed and the worktree remained clean. Build output contains only third-party annotation and bundle-size warnings.

## Previous findings and requested role probes

The P2 officer self-service/self-review path is closed. Taxpayer role middleware covers case list/create/read/save and workflow calculate/upload/delete/submit (`server/app.ts:651,710,723,756`; `server/workflow/routes.ts:117,120,135,163,282,362`). The attachment and snapshot read owner branches additionally require taxpayer role; officer access requires officer role, submitted case status, the assigned officer ID, and active assignment (`server/workflow/routes.ts:333-338,463-470`).

The new public HTTP/PGlite test at `server/workflow.test.ts:89-131` seeds a legacy officer-owned draft with snapshot and ready attachment. It verifies officer case creation and every taxpayer route family are denied, including self-submit; owner-branch snapshot and evidence access return 404; the Blob getter is never called; and draft revision, attachment, and snapshot rows remain unchanged. This directly covers the exploit from the earlier review rather than relying only on newly created-case behavior.

The assigned submitted officer path remains usable: `server/workflow.test.ts:453-493` completes a taxpayer submission, verifies the assigned officer queue/detail, snapshot and evidence reads, and confirms audit insertion failure fails closed. The routes additionally bind queue/detail and officer snapshot/evidence checks to active assignment and submitted state. This review found no bypass for an officer-owned legacy draft or an unassigned officer in the inspected guards/tests.

## Workflow, freeze, and recovery checks

The public happy path still creates a preview from the locked current revision, validates and recomputes persisted inputs and ready evidence on submit, writes assignment/submitted snapshot/state/audit/replay atomically, and returns the identical committed snapshot for the same request retry (`server/workflow/routes.ts:359-428`; `server/workflow.test.ts:453-476`). Upload finalization remains outside the database transaction but is rechecked under the case lock; a deferred upload/submit race test verifies that the pending revision does not get submitted (`server/workflow.test.ts:413-450`). The test suite also checks revision-bound preview behavior, stale-preview rejection, snapshot immutability, upload replay, and audit failure before protected officer detail is returned.

The changes to post-submission attachment guards allow only cleanup bookkeeping on an already-deleted tombstone; the PGlite regression confirms metadata and tombstone deletion remain blocked (`netlify/database/migrations/20261014000300_workflow_environment.sql:63-90`; `server/workflow.test.ts:133-150`). No public cleanup command or complete operations cleanup result is claimed; that is still ticket 05 scope.

Other repaired contract points verified in the candidate tests include original filename propagation through the upload helper, explicit deployment-context fail-closed behavior at the Function wrapper, byte/file/source quota limits, and the upload-finalization race. These checks do not establish live provider behavior.

## Limits

This was local Express/Supertest with PGlite and a BlobIO test double. I did not test hosted PostgreSQL, Netlify Blobs, deployed Function configuration, remote auth/session behavior, or production isolation. No deployment/account gate is claimed passed. Cleanup CLI remains open under ticket 05.
