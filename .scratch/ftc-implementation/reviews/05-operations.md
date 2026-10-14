# Operator and recovery adversarial reviews

Status: FAIL; repairs in progress.

Two independent GPT-6 Luna reviewers assessed clean candidate `1ab2c96936107f49c4efe2fb2b112200a7e4d0d2` against integration `f7564ce`.

- The ordinary npm CLI printed only hashes/counts for dry-run manifests, leaving the exact account/case/snapshot/audit/attachment/object scope unreviewable. The accepted operator design also calls for a read-only preview-initialization plan and exact confirmation before account/session/fixture changes.
- A disposable public-command recovery probe changed an included mutable account display name after restore. Repeating the completed restore returned `replayed` without comparing relational facts, despite verifying credentials and Blob bytes.

The implementer is repairing all findings with public-seam regression checks, followed by independent rereviews. No live reset/restore, cloud data mutation or failed candidate merge occurred. External reports are `ftc-review-operations.md` and `ftc-review-recovery.md` in the task's 14 October 2026 visualization directory.

Candidate author checks passed 99 tests, seven migration checks, typecheck/build and 31 Chromium journeys. The recovery reviewer independently passed nine focused operations tests and reproduced the drift gap. These checks establish local PGlite/operator behavior only.

Root independently rendered all four pages of the unchanged sample PDF: Thai glyphs, draft label, country caps, total 143,544.30, policy ID and 10.00 source discrepancy were legible with no observed clipping. PDF text extraction found 4,369 Thai characters, no replacement glyph, and the expected draft/total/policy labels. This is artifact QA, not acceptance of the failed operator candidate.

Root found a missing README index/presentation guide and a seeded preview evidence stub that was not a readable PDF (`startxref not found`). The existing detailed operator reference already covered recovery; the new guides improve handover navigation. The implementer repaired these along with the independent findings in clean candidate `1541b634954f6e71ead0fe422ca9b32332d55f5d`, based on integration `1d60c3c`. The author reran 99 tests/seven migrations/typecheck/build and all 31 local Chromium journeys. The unchanged sample report QA does not certify the operator repairs.

Independent review of `b00ee64eb2b92fd6d9fa80c763c9457e187bad48` passed operations scope but failed recovery: full-store backup captured a ready attachment under `legacy/evidence-key`, while restore compared only `cases/` keys. Copy verification succeeded, then inventory verification failed with the gate closed and no relational import. Both independent rereviews passed repair `4052165c4b067379d48e69e5ef501c17d6dccb90`, which compares all keys during target preflight, copying and replay. Author checks passed 100 tests, seven migration checks and 31 browser journeys. Recovery review independently passed 100 tests and injected a failed Blob write: no users/sessions imported, login stayed 503, and same-operation retry completed safely. Root additionally found two leftover runbook sentences incorrectly making backup conditional on submitted cases; documentation correction is pending. Every reset requires a verified backup; only the retention cutoff depends on submitted cases. New exact-SHA reports are `ftc-final-review-operations-4052165.md` and `ftc-repair-rereview-recovery.md`; earlier failure reports are preserved.
