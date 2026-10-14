# Shared response validation and support/report detail

Type: task
Status: claimed
Blocked by: 04, 07, 09

Independent preliminary spec audit at integration `9d30f15` reproduced three plan gaps: unchecked successful case DTOs can crash the dashboard; structured API request IDs are omitted from visible errors; frozen manual FX URL/educational assumption is omitted from reports. Review evidence is external `ftc-preliminary-spec-audit.md`.

Complete the plan's shared request/response schema contract for hosted success DTOs (auth, case/draft/detail, attachment, calculation/submission, officer, snapshot), reusing domain schemas and preserving decimal strings/nulls/current fields. Validate at the HTTP client boundary, with structured recoverable malformed-response errors instead of private-page crashes; use shared schemas on server response boundaries as appropriate so actual responses satisfy the contract. Keep binary evidence a separate typed response path.

Show a useful API request ID in failure alerts and display a release/policy identifier, including entry/failure screens. Preserve field errors, logout recovery and saved/unsaved state. Render frozen per-source FX provenance URL and manual educational assumption in printable reports.

Use agreed TDD public HTTP/client/browser/report seams for malformed case/snapshot success, useful request ID, valid real API DTO compatibility and frozen manual provenance. Verify browser journeys/typecheck/integration tests/build; independent adversarial review of each clean completed candidate before merger integration. No cloud mutations.
