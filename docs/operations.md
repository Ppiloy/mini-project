# Operations guide

## Before any operator command

Use Node.js 24. Hosted commands run from the linked project directory after authenticating the Netlify CLI. The command verifies `netlify status --json` and stops unless its linked site ID matches the trusted process `SITE_ID` or `NETLIFY_SITE_ID`. It never reads CLI token files, and tokens must not be passed on command lines or printed.

Use Netlify's default site-variable scope for `FTC_DEPLOYMENT_CONTEXT`, `FTC_BLOB_REGION`, `FTC_OFFICER_USER_ID`, `SESSION_SECRET`, and `FTC_ALLOWED_ORIGIN`. Set `FTC_DEPLOYMENT_CONTEXT` explicitly for each deploy context (`production`, `deploy-preview`, or `branch-deploy`); `CONTEXT` is not guaranteed in Function runtime. Keep production and preview secret/config values separate wherever they differ, and keep them out of Git and frontend variables. `NETLIFY_DB_URL` comes from the platform. Blob operations use explicit region `us-east-2`. Local operator commands must run inside `netlify dev:exec`, with `FTC_DEPLOYMENT_CONTEXT=dev`; they use the sandboxed Netlify Dev Blob store. Store identity comes from trusted database identity, never a CLI namespace argument.

Seed only after applying ordered migrations. `demo:seed` creates the two fictional taxpayers and one officer when missing, generates strong private passwords, and preserves existing credentials and cases on repeat. It prints only the protected credential-file path and `FTC_OFFICER_USER_ID`, never password values. For the first preview, configure a stable, trusted UUID in `FTC_OFFICER_USER_ID` before deploying; a missing officer receives that ID, while an existing identity mismatch fails closed.

Rotation requires an explicit UUID `--operation-id`. Retain that ID and the private recovery file when commit acknowledgement is uncertain. Same-operation replay verifies the existing password and does not invalidate sessions again. A distinct later operation supersedes prior credentials; a missing recovery file is a stop-and-recover condition, not permission to rotate again.

```powershell
$rotationId = [guid]::NewGuid().Guid
netlify dev:exec npm run demo:rotate -- --target local --login taxpayer-demo-a --operation-id $rotationId
```

## Preview initialization

Copied demo passwords cannot authenticate a preview until its explicit initialization gate is ready. Initialization replaces passwords for all three demo accounts, invalidates copied sessions, creates two fresh fictional drafts and usable fictional PDF evidence, reads each object back and verifies its digest, and only then opens the gate. Same-marker reruns preserve cases and passwords. A newly created database branch needs its own one-time initialization; automatic deploy does not seed or rotate.

Run a read-only preview first, inspect the private manifest path and SHA-256 printed by the command, then confirm only the exact returned manifest ID. Use the same operation ID after an uncertain outcome.

```powershell
$previewInitId = [guid]::NewGuid().Guid
# Run from the approved operator shell with the preview database/context scoped in its process environment.
npm run ops:preview-init -- --target preview --operation-id $previewInitId --dry-run
# Review the protected manifest named in the output.
npm run ops:preview-init -- --target preview --operation-id $previewInitId --confirm <exact-manifest-id>
```

## Cleanup and reset

Cleanup is read-only until confirmed. The protected manifest contains the exact marker/store/region and every tombstone's status, age, retry count, previous attempt category, lease, protection reason, and snapshot references. Ready evidence and snapshot evidence are protected; orphan objects are listed for inspection and left untouched. Cleanup requires `FTC_UPLOAD_SETTLE_MS` based on an observed maximum upload lifetime, waits through active leases, and verifies object absence after deletion. Re-run dry-run after any partial result; late uploads remain retryable.

```powershell
netlify dev:exec npm run ops:cleanup -- --target local --dry-run
netlify dev:exec npm run ops:cleanup -- --target local --confirm <exact-fresh-manifest-id>
```

Demo reset is limited to the exact `FTC_DEMO_RESET_MARKER_ID`; production is rejected. Start with a dry-run and inspect its protected scope manifest: accounts, exact cases, attachments, snapshot references, audit events, object names and SHA-256 digests, settle-period blockers, and retention eligibility. Pending/recent uploads block reset. Every whole-demo reset, including a draft-only reset, requires a fresh verified complete private backup whose marker and relational snapshot still match. Submitted examples additionally require a configured `FTC_DEMO_RETENTION_CUTOFF` and the exact same `--retention-cutoff`; draft-only resets do not require a retention cutoff. No numeric retention interval is specified here because the supplied owner confirmation did not give one. Reset is never an end-user feature or deploy action.

```powershell
$resetId = [guid]::NewGuid().Guid
netlify dev:exec npm run demo:reset -- --target local --operation-id $resetId --dry-run
netlify dev:exec npm run demo:reset -- --target local --operation-id $resetId --confirm <exact-manifest-id> --retention-cutoff <configured-cutoff> --backup <private-backup-path> --backup-sha256 <exact-sha256>
```

The verified complete backup path and SHA-256 are required for every reset. The retention cutoff and matching `--retention-cutoff` argument are required only when the manifest includes submitted cases; the cutoff must be supplied by the owner and must not be invented or inferred. Exact target, marker, operation ID, backup, and private credential file must remain unchanged across recovery.

## Release and smoke checks

Run `npm ci`, `npm run verify:release`, and `npm run test:e2e`. The default browser suite covers fixture and development-server journeys; run `npm run test:e2e:real` separately for the real Express app with disposable PGlite. CI runs the release gate using `.node-version`; `netlify.toml` gates publication with the same checks. `migrations:verify` validates ordered SQL files against locked byte checksums. Never change an already-applied migration to resolve a checksum failure; add an ordered migration instead.

For local smoke use Netlify Dev, fictional accounts, separate browser profiles for the two taxpayer roles and officer, a saved draft, sample PDF upload/download with matching digest, submit, and the same report through officer review. For hosted smoke record actual UTC, deploy and DB branch identifiers, migration result, exact URL/origin, API health, role boundaries, object digest, preview/production isolation, redeploy persistence, cold start, and account usage. None of those hosted observations are asserted as passed here.
