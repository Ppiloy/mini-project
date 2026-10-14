# Choose the implementation sequence and demonstration acceptance criteria

Labels: wayfinder:grilling
Type: grilling
Status: open
Parent: ../map.md
Blocked by: 04, 05, 06, 07

## Question

Which phased build fits the actual time and team, which features can be deferred, and which end-to-end demonstration, calculation, permission, report, and usability checks must pass before the prototype is ready?

## Comments

- Baseline assets: [four-week sequence](../../../FTC-PROTOTYPE-PLAN.md#8-four-week-delivery-sequence) and [acceptance scenarios](../../../FTC-PROTOTYPE-PLAN.md#9-acceptance-and-demonstration). User delegated scheduling; verify estimates after the first milestone rather than wait for an invented due date.
- Backend milestone now means Netlify Functions, PostgreSQL users/sessions and Blob evidence. Final acceptance includes cross-device access, cold-start/redeploy persistence, preview isolation, payload limits and coordinated database/evidence recovery. The offline fixture demo is a separate fallback, not a synchronized backend.
- Review update, 14 October 2026: move account/runtime/session/Database/Blob verification into a first-week 4–6 hour integration gate, within the unchanged 80–120 hour target. Add exact-decimal and rounding checks, stale-L and partial-draft cases, unavailable/unassigned officer cases, lost-response retries, file signatures/quotas and same-browser account switching. Re-estimate after week one. See [review findings](../plan-review.md).
