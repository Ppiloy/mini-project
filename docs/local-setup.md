# Local setup

Use Node.js 24 and the committed `package-lock.json`:

```sh
npm ci
netlify dev
```

In another terminal, apply the committed migrations and create the fictional accounts inside the same Netlify Dev environment:

```sh
netlify database migrations apply
netlify dev:exec npm run demo:seed -- --target local
```

The seed command requires the explicit target to match the trusted runtime environment marker. It creates two fictional taxpayers and one reviewing officer only when those accounts are absent. Repeat runs retain passwords and cases. New credentials are written to a private file under the operator's home directory; the command prints only its path and the officer identifier. Keep that file private and pass credentials to the presenter through an approved private channel.

Set the server-only officer identifier from the seed summary as `FTC_OFFICER_USER_ID`. To rotate one demo account, run this explicitly in the same target environment:

```sh
netlify dev:exec npm run demo:rotate -- --target local --login taxpayer-demo-a
```

Rotation writes the replacement secret to a new private file and deletes that account's active PostgreSQL sessions. It does not run during build or deployment.

The application reads these server-side environment variable names; do not add values to this document or to `VITE_` variables:

- `NETLIFY_DB_URL` — supplied by Netlify Database / Netlify Dev.
- `SESSION_SECRET` — private session signing secret.
- `FTC_ALLOWED_ORIGIN` — exact application origin allowed by the API.
- `FTC_OFFICER_USER_ID` — identifier of the configured active officer.
- `FTC_BLOB_REGION` — server-side evidence storage region.

Run `npm run verify:release` for TypeScript, calculation/API tests, blank-database migration and checksum verification, and the production build. Netlify publication and CI run the same gates after a locked `npm ci` install.
