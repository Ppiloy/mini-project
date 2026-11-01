import type { EvidenceKind, ForeignIncomeSourceDraft } from "./contracts.js";

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

export const EVIDENCE_LABELS: Readonly<Record<EvidenceKind, string>> = {
  foreign_income: "หลักฐานเงินได้",
  foreign_tax: "หลักฐานภาษีต่างประเทศ",
  remittance: "หลักฐานการนำเงินเข้าไทย",
  thai_tax: "หลักฐานภาษีไทย",
  other: "เอกสารอื่น",
};

export function worksheetLabel(letter: WorksheetLetter): string {
  return `(${letter}) - ${WORKSHEET_LABELS[letter]}`;
}

export const COUNTRY_CHOICES = [
  { code: "US", label: "สหรัฐอเมริกา", storedName: "United States", suggestedCurrency: "USD", reviewed: false },
  { code: "SG", label: "สิงคโปร์", storedName: "Singapore", suggestedCurrency: "SGD", reviewed: false },
  { code: "CN", label: "จีน", storedName: "China", suggestedCurrency: "CNY", reviewed: true },
  { code: "VN", label: "เวียดนาม", storedName: "Vietnam", suggestedCurrency: "VND", reviewed: true },
  { code: "XX", label: "ประเทศอื่น", storedName: "ประเทศอื่น", suggestedCurrency: null, reviewed: false },
] as const;

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

export function countryLabel(code: string | null | undefined, fallback = "ไม่ระบุประเทศ"): string {
  return COUNTRY_CHOICES.find((country) => country.code === code)?.label ?? fallback;
}

export function incomeTypeLabel(source: Pick<ForeignIncomeSourceDraft, "incomeType" | "subtype">): string {
  if (source.incomeType === "salary_40_1") return "40(1) เงินเดือนหรือค่าจ้าง";
  if (source.incomeType === "dividend_40_4") return "40(4) เงินปันผล";
  if (source.incomeType === "other") return "ประเภทเงินได้อื่น — ยังไม่รองรับ";
  return "ยังไม่ระบุประเภทเงินได้";
}
