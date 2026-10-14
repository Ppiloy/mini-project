# Local setup

Use Node.js 24 and the committed `package-lock.json`:

```powershell
npm ci
netlify dev
```

The Functions-scoped local values are `FTC_DEPLOYMENT_CONTEXT=dev`, `SESSION_SECRET`, `FTC_ALLOWED_ORIGIN`, and `FTC_BLOB_REGION=us-east-2`. Netlify Dev supplies its local `NETLIFY_DB_URL` and sets `NETLIFY_DEV`. Apply committed migrations and create the fictional accounts from a second terminal using the same Netlify Dev context:

```powershell
$env:FTC_DEPLOYMENT_CONTEXT = "dev"
netlify database migrations apply
netlify dev:exec npm run demo:seed -- --target local
```

Seed is an explicit operator action. It creates the two fictional taxpayer accounts and one officer only when absent. Repeat runs retain credentials and cases. Generated passwords are written only to an OS-protected private file under `.ftc-private`; stdout contains its path and the generated `FTC_OFFICER_USER_ID`, never passwords. Set that ID in the local Functions environment. Do not put credentials in `.env.example`, frontend variables, Git, or logs.

For a hosted first preview, configure a stable trusted officer UUID as Functions-scoped `FTC_OFFICER_USER_ID` before the first deploy/seed. Seeding a missing officer uses this configured UUID. The server refuses a mismatch with an existing officer and never replaces that established identity. This prevents an initial preview seed from requiring a redeploy just to publish a randomly discovered officer ID.

Rotate one account by specifying a stable UUID operation ID. Keep the same ID and private file to recover an ambiguous commit; choose a new ID only for a deliberate later rotation.

```powershell
$rotationId = [guid]::NewGuid().Guid
netlify dev:exec npm run demo:rotate -- --target local --login taxpayer-demo-a --operation-id $rotationId
```

For hosted operator commands, install and authenticate the Netlify CLI, then link the operator's project directory to the exact site configured for the Functions. The command checks `netlify status --json` against trusted `SITE_ID`/`NETLIFY_SITE_ID` before any hosted Blob access. Keep the same authenticated linked-site context for backup, preview initialization, and restore rehearsal. Do not pass tokens on command lines or copy CLI credentials into files.

Local evidence uses the Netlify Dev Blob sandbox. Its store name is derived from the trusted database identity, not a command-line option. A fresh database gets an isolated store. A mismatch with an existing marker fails closed. The connection identity contains a port; persistence across Netlify Dev restarts has not yet been verified and must not be assumed for an already initialized local marker.

Run a dry-run before cleanup or reset. Cleanup never deletes ready evidence or unreferenced objects; reset is limited to the configured dedicated-demo marker and requires an exact manifest confirmation. If submitted demo cases exist, the explicit retention cutoff and verified complete backup are required.

```powershell
netlify dev:exec npm run ops:cleanup -- --target local --dry-run
netlify dev:exec npm run demo:reset -- --target local --dry-run --operation-id $([guid]::NewGuid().Guid)
```

Use `npm run verify:release` for TypeScript, API/calculation tests, ordered migration/checksum verification, and production build. Netlify publication and CI run the same locked-install gates.
