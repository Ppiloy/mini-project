import type {
  CalculationSnapshot,
  FtcCaseDraft,
  FrozenEvidenceReference,
  SubmissionMetadata,
  SnapshotKind,
} from "./contracts.js";
import { calculateFTC, withCanonicalThbAmounts } from "./calculator.js";
import { parseDraft } from "./draft.js";
import { DEMO_POLICY, policyReference, type DemoPolicy } from "./policy.js";

export interface CreateCalculationSnapshotInput {
  id: string;
  caseId: string;
  revision: number;
  kind: SnapshotKind;
  inputs: FtcCaseDraft;
  evidence: readonly FrozenEvidenceReference[];
  createdAt: string;
  policy?: DemoPolicy;
  submissionMetadata?: SubmissionMetadata | null;
}

/** Copies every consumed input and result value into a versioned snapshot. */
export function createCalculationSnapshot(input: CreateCalculationSnapshotInput): CalculationSnapshot {
  const policy = input.policy ?? DEMO_POLICY;
  if (input.kind === "preview" && input.submissionMetadata != null) {
    throw new Error("Preview snapshots cannot carry submission metadata.");
  }
  if (input.revision !== input.inputs.revision) {
    throw new Error("Snapshot revision must match the frozen input revision.");
  }
  const inputs = withCanonicalThbAmounts(parseDraft(input.inputs));
  const result = calculateFTC(inputs, policy);
  return {
    id: input.id,
    caseId: input.caseId,
    revision: input.revision,
    kind: input.kind,
    inputs: structuredClone(inputs),
    result: structuredClone(result),
    evidence: input.evidence.map((reference) => ({ ...reference })),
    policy: policyReference(policy, inputs.taxYear ?? policy.taxYear),
    createdAt: input.createdAt,
    submissionMetadata: input.submissionMetadata ? structuredClone(input.submissionMetadata) : null,
  };
}
