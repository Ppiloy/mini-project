# Independent schema review: session recovery

**Candidate:** `89050f496fddd284b3cff30ea650534497ae7401` (`codex/ftc-session-recovery`), reviewed in `tmp/worktrees/session-recovery`.

**Result: PASS for the requested cases.** No new recovery finding was reproduced. This was a local/mock review; no deployed API or server session was used.

## Runtime schema review

The error schema matches the shared contract in `shared/contracts.ts`: `ApiErrorCode` uses the declared enum; `error.message` and `requestId` are strings; `fields` is optional; and each `ValidationMessage` has string `code` and `message` plus an optional path array containing only strings and numbers. I exercised the schema against missing/non-string codes and messages, non-array fields, null or incomplete entries, string paths, and paths containing objects. Each malformed shape was rejected. An entry with valid strings and a mixed string/number path is accepted, matching the contract.

Auth session response validation matches `ApiUser` and the client `AuthSession` fields (`id`, `loginName`, `displayName`, role enum, nullable `maskedReference`, and string CSRF token), wrapped in the standard `{ data, requestId }` success envelope. Logout success requires `{ data: { loggedOut: true }, requestId }`. Error and success schemas are applied at the request boundary; a malformed 200 cannot become an active session or confirm logout.

## Checks

- `npm run test:e2e -- e2e/logout-recovery.spec.ts --workers=1`: **15 passed**.
- `npm run typecheck`: **passed**.
- Valid complete application JSON 401 confirms anonymous session after an ambiguous logout failure.
- HTML 401, missing request ID, malformed validation entries, and wrong error code remain unresolved and retain retry intent.
- Malformed auth session success does not expose a private user; malformed logout successes with `loggedOut: false` or missing envelope request ID remain unresolved.
- The outage/reload recovery marker remains visible without hydrating identity; same-account retry can complete, and a different current account is not logged out.
- Wrong-role account replacement, prior-account cache clearing, persistent role guidance/retry, private-route denial, and local fixture sign-out still pass.

**Workspace:** The candidate worktree remained clean. Tests used mocked HTTP responses and Chromium; this does not establish behavior on a deployed Netlify protection layer.
