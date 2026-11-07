import type { IncomeType } from "./contracts.js";

export const RD_DTA_REGISTER_URL = "https://www.rd.go.th/english/766.html";
const RD_TREATY_DOCUMENT_URLS: Readonly<Record<string, string>> = Object.freeze({
  AM: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/armenia_en_dta.pdf",
  AU: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/australia_en_dta.pdf",
  AT: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/austria_en_dta.pdf",
  BH: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/bahrain_en_dta.pdf",
  BD: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/bangladesh_en_dta.pdf",
  BY: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/belarus_en_dta.pdf",
  BE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/belgium_en_dta.pdf",
  BG: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/bulgaria_en_dta.pdf",
  KH: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/cambodia_en_dta.pdf",
  CA: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/canada_en_dta.pdf",
  CL: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/chile_en_dta.pdf",
  CN: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/china_en_dta.pdf",
  CY: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/cyprus_en_dta.pdf",
  CZ: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/czech_en_dta.pdf",
  DK: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/denmark_en_dta.pdf",
  EE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/estonia_en_dta.pdf",
  FI: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/finland_en_dta.pdf",
  FR: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/france_en_dta.pdf",
  DE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/germany_en_dta.pdf",
  HK: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/hongkong_en_dta.pdf",
  HU: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/hungary_en_dta.pdf",
  IN: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/india_en_dta.pdf",
  ID: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/indonesia_en_dta.pdf",
  IE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/ireland_en_dta.pdf",
  IL: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/israel_en_dta.pdf",
  IT: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/italy_en_dta.pdf",
  JP: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/japan_en_dta.pdf",
  KR: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/korea(republicofkorea)_en_dta.pdf",
  KW: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/kuwait_en_dta.pdf",
  LA: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/laos_en_dta.pdf",
  LU: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/luxembourg_en_dta.pdf",
  MY: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/malaysia_en_dta.pdf",
  MU: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/mauritius_en_dta.pdf",
  MM: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/myanmar_en_dta.pdf",
  NP: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/nepal_en_dta.pdf",
  NL: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/netherland_en_dta.pdf",
  NZ: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/newzealand_en_dta.pdf",
  NO: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/norway_en_dta.pdf",
  OM: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/oman_en_dta.pdf",
  PK: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/pakistan_en_dta.pdf",
  PH: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/philippines_en_dta_v2.pdf",
  PL: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/poland_en_dta.pdf",
  RO: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/romania_en_dta.pdf",
  RU: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/russian_en_dta.pdf",
  SC: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/seychelles_en_dta.pdf",
  SG: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/singapore_en_dta_v2.pdf",
  SI: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/slovenia_en_dta.pdf",
  ZA: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/southafrica_en_dta.pdf",
  ES: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/spain_en_dta.pdf",
  LK: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/srilanka_en_dta.pdf",
  SE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/sweden_en_dta_2.pdf",
  CH: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/switzerland_en_dta.pdf",
  TW: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/taiwan_en_dta.pdf",
  TJ: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/tajikistan_en_dta.pdf",
  TR: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/turkey_en_dta.pdf",
  UA: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/ukraine_en_dta.pdf",
  AE: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/uae_en_dta.pdf",
  GB: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/greatbritainandnorthernireland/unitedkingdom_en_dta.pdf",
  US: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/usa_en_dta.pdf",
  UZ: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/uzbekistan_en_dta.pdf",
  VN: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/vietnam_en_dta.pdf",
});

export interface CountryChoice {
  code: string;
  label: string;
  storedName: string;
  suggestedCurrency: string | null;
  reviewed: boolean;
  treatyUrl: string;
}

export interface IncomeChoice {
  key: string;
  label: string;
  section: string;
  incomeType: IncomeType;
  subtype: string | null;
  legacySubtypes?: readonly string[];
}

const rdCountry = (code: string, label: string, storedName: string, suggestedCurrency: string | null = null): CountryChoice => Object.freeze({
  code,
  label,
  storedName,
  suggestedCurrency,
  reviewed: true,
  treatyUrl: RD_TREATY_DOCUMENT_URLS[code]!,
});

/** The 61 comprehensive income-tax treaty partners in the current RD register. */
export const COUNTRY_CHOICES: readonly CountryChoice[] = Object.freeze([
  rdCountry("AM", "อาร์เมเนีย", "Armenia"),
  rdCountry("AU", "ออสเตรเลีย", "Australia", "AUD"),
  rdCountry("AT", "ออสเตรีย", "Austria", "EUR"),
  rdCountry("BH", "บาห์เรน", "Bahrain"),
  rdCountry("BD", "บังกลาเทศ", "Bangladesh"),
  rdCountry("BY", "เบลารุส", "Belarus"),
  rdCountry("BE", "เบลเยียม", "Belgium", "EUR"),
  rdCountry("BG", "บัลแกเรีย", "Bulgaria", "EUR"),
  rdCountry("KH", "กัมพูชา", "Cambodia"),
  rdCountry("CA", "แคนาดา", "Canada"),
  rdCountry("CL", "ชิลี", "Chile"),
  rdCountry("CN", "จีน", "China", "CNY"),
  rdCountry("CY", "ไซปรัส", "Cyprus", "EUR"),
  rdCountry("CZ", "เช็ก", "Czech Republic"),
  rdCountry("DK", "เดนมาร์ก", "Denmark"),
  rdCountry("EE", "เอสโตเนีย", "Estonia", "EUR"),
  rdCountry("FI", "ฟินแลนด์", "Finland", "EUR"),
  rdCountry("FR", "ฝรั่งเศส", "France", "EUR"),
  rdCountry("DE", "เยอรมนี", "Germany", "EUR"),
  rdCountry("HK", "ฮ่องกง", "Hong Kong"),
  rdCountry("HU", "ฮังการี", "Hungary"),
  rdCountry("IN", "อินเดีย", "India"),
  rdCountry("ID", "อินโดนีเซีย", "Indonesia"),
  rdCountry("IE", "ไอร์แลนด์", "Ireland", "EUR"),
  rdCountry("IL", "อิสราเอล", "Israel"),
  rdCountry("IT", "อิตาลี", "Italy", "EUR"),
  rdCountry("JP", "ญี่ปุ่น", "Japan", "JPY"),
  rdCountry("KR", "เกาหลีใต้", "Korea (Republic of Korea)"),
  rdCountry("KW", "คูเวต", "Kuwait"),
  rdCountry("LA", "ลาว", "Laos"),
  rdCountry("LU", "ลักเซมเบิร์ก", "Luxembourg", "EUR"),
  rdCountry("MY", "มาเลเซีย", "Malaysia"),
  rdCountry("MU", "มอริเชียส", "Mauritius"),
  rdCountry("MM", "เมียนมา", "Myanmar"),
  rdCountry("NP", "เนปาล", "Nepal"),
  rdCountry("NL", "เนเธอร์แลนด์", "Netherlands", "EUR"),
  rdCountry("NZ", "นิวซีแลนด์", "New Zealand"),
  rdCountry("NO", "นอร์เวย์", "Norway"),
  rdCountry("OM", "โอมาน", "Oman"),
  rdCountry("PK", "ปากีสถาน", "Pakistan"),
  rdCountry("PH", "ฟิลิปปินส์", "Philippines"),
  rdCountry("PL", "โปแลนด์", "Poland"),
  rdCountry("RO", "โรมาเนีย", "Romania"),
  rdCountry("RU", "รัสเซีย", "Russia"),
  rdCountry("SC", "เซเชลส์", "Seychelles"),
  rdCountry("SG", "สิงคโปร์", "Singapore", "SGD"),
  rdCountry("SI", "สโลวีเนีย", "Slovenia", "EUR"),
  rdCountry("ZA", "แอฟริกาใต้", "South Africa"),
  rdCountry("ES", "สเปน", "Spain", "EUR"),
  rdCountry("LK", "ศรีลังกา", "Sri Lanka"),
  rdCountry("SE", "สวีเดน", "Sweden"),
  rdCountry("CH", "สวิตเซอร์แลนด์", "Switzerland"),
  rdCountry("TW", "ไต้หวัน", "Taiwan"),
  rdCountry("TJ", "ทาจิกิสถาน", "Tajikistan"),
  rdCountry("TR", "ตุรกี", "Turkey"),
  rdCountry("UA", "ยูเครน", "Ukraine"),
  rdCountry("AE", "สหรัฐอาหรับเอมิเรตส์", "United Arab Emirates (UAE)"),
  rdCountry("GB", "สหราชอาณาจักร", "United Kingdom", "GBP"),
  rdCountry("US", "สหรัฐอเมริกา", "United States", "USD"),
  rdCountry("UZ", "อุซเบกิสถาน", "Uzbekistan"),
  rdCountry("VN", "เวียดนาม", "Vietnam", "VND"),
]);

/** Section 40 choices shared by taxpayer entry, validation and calculation. */
export const INCOME_CHOICES: readonly IncomeChoice[] = Object.freeze([
  Object.freeze({ key: "40_1", label: "40(1) เงินได้จากการจ้างแรงงาน", section: "40(1)", incomeType: "salary_40_1", subtype: "salary" }),
  Object.freeze({ key: "40_2", label: "40(2) เงินได้เนื่องจากหน้าที่หรือตำแหน่งงาน หรือรับทำงานให้", section: "40(2)", incomeType: "service_40_2", subtype: "service" }),
  Object.freeze({ key: "40_3", label: "40(3) ค่าแห่งลิขสิทธิ์ ค่าความนิยม หรือสิทธิอื่น และเงินปี", section: "40(3)", incomeType: "rights_40_3", subtype: "rights" }),
  Object.freeze({ key: "40_4_interest", label: "40(4) เงินได้จากการลงทุน เช่น ดอกเบี้ย", section: "40(4)", incomeType: "investment_40_4", subtype: "investment", legacySubtypes: Object.freeze(["interest"]) }),
  Object.freeze({ key: "40_4_dividend", label: "40(4) เงินปันผล", section: "40(4)", incomeType: "dividend_40_4", subtype: "dividend" }),
  Object.freeze({ key: "40_5", label: "40(5) เงินได้จากการให้เช่าทรัพย์สิน หรือจากการผิดสัญญาเช่าซื้อและขายผ่อน", section: "40(5)", incomeType: "property_40_5", subtype: "property" }),
  Object.freeze({ key: "40_6", label: "40(6) เงินได้จากวิชาชีพอิสระ", section: "40(6)", incomeType: "professional_40_6", subtype: "professional" }),
  Object.freeze({ key: "40_7", label: "40(7) เงินได้จากการรับเหมาที่ผู้รับเหมาจัดหาสัมภาระสำคัญนอกเหนือจากเครื่องมือ", section: "40(7)", incomeType: "contract_40_7", subtype: "contract" }),
  Object.freeze({ key: "40_8", label: "40(8) เงินได้จากธุรกิจ การพาณิชย์ เกษตร อุตสาหกรรม ขนส่ง หรือเงินได้อื่น", section: "40(8)", incomeType: "business_40_8", subtype: "business" }),
]);

const incomeTypesBySubtypes = new Map<IncomeType, string[]>();
for (const choice of INCOME_CHOICES) {
  const subtypes = incomeTypesBySubtypes.get(choice.incomeType) ?? [];
  for (const subtype of [choice.subtype, ...(choice.legacySubtypes ?? [])]) {
    if (subtype !== null && !subtypes.includes(subtype)) subtypes.push(subtype);
  }
  incomeTypesBySubtypes.set(choice.incomeType, subtypes);
}

/** Valid new Section 40 income types and their explicit category subtypes. */
export const SUPPORTED_INCOME_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries([
    ...[...incomeTypesBySubtypes].map(([incomeType, subtypes]) => [incomeType, Object.freeze(subtypes)] as const),
    ["other", Object.freeze(INCOME_CHOICES.map(({ key }) => key))],
  ]),
);
