# Choose the stack and persistence boundary

Labels: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: Codex
Parent: ../map.md
Blocked by: 01, 03

## Question

Should the first delivery run entirely in a browser or persist shared cases with authentication and private documents? Choose the framework, database, document storage, calculation execution boundary, hosting, and external-data adapters appropriate to that delivery.

The latest user instruction is to host on Netlify, including its database if supported. This supersedes the earlier local-only SQLite choice.

## Comments

- Original baseline was React/Vite plus Supabase with a hosted frontend.
- On 13 October 2026 the user explicitly requested: "adjust backend stack for local only and use sqlite instead of supabase". Update the architecture and dependent planning artifacts to honor this choice.
- Later on 13 October 2026 the user requested: "update plan again to host on netlify instead of local, including database if supported". Reopen this decision to verify Netlify's current offerings and update the plan.

## Answer

Use React/TypeScript/Vite on Netlify static hosting, Express via serverless-http on Netlify Functions, Netlify Database for managed PostgreSQL, and Netlify Blobs for evidence. Netlify's database is supported and replaces SQLite. Keep application users and sessions in PostgreSQL, enforce case permissions in the API, and commit recomputed submissions transactionally. Production evidence uses durable storage, with explicit preview separation and authorized file access. Retain four weeks and the fixture-first milestone; deployment, cold-start, cross-device and recovery checks replace local-only acceptance.

The [updated plan](../../../FTC-PROTOTYPE-PLAN.md#7-architecture-state-and-access) and [technical note](../research/technology-options.md) contain the design, current official sources and planned verification. Database needs a credit-based account; this user's entitlement and actual usage charges remain unverified. No app code, cloud account settings, database or deployment was created or changed in this decision session.
