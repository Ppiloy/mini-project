# Source review and requirements traceability

Reviewed: 13 October 2026. The complete 21-page deck was text-extracted; the ER diagram and all seven UI slides were also inspected visually, with larger renders for the input, calculation, and officer-review screens.

Source: [Group 5 FTC slides](<C:/Users/Decha/Downloads/88AE9EDF808A10177F500273A30C17D5F94601B7_กลุ่ม 5_เครื่องมือช่วยคำนวณเครดิตภาษีสำหรับผู้มีเงินได้จากต่างประเทศ Slide_Final.pdf>).

## What the slides establish

| PDF pages | Project evidence | Planning implication |
|---|---|---|
| 2-3 | Help individuals with foreign income calculate FTC and prepare information; support Revenue Department reviewers | Two user roles in one application; explain the result as well as displaying it |
| 4-5 | Central database, proportional calculation, FX reference, dashboards, documents, validation, Draft/Submitted states, history | Netlify Database serves the prototype accounts, with Blob evidence and reproducible snapshots |
| 6-7 | Ten functional requirements including e-Filing login, identity, FX, DTA, calculation, reporting, review, alerts, export | Keep a traceable distinction between implemented demo behavior and simulated external integration |
| 8-9 | Access control, accuracy, auditability, availability, performance, maintainability, changing rules | Check ownership and reviewer permissions, freeze submitted results, version reference data, and define failure states |
| 10-11 | Taxpayer, officer, e-Filing, FX and DTA interactions; BOT/RD named as reference sources | External interfaces need adapters; no API contract or credentials are supplied |
| 12-13 | Relational data model with taxpayers, cases, income, rates, rules, calculations, attachments, officers and reports | Preserve relational relationships but correct types and cardinalities before implementation |
| 14-17 | Taxpayer login, dashboard, long input form, calculation preview | Preserve these capabilities; a guided form is a usability improvement to evaluate |
| 18-20 | Officer login, worklist, read-only case review and access-history display | Officer role inspects submitted snapshots; approval/rejection is not specified |

## Functional coverage proposed for the working demo

| PDF requirement | Prototype treatment | External/production boundary |
|---|---|---|
| 1. e-Filing identity | Seeded application users, Function password verification and PostgreSQL-backed sessions | Real e-Filing sign-in remains outside the prototype; never ask for government passwords |
| 2. Taxpayer storage | Minimal fictional profile linked to authenticated identity | No need for real 13-digit tax IDs in project data |
| 3. Validation | Field rules plus case-level eligibility and completeness checks | Unknown legal classifications remain unsupported, not guessed |
| 4. FX conversion | Versioned historical fixtures/manual references with provenance and deterministic conversion | Live government/FX APIs remain outside the hosted demonstration |
| 5. DTA processing | Small reviewed country/income rule set with source links and effective dates | A treaty country list is not a complete treaty rule engine |
| 6. FTC calculation | Decimal arithmetic, traceable steps, immutable saved result | Support only explicitly checked scenarios |
| 7. Summary | Taxpayer result and officer view use the same saved calculation | Summary is a demo calculation record |
| 8. Officer review | Read-only submitted cases and document inspection | No invented approval/rejection workflow |
| 9. Notifications | Inline completeness errors, saved/submitted feedback, status badges | Email/SMS are unnecessary for the demonstration |
| 10. Export | A print-friendly report that the browser can save as PDF | No claim that it is an official filing document |

## Problems to correct before translating the slides into code

1. **The example arithmetic is inconsistent.** Page 17 displays `K=1,975,000`, `L=318,750`, country income `N=750,000` and `225,000`, and foreign tax `O=225,000` and `22,500`. Its stated formula `P=(N/K)*L` gives limits of `121,044.303797...` and `36,313.291139...`. Taking the lesser tax/limit in each country gives `143,544.303797...`, displayed as **143,544.30 THB** when rounded to two decimals. The prominent slide total is **143,554.30 THB**. Reproducing arithmetic does not validate the legal eligibility or every input.
2. **Foreign income and remittances are conflated.** The narrative mentions proportional remittances, while the UI mostly asks for already converted THB amounts. The model needs earned amount/date and remitted amount/date, the attributable foreign tax, and the relation between them.
3. **`DomesticTax_L` is ambiguous.** The screen says tax payable in Thailand; the database field could be read as tax on domestic income alone. The official worksheet must define this input and denominator before coding it.
4. **`ImportDate` is typed as decimal.** Model a business date using PostgreSQL DATE and ISO API values; distinguish an income-earned date, remittance date, FX effective date, and tax payment date where required.
5. **One calculation per case cannot preserve repeated calculations.** Use one case with multiple calculation snapshots and an explicit submitted snapshot.
6. **One FX/rule pointer on the calculation header cannot represent all income lines.** Store references and consumed values on result lines or within a complete immutable snapshot.
7. **`MaxCreditRate` alone cannot encode treaty treatment.** Eligibility, income subtype, article, conditions, effective dates, and relief method may matter. Keep unsupported cases explicit.
8. **A country summary can hide line-level differences.** Keep income-type detail and treaty treatment before applying the verified final aggregation rules.
9. **Government identity and app login are different designs.** The hosted prototype uses separate application credentials with salted hashes and PostgreSQL sessions. The taxpayer profile contains no government password; actual e-Filing identity remains simulated.
10. **A report record is not an audit log.** Calculation runs, status changes, document access, and officer review need distinct event records. Reports should be generated from a named calculation snapshot.
11. **Mandatory officer/report relationships are premature for drafts.** A draft may have no calculation, no submission, no reviewer, and no report.
12. **Submitted is not defined as an official filing.** For the prototype it should mean placement in the app's review queue, visibly described in those terms.
13. **Current and historical rules must not overwrite history.** A saved result needs the exact rules, FX inputs, rounding policy, and engine version used at the time.

## Source boundaries

The PDF supplies useful requirements and visual concepts, but no executable source, approved API contracts, calculation test suite, complete treaty logic, rate-selection specification, deployment target, or implementation schedule. Research findings and planning recommendations are linked separately in the [decision map](map.md).
