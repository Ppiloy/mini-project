import { describe, expect, it } from "vitest";
import { partialRemittanceFixture } from "../src/fixtures/domain.js";
import { EVIDENCE_LABELS } from "./labels.js";
import { classifySubmittedSnapshot } from "./review.js";
import { createCalculationSnapshot } from "./snapshot.js";

function submittedSnapshot(sourceUpdate: Partial<(typeof partialRemittanceFixture.draft.sources)[number]>) {
  const draft = structuredClone(partialRemittanceFixture.draft);
  draft.id = "review-e-source-case";
  draft.sources[0] = { ...draft.sources[0]!, ...sourceUpdate, id: "review-e-source" };
  const snapshot = createCalculationSnapshot({
    id: "review-e-source-snapshot",
    caseId: draft.id,
    revision: draft.revision,
    kind: "submitted",
    inputs: draft,
    evidence: [],
    createdAt: "2026-11-02T00:00:00.000Z",
  });
  // Model a saved snapshot whose cached E total is absent; classification uses frozen raw facts.
  snapshot.inputs.sources[0]!.eligibleForeignTaxThb = null;
  return snapshot;
}

describe("submitted review classification for E", () => {
  it("requires foreign-tax evidence for ordinary E when only actual tax is recorded", () => {
    const snapshot = submittedSnapshot({ eligibleForeignTax: null, eligibilityRationale: null });

    const point = classifySubmittedSnapshot(snapshot).find(({ code }) => code === "source.missing_evidence");

    expect(point?.reason).toContain(EVIDENCE_LABELS.foreign_tax);
    expect(classifySubmittedSnapshot(snapshot).some(({ code }) => code === "source.actual_tax_differs_from_used")).toBe(false);
  });

  it("preserves a meaningful legacy adjustment when the paid amount is absent", () => {
    const snapshot = submittedSnapshot({
      actualForeignTaxPaid: null,
      eligibleForeignTax: "3000.00",
      eligibilityRationale: "บันทึกแยกจากยอดภาษีที่ชำระจริง",
    });

    expect(classifySubmittedSnapshot(snapshot).some(({ code }) => code === "source.actual_tax_differs_from_used")).toBe(true);
  });

  it("requires tax evidence for a positive amount paid even when E is zero, while treating cache values as fallback only", () => {
    const adjustedToZero = submittedSnapshot({ actualForeignTaxPaid: "5000.00", eligibleForeignTax: "0.00" });
    const paidPoint = classifySubmittedSnapshot(adjustedToZero).find(({ code }) => code === "source.missing_evidence");
    expect(paidPoint?.reason).toContain(EVIDENCE_LABELS.foreign_tax);

    const rawZeroWithStaleCache = submittedSnapshot({ actualForeignTaxPaid: "0.00", eligibleForeignTax: "0.00" });
    rawZeroWithStaleCache.inputs.sources[0]!.eligibleForeignTaxThb = "5000.00";
    const zeroPoint = classifySubmittedSnapshot(rawZeroWithStaleCache).find(({ code }) => code === "source.missing_evidence");
    expect(zeroPoint?.reason).not.toContain(EVIDENCE_LABELS.foreign_tax);

    const legacyWithoutRawE = submittedSnapshot({ actualForeignTaxPaid: null, eligibleForeignTax: null });
    legacyWithoutRawE.inputs.sources[0]!.actualForeignTaxPaidThb = "5000.00";
    const legacyPoint = classifySubmittedSnapshot(legacyWithoutRawE).find(({ code }) => code === "source.missing_evidence");
    expect(legacyPoint?.reason).toContain(EVIDENCE_LABELS.foreign_tax);
  });
});

describe("submitted review classification for residence declarations", () => {
  it("adds one non-verifying review point per declared earned year, even when sources share the year", () => {
    const snapshot = submittedSnapshot({});
    snapshot.inputs.residenceYears = [
      { earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days" },
      { earnedTaxYear: 2025, mode: "declared", declaration: "at_least_180_days" },
      { earnedTaxYear: 2026, mode: "declared", declaration: "at_least_180_days" },
      { earnedTaxYear: 2027, mode: "periods", periods: [{ startDate: "2027-01-01", endDate: "2027-12-31" }] },
    ];

    const points = classifySubmittedSnapshot(snapshot).filter(({ code }) => code.startsWith("residence.declaration_unverified."));

    expect(points).toHaveLength(2);
    expect(points.map(({ code }) => code)).toEqual(["residence.declaration_unverified.2025", "residence.declaration_unverified.2026"]);
    expect(points.every((point) => point.category === "substantive" && point.sourceId === null && point.sourceIndex === null)).toBe(true);
    expect(points[0]?.reason).toContain("โดยไม่มีช่วงวันที่หรือจำนวนวันแน่นอน");
    expect(points[0]?.reason).toContain("ไม่ได้ตรวจสอบข้อเท็จจริงหรือวินิจฉัยสิทธิ FTC หรือ DTA");
  });
});
