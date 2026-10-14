# FTC implementation

Status: active

Implement [FTC-PROTOTYPE-PLAN.md](../../FTC-PROTOTYPE-PLAN.md). The plan is authoritative; planning tickets are retained as decision history.

Integration branch: `codex/ftc-integration`. Baseline: initial planning commit on `master`.

All subagents must use GPT-6 Luna. Each implementation ticket uses an isolated branch/worktree, TDD at the plan's already authorized public calculation/API/browser seams, adversarial review after completion, then a merger subagent. Repeat review after fixes. Final review has separate standards and specification axes.

Do not claim Netlify deployment, cross-device behavior, cold-start persistence or recovery has passed without actual evidence. Netlify CLI is authenticated and the project is linked. On 14 October the user confirmed a credit-based plan, available credits, and that current Database charges/backup retention were checked. Production Database provisioning and hosted acceptance have not yet run.

On 15 October, after the supported API rejected Functions-only variable scope, the user explicitly approved the current plan's default site-variable scopes. This overrides the plan's narrower scope selection: private runtime configuration is available to builds and Functions under the default scopes, with separate production/preview secrets, no client-prefixed variables, and no values in Git/frontend artifacts. No plan upgrade or purchase is authorized.

## Contract coordination

- Shared domain implementation owns `shared/` and `src/fixtures/`.
- Hosted implementation owns `server/`, `netlify/functions/`, `netlify/database/`, API permission tests.
- UI implementation owns `src/` excluding fixtures, browser repositories and browser journeys.
- Foundation owns root package/tooling initially; subsequent dependency changes are serialized.
- Money/rates/derived decimals cross all interfaces as strings. Missing draft fields remain null.
- API endpoint families and error codes are those in plan section 7. Expected revision and snapshot/request IDs control all mutations.

## Verification seams

1. `calculateFTC` and shared draft/calculation validation: independent arithmetic, unsupported/missing input and rounding boundaries; does not certify tax eligibility.
2. Express HTTP API with PostgreSQL/Blob adapters: identity, ownership, assignment, revisions, immutable submissions, evidence quotas and races; deployed wrapper requires a separate live gate.
3. Browser journeys through Thai UI: saves, errors, preview freshness, evidence, submit, officer report, account switching, keyboard/mobile/print; fixture mode clearly identified.
