# FTC improvement verification

Scope source: `FTC-Web-App-Improvement-Brief.md`, prepared 1 November 2026.
Baseline: `f8cc78b9463857e93115a88a94e7210801bf1b10` on `codex/ftc-integration`.

The user confirmed three TDD boundaries before new tests were written:

- Browser journeys: entry, persistence feedback, confirmation controls, worksheets, reports, and officer screens.
- Public calculation/validation interfaces: arithmetic, currency conversion, residence periods, and readiness.
- Authenticated HTTP API: evidence contents, authorization, deletion, and immutable submission records.

Implementation agents use GPT-6-luna with maximum reasoning effort. The coordinating agent reviews the implementation against the brief before each release commit.

The user confirmed delivery of the core and P2 improvements. P3 officer decisions, supplementary documents, and versioned resubmission are deferred.

## Baseline findings

- The release gate passes: 117 tests in 14 files, seven ordered SQL migrations, TypeScript, and the production build. The initial sandbox run failed on local socket/private temporary-directory restrictions; rerunning with the necessary execution access passed.
- Demo evidence stores only metadata. Taxpayer and officer downloads construct a text explanation with `.demo.txt` appended. No actual file preview exists. Hosted evidence already has signature/size checks, authorized Blob storage, and original-byte downloads; this defect does not establish that the hosted path is broken.
- Currency entry is a three-character free-text input. Its change handler can ask for confirmation after each character when amounts exist. Country choices do not include the requested US/Singapore entries.
- The final review renders read-only confirmation cards in addition to the authoritative editable controls.
- Next saves the draft without checking step completeness; calculation navigates to a result even when required calculation inputs are missing.
- Save success follows persistence, but the UI exposes revision counters and duplicates the mobile action bar.
- No clipboard write exists in the current application source; the source-document allegation was not reproduced.
- The active branch is attached to PR #1 and its Netlify Deploy Preview. The linked site's production branch is `main`; these improvement pushes use the existing PR branch.

## Tax scope and reference checks

- [Revenue Code Section 41](https://www.rd.go.th/5937.html) states the residence threshold as a total of 180 days in the tax year. Residence alone does not decide FTC eligibility.
- The [RD FTC guide](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf), pages 6–11, describes currency conversion using a commercial-bank buying rate on the remittance date or BOT's reference from the preceding business day. The app must retain the supplied quote and provenance; it does not fetch or invent historical rates.
- Exact PND90/91 line numbers have not been verified for a supported form year. No exact return-line destination should be introduced on that basis.
- USA and Singapore being selectable must not expand the reviewed VN/CN calculation scenarios. The brief's “C” is provisionally interpreted as China.

## Completed increments

### 1. Original evidence and independent currency entry

- Demo uploads persist original bytes in IndexedDB, with SHA-256, filename, MIME type, and existing 3 MiB/file, five files/group, 20 files/case, and 30 MiB/case limits. Taxpayer and officer actions share PDF/image preview and original-file download behavior.
- Legacy metadata without stored bytes is unavailable. Submission preflights local evidence, and missing bytes prevent a successful submission. Draft evidence can be deleted; submitted evidence and report inputs stay frozen.
- Country and currency selection are independent. China suggests CNY; the user can choose USD. USA and Singapore are selectable but remain outside reviewed calculation support. Changing an input mode or currency with existing amounts explains the reset once.
- RED: the evidence browser journey failed because the preview button was absent; the entry journey failed because USA/Singapore choices were absent. The first green attempt caught and corrected an empty-draft confirmation caused by an optional undefined transfer value.
- GREEN: `FTC_TEST_API_PORT=8890 FTC_TEST_WEB_PORT=5175 npm run test:e2e -- e2e/entry-improvement.spec.ts e2e/evidence-improvement.spec.ts` passed 3/3. Evidence coverage includes PDF/PNG preview, exact original downloads after reload and officer review, draft-file deletion, and refusal to submit after browser files are removed.
- Review corrected a canonical-THB comparison that would have rejected valid edited drafts and ensured byte unavailability never rewrites a submitted record.
- Browser-local files remain within one browser profile. Hosted sharing continues to use the authorized server evidence store; this increment does not claim a new cross-device hosted smoke result.

### 2. Confirmed draft deletion and dashboard actions

- Taxpayers can cancel or confirm deleting their draft. The hosted endpoint checks owner, role, CSRF, current revision, environment, and draft state. Submitted records cannot be deleted.
- The server retains immutable case/report/audit history behind a deletion marker. Once evidence cleanup finishes, the draft disappears from the active list and releases the active case quota. Failed cleanup remains visible with a retry action; deleted/deleting drafts cannot be reopened, recalculated, submitted, or modified through known API URLs. In-flight uploads prevent deletion from starting.
- Dashboard actions use `แก้ไขต่อ`, `ดูผลคำนวณ`, and `ดูรายงาน`. Loading a worked example is verified to leave the browser clipboard unchanged; no source-document clipboard bug was reproduced in the baseline.
- RED: the new authenticated DELETE request returned 404 before implementation. GREEN: four HTTP tests cover authorization, quota release, create-request replay, failed Blob cleanup/retry, inaccessible deleted records, and upload races. Two browser tests cover confirmation/removal/reload and the clipboard boundary.
- Integration verification: `npm run verify:release` passes 121 tests in 15 files, seven migration checks, TypeScript, and the production build. Six browser specs covering foundation, existing taxpayer journeys, evidence, currency, and deletion pass 16/16 with four browser workers.
- The additional PGlite suite exposed an existing 5-second initialization timeout under unrestricted worker pressure. `test.maxWorkers: 4` makes the full suite pass; no assertion or timeout was weakened.

### 3. Browser storage failure and test-run isolation

- Demo persistence reports an actionable error when browser storage cannot be read, JSON is malformed, or required collections have the wrong shape. These failures cannot silently create an empty store over existing drafts. A missing storage key remains a valid empty store; older records without the file-byte inventory still load.
- RED: read failures and malformed collections did not produce an error before implementation. GREEN: two browser journeys exercise failed/malformed reads, attempted creation, recovery, and the original draft remaining visible. Two response-contract journeys also pass, including legacy demo-store compatibility.
- Browser tests now use separate artifact folders per port and disable hot reload only in the test environment. This resolves observed cross-run artifact collisions and unexpected page reloads during parallel implementation. Normal development hot reload is preserved.

### 4. Specific validation, reliable saves, and confirmation/navigation controls

- Incomplete drafts remain saveable. Next checks the current section and saves successfully before advancing; calculation blocks invalid, incomplete, or unsupported input rather than opening an empty result. Source-specific messages link to identity, amounts, exchange rates, or Thai tax fields.
- One authoritative keyboard-operable checkbox remains per statement. Saving and reloading retains valid confirmations. Editing relevant facts still invalidates the affected confirmation. Saved valid steps are clickable after reload; incomplete steps cannot appear complete.
- Form controls stay locked through save, evidence, and calculation requests, preventing an acknowledged response from overwriting edits typed during a request. Failed persistence shows a failure status and retains the entered draft. Upload and deletion feedback describes the actual pending operation.
- Source deletion requires confirmation. Sources with linked evidence remain available until their evidence is removed; the action links to that evidence group. The first Back action and duplicate mobile action bar are removed.
- Retired transfer-total/classification controls and their automated calculation restrictions are removed; the remittance date and D/E/F validation remain required. Existing raw legacy facts remain in saved records.
- RED covered edits during delayed persistence, missing/invalid section inputs, duplicate confirmations, and saved-step navigation disabled after reload. GREEN: 25 browser journeys across fixture workflow, hosted recovery, country/currency entry, and evidence. Root review also ran the integrated release gate: 136 tests, eight migrations, TypeScript, and production build passed with the pending P1/P2 changes present.

### 5. Shared saved-result worksheet and printable report

- Taxpayer results, printable reports, and officer detail render the same saved A–H source worksheet, separate I/J/K/L rows, M–Q country worksheet, and final FTC total. Thai shared labels lead; amounts include separators and units, (H) is a percentage, and formulas are expandable.
- The normal (E) value remains the engine's allocation input. A differing total tax payment is an explained supplemental fact; it never silently replaces the allocation input. Original-currency information appears only for an actual conversion and retains rate precision, quotation units, date, source, and method.
- Reports identify the saved result and its creation time, independently of filing time. Submitted worksheets and grouped evidence remain frozen. Ordinary result/report screens no longer display internal revisions, policy identifiers, raw field names, or duplicate calculation panels.
- RED: missing worksheet structure; subsequent review caught a missing (A) borrowing the calculation year and collapsed formulas in printed output. GREEN: four browser journeys cover canonical labels, the Vietnam–China totals, a missing earned year, saved report, print behavior, and officer values. Root inspected desktop/mobile captures and both Poppler-rendered A4 PDF pages: Thai glyphs, source/country totals, complete I–L rows, visible formulas, and no orphan footer page.
- The Vietnam–China total remains 143,544.30, with Vietnam's limit 121,044.30, China's limit 36,313.29, and China's credit 22,500.00. Shared arithmetic and the decimal/rounding convention are unchanged.

### 6. Officer worklist and concrete review points

- A new authenticated worklist uses the immutable submitted result for year, source count, and FTC. Its submission time comes from the case's submission record, independently of result creation time. Access requires the officer's active assignment and current hosting environment; the earlier case-list API remains compatible.
- The worklist shows reference, year, source count, FTC, submission date, awaiting-review status, and review-point count. Filters cover awaiting review and presence of review points. Flagged unresolved cases appear first, then older submissions. Slow responses from an older filter cannot replace the current filter's rows.
- Detail and queue share advisory structural checks: invalid saved data, missing linked evidence, unsupported facts, and substantive questions such as manually supplied FX or differing total/used foreign tax. Each point identifies source, reason, category, and suggested action. Positive supplied (L) without a Thai tax document is an advisory missing-evidence point, not a new submission restriction. No point or filename establishes legal entitlement or evidence verification.
- RED: the worklist HTTP route was absent; the browser queue lacked the requested fields, filters, and detail prompts. GREEN: two authenticated HTTP tests cover frozen facts, submission-date sorting, filters, role, assignment, and environment isolation. Browser journeys cover order/filter/detail, stale-response protection, and phone scrolling confined to the table. Officer decisions and resubmission remain deferred.
- Root release review used an isolated copy of the exact staged files: 124 tests, seven migration checks, TypeScript, and production build passed; the complete default Chromium suite passed 56/56. Root also inspected the 390-pixel phone capture.
