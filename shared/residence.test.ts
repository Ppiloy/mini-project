import { describe, expect, it } from "vitest";
import { calculateFTC } from "./calculator.js";
import { partialRemittanceFixture } from "../src/fixtures/domain.js";
import { createEmptyDraft, draftSchema } from "./draft.js";
import { createCalculationSnapshot } from "./snapshot.js";
import { calculateResidenceDaysInYear, deriveResidenceDaysForDraft, validateResidencePeriods } from "./residence.js";

describe("residence period day counts", () => {
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
