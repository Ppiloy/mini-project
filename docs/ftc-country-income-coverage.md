# FTC country and income coverage

This change implements the country/income request supplied on 3 November 2026. It does not add the separate November product-review recommendations.

## Baseline and source basis

Before this change, `shared/policy.ts` allowed only Vietnam and China, salary under Section 40(1), and a dividend example under Section 40(4). `shared/labels.ts` offered US, SG, CN, VN and a generic other-country entry; `FormSteps.tsx` displayed the other Section 40 categories with unsupported labels. The contract, draft schema and database check constraint accepted only three legacy income identifiers. The calculator already used one source-allocation formula and independent country limits.

The country catalogue follows the [current RD DTA register](https://www.rd.go.th/english/766.html), checked on 3 November 2026 (register updated 19 October 2026), together with the [RD FTC manual](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf). There are 61 comprehensive income-tax treaty partners in scope. The register also contains a Saudi Arabia air-transport agreement; that narrow agreement does not make Saudi Arabia a personal-income FTC partner in this catalogue. Hong Kong and Taiwan retain their own jurisdiction identifiers.

Section 40 descriptions follow the [Revenue Code](https://www.rd.go.th/5937.html). Country selection establishes membership in the published treaty network, not entitlement for every payment. Taxpayers must check residence, the nature of income, taxing rights, treaty limitations and applicable amendments in the current treaty. No country-specific tax rates or arithmetic are inferred from the country selector.

The requested examples' ordinary-credit provisions were checked in the official RD texts: [United States, Article 25(2)](https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/usa_en_dta.pdf), [Singapore, Article 22(b)](https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/singapore_en_dta_v2.pdf), [China, Article 23(2)](https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/china_en_dta.pdf), [Vietnam, Article 23(3)(a)](https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/vietnam_en_dta.pdf), and [Cambodia, Article 23(2)](https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/cambodia_en_dta.pdf). These references support checking source-country tax and the Thai limit for the relevant income; they do not replace checking each payment's applicable income article, residence and treaty conditions. The catalogue links each partner's active treaty PDF and the registry for protocols/MLI updates.

## Calculation and compatibility

Each income entry retains its country, Section 40 category, D, E and F. The common worksheet computes G = (F/D) × E and H = F/D. It then totals the entries for each country: P = (N/K) × L and Q = min(O, P), with I = total F, K = I + J and total credit = sum of country Q. L remains a supplied amount from the prepared Thai tax calculation. Unused country limits cannot offset another country's excess foreign tax.

The manual permits income earned from 1 January 2024 onward to be remitted in the claim year, including a later year. Validation therefore checks the earned year/date, claim-year remittance and the 180-day residence test in the earned year rather than applying the old 2025-only/same-year restriction. Foreign penalties, surcharges and non-income taxes are excluded from the creditable tax input; treaty eligibility is considered before applying the common formula.

The expansion retains legacy income identifiers and saved subtype values. Its additive database constraint change does not rewrite existing records or calculation snapshots. New calculations use versioned policy metadata; historical snapshots retain their saved inputs, results and policy. The existing single-remittance-per-entry model, FX entry, evidence, submission and officer workflows continue unchanged.

## Verification boundaries

Tests use the previously agreed shared calculation/validation, taxpayer browser journey and authenticated HTTP API boundaries. Shared tests check the exact treaty-country catalogue, all Section 40 categories, RD scope and independent country arithmetic. Browser checks exercise the actual choices and saved displays. HTTP checks cover database persistence and snapshot read-back; they do not certify a taxpayer's legal entitlement or hosting configuration.

GPT-6-Luna at max reasoning implemented the domain and browser slices and independently checked the RD sources and specification. Root review corrected missing-subtype display, retained unknown-country labels in forms/reports/Excel, and obsolete unsupported-income flags. A valid category selection clears only that classification flag; its explanation and unrelated treaty-review flags remain. Historical snapshots are read without recalculation or rewriting.

The final release gate passes 186 tests in 20 files, TypeScript, ten ordered/checksummed migrations with a blank-database apply, and the production build. Existing browser assertions that required the old limited countries, categories or year were updated to the new specification; negative coverage retains pre-2024 and unknown-country/unclassified-income cases.

The complete browser reruns pass 109/109 default journeys and 11/11 authenticated real-backend journeys. The legacy report regression checks the downloaded Excel file as well as the displayed frozen country name. These are local regression checks of the requested coverage and existing behavior; they do not claim unrelated product-review recommendations were fixed.
