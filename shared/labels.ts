import type { EvidenceKind, ForeignIncomeSourceDraft, FxRateType, FxSourceKind } from "./contracts.js";
import { COUNTRY_CHOICES, INCOME_CHOICES } from "./coverage.js";

export { COUNTRY_CHOICES } from "./coverage.js";

export const WORKSHEET_LABELS = {
  A: "ปีภาษีที่เกิดเงินได้",
  B: "ประเทศแหล่งเงินได้",
  C: "ประเภทเงินได้",
  D: "จำนวนเงินได้ในต่างประเทศ",
  E: "จำนวนภาษีชำระในต่างประเทศ",
  F: "จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ",
  G: "จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ",
  H: "สัดส่วนเงินได้ต่างประเทศที่นำเข้ามา",
  I: "เงินได้พึงประเมินในต่างประเทศที่นำเข้ามา",
  J: "เงินได้พึงประเมินในประเทศไทย",
  K: "เงินได้พึงประเมินรวมจากทุกแหล่งเงินได้",
  L: "ภาษีที่ต้องชำระในประเทศไทย",
  M: "ประเทศ",
  N: "จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ (แยกตามประเทศ)",
  O: "จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้ที่นำเข้ามา (แยกตามประเทศ)",
  P: "เครดิตภาษีที่คำนวณได้ (คำนวณเพดานเครดิตภาษี)",
  Q: "เครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย",
} as const;

export type WorksheetLetter = keyof typeof WORKSHEET_LABELS;

export const WORKSHEET_SECTIONS = [
  "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ",
  "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี",
  "เครดิตภาษีที่คำนวณได้ตามประเทศ",
  "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย",
] as const;

export const PRODUCT_NAME = "เครดิตภาษีต่างประเทศ";
export const DEMO_ENTRY_LABEL = "ทดลองใช้ด้วยข้อมูลตัวอย่าง";
export const EDUCATIONAL_NOTICE = "ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น";
export const DEMO_EXAMPLE_LABELS = {
  partialRemittance: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน",
  vietnamAndChina: "ตัวอย่าง: เงินได้จากเวียดนามและจีน",
} as const;

export const EVIDENCE_LABELS: Readonly<Record<EvidenceKind, string>> = {
  foreign_income: "หลักฐานเงินได้",
  foreign_tax: "หลักฐานภาษีต่างประเทศ",
  remittance: "หลักฐานการนำเงินเข้าไทย",
  thai_tax: "หลักฐานภาษีไทย",
  other: "เอกสารอื่น",
};

export const AVAILABLE_EVIDENCE_STATEMENT_V1 = "ฉันยืนยันว่าได้แนบเอกสารที่มีอยู่ในขณะนี้แล้ว และรับทราบว่าเจ้าหน้าที่อาจขอเอกสารเพิ่มเติม";

export function worksheetLabel(letter: WorksheetLetter): string {
  return `${WORKSHEET_LABELS[letter]} (${letter})`;
}

export function fxRateTypeLabel(value: FxRateType | null): string {
  switch (value) {
    case "bank_buying": return "อัตรารับซื้อของธนาคาร";
    case "bot_average_buying": return "อัตราเฉลี่ยรับซื้อของธนาคารแห่งประเทศไทย";
    case "manual": return "อัตราที่ผู้ใช้กรอกเอง";
    case "fixture": return "อัตราที่กำหนดไว้ในตัวอย่าง";
    default: return "ไม่ระบุประเภทอัตรา";
  }
}

export function fxSourceKindLabel(value: FxSourceKind | null): string {
  switch (value) {
    case "bank": return "ธนาคาร";
    case "bot": return "ธนาคารแห่งประเทศไทย";
    case "user_supplied": return "ผู้ใช้ระบุ";
    case "fixture": return "ตัวอย่างเพื่อการศึกษา";
    default: return "ไม่ระบุแหล่งอัตรา";
  }
}

export const CURRENCY_CHOICES = [
  { code: "THB", label: "บาทไทย" },
  { code: "USD", label: "ดอลลาร์สหรัฐ" },
  { code: "SGD", label: "ดอลลาร์สิงคโปร์" },
  { code: "CNY", label: "หยวนจีน" },
  { code: "VND", label: "ด่งเวียดนาม" },
  { code: "EUR", label: "ยูโร" },
  { code: "GBP", label: "ปอนด์สเตอร์ลิง" },
  { code: "JPY", label: "เยนญี่ปุ่น" },
  { code: "AUD", label: "ดอลลาร์ออสเตรเลีย" },
] as const;

export type CurrencyCode = typeof CURRENCY_CHOICES[number]["code"];

export function countryLabel(code: string | null | undefined, fallback = "ไม่ระบุประเทศ", storedName?: string | null): string {
  const knownCountry = COUNTRY_CHOICES.find((country) => country.code === code);
  if (knownCountry) return knownCountry.label;
  const legacyName = storedName?.trim();
  if (code && legacyName) return `${legacyName} (${code}) · ไม่พบในรายชื่อ DTA ที่รองรับ`;
  return fallback;
}

export function incomeTypeLabel(source: Pick<ForeignIncomeSourceDraft, "incomeType" | "subtype">): string {
  const choice = INCOME_CHOICES.find((item) => item.incomeType === source.incomeType && item.subtype === source.subtype);
  if (choice) return choice.label;
  const categoryChoice = INCOME_CHOICES.find((item) => item.incomeType === source.incomeType);
  if (categoryChoice) return categoryChoice.label;
  if (source.incomeType === "other") {
    const legacyChoice = INCOME_CHOICES.find((item) => item.key === source.subtype);
    if (legacyChoice) return legacyChoice.label;
  }
  if (source.incomeType === "other") return "รายการเดิมที่ยังไม่จำแนกตามมาตรา 40";
  return "ยังไม่ระบุประเภทเงินได้";
}

const KNOWN_EXAMPLE_NOTES: Readonly<Record<string, string>> = {
  "Deliberately synthetic quote to demonstrate conversion per 100 units; not a historical market rate.": "อัตราสมมติในตัวอย่างเพื่อสาธิตการแปลงต่อ 100 หน่วย ไม่ใช่อัตราตลาดย้อนหลัง",
  "Prepared educational slide example; supplied L is not inferred from J.": "ตัวอย่างระบุจำนวน (L) เป็นภาษีไทยก่อนเครดิตภาษีต่างประเทศหลังหักค่าใช้จ่ายและค่าลดหย่อนที่เกี่ยวข้อง โดยไม่ได้คำนวณจากเงินได้ในประเทศเพียงรายการเดียว",
  "Prepared allocation example; L is supplied.": "ตัวอย่างการจัดสรรนี้กำหนด (L) เป็นจำนวนที่ระบุไว้เพื่อสาธิตสูตร ไม่ใช่การคำนวณภาษีเงินได้บุคคลธรรมดาไทยครบถ้วน",
  "Assumed eligible solely for this mathematical educational example.": "สมมติให้จำนวน (E) นี้ใช้แสดงตัวอย่างทางคณิตศาสตร์เพื่อการศึกษาเท่านั้น ไม่ใช่การยืนยันสิทธิตามกฎหมาย",
  "Manual-derived D/E row; eligible tax is still an explicit educational assumption.": "ตัวอย่างระบุ (D)/(E) จากแถวข้อมูลที่ตรวจไว้ และกำหนดจำนวน (E) เป็นสมมติฐานสำหรับการคำนวณ",
  "No remittance in the educational example; D remains positive so the allocation denominator is defined.": "ตัวอย่างนี้ไม่มีการนำเงินเข้า แต่ (D) ยังมีจำนวนเงินได้เพื่อแสดงวิธีคำนวณสัดส่วน",
};

/** Localizes known fixture notes while leaving arbitrary taxpayer-entered text unchanged. */
export function displayKnownExampleNote(value: string | null | undefined): string | null {
  if (!value) return null;
  return KNOWN_EXAMPLE_NOTES[value] ?? value;
}
