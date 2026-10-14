# Fictional account bootstrap and release checks

Type: task
Status: resolved
Blocked by: 03

Extract the authentication/bootstrap and build prerequisites from operations so they can proceed alongside evidence workflows. Implement an idempotent developer command to seed two fictional taxpayers and one officer using generated private credentials and scrypt. Repeat seeds must preserve existing passwords and cases; no frontend or Git credentials. Reject a wrong or ambiguous target environment and coordinate the trusted environment marker with ticket 07. Expose the configured officer identifier for server-only automatic assignment. Include private credential-file handling and an explicit credential rotation command that invalidates sessions.

Implement locked installation, TypeScript/calculation/API checks and build in CI and before Netlify publication. Verify migrations can apply from a blank PostgreSQL-compatible database and preserve their ordered checksums; no hosted DDL outside deployments. Add concise local setup instructions and environment-variable names without values. Test through the operator command and HTTP login seams with a real PostgreSQL-compatible test database; test idempotency, credential rotation, wrong-target refusal and no credential disclosure. Ticket 05 owns full reset, evidence backup/restore, preview lifecycle and the handover package after 07.

Every completed candidate receives independent adversarial review before merger integration. No production/preview provisioning in this implementation unit.

Candidate `611da3adcd98e75a37bf6618743d6237142e9348` passed independent rereview and was merged at `1520a9c`. Integration release checks passed 78 tests, four migrations, typecheck and build. A subsequent fresh Windows worktree exposed a CRLF-vs-Git-blob checksum mismatch for the fourth migration; reproducible checkout/checksum handling must be repaired and independently rereviewed before this ticket resolves. Preserve committed migration identities and genuine checksum-drift detection.

Checkout repair `01c6952e2ad2ef4ab739b9e068778164f4d73cba` passed independent adversarial rereview; merged at `92cd08b9f3be9030404dd13ebbb2b1d75a952866`. LF attributes and lock values now match the unchanged Git SQL blobs; Windows/default fresh checkouts pass, while CRLF/content drift remains rejected. Integration release checks pass 83 tests, four blank-applied migrations, typecheck and build. Existing clean SQL paths were refreshed through Git attributes to LF. Evidence: [bootstrap review](../reviews/08-bootstrap.md), [checkout review](../reviews/08-checkout.md). No hosted seed, rotation, Database or CI verification is claimed.
