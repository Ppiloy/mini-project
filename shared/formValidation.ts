import type { FtcCaseDraft, ValidationMessage } from "./contracts.js";
import { calculateFTC } from "./calculator.js";
import { countryLabel, incomeTypeLabel, worksheetLabel } from "./labels.js";
import { assessResidenceYear, deriveResidenceDaysForDraft, validateResidencePeriods, validateResidenceYearPeriods } from "./residence.js";

export interface FormStepIssue {
  path?: Array<string | number>;
  message: string;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  taxYear: "ปีภาษี",
  sources: "แหล่งเงินได้",
  countryCode: worksheetLabel("B"),
  incomeType: worksheetLabel("C"),
  earnedTaxYear: "ปีที่เกิดเงินได้",
  earnedDate: "วันที่เกิดเงินได้",
  residenceDaysInEarnedYear: "จำนวนวันพำนักในปีที่เกิดเงินได้",
  inputMode: "รูปแบบจำนวนเงินของช่อง (D), (E) และ (F)",
  grossIncomeAmount: worksheetLabel("D"),
  actualForeignTaxPaid: "ภาษีต่างประเทศที่ชำระจริงทั้งหมด",
  eligibleForeignTax: worksheetLabel("E"),
  remittedIncomeAmount: worksheetLabel("F"),
  eligibilityRationale: "เหตุผลของจำนวน (E)",
  remittance: "วันที่นำเงินเข้าไทย",
  remittanceDate: "วันที่นำเงินเข้าไทย",
  currencyCode: "สกุลเงิน",
  fxReference: "อัตราแลกเปลี่ยน",
  thbRate: "อัตรา THB",
  baseUnits: "หน่วยของอัตราแลกเปลี่ยน",
  effectiveDate: "วันที่ของอัตราแลกเปลี่ยน",
  rateType: "ประเภทอัตราแลกเปลี่ยน",
  sourceLabel: "แหล่งที่มาอัตราแลกเปลี่ยน",
  domesticAssessableIncome: worksheetLabel("J"),
  amountBeforeFtc: worksheetLabel("L"),
  unsupportedClassification: "ข้อเท็จจริงเพิ่มเติมที่ยังไม่รองรับ",
  countryName: worksheetLabel("B"),
  residencePeriods: "ช่วงวันที่พำนัก",
  residenceYears: "ข้อมูลวันพำนักตามปีที่เกิดเงินได้",
};

export function validationTargetId(path: readonly (string | number)[] | undefined): string | null {
  if (!path) return null;
  if (path[0] === "taxYear") return "case-taxYear";
  if (path[0] === "sources" && typeof path[1] === "number") {
    const fields = path.slice(2).map(String);
    if (fields.length === 1 && fields[0] === "residenceDaysInEarnedYear") return "residence-period-add";
    if (fields.length === 1 && fields[0] === "countryName") fields[0] = "countryCode";
    if (fields.length === 1 && fields[0] === "earnedTaxYear") fields[0] = "earnedDate";
    if (fields[0] === "fxReference") return `source-${path[1]}-fxReference-thbRate`;
    if (fields.length === 1 && fields[0] === "remittance") fields.push("remittanceDate");
    return fields.length > 0 ? `source-${path[1]}-${fields.join("-")}` : null;
  }
  if (path[0] === "residencePeriods" && typeof path[1] === "number" && typeof path[2] === "string") return `residence-period-${path[1]}-${path[2]}`;
  if (path[0] === "residencePeriods") return "residence-period-add";
  if (path[0] === "residenceYears") {
    if (typeof path[1] !== "number") return "residence-year-add-input";
    if (path[2] === "periods" && typeof path[3] === "number" && typeof path[4] === "string") return `residence-year-${path[1]}-period-${path[3]}-${path[4]}`;
    return `residence-year-${path[1]}-add`;
  }
  if (path[0] === "domesticAssessableIncome") return "case-domesticAssessableIncome";
  if (path[0] === "thaiTax" && typeof path[1] === "string") return `case-thaiTax-${path[1]}`;
  return null;
}

export function validationTargetLabel(path: readonly (string | number)[] | undefined): string {
  if (!path) return "ช่องที่เกี่ยวข้อง";
  if (path[2] === "residenceDaysInEarnedYear") return "ช่วงเวลาที่พำนัก";
  if (path[2] === "fxReference") return "อัตราแลกเปลี่ยน";
  if (path[2] === "remittance") return "วันที่นำเงินเข้าไทย";
  if (path[0] === "residenceYears" || path[0] === "residencePeriods") return "ข้อมูลวันพำนัก";
  const field = [...path].reverse().find((part): part is string => typeof part === "string");
  return field ? FIELD_LABELS[field] ?? "ช่องที่เกี่ยวข้อง" : "ช่องที่เกี่ยวข้อง";
}

/** Required checks for moving between editable form steps. Draft saving stays permissive. */
export function validateFormStep(draft: FtcCaseDraft, step: number): FormStepIssue[] {
  if (step === 0) {
    const issues: FormStepIssue[] = [];
    if (draft.taxYear === null) issues.push({ path: ["taxYear"], message: "เลือกปีภาษีก่อนดำเนินการต่อ" });
    if (draft.residenceYears !== undefined) {
      if (draft.residenceYears.length === 0) {
        issues.push({ path: ["residenceYears"], message: "เพิ่มข้อมูลวันพำนักอย่างน้อยหนึ่งปีที่เกิดเงินได้ก่อนดำเนินการต่อ" });
      }
      const recordYears = new Set(draft.residenceYears.map((record) => record.earnedTaxYear));
      const sourceYears = new Set(draft.sources.flatMap((source) => source.earnedTaxYear === null ? [] : [source.earnedTaxYear]));
      for (const year of sourceYears) {
        if (!recordYears.has(year)) issues.push({ path: ["residenceYears", year], message: `เพิ่มข้อมูลวันพำนักสำหรับปีที่เกิดเงินได้ พ.ศ. ${year + 543}` });
      }
      for (const issue of validateResidenceYearPeriods(draft.residenceYears)) {
        const record = draft.residenceYears.find((item) => item.earnedTaxYear === issue.earnedTaxYear);
        const emptyPeriodRecord = record?.mode === "periods" && record.periods.length === 0;
        const label = issue.field === "startDate" ? "วันแรกที่พำนัก" : "วันสุดท้ายที่พำนัก";
        const message = emptyPeriodRecord ? `เพิ่มช่วงวันที่พำนักสำหรับปี พ.ศ. ${issue.earnedTaxYear + 543} หรือเลือกคำยืนยันเมื่อไม่มีวันที่บันทึกไว้`
          : issue.code === "required" ? `ระบุ${label}ของช่วงที่ ${issue.periodIndex + 1} สำหรับปี พ.ศ. ${issue.earnedTaxYear + 543}`
          : issue.code === "reversed" ? `วันสิ้นสุดของช่วงที่ ${issue.periodIndex + 1} ต้องไม่มาก่อนวันเริ่มต้น`
            : `ตรวจสอบ${label}ของช่วงที่ ${issue.periodIndex + 1}`;
        const path = emptyPeriodRecord
          ? ["residenceYears", issue.earnedTaxYear]
          : ["residenceYears", issue.earnedTaxYear, "periods", issue.periodIndex, issue.field];
        issues.push({ path, message });
      }
      for (const record of draft.residenceYears) {
        if (record.mode !== "periods" || record.periods.length === 0 || validateResidenceYearPeriods([record]).length > 0) continue;
        const assessment = assessResidenceYear(record, record.earnedTaxYear);
        if (assessment.days !== null && assessment.days < 180) {
          issues.push({ path: ["residenceYears", record.earnedTaxYear], message: `จำนวนวันพำนักในปี พ.ศ. ${record.earnedTaxYear + 543} ต่ำกว่า 180 วัน แก้ไขหรือล้างช่วงวันที่ก่อนเลือกคำยืนยัน` });
        }
      }
    } else {
      for (const issue of validateResidencePeriods(draft.residencePeriods ?? [])) {
        const label = issue.field === "startDate" ? "วันแรกที่พำนัก" : "วันสุดท้ายที่พำนัก";
        const message = issue.code === "required" ? `ระบุ${label}ของช่วงที่ ${issue.periodIndex + 1}`
          : issue.code === "reversed" ? `วันสิ้นสุดของช่วงที่ ${issue.periodIndex + 1} ต้องไม่มาก่อนวันเริ่มต้น`
            : `ตรวจสอบ${label}ของช่วงที่ ${issue.periodIndex + 1}`;
        issues.push({ path: ["residencePeriods", issue.periodIndex, issue.field], message });
      }
      const legacy = deriveResidenceDaysForDraft(draft);
      const countsByYear = new Map<number, Set<number | null>>();
      for (const source of legacy.sources) {
        if (source.earnedTaxYear === null) continue;
        const counts = countsByYear.get(source.earnedTaxYear) ?? new Set<number | null>();
        counts.add(source.residenceDaysInEarnedYear);
        countsByYear.set(source.earnedTaxYear, counts);
      }
      for (const [year, counts] of countsByYear) {
        const values = [...counts];
        if (values.length > 1) {
          issues.push({ path: ["residencePeriods"], message: `ข้อมูลวันพำนักเดิมของปี พ.ศ. ${year + 543} ไม่ตรงกันระหว่างแหล่งเงินได้ กรุณาระบุช่วงวันที่เพื่อหายอดเดียวกัน` });
          continue;
        }
        const days = values[0] ?? null;
        if (days === null) {
          issues.push({ path: ["residencePeriods"], message: `เพิ่มข้อมูลวันพำนักสำหรับปีที่เกิดเงินได้ พ.ศ. ${year + 543}` });
        } else if (days < 180) {
          issues.push({ path: ["residencePeriods"], message: `จำนวนวันพำนักในปี พ.ศ. ${year + 543} มี ${days} วัน ต่ำกว่า 180 วันตามมาตรา 41` });
        }
      }
    }
    return issues;
  }
  if (step === 1 && draft.sources.length === 0) {
    return [{
      path: ["sources"],
      message: "เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ",
    }];
  }
  if (step === 1) {
    const assessment = calculateFTC(draft);
    const blockingCodes = new Set([
      "input.required",
      "draft.invalid",
      "source.eligible_tax_exceeds_paid",
      "source.remitted_exceeds_income",
      "source.zero_income_denominator",
      "source.tax_without_income",
      "source.nonresident_earned_income",
      "source.earned_after_claim_year",
      "source.earned_date_year_mismatch",
      "source.income_before_tool_window",
      "source.remittance_before_earned",
      "fx.currency_mismatch",
      "fx.manual_provenance_missing",
      "fx.manual_date_mismatch",
      "fx.reference_unverified",
    ]);
    const residenceMessages = assessment.validationMessages.filter((issue) => issue.code.startsWith("residence."));
    const sourceMessages = assessment.validationMessages.filter((issue) => {
      const path = issue.path ?? [];
      return path[0] === "sources"
        && typeof path[1] === "number"
        && (stepForCalculationIssue(issue) === 1 || path[2] === "residenceDaysInEarnedYear")
        && blockingCodes.has(issue.code);
    });
    return formatCalculationIssues(draft, [...residenceMessages, ...sourceMessages]);
  }
  if (step === 2) {
    const issues = calculateFTC(draft).validationMessages.filter((issue) => {
      const path = issue.path ?? [];
      return stepForCalculationIssue(issue) === 2
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
    const message = issue.code === "input.required" && field === "residenceDaysInEarnedYear"
      ? "เพิ่มช่วงวันที่พำนักในขั้นข้อมูลเบื้องต้น เพื่อคำนวณจำนวนวันสำหรับปีที่เกิดเงินได้"
      : issue.code === "input.required"
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
  if (path[0] === "taxYear" || path[0] === "residencePeriods" || path[0] === "residenceYears") return 0;
  if (path[0] === "domesticAssessableIncome" || path[0] === "thaiTax") return 2;
  if (path[0] === "sources" && typeof path[1] === "number") return path[2] === "residenceDaysInEarnedYear" ? 0 : 1;
  return 0;
}
