# Controlled demo operations and deployment package

Type: task
Status: open
Blocked by: 07, 08

Idempotent fictional seeds/private generated credentials; scoped dry-run reset/cleanup; migration/build/CI commands; environment names only; preview initialization/session invalidation; evidence backup/manifest/digest restore verification; coordinated recovery and deployment smoke tools. README/setup/presentation package and real status of every hosting gate. No provisioning before account/cost requirements are confirmed.

Account/bootstrap and release-check prerequisites are implemented and reviewed separately in ticket 08. Reuse them here; do not duplicate or weaken seed idempotency.

The independent ticket 07 storage review found that tombstones track `cleanup_pending` but no runnable retry command exists yet. This is a required outcome of this operations ticket, not an optional enhancement. Implement an environment-marker/store/region-scoped cleanup command with a default dry-run manifest; retry failed/crashed physical deletes, including late upload writes. It must handle tracking for deleted tombstones belonging to subsequently submitted cases without modifying frozen ready evidence, snapshots or protected inputs. Verify cleanup and coordinated backup/recovery through the operator seam. Research pointer: external `ftc-operations-design.md` verifies the installed authenticated CLI supports explicit-region Blobs list/get/set/delete and private input/output files without reading tokens.
