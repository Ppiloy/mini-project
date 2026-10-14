# Choose supported calculation cases and explainable outputs

Labels: wayfinder:grilling
Type: grilling
Status: open
Parent: ../map.md
Blocked by: 01, 02

## Question

Which tax year, countries, income types, residency/remittance conditions, input method for Thai tax, exchange-rate policy, and rounding conventions will the prototype support? What happens when a case is unsupported, and which independently checked examples establish acceptance?

## Comments

- Baseline: [bounded calculation policy](../../../FTC-PROTOTYPE-PLAN.md#5-calculation-scope-and-design). Year 2568, same-year cases, Vietnam/China worksheet examples, salary and the demonstrated dividend subtype, supplied L, fixture/manual FX, visible treaty assumptions. Further coverage must not silently broaden this policy.
- Review update, 14 October 2026: define common-rate D/E/F input, actual-paid versus assumed-eligible tax, L confirmation bound to tax inputs, residence/date/null boundaries and numeric limits. Round the sum of unrounded country credits once and show a display reconciliation; the former sum-of-rounded-countries convention can exceed L by a satang. Record these as demo conventions and validate the independent fixtures before implementation. See [review findings](../plan-review.md).
