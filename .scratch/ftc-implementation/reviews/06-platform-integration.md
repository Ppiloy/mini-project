# Actual Netlify Dev operator integration

Status: incomplete; supported runtime repair underway.

Independent disposable rehearsal at `dcdfab7` used Netlify CLI 27.12.1 and Node 24.19.0. The actual local Database started and all seven committed migrations applied; a subsequent status check reported seven applied and none pending. No fictional accounts, cases, HTTP/evidence writes, backup or restore had run yet.

Installed `dev:exec` code combines environment/dotenv and spawns the child, without inheriting Netlify Dev's live Database or Blob context. A safe probe confirmed `NETLIFY_DEV=false` and no Database URL. Existing operator instructions therefore do not work as written. The single final-fix implementer is adding a supported local execution seam using the documented `@netlify/dev` engine; actual context, persistence and coordinated recovery still need validation. No substitute filesystem Blob backend or hosted manual DDL is authorized.

A raw `database status --show-credentials` attempt was rejected by automatic approval review because it could print a local connection password. The command stopped and no credentials were printed. The alternative under investigation is the documented SDK's in-memory local runtime context, with no secret serialization/output. This does not authorize rerouting the rejected credential output. The local state is preserved. External record: `ftc-netlify-dev-recovery-acceptance.md`.

The earlier offline server reached ready; restarting while its port was still occupied produced `Could not acquire required 'port': '8877'`. This is a test-process lifecycle observation, not a Database failure. No production reset/restore or hosted provisioning occurred in this rehearsal.
