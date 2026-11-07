import { describe, expect, it } from "vitest";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "./confirmations.js";
import { apiSuccessSchemas } from "./contracts.js";
import { createCalculationSnapshot } from "./snapshot.js";
import { countryLimitBelowFixture, slideDiscrepancyFixture } from "../src/fixtures/domain.js";

describe("calculation response contracts", () => {
  it("accepts the full-precision VN/CN golden snapshot returned by the calculator", () => {
    const snapshot = createCalculationSnapshot({
      id: "vn-cn-golden-response",
      caseId: slideDiscrepancyFixture.draft.id!,
      revision: slideDiscrepancyFixture.draft.revision,
      kind: "preview",
      inputs: slideDiscrepancyFixture.draft,
      evidence: [],
      createdAt: "2026-11-02T00:00:00.000Z",
    });

    expect(snapshot.result.outcome).toBe("ready");
    expect(snapshot.result.allowableCredit).toBe("143544.30");
    expect(snapshot.result.countries.find(({ countryCode }) => countryCode === "VN")?.thaiTaxLimit)
      .toBe("121044.3037974683544303797468354430379747");
    expect(apiSuccessSchemas.snapshot.safeParse({ data: { snapshot }, requestId: "golden-snapshot" }).success).toBe(true);
  });

  it("accepts generated response decimals with leading fractional zeros and extended precision", () => {
    const draft = structuredClone(countryLimitBelowFixture.draft);
    draft.id = "small-limit-response";
    draft.domesticAssessableIncome = "999999999.99";
    draft.thaiTax.amountBeforeFtc = "0.01";
    const source = draft.sources[0]!;
    source.grossIncomeAmount = "999999999.99";
    source.actualForeignTaxPaid = "0.01";
    source.eligibleForeignTax = "0.01";
    source.remittedIncomeAmount = "0.02";
    source.remittance = { ...source.remittance!, transferTotalAmount: "0.02" };
    source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
    draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);

    const snapshot = createCalculationSnapshot({
      id: "small-limit-response-snapshot",
      caseId: draft.id,
      revision: draft.revision,
      kind: "preview",
      inputs: draft,
      evidence: [],
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    const limit = snapshot.result.countries[0]?.thaiTaxLimit;
    expect(snapshot.result.outcome).toBe("ready");
    expect(limit).toMatch(/^0\.0{12}1\d+$/);
    expect(limit!.split(".")[1]!.length).toBeGreaterThan(40);
    expect(apiSuccessSchemas.snapshot.safeParse({ data: { snapshot }, requestId: "small-limit-snapshot" }).success).toBe(true);

    const fullBound = structuredClone(snapshot);
    fullBound.result.countries[0]!.thaiTaxLimit = `0.${"0".repeat(40)}1${"2".repeat(39)}`;
    expect(apiSuccessSchemas.snapshot.safeParse({ data: { snapshot: fullBound }, requestId: "full-bound-snapshot" }).success).toBe(true);

    const tooLong = structuredClone(snapshot);
    tooLong.result.countries[0]!.thaiTaxLimit = `0.${"1".repeat(81)}`;
    expect(apiSuccessSchemas.snapshot.safeParse({ data: { snapshot: tooLong }, requestId: "too-long-snapshot" }).success).toBe(false);
  });
});
