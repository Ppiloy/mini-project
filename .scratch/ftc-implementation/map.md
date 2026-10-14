# FTC implementation task graph

Status: active

Specification: [spec](spec.md), [plan](../../FTC-PROTOTYPE-PLAN.md).

| Ticket | Dependencies | Status |
|---|---|---|
| [01 Foundation](issues/01-foundation.md) | none | resolved |
| [02 Domain engine](issues/02-domain.md) | 01 | resolved |
| [03 Authentication/drafts](issues/03-hosted.md) | 01, 02 contract | resolved |
| [04 Thai application](issues/04-ui.md) | 01, 02 contract | resolved |
| [07 Snapshots/evidence/submission](issues/07-snapshots-evidence.md) | 02, 03 | resolved |
| [08 Bootstrap/release checks](issues/08-bootstrap-checks.md) | 03 | claimed |
| [09 Logout recovery](issues/09-logout-recovery.md) | 04 | claimed |
| [05 Operations](issues/05-operations.md) | 07, 08 | open |
| [06 Integrated acceptance](issues/06-acceptance.md) | 02, 03, 04, 05, 07, 08, 09 | open |

## Review log

Record reviewer, commit, findings, fixes and rerun evidence per ticket. Resolve only verified completed work; external hosting gates remain open until tested.

- 01 Foundation — adversarial review PASS at `ef8345d57c291623fb2c54e339634e7a8d4f05b8`; dependency repair and test-discovery exclusions PASS at `89f4459ca2895a13ba2cfef42a1c1e0df950eb19`. Both audit commands report zero vulnerabilities; integration typecheck, 5-test suite, and build pass. Evidence: [ticket 01](issues/01-foundation.md) and [foundation review](reviews/01-foundation.md). No hosted integration is claimed.
- 02 Domain — final independent adversarial review PASS at `9d6ca837feded619653e57431d26d2b0a068a538`; all six original findings and nested policy freeze finding resolved. Integration typecheck, 36 tests, and build pass. Evidence: [ticket 02](issues/02-domain.md) and [domain review](reviews/02-domain.md).
- 03 Authentication/drafts — independent adversarial rereview PASS at `e3d965064482d06bb0bf5c090fab45d65a7ef243`. Duplicate IDs, remittance references, concurrent login capacity and NUL fields repaired. Integration typecheck, 51 tests and build pass. Evidence: [ticket 03](issues/03-hosted.md) and [review](reviews/03-hosted.md). Hosted service behavior remains unclaimed.
- 04 Thai application — independent adversarial rereview PASS at `73f704bd65256ea7ba3f2c5a28f898bcc0fd0725`; three recovery/copy findings repaired and the original missing-font finding corrected. Thirteen local browser journeys and offline Thai print inspection pass; integration typecheck, 51 tests and build pass. Evidence: [ticket 04](issues/04-ui.md) and [review](reviews/04-ui.md). Real hosted integration remains open.
- 07 Snapshots/evidence/submission — independent workflow and storage/environment rereviews PASS at `7586c645d902bbee13c7f4d2930f086640064ac9`. Role, multipart and context findings repaired; integration typecheck, 69 tests and build pass. Evidence: [ticket 07](issues/07-snapshots-evidence.md), [workflow review](reviews/07-workflow.md), [storage review](reviews/07-evidence.md). Cleanup tool and hosted acceptance are still required downstream.
