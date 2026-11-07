# FTC domain ticket02 final rereview

**Commit:** `9d6ca837feded619653e57431d26d2b0a068a538`

**Verdict: PASS.** The six original findings and the subsequent policy-mutation finding are resolved at this exact clean HEAD. No application files were modified during review.

## Original exploit reruns

- **Mixed transfer principal:** unequal transfer total vs F with `classification="income_only"` now yields `needs_review` (`source.transfer_total_mismatch`). Explicit `mixed_principal_and_income` and `gross_net_ambiguous` also yield `needs_review`. A note-only contradiction with equal structured values is not NLP-interpreted; it remains the user's structured classification/checklist responsibility.
- **Submission evidence:** E=0 with Thai-tax evidence plus one ready source file and checklist covering `foreign_income`/`remittance` returns no messages. A two-source case with one positive-F source and one F=0 source, with no evidence for the F=0 source, returns no messages. A pending unrelated attachment blocks with `submit.evidence_unresolved`.
- **Snapshot mismatch/revision:** `createCalculationSnapshot` no longer accepts a caller-supplied result; the attempted mismatched slide result was ignored and the helper recomputed result J=0/credit 2,500 from the partial fixture. A revision different from `inputs.revision` throws.
- **Inherited allowlist key:** inherited US policy property now yields `needs_review`.
- **Missing worksheet currency:** `currencyCode=null` now yields `incomplete` (`input.required`).
- **NUL text:** `parseDraft` now rejects NUL provenance (`NUL characters are not supported`); previous PGlite JSONB probe rejected the same string with `unsupported Unicode escape sequence`.
- The prior whitespace-only manual FX source label remains rejected by the earlier probe (`fx.manual_provenance_missing`).

## Policy-mutation fix verified

The new regression test covers nested assumptions, source URLs, supported income types, approved FX references, and the FX reference object. Independent attempts to mutate assumptions, URLs, income types, and FX rate all threw; arrays and reference objects were frozen, and before/after calculations retained the same version, assumptions, and credit. `policyReference()` still returns independent mutable DTO copies, and mutating those copies does not affect `DEMO_POLICY`.

## Verification

- `npm run typecheck` passed.
- `npm test` passed: 7 files, 36 tests.
- `npm run build` passed.
- Final hash is `9d6ca837feded619653e57431d26d2b0a068a538`; repository status was clean.
- This review covers local domain contracts only. It does not certify API authorization, evidence race handling, hosted persistence/isolation, account access, deploys, or recovery.
