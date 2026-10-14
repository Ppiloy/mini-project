# Local setup

Use Node.js 24 and the committed `package-lock.json`:

```sh
npm ci
netlify dev
```

In another terminal, apply the committed migrations and create the fictional accounts inside the same Netlify Dev environment. Set `FTC_DEPLOYMENT_CONTEXT=dev` in that terminal before running the operator command; the operator checks this trusted process value against `--target local`.

```powershell
$env:FTC_DEPLOYMENT_CONTEXT = "dev"
netlify database migrations apply
netlify dev:exec npm run demo:seed -- --target local
```

The seed command requires the explicit target to match the trusted runtime environment marker. It creates two fictional taxpayers and one reviewing officer only when those accounts are absent. Repeat runs retain passwords and cases. New credentials are written to a private file under the operator's home directory; the command prints only its path and the officer identifier. Keep that file private and pass credentials to the presenter through an approved private channel.

Set the server-only officer identifier from the seed summary as `FTC_OFFICER_USER_ID`. To rotate one demo account, run this explicitly in the same target environment:

```powershell
$rotationId = [guid]::NewGuid().Guid
netlify dev:exec npm run demo:rotate -- --target local --login taxpayer-demo-a --operation-id $rotationId
```

Rotation requires a UUID operation ID. Reusing the same ID returns the same still-current credential file without another password change or session invalidation. If the database commits but the command loses its acknowledgement, keep the reported private recovery file and retry with that operation ID. Use a new ID only when you intend a new rotation. A later rotation makes earlier operation credentials stale, which the command detects. Rotation does not run during build or deployment.

The application reads these server-side environment variable names; do not add values to this document or to `VITE_` variables:

- `NETLIFY_DB_URL` — supplied by Netlify Database / Netlify Dev.
- `SESSION_SECRET` — private session signing secret.
- `FTC_ALLOWED_ORIGIN` — exact application origin allowed by the API.
- `FTC_OFFICER_USER_ID` — identifier of the configured active officer.
- `FTC_DEPLOYMENT_CONTEXT` — exact runtime context: `dev`, `production`, `deploy-preview`, or `branch-deploy`. Set this variable with Functions scope in Netlify because `CONTEXT` is not guaranteed in Function runtimes.
- `FTC_BLOB_REGION` — server-side evidence storage region; this prototype uses `us-east-2`.

Run `npm run verify:release` for TypeScript, calculation/API tests, blank-database migration and checksum verification, and the production build. Netlify publication and CI run the same gates after a locked `npm ci` install.

The Netlify Function reads `FTC_DEPLOYMENT_CONTEXT` from Functions-scoped site configuration; `CONTEXT` is not guaranteed at Function runtime. The operator reads the same name from its process environment and rejects missing or mismatched target values before touching account data.
