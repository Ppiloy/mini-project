# Compare prototype stacks and verify integration boundaries

Labels: wayfinder:research
Type: research
Status: resolved
Assignee: stack-research agent
Parent: ../map.md
Blocked by: none

## Question

Which maintainable stack fits a Thai FTC prototype with taxpayer/officer views, relational cases, documents, snapshots and reports? For the latest Netlify request, verify native database availability, Function hosting, persistent sessions, evidence storage, preview isolation, billing prerequisites and deployment limits.

## Comments

- Workspace is empty and has no Git repository. No required technology or deadline has yet been supplied.
- Save findings at `../research/technology-options.md`. Do not create application code, provision services, install dependencies, or push anything.

## Answer

Technical findings updated on 13 October 2026: [Netlify choices and sources](../research/technology-options.md). Netlify provides managed PostgreSQL on credit-based plans, a Function hosting path for Express, and durable Blob storage. Use PostgreSQL sessions, transactional calculation submission and explicit production/preview evidence separation. Reduce the upload policy to 3 MiB per file to leave Function payload headroom. Database restores and code rollbacks are separate; evidence recovery needs its own manifest/export. Account entitlement, costs and actual SDK integration remain to be checked during implementation.
