# FTC prototype operations handover

**Release state:** operator commands, isolated PGlite/HTTP regressions, migration verification, typecheck, tests and local production build are exercised in this repository. Hosted deployment, branch provisioning, preview persistence, production smoke, and account usage have not been freshly observed for this handover. Do not present them as completed. Last reviewed against code: 2026-10-14 UTC.

## Site and runtime configuration

The linked Netlify site is `ppiloy-mini-project`, site ID `3bc8fc1b-7af0-47c3-87cd-3080c8bfc3d3`. Hosted Function configuration uses Functions-scoped variables: `FTC_DEPLOYMENT_CONTEXT` (`production`, `deploy-preview`, or `branch-deploy`), `SESSION_SECRET` (at least 32 characters), exact `FTC_ALLOWED_ORIGIN`, `FTC_OFFICER_USER_ID`, and `FTC_BLOB_REGION=us-east-2`. Choose and configure the trusted officer UUID before first hosted seed/deploy: the Function reads its officer ID from the deployed environment, and a fresh preview DB has no officer to discover. Seed uses that ID only when creating a missing fictional officer and refuses to change an established officer identity. Netlify supplies `NETLIFY_DB_URL`; do not copy database URLs into config. `CONTEXT` is not guaranteed in Function runtime. Never put secret values in `netlify.toml`, Git, or any `VITE_` variable.

Production Blob store identity is derived from the stable site namespace. Preview store identity is bound to the trusted preview database fingerprint. Local store identity is derived from the trusted local database identity; do not pass a caller-selected store name. Every operation requires explicit `--target` and rejects a mismatch against server/process configuration and the active database marker. All Blob operations preserve the explicit `us-east-2` region.

Hosted operator commands require an authenticated Netlify CLI session and a link to the exact trusted site in the operator's current project directory. Before the first Blob command, the adapter runs `netlify status --json` and compares the linked site ID with trusted `SITE_ID`/`NETLIFY_SITE_ID`; a missing or mismatched link stops before Blob access. The installed CLI uses the Blobs API origin when outside a Function and documents its Blob operations as strongly consistent. Its default `list` call collects all SDK pages. The operator captures CLI output internally and emits only redacted diagnostic categories on failure.

## Seed, presentation credentials, and rotation

Apply the ordered migrations through Netlify's supported deploy lifecycle for hosted environments. For local development, follow [local setup](docs/local-setup.md). The demo seed command runs only when an operator calls it; it is not in build or deployment. Re-running seed preserves existing passwords and cases. The generated private file is in `.ftc-private`; deliver it through an approved private channel and then remove any unneeded copies. Stdout contains only a path, safe account summary, and `FTC_OFFICER_USER_ID`.

To rotate an account, provide a UUID `--operation-id` and repeat that same value after any uncertain database commit. The private recovery file is authoritative for that operation. Replaying the same operation reuses the current credential and does not invalidate sessions again. If a later rotation superseded it, the old operation fails instead of reporting stale credentials as current. A missing recovery file is an explicit recovery issue; it never silently rotates again. Rotation is never automatic during seed, build, or deploy.

## Preview initialization

The first request initializes the trusted marker and leaves preview login gated. Run `npm run ops:preview-init -- --target preview --operation-id <uuid>` from an authenticated Netlify CLI session scoped to that exact linked site and preview DB. The command rotates all three fictional demo accounts, invalidates copied sessions, creates two fresh taxpayer drafts with fictional evidence, strongly verifies each Blob, and only then opens that marker's auth gate. The private credential file is the sole password output. Same-marker reruns preserve cases/passwords; same-operation recovery verifies the retained file and objects. A new marker remains gated until initialized.

Netlify documents fresh database branches for new preview pushes. Persistence is expected only while the same underlying DB branch/deploy lifecycle remains active; a newly created preview database requires explicit initialization. No live preview was used to verify branch persistence or this command in Functions.

## Evidence cleanup and retention

Configure `FTC_UPLOAD_SETTLE_MS` from the observed maximum upload invocation lifetime; no numeric value is asserted here. Cleanup defaults to a read-only plan. It scopes tombstones to the exact active marker/store/region, waits out the configured settle period and any active claim lease, never deletes ready evidence or snapshot-referenced evidence, and retains tombstones permanently. Confirm only the exact fresh manifest with `--confirm <manifest-id>`. Physical delete is followed by a strong absence check; ambiguous/failing deletes remain retryable. Late objects written after a previous sweep are found in a later pass. Orphan keys are listed for inspection and left untouched.

```text
npm run ops:cleanup -- --target <local|preview|production> --dry-run
npm run ops:cleanup -- --target <same-target> --confirm <fresh-manifest-id>
```

## Coordinated backup, restore rehearsal, and dedicated demo reset

Backup defaults to a read-only inventory and captures relational rows from one repeatable-read snapshot plus every listed Blob's exact bytes and SHA-256. A missing/mismatched ready object or database change aborts the artifact. Numeric SQL values remain decimal strings. The confirmed export is private under `.ftc-private`; its path and SHA-256 are safe to report, but financial rows and object bytes are not.

```text
npm run ops:backup -- --target <target> --dry-run
npm run ops:backup -- --target <target> --confirm <fresh-manifest-id> --operation-id <uuid>
npm run ops:restore -- --target local --backup <private-file> --backup-sha256 <sha256> --dry-run --operation-id <uuid>
npm run ops:restore -- --target local --backup <private-file> --backup-sha256 <sha256> --confirm <restore-manifest-id> --operation-id <same-uuid>
```

Restore is a local rehearsal only. Its database must be fresh and blank, and its marker-derived Netlify Dev sandbox store must be empty and isolated from the source identity. Restore rejects production/preview, source identity, nonblank DB, changed object bytes, incomplete ready evidence, missing files, operation drift, or credential supersession. It preserves source case/snapshot/report facts and evidence digests while rebinding marker/store/region. It does not copy sessions or old password hashes. New credentials are private; the local authentication gate opens only after relational comparison, object read-back, and empty-session verification. The same operation ID can resume a closed gate; restore never targets the hosted database.

Reset is only for the allowlisted fictional demo cohort, and `FTC_DEMO_RESET_MARKER_ID` must exactly equal the reviewed active marker. Production is prohibited. Configure `FTC_UPLOAD_SETTLE_MS` from observed upload lifetime and plan with `--dry-run --operation-id <uuid>`; no pending or recent attachment may remain eligible. If submitted cases exist, the owner must supply the configured absolute `FTC_DEMO_RETENTION_CUTOFF`, repeat that exact cutoff, and provide a complete verified private backup and SHA-256. No numeric retention interval is documented because no account-specific value was supplied. Reset rotates the three demo passwords, clears their sessions, deletes only their exact case scope under a SQL operation ledger, and then verifies physical object deletion. Reuse the same operation ID, backup, and private credential file for recovery.

## Release checks and smoke

The release workflow runs `npm ci` with the Node version in `.node-version`, then `npm run verify:release`. This gate runs typecheck, all unit/API tests, ordered SQL migration checksum validation, and the Vite production build. `netlify.toml` runs the gate before publication; failed migration/checksum or build checks prevent publish. Never add a production seed, reset, or password rotation to a build hook.

For an actual hosted preview, record the UTC time, deploy/DB branch identifiers, successful automatic migrations, exact URL/origin, health/API response, login in a separate browser profile, evidence upload/download digest, officer assignment/access, redeploy persistence, and isolation from production before calling that gate passed. No fresh URL or hosted result is recorded here. For a local smoke, use Netlify Dev, create fictional accounts explicitly, sign in as each role, save a draft, upload/download a sample file, submit and inspect the unchanged report, then run `npm run verify:release`.

## Presentation/report facts and open gates

The committed sample uses fictional fixture data and must be labelled as draft or submitted according to the snapshot actually rendered. Keep the report's in-app Thai label `ร่าง — ยังไม่ได้ส่ง` unchanged when it is a draft. The source-arithmetic note and independent reference are in `.scratch/reviews/arithmetic-reference.md`; the sourced lecture-slide total is **143,544.30**, not 143,554.30. The prototype is educational, not a tax filing, legal conclusion, treaty determination, or proof of taxpayer eligibility.

The owner confirmed that account eligibility, cost, and retention were checked, but no exact account tier, observed usage, or numeric retention value is captured here. Record only values from the owner-confirmed source; keep exact retention cutoff unset until supplied. Hosted migration, access, cost/usage, restore, and production/preview smoke remain open until observed on the actual site. Do not paste Netlify token files, database URLs, passwords, or private export contents into issue reports.
