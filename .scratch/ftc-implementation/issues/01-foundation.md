# Application foundation

Type: task
Status: resolved
Blocked by: none

Pin compatible dependencies and Node runtime; React/TypeScript/Vite/Tailwind, Vitest/Playwright, Express/serverless-http, Netlify Database/Blobs, sessions, Zod/RHF, decimal.js. Locked install, strict typecheck, test and build commands; Netlify routing/configuration. Establish a typed shared contract that domain/API/UI agents can use independently. Verify startup and unknown API routing. No hosted-integration claim without deployment.

## Answer

Resolved by reviewed foundation commit `ef8345d57c291623fb2c54e339634e7a8d4f05b8`. The initial review passed typecheck, tests, production build, Chromium API proxy smoke, and direct API error/unknown-route probes. Integration checks after the dependency repair and test-discovery fix also passed: clean `npm ci`, both audit commands with zero vulnerabilities, `npm run typecheck`, `npm test` (5 tests), and `npm run build`.

Review evidence: [foundation adversarial review](../reviews/01-foundation.md). The test-tooling audit advisories were resolved by repair commit `39d81d3` and the Vitest discovery fix in reviewed commit `89f4459ca2895a13ba2cfef42a1c1e0df950eb19`. Adversarial review passed. Integration rerun at the reviewed repair: `npm ci` succeeded; `npm audit --json` and `npm audit --omit=dev --json` both reported zero vulnerabilities; `npm run typecheck`, `npm test` (5 tests), and `npm run build` passed. Vitest excludes `tmp/**` and `e2e/**`, so nested worktrees are no longer discovered as duplicate test suites.
