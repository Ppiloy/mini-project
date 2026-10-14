# FTC prototype plan review

Reviewed 14 October 2026 (Asia/Bangkok). Scope: the Netlify plan, PDF traceability, research notes, decision tickets and independent arithmetic. No application code or deployed account exists to test. Proposed fixes below have been incorporated into the [main plan](../../FTC-PROTOTYPE-PLAN.md); outstanding checks are explicitly separate.

## Assessment

Keep React/Vite, Express on Netlify Functions, Netlify Database and Netlify Blobs. The architecture matches the educational project, and native managed PostgreSQL remains documented. The main weaknesses were underspecified behavior and leaving hosted integration risk until week two, rather than a need for another stack change. [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/), [Express support](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/).

The plan is sufficiently defined to start a bounded implementation with a first-week integration gate. Four weeks/80–120 focused hours remains a target for someone comfortable with the stack, not a guarantee for a beginner. Re-estimate after the first week using actual progress; do not expand scope to a complete tax-return or treaty engine.

## Findings and revisions

P1 means a potential incorrect result, blocked core flow or hosted access failure. P2 means missing implementation/acceptance detail that should be resolved before that feature ships.

| Priority | Gap and concrete consequence | Revision incorporated |
|---|---|---|
| P1 | Summing separately rounded country credits can exceed L. Two Q values of 0.005 yield 0.02 even when L is 0.01. | Round the unrounded total once; show a separate display-rounding reconciliation and add a regression fixture. The published slide example remains 143,544.30. |
| P1 | D/F conversion basis and the meaning of a remittance were incomplete. Different rates could make a full remittance appear larger than the original income; bank proceeds could be confused with assessable income. | Define prepared-THB or common-currency/common-rate inputs, explicit quotation units, F as the assessable portion, unsupported mixed/net cases, residence/date boundaries and decimal limits. |
| P1 | A user could change income but retain L from the old prepared example, producing a plausible result from incompatible inputs. | Bind L confirmation to tax-relevant inputs; clear it on changes. Preserve actual paid tax separately from explicitly assumed eligible E. The server does not certify either supplied tax. |
| P1 | Only assigned officers could read cases, but nothing assigned them. Submission could produce an invisible queue item. | Atomically assign the configured seeded officer; fail without changing the draft if the officer is unavailable. Add an unassigned-officer negative test. |
| P2 | Draft saving, preview creation, submission readiness and printable draft identity were conflated. Missing fields might prevent saving or be treated as zero. | Separate three validation levels; persist nullable drafts; create revision-bound preview snapshots; label draft reports; define retry/conflict/API error behavior. |
| P1 | Secure cookies were specified without an Express proxy/HTTPS verification step. The complete wrapper/session/SDK combination remained unproven. | Put a deployed cookie/database/Blob spike in week one, specify session persistence/expiry and trusted proxy validation, and test account switching for stale browser data. |
| P2 | File types/counts existed, but submission requirements, pending-upload behavior, aggregate quotas and cleanup ownership did not. | Require a ready sample file/checklist per remitted source, block pending uploads, enforce signature/size quotas, and use environment-scoped operator cleanup with no public reset route. |
| P2 | The schedule delayed the main external dependency and omitted concrete seed/migration/release behavior. | Include the integration gate within week one; specify Git/preview checks, backward-compatible migrations, idempotent seeds, redacted failure logs and explicit demo reset/recovery ownership. |

These are specification fixes and design recommendations within the user's delegated scope. They are not reports of bugs reproduced in an implemented app.

## Independent checks performed

- Recomputed the rounding counterexample with .NET Decimal: country displays 0.01 + 0.01, original total 0.02, revised total 0.01, display reconciliation −0.01.
- Rechecked the slide formula and representative allocation/cap scenarios independently using decimal arithmetic; fixture expectations are not derived from a future app implementation.
- Checked 500 generated two-country arithmetic scenarios with Python Decimal for a nonnegative final credit at or below L and exact display reconciliation. These exercise the proposed mathematics, not unbuilt application code.
- Checked all 16 planning Markdown files, 40 local links/anchors, encoding and code fences without errors. The revised milestone ranges still sum to 80–120 hours.
- Re-read official RD worksheet definitions for D/F exchange-rate basis and retained the educational eligibility boundary. The common-rate input contract is deliberately restricted; it is not a general legal determination. [RD manual](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf#page=13).
- Verified that Express documents proxy setup for Secure session cookies, and that Netlify recommends backward-compatible migrations. Neither establishes that the chosen package versions already work together. [Express sessions](https://expressjs.com/en/resources/middleware/session/), [Netlify migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).
- Retained the existing distinction between preview database branches and site-wide Blob storage; site-wide objects are shared across deploy contexts unless the app isolates its namespaces. [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

## Gates still requiring implementation or account access

| Gate | When / owner | Evidence needed |
|---|---|---|
| Account eligibility, costs and regions | Developer/account owner, first implementation session | Available Database entitlement, selected regions, current credit/storage terms and usage controls. Published storage-promotion dates are already past; no free-service promise. |
| Package/runtime integration | Developer, first 4–6 hours | Lockfile/runtime versions; actual HTTPS login-cookie round trip; authorized database write/read and Blob upload/download through the deployed adapter. |
| Fixture provenance | Developer, week one | Each fixture labels values copied from the slides, values from the RD manual and synthetic dates/FX/residency assumptions; no invented historical rate attribution. |
| Complete workflow and persistence | Developer, weeks two/three | Saved nullable drafts, correct snapshots, officer assignment, retry/race handling, direct authorization tests, binary payload checks and data surviving redeploy. |
| Usability and release readiness | Developer plus a demonstration user, week four | Thai keyboard/mobile/print review, cross-device rehearsal, isolated preview writes, recovery check and observed credit/latency record. |

Broader treaty eligibility, all return-field mappings, official rounding rules and real filing integration remain outside the agreed prototype. They are prerequisites for expanding real-use claims, not hidden blockers to the educational demonstration.

Account checks and the integration spike are planned work; no account has been inspected, packages installed or services provisioned during this review. Existing Wayfinder interaction tickets stay open for later concrete validation; this review does not fabricate user answers or close them.
