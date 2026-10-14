import { describe, expect, it } from "vitest";
import { calculateFTC } from "./calculator.js";
import { policyReference, DEMO_POLICY } from "./policy.js";
import { slideDiscrepancyFixture } from "../src/fixtures/domain.js";

describe("FTC policy provenance", () => {
  it("prevents nested policy mutation from changing results under the same version", () => {
    const before = calculateFTC(slideDiscrepancyFixture.draft);
    const attemptMutation = (mutate: () => void, isFrozen: boolean, restore?: () => void) => {
      let rejected = false;
      try { mutate(); } catch { rejected = true; }
      if (!isFrozen) restore?.();
      expect(rejected).toBe(true);
    };

    const assumptions = DEMO_POLICY.assumptions as string[];
    attemptMutation(() => assumptions.push("runtime mutation"), Object.isFrozen(assumptions), () => assumptions.pop());
    const urls = DEMO_POLICY.sourceUrls as string[];
    const originalUrl = urls[0]!;
    attemptMutation(() => { urls[0] = "https://example.invalid/altered"; }, Object.isFrozen(urls), () => { urls[0] = originalUrl; });
    const salaryTypes = DEMO_POLICY.supportedIncomeTypes.salary_40_1 as string[];
    attemptMutation(() => salaryTypes.push("unreviewed type"), Object.isFrozen(salaryTypes), () => salaryTypes.pop());
    const references = DEMO_POLICY.approvedFxReferences as unknown as Array<{ reference: { thbRate: string | null }; remittanceDate: string }>;
    attemptMutation(() => references.push({ reference: { thbRate: "1" }, remittanceDate: "2025-01-01" }), Object.isFrozen(references), () => references.pop());
    const reference = DEMO_POLICY.approvedFxReferences[0]!.reference as { thbRate: string | null };
    const originalRate = reference.thbRate;
    attemptMutation(() => { reference.thbRate = "1"; }, Object.isFrozen(reference), () => { reference.thbRate = originalRate; });

    const after = calculateFTC(slideDiscrepancyFixture.draft);
    expect(after.policyVersion).toBe(before.policyVersion);
    expect(after.assumptions).toEqual(before.assumptions);
    expect(after.allowableCredit).toBe(before.allowableCredit);
  });

  it("returns mutable snapshot DTO copies without exposing mutable policy arrays", () => {
    const snapshotPolicy = policyReference();
    expect(Object.isFrozen(snapshotPolicy.sourceUrls)).toBe(false);
    expect(Object.isFrozen(snapshotPolicy.assumptions)).toBe(false);
    snapshotPolicy.sourceUrls.push("https://example.invalid/snapshot-only");
    snapshotPolicy.assumptions.push("snapshot-only note");
    expect(DEMO_POLICY.sourceUrls).not.toContain("https://example.invalid/snapshot-only");
    expect(DEMO_POLICY.assumptions).not.toContain("snapshot-only note");
  });
});
