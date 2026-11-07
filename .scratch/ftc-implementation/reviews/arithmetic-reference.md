# Independent arithmetic reference

Prepared by the root reviewer from the literal amounts in the plan and fictional fixtures, without calling `calculateFTC`. These checks establish mathematical expectations under supplied E and L assumptions; they do not establish treaty eligibility or the correctness of the supplied Thai tax.

## Source-slide example

All four rows are fully remitted, so G = E for each row. Vietnam has N = 500,000 + 250,000 = 750,000 and O = 150,000 + 75,000 = 225,000. China has N = 200,000 + 25,000 = 225,000 and O = 20,000 + 2,500 = 22,500. J = 1,000,000, therefore K = 1,975,000; supplied L = 318,750.

Vietnam's limit is `(750,000 / 1,975,000) × 318,750 = 9,562,500 / 79 = 121,044.303797…`. This is below O, so Q is that limit. China's limit is `(225,000 / 1,975,000) × 318,750 = 2,868,750 / 79 = 36,313.291139…`; O is smaller, so Q = 22,500.

The unrounded combined credit is `9,562,500 / 79 + 22,500 = 11,340,000 / 79 = 143,544.303797…`. Half-up rounding once to two decimal places gives **143,544.30**. The source-slide printed **143,554.30** is higher by **10.00**; no adjustment belongs in the calculation.

## Other literal acceptance checks

| Scenario | Independent working | Expected |
|---|---|---|
| Partial remittance | `(25,000 / 50,000) × 5,000` | G = 2,500; share = 50% |
| Country cap, foreign tax below | `(100,000 / 200,000) × 20,000 = 10,000`; min(5,000, 10,000) | Q = 5,000 |
| Country cap, foreign tax above | Same limit; min(15,000, 10,000) | Q = 10,000 |
| Two countries, same 10,000 cap | First O = 5,000, second O = 15,000; sum min for each country | 15,000, without pooling unused capacity |
| Two half-satang country credits | Each `(1 / 2) × 0.01 = 0.005`; unrounded sum = 0.01 | Final 0.01; displayed 0.01 + 0.01 requires −0.01 reconciliation |
| Synthetic quote per 100 units | Rate = 3,500 THB/100 USD; D = F = 100 USD, E = 30 USD | D/F = 3,500 THB; E = 1,050 THB; share = 100% |
| Quote fixture's supplied L = 100, J = 0 | N = K = 3,500; P = 100; min(1,050, 100) | Q = 100 |
| Supplied L = 0 | Every country limit = 0 | Q = 0, with supported-case explanation |
| Positive D, F = 0 | G = 0 and remitted contribution = 0 | Zero contribution; an all-zero-remittance case stays draft |
| D = 0 | F/D is undefined | Validation failure, never a numeric credit |

API/browser and hosted acceptance must compare the stored snapshot/report to these expectations. Reusing the application engine for both actual and expected values is not independent evidence.
