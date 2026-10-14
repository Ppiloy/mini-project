# FTC implementation task graph

Status: active

Specification: [spec](spec.md), [plan](../../FTC-PROTOTYPE-PLAN.md).

| Ticket | Dependencies | Status |
|---|---|---|
| [01 Foundation](issues/01-foundation.md) | none | resolved |
| [02 Domain engine](issues/02-domain.md) | 01 | resolved |
| [03 Authentication/drafts](issues/03-hosted.md) | 01, 02 contract | claimed |
| [04 Thai application](issues/04-ui.md) | 01, 02 contract | claimed |
| [07 Snapshots/evidence/submission](issues/07-snapshots-evidence.md) | 02, 03 | open |
| [08 Bootstrap/release checks](issues/08-bootstrap-checks.md) | 03 | open |
| [05 Operations](issues/05-operations.md) | 07, 08 | open |
| [06 Integrated acceptance](issues/06-acceptance.md) | 02, 03, 04, 05, 07 | open |

## Review log

Record reviewer, commit, findings, fixes and rerun evidence per ticket. Resolve only verified completed work; external hosting gates remain open until tested.

- 01 Foundation — adversarial review PASS at `ef8345d57c291623fb2c54e339634e7a8d4f05b8`; dependency repair and test-discovery exclusions PASS at `89f4459ca2895a13ba2cfef42a1c1e0df950eb19`. Both audit commands report zero vulnerabilities; integration typecheck, 5-test suite, and build pass. Evidence: [ticket 01](issues/01-foundation.md) and [foundation review](reviews/01-foundation.md). No hosted integration is claimed.
- 02 Domain — final independent adversarial review PASS at `9d6ca837feded619653e57431d26d2b0a068a538`; all six original findings and nested policy freeze finding resolved. Integration typecheck, 36 tests, and build pass. Evidence: [ticket 02](issues/02-domain.md) and [domain review](reviews/02-domain.md).
