import Decimal from "decimal.js";
import type { ForeignIncomeSourceDraft } from "./contracts.js";

/** E: an exceptional override when recorded, otherwise the amount actually paid. */
export function effectiveForeignTaxAmount(source: ForeignIncomeSourceDraft): string | null {
  return source.eligibleForeignTax ?? source.actualForeignTaxPaid;
}

/** A different E is an explicit adjustment from the amount actually paid. */
export function hasEligibleTaxAdjustment(source: ForeignIncomeSourceDraft): boolean {
  if (source.eligibleForeignTax === null) return false;
  if (source.actualForeignTaxPaid === null) return true;
  try {
    return !new Decimal(source.actualForeignTaxPaid).equals(source.eligibleForeignTax);
  } catch {
    return source.actualForeignTaxPaid !== source.eligibleForeignTax;
  }
}
