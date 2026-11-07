# Decimal calculation and fixtures

Type: task
Status: resolved
Blocked by: 01

Implement plan sections 5/6 shared schemas, three validation levels, fingerprint confirmation, decimal calculation/explanations/snapshots and fictional fixtures with provenance. All calculation acceptance scenarios in section 9 require independent expected values. Include null drafts, bounds, supported policy, common FX units, source detail and final rounding reconciliation. Publish stable contract pointers early.

## Answer

Resolved by domain implementation commit `f2ce3e6` plus the final review-fix commits through `9d6ca837feded619653e57431d26d2b0a068a538`. The independent adversarial review passed after rerunning the six original findings and the subsequent policy-mutation regression, including nested provenance immutability. Integration checks after merge passed: `npm run typecheck`, `npm test` (7 files, 36 tests), and `npm run build`. Review details and probes are recorded in [the final domain rereview](../reviews/02-domain.md).
