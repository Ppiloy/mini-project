# Hosted integration evidence

Status: active; required hosted acceptance is incomplete.

Target: linked Netlify project `ppiloy-mini-project`, site ID `3bc8fc1b-7af0-47c3-87cd-3080c8bfc3d3`. Production branch configured as `main`; Functions region observed as `us-east-2`. The user confirmed a credit-based plan, available credits, and review of current Database charges/backup retention on 14 October 2026.

## First reviewed draft deployment

- Reviewed local authentication/draft candidate: integration `410150a`, including independently passed backend `e3d965064482d06bb0bf5c090fab45d65a7ef243`.
- Installed Netlify CLI completed a draft deployment with context `deploy-preview`, alias `ftc-gate-20261014`, and generated deploy-only secret. No production publication or Git push occurred.
- Deploy ID: `6acf429752fbb19f3b176f9e`.
- [Draft URL](https://ftc-gate-20261014--ppiloy-mini-project.netlify.app).
- [Deploy log](https://app.netlify.com/projects/ppiloy-mini-project/deploys/6acf429752fbb19f3b176f9e).
- API probes to health, anonymous session, unknown API and invalid login all returned Netlify `401`, content type `text/html`, title `Login Redirect`. These responses came before application JSON and do **not** verify Function routing, Database writes or application authentication.
- The user offered to make preview access public if the dashboard permits it. Accessibility has not yet been verified. Visitor-access changes use the dashboard, as required by the local Netlify access-control skill; no token extraction or unsupported API setting was attempted.
- Private deployment secret/configuration and raw CLI output are in ignored `tmp/` files and are excluded from Git/frontend artifacts.

## Gates still required

After the reviewed workflow/operations candidate is ready: real Database migration/read/write checks, HTTPS Secure session round trip, authorized Blob binary upload/download and 3 MiB overhead boundary, cross-account/officer access, actual PostgreSQL races and response-loss retry, same-snapshot print, preview/production namespace isolation, redeploy/cold-start persistence, coordinated disposable recovery, and observed usage. Local PGlite, mocked browser responses and a successful draft upload do not replace these gates.
