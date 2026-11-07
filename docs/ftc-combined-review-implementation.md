# Combined FTC review implementation

Source: `FTC-Combined-Review-Comments-2026-11-02.md`.
Starting commit: `3e902ddb35d37ee0c9227629bd3cfd3a1e7a8ef8`, branch `codex/ftc-integration`.

The user's separate implementation request authorizes this work. The source document's review-only restrictions describe the earlier report, not this later request.

## Approved scope and test interfaces

- Reuse the previously confirmed browser journeys, public calculation/validation interfaces, and authenticated HTTP interfaces. Implementation uses GPT-6-luna with maximum reasoning effort; the coordinating agent reviews the changes and release evidence before each commit/push.
- Preserve the reviewed 2025 VN/CN calculation examples, formulas, rounding, immutable submitted records, original evidence bytes, and supplied Thai tax (L).
- Officer decisions/supplements, broader country/type/year support, and cross-year/multiple-remittance modelling remain deferred under the previous scope agreement.
- The user explicitly permits zero-file submission with an available-evidence declaration and officer flags.
- The user explicitly permits declaration-only residence entry alongside date ranges. A computed below-180 result cannot be overridden by a contradictory declaration.
- The final FX direction is manual entry with clear remittance-date guidance and BOT as an optional reference only. No live lookup or prepared-catalogue requirement is included.

## Mapping from the starting build

| Review topic | Starting evidence and delivery action |
|---|---|
| E and L entry, C07/C08 | Code still requires ordinary E rationale/equality controls and L prose. Simplify the ordinary path while preserving genuine adjusted-tax facts and saved provenance. |
| I/K, C09 | Existing totals are present. The form routes them through full calculation readiness and temporary J/L values; reproduce the reported incomplete-state display before correcting it. |
| Residence/support, C01/C03/C04 | Date ranges, threshold arithmetic, scope warnings, and selectable-vs-supported countries already exist. Add the approved declaration mode, early supported-flow gate, and clearer support presentation. |
| FX, C05/C06 | Simplify manual original-currency entry, show readable quotation units, and bind the entered rate to the remittance date. Keep BOT as an optional reference; never relabel an old rate for a new date or invent a historical quote. |
| Evidence, C12/C13 | Original bytes, preview/download, quotas, and immutable inventories already exist. Replace mandatory completeness with the approved inventory-bound declaration and immediate missing-evidence flags; retain validation/security and unresolved-upload guards. |
| Result clarity, C15/C16 | Shared A–Q, PDF and XLSX are present. Lead the taxpayer result with saved credit/country limitations and make the full worksheet expandable. |
| Wording/clutter, C10/C14/C19 | Shared labels and a single footer already exist. Follow the newer wording-first preference and clarify browser-local submission destination. |
| Officer review, C17/C18 | Worklist filters/flags and frozen detail already exist. Reconcile flags with the new evidence declaration; do not duplicate the worklist or add decisions. |
| Verification, C11/C20 | The starting build has recorded passing release/browser checks and a ready preview. Findings from other builds are not counted as current defects without reproduction. |

## Release evidence

Each completed increment will record the reproduced behavior, RED/GREEN results, review findings, checks, and deployment below.

### 1. Full-precision authenticated calculation responses

- Reproduced at the public snapshot validator and authenticated HTTP calculation endpoint: the supported Vietnam–China calculation returned a ready result, but response validation rejected its repeating country limit and the endpoint returned 503.
- Widened only the response decimal-string bounds to retain the engine's 40 significant digits, including leading fractional zeros. No input limits, arithmetic, rounding, policy scope, or stored values were loosened or rounded to fit the transport.
- RED/GREEN: public snapshot-contract tests cover the 143,544.30 golden result and small generated limits; the HTTP tracer saves a valid case, calculates, and reads back the exact unrounded result through authenticated routes.
- Root reviewed the diff and verified an isolated copy of the exact staged files: 139 tests, eight ordered migrations, TypeScript, and the production build pass with CI's two-worker configuration.
- Commit `2ef4863` was pushed; its Netlify preview build reached `ready`.

### 2. Ordinary tax entry and saved credit explanation

- Ordinary E uses the foreign tax paid when no exceptional adjustment is recorded. Its reason/equality controls are removed from normal entry. Existing different paid/used amounts remain visible and require an adjustment reason; cached THB amounts are rebuilt from raw facts.
- L accepts the supplied amount without requiring prose. J/L guidance distinguishes income before expenses/allowances from Thai tax after them and before FTC. Existing notes remain saved and visible as prior notes.
- The existing calculator now returns known I/K totals independently of full credit readiness. Unknown F or conversion inputs remain unknown; explicit zero stays zero. No second calculation engine or temporary J/L zero is used for these totals.
- The result leads with the saved total and country O/P/Q values, explains which unrounded amount limits Q, and keeps the complete worksheet expandable. Stale/non-ready previews do not receive a ready-result summary; saved display-rounding differences are explained without redistributing credits.
- Public calculation, authenticated API, and browser RED/GREEN checks cover these changes. Root review checks effective E in calculation, confirmations, worksheet, export and officer evidence flags, as well as saved result consistency.
- Review corrected duplicate E field targets, ordinary details opening because of legacy notes, and foreign-tax evidence flags when actual tax is positive but adjusted E is zero. A policy/engine change now makes unsubmitted previews stale without altering historical submitted records.
- Frozen release checks: 150 tests in 18 files, eight ordered migrations, TypeScript and production build pass. All 82 default browser journeys and 11 real-backend journeys are covered by passing runs: 78/10 initially passed; the remaining four/one passed after result-disclosure selectors and current-policy test metadata were updated. Assertions on amounts, evidence, saved reports and authorization remain intact.
- Parallel browser runners exposed a shared Vite optimizer-cache collision. Browser tests now use project/port-specific temporary caches; production configuration is unchanged. The final configuration also passed a fresh production build.
- Root visually checked ordinary/adjusted E and the saved Vietnam–China summary, including accessible adjustment/error targets and the rounding explanation.
- Commit `251321e` was pushed; its Netlify preview reached `ready`, and the preview's public API/database health endpoint returned `status: ok`.

### 3. Guided residence, manual FX and available-evidence submissions

- Scope appears before entry: reviewed 2025 Vietnam/China salary and prepared dividend examples, same-year income/remittance, one remittance per source, direct THB or a user-supplied dated quote. Unsupported selections remain recordable without a calculated credit.
- New drafts collect one residence record per income-earned year. Inclusive, overlapping periods derive the count; a declaration-only record retains a null exact count and an unverified statement. Missing/invalid records and computed 179 days block progression and calculation, including saved-step navigation and legacy period edits. Draft save remains available. Reports and Excel retain the recorded basis.
- FX entry displays the quotation unit and remittance-date basis. BOT is an optional reference link, with no lookup or catalogue. Changing the date requires clear/cancel and preserves raw D/E/F; changing currency/mode clears the stated dependent amounts and quote. Country edits preserve a selected currency. Stored reference units/provenance remain intact until explicit replacement, and a pending reset cannot target a different source after rows change.
- Submission permits zero files after the available-evidence declaration. The server binds the statement to the current revision/preview, derives available files and missing categories, and freezes statement text, actor and time. Pending/failed uploads and missing or corrupt ready-file bytes still block submission. Existing upload/security/quota controls remain. Missing evidence and declaration-only residence appear as officer review points.
- Migration `20261103000100_snapshot_submission_metadata.sql` adds nullable immutable-snapshot metadata. Existing submissions remain unattested; previews cannot carry a submission declaration. Retry digests include the acknowledgement and tolerate JSON key reordering while rejecting changed facts.
- The result shows the inventory being acknowledged. Demo byte loss now advances the draft revision, reloads availability, clears the acknowledgement and marks the preview stale. Submitted snapshots remain unchanged. Shared Thai-first labels, readable amount fields, one educational footer and concise local/online destination wording complete the entry/report flow.

Root review corrected source-reset identity, correction links to removed FX controls, partial manual-quote editing, early legacy residence guards, and stale demo inventories. An independent GPT-6-luna review checked the FX and evidence boundaries and identified the latter recovery issue.

The real authenticated journey also reproduced a ready preview followed by `confirmation.thai_tax_stale` on submission. A short HTTP regression isolated the cause: JSONB reordered nested residence object keys, while the confirmation fingerprint serialized their input order. Canonical field construction now keeps equivalent stored facts current and still invalidates changed facts. Both dated and declaration-only HTTP submissions are covered; legacy `ftc-tax-v1` serialization remains unchanged.

The final browser checks preserve arithmetic, file-byte, permission, recovery and historical-report assertions. Test fixtures were updated for the new residence form, wording and evidence grouping. Desktop/mobile screens and rendered A4 reports were visually checked for readable Thai, complete amounts, saved status, declaration/inventory visibility and page breaks. The new evidence appendix can add a third report page.

Final local release gate: 167 tests in 19 files, nine ordered/checksummed migrations, TypeScript and the production build pass. After the canonical confirmation fix, all 100 default browser journeys and all 11 authenticated real-backend journeys pass in full runs. The submitted-workbook check was then strengthened through the actual browser download and passed, replacing a direct report-builder unit test to keep coverage at the agreed public interfaces. Temporary diagnostic instrumentation and the throwaway browser harness were removed.

### Remaining agreed limits

P3 officer decisions, supplementary documents and resubmission versions remain deferred. Broader countries/types/years, cross-year income/remittance and multiple-remittance modelling are not added. No PIT engine, government filing or legal eligibility determination is claimed. Production deployment and recovery are separate from this branch's preview release.
