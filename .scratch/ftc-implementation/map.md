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
| [08 Bootstrap/release checks](issues/08-bootstrap-checks.md) | 03 | resolved |
| [09 Logout recovery](issues/09-logout-recovery.md) | 04 | resolved |
| [10 Response/report gaps](issues/10-response-report.md) | 04, 07, 09 | resolved |
| [11 Real backend browser](issues/11-real-backend-browser.md) | 03, 04, 07, 08, 09, 10 | claimed |
| [05 Operations](issues/05-operations.md) | 07, 08 | claimed |
| [06 Integrated acceptance](issues/06-acceptance.md) | 02, 03, 04, 05, 07, 08, 09, 10, 11 | open |

## Review log

Record reviewer, commit, findings, fixes and rerun evidence per ticket. Resolve only verified completed work; external hosting gates remain open until tested.

- 01 Foundation — adversarial review PASS at `ef8345d57c291623fb2c54e339634e7a8d4f05b8`; dependency repair and test-discovery exclusions PASS at `89f4459ca2895a13ba2cfef42a1c1e0df950eb19`. Both audit commands report zero vulnerabilities; integration typecheck, 5-test suite, and build pass. Evidence: [ticket 01](issues/01-foundation.md) and [foundation review](reviews/01-foundation.md). No hosted integration is claimed.
- 02 Domain — final independent adversarial review PASS at `9d6ca837feded619653e57431d26d2b0a068a538`; all six original findings and nested policy freeze finding resolved. Integration typecheck, 36 tests, and build pass. Evidence: [ticket 02](issues/02-domain.md) and [domain review](reviews/02-domain.md).
- 03 Authentication/drafts — independent adversarial rereview PASS at `e3d965064482d06bb0bf5c090fab45d65a7ef243`. Duplicate IDs, remittance references, concurrent login capacity and NUL fields repaired. Integration typecheck, 51 tests and build pass. Evidence: [ticket 03](issues/03-hosted.md) and [review](reviews/03-hosted.md). Hosted service behavior remains unclaimed.
- 04 Thai application — independent adversarial rereview PASS at `73f704bd65256ea7ba3f2c5a28f898bcc0fd0725`; three recovery/copy findings repaired and the original missing-font finding corrected. Thirteen local browser journeys and offline Thai print inspection pass; integration typecheck, 51 tests and build pass. Evidence: [ticket 04](issues/04-ui.md) and [review](reviews/04-ui.md). Real hosted integration remains open.
- 07 Snapshots/evidence/submission — independent workflow and storage/environment rereviews PASS at `7586c645d902bbee13c7f4d2930f086640064ac9`. Role, multipart and context findings repaired; integration typecheck, 69 tests and build pass. Evidence: [ticket 07](issues/07-snapshots-evidence.md), [workflow review](reviews/07-workflow.md), [storage review](reviews/07-evidence.md). Cleanup tool and hosted acceptance are still required downstream.
- 09 Logout recovery — independent final schema/recovery review PASS at `89050f496fddd284b3cff30ea650534497ae7401`; integration typecheck, 69 tests and build pass after merge `76f2673`. Fifteen focused browser journeys passed independently. Evidence: [ticket 09](issues/09-logout-recovery.md) and [session review](reviews/09-session.md). Hosted session checks remain open.
- 08 Bootstrap/release checks — independent credential rereview PASS at `611da3a` and checkout checksum rereview PASS at `01c6952e2ad2ef4ab739b9e068778164f4d73cba`. Integration release gate passes 83 tests, four migrations, typecheck and build after merge `92cd08b`. Evidence: [ticket 08](issues/08-bootstrap-checks.md), [bootstrap review](reviews/08-bootstrap.md), [checkout review](reviews/08-checkout.md). Operator checks use local PGlite; hosted acceptance remains open.
- 10 Response/report gaps — independent rereview PASS at `d9e346d585ed04c118f5ebb6bbdf4e1d14efb7fe`; integration release gate passes 86 tests and all 31 local browser journeys after merge `fed9e285`. Shared JSON schemas, failure request IDs/policy context and frozen FX provenance are verified. Evidence: [ticket 10](issues/10-response-report.md), [response/report review](reviews/10-response-report.md). Real backend browser and hosted acceptance remain required.
