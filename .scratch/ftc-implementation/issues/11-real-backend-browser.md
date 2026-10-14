# Real backend browser acceptance

Type: task
Status: claimed
Blocked by: 03, 04, 07, 08, 09, 10

Close the integration gap between separately passing backend tests and browser journeys that intercept hosted APIs. Add a test-only isolated harness using the actual Express app, actual committed migrations in PGlite, fictional operator-seeded accounts, and isolated test Blob I/O. Browser journeys must use actual HTTP APIs without substituting their responses.

Exercise taxpayer create/save/reload/first-source ID mapping, confirmations, evidence upload/download, calculation/submission, exact snapshot report and assigned-officer audit/read-only access; verify taxpayer B/anonymous denial and account-switch cache clearing. Show an actionable missing/unsupported/save conflict and retained typed values. Compare arithmetic to the independent reference. Use candidate-specific owned ports, no trace/log credential disclosure and no production imports/routes for the harness. Test-only in-memory Blob I/O is permitted here but must be clearly distinguished from durable hosted storage.

This closes local UI/backend composition evidence only. It does not prove real PostgreSQL concurrency, Netlify SDK/wrapper/Blobs, redeploy persistence, preview isolation, recovery or cloud costs; those remain ticket 06/hosting gates. Merge latest integration (including operations 05 if it lands) before reporting the clean completed candidate. Independently adversarially review this unit and all repairs before merger integration.
