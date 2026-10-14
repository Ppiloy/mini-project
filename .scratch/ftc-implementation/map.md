# FTC implementation task graph

Status: active

Specification: [spec](spec.md), [plan](../../FTC-PROTOTYPE-PLAN.md).

| Ticket | Dependencies | Status |
|---|---|---|
| [01 Foundation](issues/01-foundation.md) | none | resolved |
| [02 Domain engine](issues/02-domain.md) | 01 | claimed |
| [03 Authentication/drafts](issues/03-hosted.md) | 01, 02 contract | open |
| [04 Thai application](issues/04-ui.md) | 01, 02 contract | open |
| [07 Snapshots/evidence/submission](issues/07-snapshots-evidence.md) | 02, 03 | open |
| [05 Operations](issues/05-operations.md) | 03, 07 | open |
| [06 Integrated acceptance](issues/06-acceptance.md) | 02, 03, 04, 05, 07 | open |

## Review log

Record reviewer, commit, findings, fixes and rerun evidence per ticket. Resolve only verified completed work; external hosting gates remain open until tested.

- 01 Foundation — adversarial review PASS at `ef8345d57c291623fb2c54e339634e7a8d4f05b8`; fixes and integration typecheck/test/build evidence are recorded in [ticket 01](issues/01-foundation.md). Development-only test-tooling audit advisories remain pending; no hosted integration is claimed.
