# Evidence and database recovery

Database rows, session records, and Blob evidence are separate durable resources. A code rollback does not recover either store. A database restore alone does not restore files. Use the coordinated private export and verify all evidence digests before resuming access.

## Private backup

The dry-run manifest is an inspectable protected file; it identifies the active marker, store and region, relational table counts and database snapshot digest, and each Blob key/state/SHA-256/size. Stdout has only the private manifest path/hash and safe status. Confirm the exact manifest ID before writing the private export. The artifact contains relational records and object bytes and must remain protected; share it only through an approved private channel.

```powershell
netlify dev:exec npm run ops:backup -- --target local --dry-run
netlify dev:exec npm run ops:backup -- --target local --confirm <exact-fresh-manifest-id> --operation-id <uuid>
```

For hosted sources, use the authenticated CLI linked to the trusted site; explicit Blob region remains `us-east-2`. The CLI adapter checks site identity before Blob calls. It uses strongly consistent list/get and preserves private temporary files. No live hosted backup is claimed.

## Fresh local restore rehearsal

Restore only into a new, blank local Netlify Dev database and the marker-derived empty sandbox store. Never point restore at production or preview. The dry-run records target identity and exact source/object inventory; inspect its private manifest and confirm the exact ID. The operation ID and private credential file must be preserved to recover an ambiguous run. Restore refuses database drift, nonblank destinations, changed/missing objects, a reused source identity, or a nonempty destination store.

```powershell
netlify dev:exec npm run ops:restore -- --target local --backup <private-backup-path> --backup-sha256 <exact-sha256> --dry-run --operation-id <uuid>
netlify dev:exec npm run ops:restore -- --target local --backup <private-backup-path> --backup-sha256 <exact-sha256> --confirm <restore-manifest-id> --operation-id <same-uuid>
```

The rehearsal restores case/snapshot/report facts and verified evidence digests, rebinds the destination environment marker/store/region, issues fresh private credentials, and does not copy sessions or source password hashes. Authentication remains gated until every relational comparison and object read-back succeeds and restored sessions are absent. Replaying a completed operation compares current normalized relational facts with the snapshot originally restored; mutable account or case drift is a refusal, not a successful replay. Only password hashes and environment-specific marker/store/region bindings are normalized by design.

## Interrupted operations

- **Cleanup partial:** retain the tombstone and snapshot; run a new dry-run. Retry only eligible deletes, and require strong absence verification. A tombstone with a preview snapshot reference can be retried; frozen submitted evidence remains protected.
- **Preview initialization uncertain:** retain the operation ID and private credential file. Keep the login gate closed until read-back digest verification succeeds. Do not issue a different operation to bypass a missing file.
- **Reset commit acknowledgement uncertain:** retain the exact reset operation ID, private recovery credential file, and verified backup. The transaction ledger determines whether reset committed; do not start a new reset.
- **Restore interrupted:** keep the local gate closed and replay with the same operation ID, backup, and credential file. If any persisted facts differ from the recorded source snapshot, stop and preserve the evidence for investigation.
- **Checksum or migration failure:** do not edit/rewrite an applied SQL file or bypass the manifest. Resolve through ordered migration history before publication.

## Retention and environment lifecycle

Every whole-demo reset requires a fresh complete verified export that matches the exact active marker and current relational snapshot, including when the scope contains only drafts. Submitted demo examples additionally require an owner-supplied retention cutoff; no specific days/months value is documented. Draft-only resets require the backup but do not require an unrelated retention cutoff. Preview initialization binds to a trusted database branch lifecycle; fresh preview branches are initialized once. Do not claim that a replacement branch automatically preserves data from an earlier branch. Production records/evidence are expected to persist through redeploy, but that behavior still needs a live verification.

## Current evidence and open hosted gates

Local PGlite/PostgreSQL-compatible SQL, HTTP authentication/download, operator regressions, migration checksum validation, typecheck, tests, build, and browser fixture checks are the locally verifiable gates. This handover does not claim a current hosted URL, preview migration/seed, preview branch persistence, production smoke, restore against Netlify, production cold-start/redeploy, or account tier/usage reading. Record each only after it is observed on the actual site. The owner said cost, eligibility, and retention were checked but supplied no numeric retention cutoff or exact usage/tier evidence to preserve here.
