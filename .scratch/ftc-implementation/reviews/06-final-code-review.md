# Final parallel code review

Baseline: `2a15fac253d089d4dffde5aa22fb9df8e6210398`. Original reviewed source: `dcdfab7c11ba84e1dbf5c46fdbb8821714a0d0de`. Both axes used independent GPT-6 Luna reviewers. Full commit list is retained externally as `ftc-final-review-commits.txt`.

## Standards

No documented-standard breach was found. The glossary distinctions between foreign tax paid, allowable credit and refund classifications remain intact. One labelled Divergent Change judgement notes that `server/scripts/operations.ts` groups cleanup, initialization, backup, restore and reset in a 1,237-line module; the reviewer explicitly calls it a future maintainability consideration, not a functional defect. Root retained the shared operator boundary and its target/manifest/transaction/recovery invariants for this bounded prototype. No unrelated refactor is required to complete a feature. External report: `ftc-final-standards-review.md`.

## Spec

One P2 finding: the dashboard lacked the plan's calculated allowable FTC and direct draft-report access. Single final-fix implementer repaired it in `30217ebbe2423ed1cdb1a2f5c902afa62e2e28c0`. An independent rereview passed owner/case/kind/revision checks, current-preview/frozen-submitted amounts, explicit missing/stale/loading/error states, retry, reload and direct report journeys. Hosted and fixture queue wording is now distinct. External reports: original `ftc-final-spec-review.md` and preserved repair `ftc-final-spec-rereview-dashboard.md`.

Focused keyboard/print acceptance initially observed an overlay on older browser-only tree `464ee83`; that tree predates the operations CSS which already hides `.skip-link`. Final candidate `952fd437fe526d92a59111b0637bd425e2c195b1` adds explicit focus selectors and a regression verifying screen keyboard focus, print hiding, and real draft/submitted PDFs. Independent reviewer rendered and inspected every page of both two-page PDFs: Thai glyphs, 2,500.00, labels and source table are legible with no overlay/clipping. Report: `ftc-focused-print-rereview.md`. Merger integrated this exact tree at `e8cd3f17a6ff9287a9d80ea6c375a693919785fb`.

Evidence: 101-test/seven-migration release gate, 32 default and 11 actual-backend browser journeys passed on the repaired candidate. The final merge has identical tree and preserved package/migration identities; both discovery commands independently enumerate those 43 tests. No hosted-service result is inferred from these checks.

Standards: zero hard breaches, one maintenance judgement retained. Spec: one functional finding repaired and rereviewed; platform/hosted acceptance remains open.
