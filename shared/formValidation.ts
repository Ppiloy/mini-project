import type { FtcCaseDraft, ValidationMessage } from "./contracts.js";
import { calculateFTC } from "./calculator.js";
import { countryLabel, incomeTypeLabel } from "./labels.js";

export interface FormStepIssue {
  path?: Array<string | number>;
  message: string;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  taxYear: "ปีภาษี",
  sources: "แหล่งเงินได้",
  countryCode: "ประเทศที่เกิดเงินได้",
  incomeType: "ประเภทเงินได้",
  earnedTaxYear: "ปีที่เกิดเงินได้",
  earnedDate: "วันที่เกิดเงินได้",
  residenceDaysInEarnedYear: "จำนวนวันพำนักในปีที่เกิดเงินได้",
  inputMode: "รูปแบบการกรอก",
  grossIncomeAmount: "จำนวนเงินได้ต้นทาง (D)",
  actualForeignTaxPaid: "ภาษีต่างประเทศที่ชำระจริง",
  eligibleForeignTax: "ภาษีที่สมมติว่าเข้าเกณฑ์ (E)",
  remittedIncomeAmount: "เงินได้ที่นำเข้าไทย (F)",
  eligibilityRationale: "เหตุผลของสมมติฐาน E",
  remittance: "วันที่นำเงินเข้าไทย",
  remittanceDate: "วันที่นำเงินเข้าไทย",
  currencyCode: "สกุลเงิน",
  fxReference: "อัตราแลกเปลี่ยน",
  thbRate: "อัตรา THB",
  baseUnits: "หน่วยของอัตราแลกเปลี่ยน",
  effectiveDate: "วันที่ของอัตราแลกเปลี่ยน",
  rateType: "ประเภทอัตราแลกเปลี่ยน",
  sourceLabel: "แหล่งที่มาอัตราแลกเปลี่ยน",
  domesticAssessableIncome: "เงินได้ในประเทศ (J)",
  amountBeforeFtc: "ภาษีไทยก่อนเครดิตภาษีต่างประเทศ (L)",
  provenance: "ที่มาของภาษีไทย (L)",
};

export function validationTargetId(path: readonly (string | number)[] | undefined): string | null {
  if (!path) return null;
  if (path[0] === "taxYear") return "case-taxYear";
  if (path[0] === "sources" && typeof path[1] === "number") {
    const fields = path.slice(2).map(String);
    if (fields.length === 1 && fields[0] === "fxReference") fields.push("thbRate");
    if (fields.length === 1 && fields[0] === "remittance") fields.push("remittanceDate");
    return fields.length > 0 ? `source-${path[1]}-${fields.join("-")}` : null;
  }
  if (path[0] === "domesticAssessableIncome") return "case-domesticAssessableIncome";
  if (path[0] === "thaiTax" && typeof path[1] === "string") return `case-thaiTax-${path[1]}`;
  return null;
}

export function validationTargetLabel(path: readonly (string | number)[] | undefined): string {
  if (!path) return "ช่องที่เกี่ยวข้อง";
  if (path[2] === "fxReference") return "อัตราแลกเปลี่ยน";
  if (path[2] === "remittance") return "วันที่นำเงินเข้าไทย";
  const field = [...path].reverse().find((part): part is string => typeof part === "string");
  return field ? FIELD_LABELS[field] ?? "ช่องที่เกี่ยวข้อง" : "ช่องที่เกี่ยวข้อง";
}

/** Required checks for moving between editable form steps. Draft saving stays permissive. */
export function validateFormStep(draft: FtcCaseDraft, step: number): FormStepIssue[] {
  if (step === 0 && draft.taxYear === null) {
    return [{ path: ["taxYear"], message: "เลือกปีภาษีก่อนดำเนินการต่อ" }];
  }
  if (step === 1 && draft.sources.length === 0) {
    return [{
      path: ["sources"],
      message: "เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ",
    }];
  }
  if (step === 1) {
    const issues: FormStepIssue[] = [];
    draft.sources.forEach((source, index) => {
      const field = (name: string, message: string) => issues.push({ path: ["sources", index, name], message: `แหล่งเงินได้ ${index + 1}: ${message}` });
      if (source.countryCode === null) field("countryCode", "เลือกประเทศที่เกิดเงินได้ก่อนดำเนินการต่อ");
      if (source.incomeType === null) field("incomeType", "เลือกประเภทเงินได้ก่อนดำเนินการต่อ");
      if (source.earnedDate === null) field("earnedDate", "ระบุวันที่เกิดเงินได้ก่อนดำเนินการต่อ");
      if (source.residenceDaysInEarnedYear === null) field("residenceDaysInEarnedYear", "ระบุจำนวนวันพำนักในปีที่เกิดเงินได้ก่อนดำเนินการต่อ");
      if (source.inputMode === null) field("inputMode", "เลือกรูปแบบการกรอกก่อนดำเนินการต่อ");
      if (source.inputMode === "original_currency" && source.currencyCode === null) field("currencyCode", "เลือกสกุลเงินต้นทางก่อนดำเนินการต่อ");
    });
    return issues;
  }
  if (step === 2) {
    const assessment = calculateFTC(draft);
    const blockingCodes = new Set([
      "input.required",
      "draft.invalid",
      "source.eligible_tax_exceeds_paid",
      "source.remitted_exceeds_income",
      "source.zero_income_denominator",
      "source.tax_without_income",
      "fx.currency_mismatch",
      "fx.manual_provenance_missing",
      "fx.reference_unverified",
    ]);
    const issues = assessment.validationMessages.filter((issue) => {
      const path = issue.path ?? [];
      return path[0] === "sources"
        && typeof path[1] === "number"
        && stepForCalculationIssue(issue) === 2
        && blockingCodes.has(issue.code);
    });
    return formatCalculationIssues(draft, issues);
  }
  if (step === 3) {
    const issues = calculateFTC(draft).validationMessages.filter((issue) => {
      const path = issue.path ?? [];
      return stepForCalculationIssue(issue) === 3
        && (path[0] === "domesticAssessableIncome" || path[0] === "thaiTax")
        && (issue.code === "input.required" || issue.code === "draft.invalid");
    });
    return formatCalculationIssues(draft, issues);
  }
  return [];
}

export function formatCalculationIssues(draft: FtcCaseDraft, messages: readonly ValidationMessage[]): FormStepIssue[] {
  return messages.map((issue) => {
    const path = issue.path ?? [];
    const field = [...path].reverse().find((part): part is string => typeof part === "string");
    const fieldLabel = field ? FIELD_LABELS[field] ?? "ข้อมูลรายการนี้" : "ข้อมูลกรณีนี้";
    const message = issue.code === "input.required"
      ? `กรุณากรอก${fieldLabel}${/[A-Za-z0-9)]$/.test(fieldLabel) ? " " : ""}ให้ครบก่อนดำเนินการต่อ`
      : issue.code === "draft.invalid"
        ? `ตรวจสอบรูปแบบหรือค่าของ${fieldLabel}ก่อนดำเนินการต่อ`
      : issue.message;
    if (path[0] === "sources" && typeof path[1] === "number") {
      const source = draft.sources[path[1]];
      if (source) {
        return {
          path,
          message: `แหล่งเงินได้ ${path[1] + 1} (${countryLabel(source.countryCode)} · ${incomeTypeLabel(source)}): ${message}`,
        };
      }
    }
    return { path, message };
  });
}

export function stepForCalculationIssue(issue: ValidationMessage): number {
  if (issue.code.startsWith("confirmation.")) return 4;
  const path = issue.path ?? [];
  if (path[0] === "taxYear") return 0;
  if (path[0] === "domesticAssessableIncome" || path[0] === "thaiTax") return 3;
  if (path[0] === "sources" && typeof path[1] === "number") {
    return ["countryCode", "incomeType", "earnedTaxYear", "earnedDate", "residenceDaysInEarnedYear", "inputMode"].includes(String(path[2])) ? 1 : 2;
  }
  return 0;
}
