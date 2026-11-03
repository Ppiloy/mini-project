import { describe, expect, it } from "vitest";
import { calculateFTC } from "./calculator.js";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "./confirmations.js";
import { partialRemittanceFixture } from "../src/fixtures/domain.js";
import { createEmptyDraft, draftSchema } from "./draft.js";
import { withCanonicalThbAmounts } from "./calculator.js";
import { createCalculationSnapshot } from "./snapshot.js";
import { calculateResidenceDaysInYear, deriveResidenceDaysForDraft, validateResidencePeriods } from "./residence.js";

describe("residence period day counts", () => {
  it("accepts an explicit unverified at-least-180 declaration without inventing an exact day count", () => {
    const source = { ...structuredClone(partialRemittanceFixture.draft.sources[0]!), residenceDaysInEarnedYear: null };
    source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
    const draft = {
      ...structuredClone(partialRemittanceFixture.draft),
      residenceYears: [{ earnedTaxYear: 2025, mode: "declared" as const, declaration: "at_least_180_days" as const }],
      sources: [source],
    };
    draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);

    const result = calculateFTC(draft);

    expect(result.outcome).toBe("ready");
    expect(result.allowableCredit).toBe("2500.00");
    expect(withCanonicalThbAmounts(draft).sources[0]?.residenceDaysInEarnedYear).toBeNull();
  });

  it("requires Thai tax confirmation again when a per-year residence record changes", () => {
    const source = { ...structuredClone(partialRemittanceFixture.draft.sources[0]!), residenceDaysInEarnedYear: null };
    const draft = {
      ...structuredClone(partialRemittanceFixture.draft),
      residenceYears: [{ earnedTaxYear: 2025, mode: "periods" as const, periods: [{ startDate: "2025-01-01", endDate: "2025-06-29" }] }],
      sources: [source],
    };
    const canonical = deriveResidenceDaysForDraft(draft);
    canonical.sources[0]!.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(canonical.sources[0]!);
    const confirmed = canonical;
    confirmed.thaiTax.confirmedInputFingerprint = taxInputFingerprint(confirmed);
    const initial = calculateFTC(confirmed);
    expect(initial.outcome, JSON.stringify(initial.validationMessages)).toBe("ready");

    const residence = confirmed.residenceYears?.[0];
    if (residence?.mode !== "periods") throw new Error("Expected entered residence periods.");
    residence.periods[0]!.startDate = "2025-01-02";
    residence.periods[0]!.endDate = "2025-06-30";

    const changed = calculateFTC(confirmed);
    expect(changed.outcome).toBe("needs_review");
    expect(changed.validationMessages.map(({ code }) => code)).toContain("confirmation.thai_tax_stale");
  });

  it("requires residence facts only for income-earned years, not an independently inferred return year", () => {
    const source = { ...structuredClone(partialRemittanceFixture.draft.sources[0]!), earnedTaxYear: 2024, earnedDate: "2024-10-15" };
    source.eligibilityConfirmedInputFingerprint = sourceEligibilityFingerprint(source);
    const draft = {
      ...structuredClone(partialRemittanceFixture.draft),
      residenceYears: [{ earnedTaxYear: 2024, mode: "declared" as const, declaration: "at_least_180_days" as const }],
      sources: [source],
    };
    draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);

    const result = calculateFTC(draft);

    expect(result.validationMessages.map(({ code, path }) => ({ code, path })))
      .not.toContainEqual({ code: "residence.year_record_required", path: ["residenceYears", 2025] });
  });

  it("does not treat an empty per-year period record as a completed zero-day count", () => {
    const draft = deriveResidenceDaysForDraft({
      ...structuredClone(partialRemittanceFixture.draft),
      residenceYears: [{ earnedTaxYear: 2025, mode: "periods" as const, periods: [] }],
      sources: partialRemittanceFixture.draft.sources.map((source) => ({ ...structuredClone(source), residenceDaysInEarnedYear: null })),
    });
    draft.sources = draft.sources.map((source) => ({ ...source, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) }));
    draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);

    const result = calculateFTC(draft);

    expect(result.outcome).toBe("incomplete");
    expect(result.validationMessages.map(({ code }) => code)).toContain("residence.period_required");
  });

  it("applies the 180-day calculation guard to explicit per-year periods at 179, 180, and 181 days", () => {
    for (const { endDate, expectedDays } of [
      { endDate: "2025-06-28", expectedDays: 179 },
      { endDate: "2025-06-29", expectedDays: 180 },
      { endDate: "2025-06-30", expectedDays: 181 },
    ]) {
      const draft = deriveResidenceDaysForDraft({
        ...structuredClone(partialRemittanceFixture.draft),
        residenceYears: [{ earnedTaxYear: 2025, mode: "periods" as const, periods: [{ startDate: "2025-01-01", endDate }] }],
        sources: partialRemittanceFixture.draft.sources.map((source) => ({ ...structuredClone(source), residenceDaysInEarnedYear: null })),
      });
      draft.sources = draft.sources.map((source) => ({ ...source, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) }));
      draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);

      const result = calculateFTC(draft);

      expect(draft.sources[0]?.residenceDaysInEarnedYear).toBe(expectedDays);
      if (expectedDays < 180) {
        expect(result.outcome).toBe("needs_review");
        expect(result.validationMessages.map(({ code }) => code)).toContain("residence.below_threshold");
      } else {
        expect(result.outcome).toBe("ready");
      }
    }
  });

  it("counts inclusive endpoints once across overlapping periods", () => {
    const periods = [
      { startDate: "2025-01-01", endDate: "2025-01-10" },
      { startDate: "2025-01-05", endDate: "2025-01-12" },
      { startDate: "2025-01-12", endDate: "2025-01-12" },
    ];

    expect(calculateResidenceDaysInYear(periods, 2025)).toBe(12);
  });

  it("clips a stay across December 31 into the year being counted", () => {
    const periods = [
      { startDate: "2024-12-31", endDate: "2025-01-02" },
      { startDate: "2025-12-31", endDate: "2026-01-01" },
    ];

    expect(calculateResidenceDaysInYear(periods, 2024)).toBe(1);
    expect(calculateResidenceDaysInYear(periods, 2025)).toBe(3);
    expect(calculateResidenceDaysInYear(periods, 2026)).toBe(1);
  });

  it("counts 366 days for a full leap year", () => {
    expect(calculateResidenceDaysInYear([
      { startDate: "2024-01-01", endDate: "2024-12-31" },
    ], 2024)).toBe(366);
  });

  it("reports incomplete, invalid, and reversed periods without silently counting them", () => {
    expect(validateResidencePeriods([
      { startDate: null, endDate: "2025-02-01" },
      { startDate: "2025-02-30", endDate: "2025-03-01" },
      { startDate: "2025-04-02", endDate: "2025-04-01" },
    ])).toEqual([
      { periodIndex: 0, field: "startDate", code: "required" },
      { periodIndex: 1, field: "startDate", code: "invalid_date" },
      { periodIndex: 2, field: "endDate", code: "reversed" },
    ]);
  });

  it("rejects invalid periods and invalid year values at the counting boundary", () => {
    expect(() => calculateResidenceDaysInYear([{ startDate: "2025-03-02", endDate: "2025-03-01" }], 2025)).toThrow();
    expect(() => calculateResidenceDaysInYear([], 2025.5)).toThrow();
  });

  it("keeps legacy drafts and incomplete period rows saveable but rejects invalid or reversed dates", () => {
    const legacy = createEmptyDraft();
    delete legacy.residencePeriods;
    expect(draftSchema.safeParse(legacy).success).toBe(true);
    expect(draftSchema.safeParse({ ...createEmptyDraft(), residencePeriods: [{ startDate: null, endDate: null }] }).success).toBe(true);
    expect(draftSchema.safeParse({ ...createEmptyDraft(), residencePeriods: [{ startDate: "2025-02-30", endDate: "2025-03-01" }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...createEmptyDraft(), residencePeriods: [{ startDate: "2025-04-02", endDate: "2025-04-01" }] }).success).toBe(false);
  });

  it("allows incomplete per-year date drafts but rejects duplicate years and mixed residence models", () => {
    const incomplete = { ...createEmptyDraft(), residenceYears: [{ earnedTaxYear: 2025, mode: "periods" as const, periods: [{ startDate: null, endDate: null }] }] };
    expect(draftSchema.safeParse(incomplete).success).toBe(true);
    expect(draftSchema.safeParse({ ...createEmptyDraft(), residenceYears: [
      { earnedTaxYear: 2025, mode: "periods", periods: [] },
      { earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days" },
    ] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...incomplete, residencePeriods: [] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...createEmptyDraft(), residenceYears: [
      { earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days", periods: [] },
    ] }).success).toBe(false);
  });

  it("keeps empty draft builders legacy-compatible and freezes derived totals into snapshot inputs", () => {
    expect(createEmptyDraft()).not.toHaveProperty("residencePeriods");
    const source = partialRemittanceFixture.draft.sources[0]!;
    const inputs = {
      ...structuredClone(partialRemittanceFixture.draft),
      residencePeriods: [{ startDate: "2025-01-01", endDate: "2025-06-29" }],
      sources: [{ ...source, residenceDaysInEarnedYear: 1 }],
    };
    const snapshot = createCalculationSnapshot({
      id: "residence-snapshot",
      caseId: inputs.id!,
      revision: inputs.revision,
      kind: "preview",
      inputs,
      evidence: [],
      createdAt: "2026-11-02T00:00:00.000Z",
    });

    expect(snapshot.inputs.residencePeriods).toEqual(inputs.residencePeriods);
    expect(snapshot.inputs.sources[0]?.residenceDaysInEarnedYear).toBe(180);
  });

  it("freezes declaration-only residence without assigning an exact count to a calculation snapshot", () => {
    const draft = deriveResidenceDaysForDraft({
      ...structuredClone(partialRemittanceFixture.draft),
      residenceYears: [{ earnedTaxYear: 2025, mode: "declared" as const, declaration: "at_least_180_days" as const }],
    });
    draft.sources = draft.sources.map((source) => ({ ...source, eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) }));
    draft.thaiTax.confirmedInputFingerprint = taxInputFingerprint(draft);
    const snapshot = createCalculationSnapshot({
      id: "declared-residence-snapshot",
      caseId: draft.id!,
      revision: draft.revision,
      kind: "preview",
      inputs: draft,
      evidence: [],
      createdAt: "2026-11-02T00:00:00.000Z",
    });

    expect(snapshot.result.outcome).toBe("ready");
    expect(snapshot.inputs.residenceYears).toEqual(draft.residenceYears);
    expect(snapshot.inputs.sources[0]?.residenceDaysInEarnedYear).toBeNull();
    expect(snapshot.result.assumptions.some((item) => item.includes("ยังไม่ผ่านการตรวจสอบ"))).toBe(true);
  });

  it("derives source totals from the earned year instead of a caller-supplied count", () => {
    const draft = {
      ...structuredClone(partialRemittanceFixture.draft),
      residencePeriods: [{ startDate: "2025-01-01", endDate: "2025-06-29" }],
      sources: partialRemittanceFixture.draft.sources.map((source) => ({ ...source, residenceDaysInEarnedYear: 1 })),
    };

    expect(deriveResidenceDaysForDraft(draft).sources[0]?.residenceDaysInEarnedYear).toBe(180);
  });

  it("uses period-derived 179/180/181 day totals for the separate 180-day example status", () => {
    const cases = [
      { endDate: "2025-06-28", expectedDays: 179, isBelowExampleThreshold: true },
      { endDate: "2025-06-29", expectedDays: 180, isBelowExampleThreshold: false },
      { endDate: "2025-06-30", expectedDays: 181, isBelowExampleThreshold: false },
    ];

    for (const { endDate, expectedDays, isBelowExampleThreshold } of cases) {
      const source = partialRemittanceFixture.draft.sources[0]!;
      const draft = {
        ...structuredClone(partialRemittanceFixture.draft),
        residencePeriods: [{ startDate: "2025-01-01", endDate }],
        sources: [{ ...source, residenceDaysInEarnedYear: 365 }],
      };
      const result = calculateFTC(draft);
      expect(result.validationMessages.some(({ code }) => code === "source.nonresident_earned_income")).toBe(isBelowExampleThreshold);
      expect(deriveResidenceDaysForDraft(draft).sources[0]?.residenceDaysInEarnedYear).toBe(expectedDays);
    }
  });

  it("blocks calculation for incomplete, invalid, and reversed period inputs", () => {
    const source = partialRemittanceFixture.draft.sources[0]!;
    const invalidPeriods = [
      [{ startDate: null, endDate: null }],
      [{ startDate: "2025-02-30", endDate: "2025-03-01" }],
      [{ startDate: "2025-04-02", endDate: "2025-04-01" }],
    ];
    for (const residencePeriods of invalidPeriods) {
      const result = calculateFTC({ ...structuredClone(partialRemittanceFixture.draft), residencePeriods, sources: [source] });
      expect(result.outcome).not.toBe("ready");
      expect(result.allowableCredit).toBeNull();
      expect(result.validationMessages.some(({ path }) => path?.[0] === "residencePeriods")).toBe(true);
    }
  });
});
