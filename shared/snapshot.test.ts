import { describe, expect, it } from "vitest";
import { calculateFTC } from "./calculator.js";
import { partialRemittanceFixture } from "../src/fixtures/domain.js";
import { createCalculationSnapshot } from "./snapshot.js";

describe("calculation snapshots", () => {
  it("copies the inputs, detailed result, evidence and policy used for an immutable preview", () => {
    const draft = partialRemittanceFixture.draft;
    const result = calculateFTC(draft);
    const snapshot = createCalculationSnapshot({
      id: "snapshot-1",
      caseId: "case-1",
      revision: draft.revision,
      kind: "preview",
      inputs: draft,
      result,
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
});
