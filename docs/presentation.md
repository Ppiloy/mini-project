# Five-minute presentation

## Hosted walkthrough

Use the hosted HTTPS site only after the deployment is verified, and use separate browser profiles for the taxpayer and officer roles. If the hosted workflow has not been smoke-tested, present the local fixture fallback honestly as browser-only simulation; do not imply it reads the live queue or records.

1. Introduce the example as an educational foreign-tax-credit workflow and explain taxpayer versus reviewing officer.
2. Open the fictional Vietnam and China worked example, total **143,544.30**, and distinguish foreign income from the amount remitted to Thailand.
3. Calculate, show the country breakdown and explain that each country limit is applied before totals are combined.
4. Demonstrate one validation message, correct it, attach a sample document, and submit only in the tested hosted flow.
5. Switch to the officer's separate profile, open the assigned submitted case, and compare the unchanged result and printable report.
6. Close with the educational assumptions, the source arithmetic discrepancy, and the difference between hosted shared state and the local fallback.

Keep the sourced slide discrepancy visible: the source presentation stated **143,554.30**; independent recomputation gives **143,544.30**, a **10.00** difference. See `.scratch/ftc-implementation/reviews/arithmetic-reference.md`. Do not characterize the calculation as a legal conclusion, tax filing, or proof of treaty eligibility.

## Offline fixture fallback

Run `npm ci` and `npm run dev`, then open `http://localhost:5173/demo`. Select **ตัวอย่างเวียดนามและจีน · 143,544.30**, complete the guided fixture flow, save/calculate, and use the report link to print. The mode is intentionally labelled as browser-local simulation. It has no hosted queue, persistent shared database, or downloadable real evidence. For an already prepared static sample, use [the committed Thai draft report](../output/pdf/sample-thai-draft-report.pdf); preserve its exact draft label `ร่าง — ยังไม่ได้ส่ง`.

The preview-initialization document `server/fixtures/fictional-preview-evidence.pdf` is a separate one-page fictional PDF used for initialized preview downloads. It contains no real taxpayer or financial information. The fallback's simulated attachments remain names/statuses only.

## Speaking notes

- **Meaning:** foreign income and remittance are distinct facts. The example allocates attributable foreign tax and applies a bounded credit limitation.
- **Assumptions:** policy year and supported categories are narrow; unsupported facts stay visible rather than being silently treated as eligible.
- **Evidence:** a file's presence does not prove the underlying tax treatment; the prototype demonstrates storage and review workflow only.
- **Hosting:** Netlify serves the interface/Functions; PostgreSQL-compatible Database stores relational facts; Blobs stores evidence. Preview isolation and production recovery need observed hosted checks before being described as proven.
