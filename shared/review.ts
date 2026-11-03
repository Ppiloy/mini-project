import type { CalculationSnapshot, OfficerReviewPoint, ReviewPointCategory, UnsupportedClassification } from "./contracts.js";
import { hasEligibleTaxAdjustment } from "./foreignTax.js";
import { missingEvidenceInventory } from "./evidenceInventory.js";
import { EVIDENCE_LABELS } from "./labels.js";

const reviewScope = "จุดตรวจนี้ช่วยชี้ข้อมูลเชิงโครงสร้างเท่านั้น ไม่ใช่การอนุมัติหรือคำวินิจฉัยสิทธิในเครดิตภาษี; การมีไฟล์แนบไม่ได้ยืนยันว่าเอกสารถูกต้องหรือครบถ้วน";

export const officerReviewScope = reviewScope;

const unsupportedClassificationLabels: Record<UnsupportedClassification, string> = {
  unsupported_tax_year: "ปีภาษีอยู่นอกขอบเขตตัวอย่าง",
  cross_year_remittance: "เงินได้กับการนำเข้าอยู่คนละปีภาษี",
  nonresident_earned_income: "ข้อเท็จจริงเรื่องวันพำนักยังอยู่นอกกรณีตัวอย่าง",
  unsupported_income_type: "ประเภทเงินได้อยู่นอกขอบเขตตัวอย่าง",
  unknown_treaty_treatment: "การจัดประเภทตามอนุสัญญายังไม่ชัดเจน",
  mixed_principal_and_income: "ยอดโอนรวมทั้งเงินต้นและเงินได้",
  ambiguous_gross_net: "ยังไม่ชัดเจนว่ายอดเป็น gross หรือ net",
  tax_refund: "มีข้อเท็จจริงเรื่องการคืนภาษี",
  multiple_remittances: "มีการนำเข้าเงินหลายครั้ง",
  other: "ข้อเท็จจริงอื่นที่ระบุว่ายังไม่รองรับ",
};

function resultOutcomeLabel(outcome: CalculationSnapshot["result"]["outcome"]): string {
  return outcome === "incomplete" ? "ข้อมูลไม่ครบ" : outcome === "needs_review" ? "ต้องตรวจสอบเพิ่มเติม" : "พร้อมตามผลที่บันทึก";
}

function sourceLocation(snapshot: CalculationSnapshot, path: Array<string | number> | undefined): Pick<OfficerReviewPoint, "sourceId" | "sourceIndex"> {
  const sourceIndex = path?.[0] === "sources" && typeof path[1] === "number" && Number.isInteger(path[1])
    && path[1] >= 0 && path[1] < snapshot.inputs.sources.length ? path[1] : null;
  return { sourceIndex, sourceId: sourceIndex === null ? null : snapshot.inputs.sources[sourceIndex]?.id ?? null };
}

function validationCategory(code: string): ReviewPointCategory {
  if (/evidence/i.test(code)) return "missingEvidence";
  if (/unsupported|cross_year|nonresident/i.test(code)) return "unsupported";
  if (code === "draft.invalid" || /required|invalid|reversed|exceeds|zero_|mismatch|date_/i.test(code)) return "invalid";
  return "substantive";
}

function nextActionFor(category: ReviewPointCategory): string {
  switch (category) {
    case "invalid": return "ตรวจสอบและแก้ข้อมูลต้นทางที่ระบุ ก่อนพิจารณารายการต่อ";
    case "missingEvidence": return "ตรวจสอบรายการหลักฐานที่จำเป็น และแนบหรือเชื่อมโยงเอกสารที่เกี่ยวข้อง";
    case "unsupported": return "ตรวจข้อเท็จจริงและขอบเขตที่รองรับก่อนส่งต่อเพื่อพิจารณา";
    case "substantive": return "ตรวจข้อเท็จจริง เหตุผล และเอกสารประกอบด้วยตนเอง";
  }
}

/** Classifies only facts frozen in the submitted snapshot; it does not recalculate or approve a claim. */
export function classifySubmittedSnapshot(snapshot: CalculationSnapshot): OfficerReviewPoint[] {
  const points: OfficerReviewPoint[] = [];
  const seen = new Set<string>();
  const add = (point: OfficerReviewPoint) => {
    const key = `${point.code}:${point.sourceId ?? point.sourceIndex ?? "case"}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  };

  for (const group of missingEvidenceInventory(snapshot.inputs, snapshot.evidence)) {
    const names = group.missingKinds.map((kind) => EVIDENCE_LABELS[kind]).join(", ");
    if (group.sourceIndex === null) {
      add({ code: "case.missing_thai_tax_evidence", category: "missingEvidence", sourceId: null, sourceIndex: null,
        title: "ยังไม่พบหลักฐานภาษีไทยที่เชื่อมกับกรณีนี้",
        reason: `มีการระบุภาษีไทยก่อนเครดิต (L) เป็นจำนวนบวก แต่ยังไม่พบ ${names} ในฉบับที่ส่ง; การไม่พบไฟล์เพียงอย่างเดียวไม่ได้บอกว่าจำนวนนี้ถูกหรือผิด`,
        nextAction: "ตรวจสอบที่มาและจำนวน (L) พร้อมเอกสารประกอบ หรือบันทึกเหตุผลที่เกี่ยวข้อง" });
    } else {
      add({ code: "source.missing_evidence", category: "missingEvidence", sourceId: group.sourceId, sourceIndex: group.sourceIndex,
        title: "ยังไม่พบหลักฐานทุกชนิดที่เชื่อมกับรายการนี้",
        reason: `ในฉบับที่ส่งยังไม่พบหลักฐานที่ผูกกับรายการนี้สำหรับ: ${names}. การพบไฟล์ไม่ได้ยืนยันความถูกต้องของเอกสาร`,
        nextAction: nextActionFor("missingEvidence") });
    }
  }

  const reviewedResidenceYears = new Set<number>();
  for (const record of snapshot.inputs.residenceYears ?? []) {
    if (record.mode !== "declared" || reviewedResidenceYears.has(record.earnedTaxYear)) continue;
    reviewedResidenceYears.add(record.earnedTaxYear);
    const thaiYear = record.earnedTaxYear + 543;
    add({ code: `residence.declaration_unverified.${record.earnedTaxYear}`, category: "substantive", sourceId: null, sourceIndex: null,
      title: `คำยืนยันวันพำนักในปี พ.ศ. ${thaiYear} ยังไม่ผ่านการตรวจสอบ`,
      reason: `ฉบับที่ส่งมีคำยืนยันของผู้ใช้ว่าพำนักในประเทศไทยอย่างน้อย 180 วันในปี พ.ศ. ${thaiYear} โดยไม่มีช่วงวันที่หรือจำนวนวันแน่นอน จุดตรวจนี้ไม่ได้ตรวจสอบข้อเท็จจริงหรือวินิจฉัยสิทธิ FTC หรือ DTA`,
      nextAction: `ตรวจสอบข้อเท็จจริงวันพำนักและเอกสารของปี พ.ศ. ${thaiYear} ด้วยตนเองก่อนพิจารณารายการ` });
  }

  for (const [index, source] of snapshot.inputs.sources.entries()) {
    const location = { sourceId: source.id, sourceIndex: index };
    if (source.unsupportedClassification !== null) {
      add({ code: "source.unsupported_classification", category: "unsupported", ...location,
        title: "มีข้อเท็จจริงที่ระบุว่ายังไม่รองรับ",
        reason: source.unsupportedExplanation?.trim() || `ข้อเท็จจริงของรายการนี้คือ: ${unsupportedClassificationLabels[source.unsupportedClassification]}`,
        nextAction: nextActionFor("unsupported") });
    }

    if (source.inputMode === "original_currency" &&
      (source.fxReference?.rateType === "manual" || source.fxReference?.sourceKind === "user_supplied")) {
      add({ code: "fx.manual_reference", category: "substantive", ...location,
        title: "มีการกรอกอัตราแลกเปลี่ยนเอง",
        reason: "ข้อมูลในฉบับที่ส่งระบุอัตราที่ผู้ใช้กรอกเอง จึงควรตรวจสอบอัตรา วันที่ ฐานหน่วย และแหล่งอ้างอิง",
        nextAction: "ตรวจสอบอัตราแลกเปลี่ยนกับแหล่งข้อมูลและวันที่ที่เกี่ยวข้อง" });
    }

    if (hasEligibleTaxAdjustment(source)) {
      add({ code: "source.actual_tax_differs_from_used", category: "substantive", ...location,
        title: "ยอดภาษีที่ใช้คำนวณต่างจากยอดที่ระบุว่าชำระจริง",
        reason: "ยอดภาษีต่างประเทศที่ใช้เป็นจำนวน (E) ที่ใช้คำนวณ ไม่เท่ากับยอดภาษีต่างประเทศที่บันทึกว่าชำระจริง; ความต่างนี้ไม่ได้ตัดสินสิทธิหรือความเหมาะสมโดยอัตโนมัติ",
        nextAction: "ตรวจสอบการแยกยอด เหตุผล และเอกสารภาษีที่เกี่ยวข้อง" });
    }

  }

  for (const message of snapshot.result.validationMessages) {
    const indexedSource = typeof message.path?.[1] === "number" ? snapshot.inputs.sources[message.path[1]] : undefined;
    if (message.code === "source.unsupported_classification" && indexedSource?.unsupportedClassification !== null
        && indexedSource?.unsupportedClassification !== undefined) continue;
    const category = validationCategory(message.code);
    const location = sourceLocation(snapshot, message.path);
    add({ code: `result.${message.code}`, category, ...location,
      title: message.message.trim() || "ผลตรวจในฉบับที่ส่งต้องพิจารณา",
      reason: message.message.trim() || "ผลคำนวณที่บันทึกไว้มีจุดตรวจนี้ แต่ไม่มีคำอธิบายเพิ่มเติม",
      nextAction: nextActionFor(category) });
  }

  if (snapshot.result.outcome !== "ready" && snapshot.result.validationMessages.length === 0) {
    const category: ReviewPointCategory = snapshot.result.outcome === "incomplete" ? "invalid" : "substantive";
    add({ code: `result.${snapshot.result.outcome}`, category, sourceId: null, sourceIndex: null,
      title: snapshot.result.outcome === "incomplete" ? "ฉบับที่ส่งระบุข้อมูลไม่ครบ" : "ฉบับที่ส่งระบุว่าต้องตรวจสอบเพิ่มเติม",
      reason: `สถานะผลคำนวณที่บันทึกไว้คือ “${resultOutcomeLabel(snapshot.result.outcome)}”`,
      nextAction: nextActionFor(category) });
  }

  return points;
}
