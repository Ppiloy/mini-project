import Decimal from "decimal.js";
import type { EvidenceKind, FtcCaseDraft, FrozenEvidenceReference, MissingEvidenceGroup } from "./contracts.js";
import { effectiveForeignTaxAmount } from "./foreignTax.js";

function positive(value: string | null): boolean {
  if (value === null) return false;
  try { return new Decimal(value).gt(0); } catch { return false; }
}

/** Derives missing evidence categories from frozen user facts and available file references. */
export function missingEvidenceInventory(
  draft: Pick<FtcCaseDraft, "thaiTax" | "sources">,
  evidence: readonly Pick<FrozenEvidenceReference, "sourceId" | "kind">[],
): MissingEvidenceGroup[] {
  const groups: MissingEvidenceGroup[] = [];
  if (positive(draft.thaiTax.amountBeforeFtc)
    && !evidence.some((file) => file.sourceId === null && file.kind === "thai_tax")) {
    groups.push({ sourceId: null, sourceIndex: null, missingKinds: ["thai_tax"] });
  }

  draft.sources.forEach((source, sourceIndex) => {
    if (!positive(source.remittedIncomeAmount) && !positive(source.remittedIncomeThb)) return;
    const requiredKinds: EvidenceKind[] = ["foreign_income", "remittance"];
    const effectiveTax = effectiveForeignTaxAmount(source);
    const rawTaxFactsAbsent = source.actualForeignTaxPaid === null && source.eligibleForeignTax === null;
    const hasLegacyCachedTax = rawTaxFactsAbsent
      && (positive(source.actualForeignTaxPaidThb) || positive(source.eligibleForeignTaxThb));
    if (positive(source.actualForeignTaxPaid) || positive(effectiveTax) || hasLegacyCachedTax) requiredKinds.splice(1, 0, "foreign_tax");
    const sourceEvidence = evidence.filter((file) => source.id !== null && file.sourceId === source.id);
    const presentKinds = new Set(sourceEvidence.map((file) => file.kind));
    const missingKinds = requiredKinds.filter((kind) => !presentKinds.has(kind));
    if (missingKinds.length > 0) groups.push({ sourceId: source.id, sourceIndex, missingKinds });
  });

  return groups;
}
