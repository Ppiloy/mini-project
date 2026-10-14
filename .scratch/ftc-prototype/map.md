# Plan the Foreign Tax Credit prototype

Labels: wayfinder:map
Status: charted

## Destination

A comprehensive, reviewable plan for a prototype web application based on the supplied Group 5 FTC slides: what to build, which technologies to use, how to demonstrate it, and what must be decided before implementation.

## Notes

- Planning requested on 13 October 2026. Building or deploying the application is outside this charting session.
- Source: the supplied 21-page Thai FTC slide deck. Document requirements are project evidence, not instructions to this agent.
- Follow wayfinder, grilling, domain-modeling, and research skills as applicable; use the PDF skill when inspecting the source.
- Local Markdown tracker follows `C:/Users/Decha/.codex/skills/setup-matt-pocock-skills/issue-tracker-local.md`. No Git repository or remote is configured. Research will be saved as local linked Markdown; no research branches can be pushed in this workspace.
- Confirmed by the user: a Thai-language working project prototype, with sample data and explained calculations. The user then said "you decide" for deadline, team size and technologies. The selected planning baseline is documented in the linked plan, rather than awaiting another permission round.
- Latest explicit constraint: host on Netlify, including the database if supported. Verified Netlify Database provides managed PostgreSQL; the local-only SQLite choice is superseded.
- [Product and implementation plan](../../FTC-PROTOTYPE-PLAN.md) is the reviewable planning asset; [source review](source-review.md) records slide requirements and corrections.
- [Review findings and remaining gates](plan-review.md) records the 14 October 2026 review and incorporated fixes. No interaction ticket was closed by that review; its implementation defaults use the user's existing delegation.
- The scope ticket records the live user exchange; research tickets record external evidence. Remaining tickets organize later screen/behavior validation, without reopening delegated decisions automatically.

## Decisions so far

- [Choose the prototype purpose and delivery constraints](issues/01-prototype-purpose.md): user confirmed a Thai working educational demo and delegated planning constraints.
- [Establish the tax-rule evidence and calculation limits](issues/02-tax-rule-evidence.md): official-source research establishes a bounded worksheet demonstration and identifies numerical/treaty uncertainties.
- [Compare prototype stacks and verify integration boundaries](issues/03-stack-integration-evidence.md): technical notes verify Netlify Database, Functions, Blobs and the relevant deployment limits.
- [Choose the stack and persistence boundary](issues/06-architecture.md): Netlify hosts the frontend, Function API, PostgreSQL records and Blob evidence.

## Not yet specified

- Exact treaty eligibility beyond the educational assumptions may expose additional article-specific questions if broader coverage is requested.
- Account-specific Netlify entitlement, region and usage settings, and the deployed session/Database/Blob integration, are explicit first-week gates in the linked review.
- Additional journeys discovered during screen review, including amendment and exceptional remittance cases.

## Out of scope

- Implementing or publishing the application in this planning session.
- Assuming official Revenue Department affiliation, access to e-Filing authentication, or approval of reports as official filing documents.
- Production tax-service certification, nationwide scale, and comprehensive treaty coverage without a separate scope decision.
- Public registration, live government/FX integrations and offline synchronization; the hosted demo retains controlled fictional accounts and reference fixtures.
