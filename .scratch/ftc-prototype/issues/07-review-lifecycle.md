# Define submission, read-only review, and calculation history

Labels: wayfinder:grilling
Type: grilling
Status: open
Parent: ../map.md
Blocked by: 01, 06

## Question

Does Submitted mean sent to the prototype review queue only? Can submitted cases be edited, who can view them, and how are revisions, frozen calculations, attachments, review events, and report access represented without implying tax approval?

## Comments

- Baseline: Draft → Submitted, immutable submitted case/evidence/snapshot, assigned officer read-only, review access event without approval/rejection. See the [lifecycle plan](../../../FTC-PROTOTYPE-PLAN.md#7-architecture-state-and-access). Verify these semantics in the concrete interaction review.
- Hosted implementation boundary: enforce caller permissions in the Function API, protect submitted state in PostgreSQL, and coordinate evidence intents with Blobs. Database transactions do not atomically include object writes. Platform builder permissions are distinct from application roles.
- Review update, 14 October 2026: submission assigns the configured seeded officer atomically and fails safely if unavailable. Require current preview/L confirmation and completed sample evidence; define retry behavior and audit-before-return for officer detail/file/report access. Draft reports are visibly distinguished from submitted reports. See [review findings](../plan-review.md).
