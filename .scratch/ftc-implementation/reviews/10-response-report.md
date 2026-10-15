# Ticket 10 independent rereview — response validation and report provenance

**Verdict: PASS** for the required ticket 10 scope at exact candidate `d9e346d585ed04c118f5ebb6bbdf4e1d14efb7fe` (`codex/ftc-response-report`). The worktree was clean at review start and finish. This candidate includes the integration tracker merge `7a47f31` and the reviewed ticket 08 LF migration-checksum repair. The earlier `ftc-review-response-report.md` remains unchanged.

## Findings

No actionable ticket 10 findings reproduced.

The prior P2 is repaired: `logoutAndConfirm` returns its underlying logout/status errors when confirmation is unresolved; `SessionProvider` retains status errors for persisted logout intents; and both the in-app sign-out banner and entry-page cleanup/retry alerts format available request IDs with the policy identifier. On an authoritative anonymous response, confirmation succeeds and the errors/intent are cleared. A different authenticated account clears the prior logout intent and is adopted without sending logout for that new account.

The ticket 09 recovery checks remain sound: failed logout does not claim success; unavailable or malformed status leaves the warning and retry available across reload; only a validated anonymous response or valid logout success clears the pending intent and private browser state; wrong-role login keeps the new authoritative identity/guidance consistent and clears the old owner's pending cache; fixture sign-out remains local.

Shared JSON success schemas remain required at the client boundary, and server JSON success responses pass through the shared schema helper. Malformed case/snapshot replies produce recoverable errors with request IDs; local server/API tests exercise DTOs through the helper. Binary evidence downloads retain their separate Blob path. The report renders the frozen manual FX source URL and educational assumption. Upload still sends the original Unicode filename as `displayName` multipart metadata.

## Checks run

- `npm run typecheck` — PASS.
- `npm test -- --run src/data/api.test.ts server/app.test.ts server/workflow.test.ts server/hosted.test.ts` — PASS, 4 files / 40 tests.
- `npm run test:e2e -- e2e/response-contract.spec.ts e2e/logout-recovery.spec.ts --workers=1` — PASS, 18 Chromium journeys on isolated local ports 18887/15172. Coverage includes 503 logout diagnostics, wrong-role cleanup error IDs and retry, unresolved logout after reload/status outage, rejection of HTML/malformed/wrong-code 401s, different-account replacement, anonymous confirmation, fixture sign-out, malformed JSON success handling, and frozen FX provenance.

**Limits:** Browser tests used mocked HTTP responses; server/API tests used local test seams. No hosted Netlify deployment, managed PostgreSQL/Blobs, or cloud mutations were exercised. I did not run the full release gate or claim hosted acceptance.
