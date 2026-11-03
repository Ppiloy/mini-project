# Thai Foreign Tax Credit prototype

This is an educational prototype for recording foreign income and remittances, calculating a bounded example credit, attaching evidence, and reviewing an unchanged result. It does not determine legal eligibility or prepare a tax filing. Use fictional information only.

The browser-only example mode at `/demo` is the presentation fallback. It stores records in localStorage and original evidence files in IndexedDB within that browser profile. Files can be previewed and downloaded there; this does not share them across devices or profiles. The hosted database, officer queue, and authorized evidence store remain separate.

## Start and verify

Use Node.js 24 and the committed lockfile. See [local setup](docs/local-setup.md) before running Netlify Dev or creating demo accounts.

```powershell
npm ci
npm run verify:release
npm run test:e2e
npm run test:e2e:real
```

The release gate runs typecheck, API/calculation/operator tests, ordered SQL checksum verification, and the production build. Netlify publication is configured to stop when that gate fails. Seed, rotation, preview initialization, reset, and restore are explicit operator actions and are never build hooks.

`test:e2e` runs the default browser suite against the local Vite and development API servers. `test:e2e:real` separately runs the actual-Express acceptance suite against a fresh disposable PGlite database; see [its setup and limits](e2e/real-backend/README.md). The default suite excludes that harness so it never starts it without its dedicated configuration.

## Handover

- [Operations guide](docs/operations.md) covers trusted configuration, review manifests, seed/rotation, preview initialization, cleanup, and release checks.
- [Recovery guide](docs/recovery.md) covers private exports, fresh local restore rehearsal, ambiguity handling, retention, and open hosting gates.
- [Presentation guide](docs/presentation.md) contains the five-minute walkthrough, fixture fallback, and sample report provenance.
- [Combined review delivery](docs/ftc-combined-review-implementation.md) records the agreed improvement scope, regression checks, commits, and preview deployment evidence.
- [Detailed operator reference](README-operations.md) documents command behavior and the environment ownership rules.

Preview deployment evidence is recorded in the delivery notes. It does not establish production smoke results, account usage, or completed live recovery. See the operator guides for those separate checks.
