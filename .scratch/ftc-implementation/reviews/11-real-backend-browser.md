# Real-backend browser adversarial review

Status: FAIL; repairs in progress.

Independent GPT-6 Luna reviewer assessed `55cd33b0499c7deddebb499ec739ec69130b27c5` against baseline `c4a98c2`. The five real-HTTP browser journeys passed independently on owned ports, but a delayed actual initial-session response reproduced a fixture/hosted identity race: fixture selection before session readiness skipped logout, and the late response replaced the fixture identity with the hosted account while the fixture mode remained active.

The reviewer also required exact calculation-line/evidence/source/digest assertions, a submitted-edit test using the actual latest revision, and failed logout/retry browser evidence. The candidate is not accepted or merged. The implementer is repairing every finding, followed by independent rereview of the clean new candidate.

External report: `ftc-review-real-backend-browser.md` in the task's 14 October 2026 visualization directory. This unit uses actual Express HTTP, committed migrations in PGlite, private generated fictional credentials and test-only Blob I/O. It does not establish hosted PostgreSQL concurrency, SDK/Blobs durability or redeploy behavior.
