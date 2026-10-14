# Thai foreign tax credit prototype: rule evidence and boundaries

Research date: **2026-10-13** (Asia/Bangkok). Purpose: planning a Thai-language class/project prototype with sample data. This is a bounded research pass, not certification of a filing calculator. All web references below were retrieved on this date. No live tax submission or authenticated BOT API call was made.

Review addendum, **2026-10-14**: rechecked the manual's D/F conversion basis and China partial-remittance row. The [main plan](../../../FTC-PROTOTYPE-PLAN.md#5-calculation-scope-and-design) now narrows currency input to prepared THB or one common currency/rate, binds L confirmation to tax inputs, and explicitly separates actual paid tax from assumed eligible E. Its revised demo rounding rounds the unrounded total once, with a display reconciliation when rounded country rows differ. These engineering conventions supersede the less specific recommendations below; they are not additional legal findings.

## Recommendation

Build an explainable **2568/2025 ordinary FTC demonstration** with two layers: income/remittance records, then a country summary. Accept a supplied Thai tax amount L rather than building a complete personal income tax return engine. Preserve the slide example as a source fixture with an arithmetic discrepancy note. Calculate its mathematical output as **143,544.30 THB**, not the printed 143,554.30 THB. Label this a formula demonstration; its treaty treatment has not been legally validated.

Use manual, source-labelled historical exchange rates in the first version. A live BOT integration is technically plausible but remains outside the bounded demonstration even with the latest Netlify hosting choice; the integration findings below are background feasibility evidence.

## Verified source findings

### 1. Eligibility timing

The consolidated P.161/2566 says qualifying foreign-source assessable income is included in the year it is brought into Thailand, even when earned in an earlier year; the instruction applies to remittances from 1 January 2024. P.162/2566 excludes income arising before 1 January 2024 from that new instruction. This is not a general claim that every pre-2024 transaction under every historical scenario is exempt. [P.161/2566](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn161A.pdf), [P.162/2566](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn162A.pdf).

RD's Q&A uses **at least 180 days in the income year**, distinguishes returned principal from income, and describes gains as the excess over investment cost. Money movement alone therefore does not establish assessable income. Income earned while nonresident is materially different from income earned while resident. [RD Q&A, questions concerning residence, principal, capital gains and accumulated savings](https://www.rd.go.th/fileadmin/user_upload/lorkhor/newsbanner/2024/1/QnA161-162-1.pdf).

**Design decision:** ask residence days separately for each earned year; do not ask only for current-year residence. Require earned year, remittance date/year, source country, and an assessable-income amount. A 179/180-day boundary must be explicit. Treat capital tracing, mixed investment accounts, special exemptions, and dual-residence disputes as unsupported scenarios in this prototype.

### 2. Calculation specification from RD's manual

RD's November 2568 manual specifies country-and-income-type entry rows, then **country-level N/O/P/Q aggregation**. Its input definitions and formulas are:

| Symbol | Meaning / operation |
|---|---|
| D | Total foreign income, in THB |
| E | Foreign income tax allocated to that income type |
| F | Assessable income remitted in the selected year, in THB |
| G | `(F / D) × E` |
| H | `100 × F / D` |
| I | Sum of F |
| J | Domestic assessable income before expenses and allowances |
| K | `I + J`, gross assessable income |
| L | Thai tax calculated after expenses/allowances; supplied from the return |
| N, O | Country sums of F and G |
| P | `(N / K) × L` |
| Q | `min(O, P)` per country |

The manual covers ordinary credit, requires DTA-specific review, excludes penalties, and does not permit unused excess credit carryforward. It allows commercial-bank buying rates on remittance day or BOT average buying rates from the preceding business day. [RD manual, printed pp. 4–14](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf).

**Interpretation requiring care:** the prose says to distinguish each country and income type, while the worked summary aggregates countries. Retain all type-level detail; use the displayed country-summary algorithm for the bounded demo. Do not silently implement a global pooled cap, or change to a per-type cap while claiming exact reproduction. Obtain tax reviewer confirmation before treating this as a universal legal rule.

**L input decision:** label it as computed Thai tax before this foreign credit. Do not call it final tax due after withholding. The bounded demo should use a known supplied L and show its provenance. Exact field mapping for all return types, minimum-tax interactions, special rates, and other credits needs separate validation.

### 3. DTA presence is not the same as a universal rate

The RD treaty register includes treaty texts, protocols, and MLI status and was shown as updated 6 July 2026. A static country count is a poor product rule. [RD treaty register](https://www.rd.go.th/765.html).

The Vietnam treaty text, Article 10, states a 15% gross-dividend ceiling in the stated beneficial-owner scenario, with exceptions for effectively connected holdings. This gives a concrete reason not to accept every foreign-tax amount as treaty-creditable merely because the country has a treaty. [Vietnam treaty Article 10](https://www.rd.go.th/2607.html).

The RD-hosted China Article 10 text has different conditions, including references to a recipient company and shareholding levels. It does not support blindly applying a universal 10% treaty dividend cap to every individual. Protocol/MLI applicability and the current consolidated treaty position were not resolved in this bounded pass. [China treaty Articles 6–10](https://www.rd.go.th/english/2526.html).

**Design decision:** a country selector should have three statuses: supported demo case, unsupported case, or needs review. An income row should keep both `foreignTaxPaid` and an optional `treatyEligibleTax` with source/rationale, rather than overwriting actual tax paid. For the initial formula demonstration, supply an explicit assumption that tax inputs are eligible; do not present that assumption as an automated treaty determination. Build only a small reviewed country/income fixture set, not a claimed complete treaty engine.

### 4. Return and evidence context

RD's 2568 forms page distinguishes PND90 for general income from PND91 for employment-only income and provides a foreign-income attachment. This supports an eventual document checklist and a result intended for comparison with return inputs. It does not establish a public submission API. [RD 2568 forms](https://www.rd.go.th/67335.html).

**Design decision:** a printable calculation report is enough for this project. Do not mimic an accepted e-filing receipt. Keep example taxpayer names synthetic. Evidence can be represented by labels/checklist state instead of uploading tax documents.

## Arithmetic audit of the slide fixture

These calculations are independent arithmetic using the numbers supplied by the parent agent's inspection of the user's slide PDF. They do not validate residency, source rules, treaty entitlements, or actual tax paid.

| Country / type | F: remitted income | G: tax attributable to remittance |
|---|---:|---:|
| Vietnam 40(1) | 500,000.00 | 150,000.00 |
| Vietnam 40(4) | 250,000.00 | 75,000.00 |
| China 40(1) | 200,000.00 | 20,000.00 |
| China 40(4) | 25,000.00 | 2,500.00 |
| Total | 975,000.00 | 247,500.00 |

With `J = 1,000,000`, `K = 1,975,000`, and `L = 318,750`:

```text
Vietnam cap = 750000 / 1975000 × 318750
            = 121044.30379746835443037974684
Vietnam credit = min(225000, cap) = 121044.303797...

China cap   = 225000 / 1975000 × 318750
            = 36313.291139240506329113924038
China credit = min(22500, cap) = 22500

Total credit = 143544.30379746835443037974684
Displayed to 2 decimals = 143544.30
```

PowerShell `.NET Decimal` arithmetic was used, not binary floating-point. The printed 143,554.30 is 10.00 THB above the two-decimal recomputation, so normal cent rounding cannot explain it.

The official manual's example also prints Vietnam 121,004.30 and total 143,554.30 (printed pp. 23–24). Those printed terms sum to 143,504.30. The source therefore contains inconsistent arithmetic. [RD manual worked example](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf#page=26).

**Fixture implementation recommendation:** store `sourcePrintedTotal`, `recomputedTotal`, and a plain-language `sourceDiscrepancy` note. Never add a 10 THB adjustment to make the app agree with the slide. Keep this fixture specifically as a regression test against copying a source typo.

Preserve China's dividend as a partial-remittance example: original foreign income D=50,000, tax E=5,000, remitted F=25,000, proportional tax G=2,500. Do not replace original D/E with F/G and lose the 50% lesson. On 14 October 2026, D/E were verified directly against the RD manual's row on printed p. 21; label this supporting detail as manual-derived rather than assuming the simplified slide contains every original amount. [RD manual](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_TH.pdf#page=24).

The Vietnam dividend's sample tax allocation is 75,000/250,000 = 30%, which raises a treaty-review question against the cited Article 10's stated 15% case. This does not justify silently rewriting the example: its assumed facts and allocation must be reviewed. It is another reason to describe the fixture as mathematical only.

## Historical FX and BOT API feasibility

BOT's official exchange-rate page provides historical series and daily Excel downloads. Thus live network access is unnecessary for a reproducible presentation: a small, attributed historical fixture can supply the demonstration. [BOT exchange rates](https://www.bot.or.th/th/statistics/exchange-rate.html).

The current API portal says the newer service began on 17 September 2025 and uses `portal.api.bot.or.th`, `gateway.api.bot.or.th`, and an `Authorization` header. The exchange-rate documentation identifies an API key, the base `https://gateway.api.bot.or.th/Stat-ExchangeRate/v2`, and daily/monthly/quarterly/annual routes. [BOT portal](https://portal.api.bot.or.th/), [current exchange-rate API documentation](https://portal.api.bot.or.th/portal/catalogue-products/exchange-rates-1/0e644d4d76de4108537e1f95cf83330e/docs).

The older first-party documentation specifies `start_period`, `end_period`, and optional `currency`, and describes publication each business day at 18:00 Bangkok time. Its hostname and `X-IBM-Client-Id` header are legacy; do not copy them into a new integration without reconciling the current docs. [Legacy BOT daily-rate API documentation](https://apiportal.bot.or.th/bot/public/node/18272).

**Unverified integration details:** subscription approval, rate limits, CORS, exact current response schema, currency coverage (especially VND), holiday/missing-rate behavior, units per currency, and precise mapping of a tax-approved buying rate to the API's rate field. These are feasibility checks, not solved requirements.

**Proposed adapter contract:** `getHistoricalRate(currency, remittanceDate, ratePolicy)` returns amount, base units, rate date, source URL, rate type, retrieval time, and whether manual. The UI should display all material provenance. A missing rate must not fall back to today's rate. If a key is required, keep it behind a server-side function; never ship the key in a public frontend bundle.

For v1, accept a manually entered positive THB-per-unit rate, a rate date, and source text, and keep the original foreign amount. Display the derived THB amount alongside it. Offer a preloaded historical sample. These are engineering recommendations, not a conclusion that every manually chosen rate is tax-compliant.

## Bounded prototype policy

Recommended explicit policy record:

```text
ruleSetId: rd-ftc-demo-2568-v1
filingYear: 2568
mode: educational-formula-demonstration
incomeYears: 2568 (same-year demo only)
incomeTypes: 40(1), the demonstrated dividend subtype of 40(4)
aggregation: entry by country/type; cap summary by country
thaiTaxL: supplied, with provenance
fx: manual historical / fixed sample
rounding: decimal arithmetic; round unrounded total to 2 decimals; reconcile displayed country rows
treatyValidation: assumptions shown; unsupported facts require review
sourceReviewedOn: 2026-10-13
```

Do not interpret the `incomeYears` choice as a legal expiry of rules: it is a deliberate project scope. Keep pre-2024 data, cross-year income/remittance, multiple-remittance cumulative tracking, nonresident-earned income, unsupported types, and no-DTA cases in a review/explanation path rather than letting them flow through an unsupported normal calculation. The cited cross-year rule remains educational context, while v1 supports only same-year amounts and one partial-remittance fixture.

The result should expose the chain from input row to G/H, then N/O, then P/Q, and explain which number limits credit. A scenario without a DTA should distinguish lack of credit from lack of taxable income. A zero-tax case should explain zero capacity. Avoid presenting zero as evidence that no return is required.

## Meaningful acceptance cases

| Case | Expected prototype behavior |
|---|---|
| Slide fixture | Recomputes 143,544.30; identifies 143,554.30 discrepancy |
| China dividend partial remittance | D=50,000/E=5,000/F=25,000 gives G=2,500 and H=50% |
| Foreign tax below Thai cap | Q equals O |
| Foreign tax above Thai cap | Q equals P |
| Two countries | Separate caps; no cross-country excess-credit pooling |
| Two income types in a country | Type rows preserved; country summary reconciles to their sums |
| Exactly 180 residence days | Qualifies for the demo's resident-year branch; 179 does not |
| Income in 2566, remitted 2568 | Outside the post-2024 demonstration path with reason |
| Income in 2567, remitted 2568 | Explain income-year residence/remittance-year rule, but route outside the same-year v1 calculation |
| No remittance | No remitted income/credit contribution |
| Returned principal | Does not get auto-labelled assessable income |
| No DTA / unknown country | No automatic credit entitlement; distinguish taxable income review |
| L=0 | Credit capacity0; no divide-by-zero or negative credit |
| K=0 or D=0 | Explicit zero/no-income path or validation error, never NaN |
| F>D, negative tax, invalid date | Reject inconsistent inputs with field explanation |
| Historical rate missing | Request manual source-labelled rate; never use current rate silently |
| Currency quoted per100 units | Conversion uses declared units, not assumed per1 |
| Export | All source amounts, derived amounts, assumptions, rule version and rounding reconcile |

These are proposed acceptance tests. No app has been implemented or tested during this research.

## Questions remaining before broader real-use claims

1. Whether country-level aggregation exactly covers every relevant treaty and type interaction; preserve fine-grained records while resolving.
2. Exact return-field mapping for L, including minimum tax, special rates, withholding and other credits.
3. Which foreign taxes qualify under each treaty and how overwithholding/refunds must be handled.
4. Evidence and FX treatment across several remittances and years, including already-used credits and gross-versus-net remittance facts.
5. Complete current treaty/protocol/MLI state for any country added to supported coverage.
6. A confirmed legal rounding policy. Display-only two-decimal rounding is a demo decision.
7. Whether any 2026 law changes affect future filing years. This pass verified the cited sources and supports a frozen2568 prototype; it did not certify the complete current law corpus.

These questions do not prevent the agreed educational prototype; they constrain its supported scenarios and wording.
