# Establish the tax-rule evidence and calculation limits

Labels: wayfinder:research
Type: research
Status: resolved
Assignee: tax-research agent
Parent: ../map.md
Blocked by: none

## Question

Which official Thai Revenue Department and Bank of Thailand sources define the foreign-income FTC workflow, eligibility, calculation inputs, country/income grouping, exchange-rate handling, and treaty coverage? What does the slide deck leave ambiguous, and which statements cannot yet support a real-use calculator?

## Comments

- Research context: pages 16-17 use foreign income 975,000 THB, domestic income J=1,000,000 THB, K=1,975,000 THB, tax L=318,750 THB; country rows Vietnam 750,000/225,000 tax and China 225,000/22,500 tax; final displayed FTC=143,554.30 THB. Do not assume these labels or results establish the legal formula. High-resolution images confirm Vietnam (เวียดนาม).
- Save findings at `../research/tax-rules.md`. Local research replaces the skill's branch workflow because no Git repository/remote exists.

## Answer

Research completed against official RD and BOT sources on 13 October 2026: [tax-rule findings and references](../research/tax-rules.md). The documented worksheet keeps country/type inputs and a country-level limitation summary. It supports a frozen 2568 educational example with supplied Thai tax and explicit eligibility assumptions, not a comprehensive treaty engine. Independent arithmetic produces 143,544.30 THB for the displayed slide formula; source examples contain inconsistent totals. Historical FX is available, but live authenticated integration was not tested. Broader treaty treatment, full return-field mapping and legal rounding remain unresolved outside the chosen demo claims.
