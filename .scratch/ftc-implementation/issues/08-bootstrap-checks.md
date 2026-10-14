# Fictional account bootstrap and release checks

Type: task
Status: claimed
Blocked by: 03

Extract the authentication/bootstrap and build prerequisites from operations so they can proceed alongside evidence workflows. Implement an idempotent developer command to seed two fictional taxpayers and one officer using generated private credentials and scrypt. Repeat seeds must preserve existing passwords and cases; no frontend or Git credentials. Reject a wrong or ambiguous target environment and coordinate the trusted environment marker with ticket 07. Expose the configured officer identifier for server-only automatic assignment. Include private credential-file handling and an explicit credential rotation command that invalidates sessions.

Implement locked installation, TypeScript/calculation/API checks and build in CI and before Netlify publication. Verify migrations can apply from a blank PostgreSQL-compatible database and preserve their ordered checksums; no hosted DDL outside deployments. Add concise local setup instructions and environment-variable names without values. Test through the operator command and HTTP login seams with a real PostgreSQL-compatible test database; test idempotency, credential rotation, wrong-target refusal and no credential disclosure. Ticket 05 owns full reset, evidence backup/restore, preview lifecycle and the handover package after 07.

Every completed candidate receives independent adversarial review before merger integration. No production/preview provisioning in this implementation unit.
