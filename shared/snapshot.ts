import type {
  CalculationResult,
  CalculationSnapshot,
  FtcCaseDraft,
  FrozenEvidenceReference,
  SnapshotKind,
} from "./contracts.js";
import { withCanonicalThbAmounts } from "./calculator.js";
import { parseDraft } from "./draft.js";
import { DEMO_POLICY, policyReference, type DemoPolicy } from "./policy.js";

export interface CreateCalculationSnapshotInput {
  id: string;
  caseId: string;
  revision: number;
  kind: SnapshotKind;
  inputs: FtcCaseDraft;
  result: CalculationResult;
  evidence: readonly FrozenEvidenceReference[];
  createdAt: string;
  policy?: DemoPolicy;
}

/** Copies every consumed input and result value into a versioned snapshot. */
export function createCalculationSnapshot(input: CreateCalculationSnapshotInput): CalculationSnapshot {
  const policy = input.policy ?? DEMO_POLICY;
  if (input.result.policyVersion !== policy.id || input.result.engineVersion !== policy.engineVersion) {
    throw new Error("Snapshot policy and calculation result versions must match.");
  }
  const inputs = withCanonicalThbAmounts(parseDraft(input.inputs));
  return {
    id: input.id,
    caseId: input.caseId,
    revision: input.revision,
    kind: input.kind,
    inputs: structuredClone(inputs),
    result: structuredClone(input.result),
    evidence: input.evidence.map((reference) => ({ ...reference })),
    policy: policyReference(policy),
    createdAt: input.createdAt,
  };
}
