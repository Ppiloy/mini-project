# Application foundation

Type: task
Status: resolved
Blocked by: none

Pin compatible dependencies and Node runtime; React/TypeScript/Vite/Tailwind, Vitest/Playwright, Express/serverless-http, Netlify Database/Blobs, sessions, Zod/RHF, decimal.js. Locked install, strict typecheck, test and build commands; Netlify routing/configuration. Establish a typed shared contract that domain/API/UI agents can use independently. Verify startup and unknown API routing. No hosted-integration claim without deployment.

## Answer

Resolved by reviewed foundation commit `ef8345d57c291623fb2c54e339634e7a8d4f05b8`. The review passed the foundation milestone and verified clean `npm ci`, typecheck, tests, production build, Chromium API proxy smoke, and direct API error/unknown-route probes. Integration rerun: `npm run typecheck` passed, `npm test` passed, the committed server suite passed with `vitest run --dir server` (5 tests), and `npm run build` passed. The default test discovery also saw duplicate suites in the preserved `tmp/worktrees` directories.

Review evidence: [foundation adversarial review](C:/Users/Decha/.codex/visualizations/2026/10/14/01a13877-050c-7d11-b74a-1b652ed63589/ftc-review-foundation.md). The review's dependency audit note remains pending: four development-only advisories through Vitest 3.2.7 / `tinypool` (two moderate, two critical); upgrade the test toolchain before using it with untrusted test/config inputs. No production dependency vulnerability was reported.
