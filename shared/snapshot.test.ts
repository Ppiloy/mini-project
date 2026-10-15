import { describe, expect, it } from "vitest";
import { calculateFTC } from "./calculator.js";
import { partialRemittanceFixture, slideDiscrepancyFixture } from "../src/fixtures/domain.js";
import { createCalculationSnapshot } from "./snapshot.js";

describe("calculation snapshots", () => {
  it("copies the inputs, detailed result, evidence and policy used for an immutable preview", () => {
    const draft = structuredClone(partialRemittanceFixture.draft);
    const result = calculateFTC(draft);
    const snapshot = createCalculationSnapshot({
      id: "snapshot-1",
      caseId: "case-1",
      revision: draft.revision,
      kind: "preview",
      inputs: draft,
      evidence: [],
      createdAt: "2026-10-14T01:00:00.000Z",
    });

    draft.sources[0]!.grossIncomeAmount = "1.00";
    result.lines[0]!.value = "1.00";
    expect(snapshot.inputs.sources[0]?.grossIncomeAmount).toBe("50000.00");
    expect(snapshot.inputs.sources[0]?.grossIncomeThb).toBe("50000");
    expect(snapshot.result.lines[0]?.value).toBe("50000");
    expect(snapshot.policy.id).toBe("rd-ftc-demo-2568-v1");
    expect(snapshot.result.engineVersion).toBe("ftc-engine-v1");
  });

  it("recomputes results from the exact frozen inputs and rejects a mismatched revision", () => {
    const draft = partialRemittanceFixture.draft;
    const inconsistentInput = {
      id: "snapshot-mismatch", caseId: draft.id!, revision: draft.revision, kind: "preview" as const,
      inputs: draft, result: calculateFTC(slideDiscrepancyFixture.draft), evidence: [], createdAt: "2026-10-14T01:00:00.000Z",
    };
    const snapshot = createCalculationSnapshot(inconsistentInput as never);
    expect(snapshot.inputs.domesticAssessableIncome).toBe("0.00");
    expect(snapshot.result.validationMessages).toEqual([]);
    expect(snapshot.result.outcome).toBe("ready");
    expect(snapshot.result.allowableCredit).toBe(partialRemittanceFixture.expected.allowableCredit);
    expect(snapshot.result.totalAssessableIncome).toBe("25000");
    expect(snapshot.result.allowableCredit).not.toBe("143544.30");

    expect(() => createCalculationSnapshot({
      id: "snapshot-revision-mismatch", caseId: draft.id!, revision: draft.revision + 1,
      kind: "preview", inputs: draft, evidence: [], createdAt: "2026-10-14T01:00:00.000Z",
    })).toThrow(/revision/i);
  });
});
