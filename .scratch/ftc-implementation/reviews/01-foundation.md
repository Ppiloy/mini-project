# FTC foundation adversarial review

Reviewed final integration hash `89f4459ca2895a13ba2cfef42a1c1e0df950eb19` (`codex/ftc-foundation`); worktree clean.

**Result: PASS for the foundation milestone.** The dependency security repair and the root setup fixes are present. No application code changes were made by this review.

## Verified at this hash

- `npm ci`: succeeded from the committed lockfile.
- `npm audit --json` and `npm audit --omit=dev --json`: zero vulnerabilities.
- `npm run typecheck`: passed.
- `npm test`: passed, 5 tests across API and PGlite suites.
- `npm run build`: passed.
- `npm run test:e2e`: passed, Chromium smoke 1/1; API health and unknown route reached through the Vite proxy.
- `vitest list`: returns only the four API tests and one PGlite test. `vite.config.ts` preserves Vitest defaults and excludes `tmp/**` and `e2e/**`, preventing nested-worktree and Playwright test discovery.
- `.gitignore` again excludes `tmp/`, `*.log`, and `demo-credentials*`.
- Direct API checks at the preceding dependency-fix hash confirmed unknown route JSON 404, malformed JSON JSON 400 with `invalid_input`, and oversized JSON JSON 413 with `payload_too_large`; those API files are unchanged at this final hash.

The earlier TypeScript export, Playwright API server, parser error envelope, and missing credential-ignore findings are resolved. The Vitest/Tinypool advisories are cleared by the exact-pinned Vitest 5 toolchain.

This pass covers local foundation behavior only. It does not establish Netlify account eligibility, deployment, deployed wrapper behavior, hosted cookie/session behavior, cross-device persistence, preview isolation, cold-start persistence, or recovery.
