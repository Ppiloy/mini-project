import Decimal from "decimal.js";
import type {
  AttachmentMetadata,
  CalculationLine,
  CalculationResult,
  CountryCalculationResult,
  ExchangeRateReference,
  FtcCaseDraft,
  ForeignIncomeSourceDraft,
  ValidationMessage,
} from "./contracts.js";
import { isSourceEligibilityConfirmationCurrent, isThaiTaxConfirmationCurrent } from "./confirmations.js";
import { draftSchema } from "./draft.js";
import { DEMO_POLICY, type DemoPolicy } from "./policy.js";

const CalcDecimal = Decimal.clone({ precision: DEMO_POLICY.precision, rounding: Decimal.ROUND_HALF_UP });
type Outcome = CalculationResult["outcome"];
interface Assessment { outcome: Outcome; messages: ValidationMessage[] }
interface SourceAmounts { income: Decimal; actualTax: Decimal; eligibleTax: Decimal; remittedIncome: Decimal; }

const msg = (code: string, message: string, path: Array<string | number> = []): ValidationMessage => ({ code, message, path });
const required = (path: Array<string | number>) => msg("input.required", "กรุณากรอกข้อมูลนี้ให้ครบก่อนคำนวณ", path);
const amount = (value: string | null): Decimal | null => value === null ? null : new CalcDecimal(value);
const text = (value: Decimal): string => value.toFixed();
const money = (value: Decimal): string => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const issuePath = (path: PropertyKey[]): Array<string | number> => path.filter((part): part is string | number => typeof part === "string" || typeof part === "number");

function assess(draft: FtcCaseDraft, policy: DemoPolicy): Assessment {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      outcome: "incomplete",
      messages: parsed.error.issues.map((issue) => msg("draft.invalid", "ข้อมูลร่างมีรูปแบบไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ", issuePath(issue.path))),
    };
  }
  const value = parsed.data;
  const messages: ValidationMessage[] = [];
  let incomplete = false;
  let needsReview = false;
  const addIncomplete = (message: ValidationMessage) => { incomplete = true; messages.push(message); };
  const addReview = (message: ValidationMessage) => { needsReview = true; messages.push(message); };

  if (value.taxYear === null) addIncomplete(required(["taxYear"]));
  else if (value.taxYear !== policy.taxYear) addReview(msg("case.unsupported_year", "ต้นแบบรองรับเฉพาะปีภาษี 2568 (ค.ศ. 2025)", ["taxYear"]));
  if (value.domesticAssessableIncome === null) addIncomplete(required(["domesticAssessableIncome"]));
  if (value.thaiTax.amountBeforeFtc === null) addIncomplete(required(["thaiTax", "amountBeforeFtc"]));
  if (value.thaiTax.provenance === null || value.thaiTax.provenance.trim() === "") addIncomplete(required(["thaiTax", "provenance"]));
  if (value.thaiTax.amountBeforeFtc !== null && value.thaiTax.provenance !== null && !isThaiTaxConfirmationCurrent(value)) {
    addReview(msg("confirmation.thai_tax_stale", "ข้อมูลรายได้ อัตราแลกเปลี่ยน หรือที่มาของภาษีไทยเปลี่ยนแล้ว กรุณายืนยันภาษีไทยอีกครั้ง", ["thaiTax"]));
  }
  if (value.sources.length === 0) addIncomplete(msg("source.required", "เพิ่มแหล่งเงินได้ต่างประเทศอย่างน้อยหนึ่งรายการ", ["sources"]));
  if (value.sources.length > policy.maximumSources) addReview(msg("source.too_many", "ต้นแบบรองรับแหล่งเงินได้ไม่เกิน 20 รายการ", ["sources"]));

  value.sources.forEach((source, index) => {
    const path = (field: string) => ["sources", index, field] as Array<string | number>;
    assessSource(source, value.taxYear, policy, path, addIncomplete, addReview);
  });

  if (needsReview) return { outcome: "needs_review", messages };
  if (incomplete) return { outcome: "incomplete", messages };
  return { outcome: "ready", messages };
}

function assessSource(
  source: ForeignIncomeSourceDraft,
  taxYear: number | null,
  policy: DemoPolicy,
  path: (field: string) => Array<string | number>,
  addIncomplete: (message: ValidationMessage) => void,
  addReview: (message: ValidationMessage) => void,
): void {
  const requiredFields: Array<[string, unknown]> = [
    ["countryCode", source.countryCode], ["incomeType", source.incomeType], ["earnedTaxYear", source.earnedTaxYear],
    ["earnedDate", source.earnedDate], ["residenceDaysInEarnedYear", source.residenceDaysInEarnedYear], ["inputMode", source.inputMode],
    ["grossIncomeAmount", source.grossIncomeAmount], ["actualForeignTaxPaid", source.actualForeignTaxPaid], ["eligibleForeignTax", source.eligibleForeignTax],
    ["remittedIncomeAmount", source.remittedIncomeAmount], ["remittance", source.remittance],
  ];
  for (const [field, fieldValue] of requiredFields) if (fieldValue === null) addIncomplete(required(path(field)));
  if (source.countryCode !== null && !(source.countryCode in policy.supportedCountries)) {
    addReview(msg("source.unsupported_country", "ประเทศนี้ยังไม่อยู่ในขอบเขตตัวอย่างที่รองรับ", path("countryCode")));
  }
  if (source.incomeType !== null) {
    const allowedSubtypes = policy.supportedIncomeTypes[source.incomeType];
    const subtypeSupported = allowedSubtypes !== undefined
      && (source.incomeType === "salary_40_1" ? source.subtype === null || allowedSubtypes.includes(source.subtype) : source.subtype !== null && allowedSubtypes.includes(source.subtype));
    if (!subtypeSupported) addReview(msg("source.unsupported_type", "ประเภทเงินได้หรือประเภทย่อยยังไม่รองรับในตัวอย่างนี้", path("incomeType")));
  }
  if (source.unsupportedClassification !== null) {
    addReview(msg("source.unsupported_classification", source.unsupportedExplanation ?? "ข้อเท็จจริงของแหล่งเงินได้นี้ยังไม่รองรับ ต้องตรวจสอบเพิ่มเติม", path("unsupportedClassification")));
  }
  if (source.countryCode !== null && source.countryName !== null && policy.supportedCountries[source.countryCode] !== source.countryName) {
    addReview(msg("source.country_name_mismatch", "ชื่อประเทศไม่ตรงกับรหัสประเทศที่เลือก", path("countryName")));
  }
  if (source.earnedTaxYear !== null && taxYear !== null && source.earnedTaxYear !== taxYear) {
    addReview(msg("source.cross_year_income", "ตัวอย่างนี้รองรับเงินได้และการนำเข้าภายในปีภาษีเดียวกัน", path("earnedTaxYear")));
  }
  if (source.earnedTaxYear !== null && source.earnedTaxYear !== policy.taxYear) {
    addReview(msg("source.unsupported_income_year", "ต้นแบบรองรับเงินได้ที่เกิดในปี 2568 (ค.ศ. 2025) เท่านั้น", path("earnedTaxYear")));
  }
  if (source.earnedDate !== null && source.earnedDate.slice(0, 4) !== String(policy.taxYear)) {
    addReview(msg("source.unsupported_earned_date", "วันที่เกิดเงินได้ต้องอยู่ในปี 2025 สำหรับตัวอย่างนี้", path("earnedDate")));
  }
  if (source.residenceDaysInEarnedYear !== null && source.residenceDaysInEarnedYear < policy.minimumResidenceDays) {
    addReview(msg("source.nonresident_earned_income", "จำนวนวันพำนักต่ำกว่า 180 วัน จึงอยู่นอกกรณีตัวอย่างผู้มีถิ่นที่อยู่", path("residenceDaysInEarnedYear")));
  }
  if (source.inputMode === "worksheet_thb" && source.currencyCode !== null && source.currencyCode !== "THB") {
    addReview(msg("source.worksheet_currency", "จำนวนเงินในโหมดตารางต้องเป็น THB", path("currencyCode")));
  }
  if (source.inputMode === "original_currency") assessFx(source, policy, path, addIncomplete, addReview);

  if (source.eligibleForeignTax !== null && source.actualForeignTaxPaid !== null && new CalcDecimal(source.eligibleForeignTax).gt(source.actualForeignTaxPaid)) {
    addReview(msg("source.eligible_tax_exceeds_paid", "ภาษีที่สมมติว่าเข้าเกณฑ์ต้องไม่เกินภาษีที่ชำระจริง", path("eligibleForeignTax")));
  }
  if (source.grossIncomeAmount !== null && source.remittedIncomeAmount !== null && new CalcDecimal(source.remittedIncomeAmount).gt(source.grossIncomeAmount)) {
    addReview(msg("source.remitted_exceeds_income", "เงินได้ที่นำเข้าต้องไม่เกินเงินได้ต้นทางในกรณีตัวอย่างนี้", path("remittedIncomeAmount")));
  }
  if (source.grossIncomeAmount !== null && new CalcDecimal(source.grossIncomeAmount).isZero()) {
    addReview(msg("source.zero_income_denominator", "เงินได้ต้นทางต้องมากกว่าศูนย์เพื่อใช้เป็นตัวหาร แม้ไม่มีเงินได้นำเข้า", path("grossIncomeAmount")));
    if (source.eligibleForeignTax !== null && !new CalcDecimal(source.eligibleForeignTax).isZero()) {
      addReview(msg("source.tax_without_income", "ไม่มีเงินได้ต้นทาง แต่ระบุภาษีต่างประเทศที่เข้าเกณฑ์มากกว่าศูนย์", path("eligibleForeignTax")));
    }
  }
  if (source.eligibilityRationale === null || source.eligibilityRationale.trim() === "") addIncomplete(required(path("eligibilityRationale")));
  else if (source.eligibleForeignTax !== null && !isSourceEligibilityConfirmationCurrent(source)) addReview(msg("confirmation.eligibility_stale", "กรุณายืนยันสมมติฐานภาษีต่างประเทศที่เข้าเกณฑ์และเหตุผลของรายการนี้", path("eligibilityRationale")));

  const remittance = source.remittance;
  if (remittance === null) return;
  if (remittance.remittanceDate === null) addIncomplete(required([...path("remittance"), "remittanceDate"]));
  else {
    if (remittance.remittanceDate.slice(0, 4) !== String(policy.taxYear)) addReview(msg("source.cross_year_remittance", "วันที่นำเข้าไทยต้องอยู่ในปี 2025 สำหรับตัวอย่างนี้", [...path("remittance"), "remittanceDate"]));
    if (source.earnedDate !== null && remittance.remittanceDate < source.earnedDate) addReview(msg("source.remittance_before_earned", "วันที่นำเข้าไทยต้องไม่ก่อนวันที่เกิดเงินได้", [...path("remittance"), "remittanceDate"]));
  }
  if (remittance.transferTotalAmount === null) addIncomplete(required([...path("remittance"), "transferTotalAmount"]));
  if (remittance.transferCurrencyCode === null) addIncomplete(required([...path("remittance"), "transferCurrencyCode"]));
  if (source.currencyCode !== null && remittance.transferCurrencyCode !== null && source.currencyCode !== remittance.transferCurrencyCode) {
    addReview(msg("source.cross_currency_remittance", "ต้นแบบยังไม่รองรับการแปลงคนละสกุลเงินระหว่างเงินได้กับการโอน", [...path("remittance"), "transferCurrencyCode"]));
  }
  if (remittance.classification === null) addIncomplete(required([...path("remittance"), "classification"]));
  else if (remittance.classification !== "income_only") addReview(msg("source.unsupported_remittance_classification", remittance.classificationNote ?? "การโอนรวมเงินต้นหรือรายการกำกวมต้องตรวจสอบเพิ่มเติม", [...path("remittance"), "classification"]));
}

function assessFx(
  source: ForeignIncomeSourceDraft,
  policy: DemoPolicy,
  path: (field: string) => Array<string | number>,
  addIncomplete: (message: ValidationMessage) => void,
  addReview: (message: ValidationMessage) => void,
): void {
  const fx = source.fxReference;
  if (fx === null) { addIncomplete(required(path("fxReference"))); return; }
  const requiredFx: Array<[string, string | number | null]> = [
    ["currencyCode", fx.currencyCode], ["thbRate", fx.thbRate], ["baseUnits", fx.baseUnits], ["effectiveDate", fx.effectiveDate],
    ["rateType", fx.rateType], ["sourceKind", fx.sourceKind], ["sourceLabel", fx.sourceLabel],
  ];
  for (const [field, value] of requiredFx) if (value === null) addIncomplete(required([...path("fxReference"), field]));
  if (fx.currencyCode !== null && source.currencyCode !== null && fx.currencyCode !== source.currencyCode) {
    addReview(msg("fx.currency_mismatch", "สกุลเงินของอัตราแลกเปลี่ยนต้องตรงกับ D/E/F", [...path("fxReference"), "currencyCode"]));
  }
  if (fx.rateType === "manual") {
    if (fx.sourceKind !== "user_supplied" || fx.sourceLabel?.trim() === "" || fx.effectiveDate === null || fx.educationalAssumption?.trim() === "") {
      addReview(msg("fx.manual_provenance_missing", "อัตราที่กรอกเองต้องระบุวันที่ อัตรา แหล่งที่มา และสมมติฐานเพื่อการศึกษา", path("fxReference")));
    }
  } else if (!policy.approvedFxReferences.some((approved) =>
    exactFxReferenceMatch(fx, approved.reference) && source.remittance?.remittanceDate === approved.remittanceDate)) {
    addReview(msg("fx.reference_unverified", "อัตรานี้ยังไม่มีแหล่งอ้างอิงที่ตรวจสอบและอนุมัติไว้สำหรับวันที่นำเข้านี้", path("fxReference")));
  }
}

function exactFxReferenceMatch(left: ExchangeRateReference, right: ExchangeRateReference): boolean {
  return left.currencyCode === right.currencyCode
    && left.thbRate === right.thbRate
    && left.baseUnits === right.baseUnits
    && left.effectiveDate === right.effectiveDate
    && left.rateType === right.rateType
    && left.sourceKind === right.sourceKind
    && left.sourceLabel === right.sourceLabel
    && left.sourceUrl === right.sourceUrl
    && left.educationalAssumption === right.educationalAssumption;
}

function sourceAmounts(source: ForeignIncomeSourceDraft): SourceAmounts {
  const income = new CalcDecimal(source.grossIncomeAmount!);
  const actualTax = new CalcDecimal(source.actualForeignTaxPaid!);
  const eligibleTax = new CalcDecimal(source.eligibleForeignTax!);
  const remittedIncome = new CalcDecimal(source.remittedIncomeAmount!);
  if (source.inputMode === "worksheet_thb") return { income, actualTax, eligibleTax, remittedIncome };
  const fx = source.fxReference!;
  const rate = new CalcDecimal(fx.thbRate!);
  const units = new CalcDecimal(fx.baseUnits!);
  return {
    income: income.mul(rate).div(units),
    actualTax: actualTax.mul(rate).div(units),
    eligibleTax: eligibleTax.mul(rate).div(units),
    remittedIncome: remittedIncome.mul(rate).div(units),
  };
}

/** Rebuilds cached THB fields from raw inputs for server persistence and snapshots. */
export function withCanonicalThbAmounts(draft: FtcCaseDraft): FtcCaseDraft {
  const parsed = draftSchema.parse(draft);
  return {
    ...parsed,
    sources: parsed.sources.map((source) => {
      const fx = source.fxReference;
      const worksheetReady = source.inputMode === "worksheet_thb" && source.currencyCode === "THB";
      const originalCurrencyReady = source.inputMode === "original_currency"
        && fx !== null
        && fx.currencyCode === source.currencyCode
        && fx.thbRate !== null
        && fx.baseUnits !== null
        && fx.effectiveDate !== null
        && fx.rateType !== null
        && fx.sourceKind !== null
        && fx.sourceLabel !== null;
      const rate = worksheetReady ? new CalcDecimal(1)
        : originalCurrencyReady ? new CalcDecimal(fx.thbRate!).div(fx.baseUnits!) : null;
      const convert = (raw: string | null) => raw === null || rate === null ? null : text(new CalcDecimal(raw).mul(rate));
      const transferCurrencyMatches = source.remittance?.transferCurrencyCode === source.currencyCode;
      return {
        ...source,
        grossIncomeThb: convert(source.grossIncomeAmount),
        actualForeignTaxPaidThb: convert(source.actualForeignTaxPaid),
        eligibleForeignTaxThb: convert(source.eligibleForeignTax),
        remittedIncomeThb: convert(source.remittedIncomeAmount),
        remittance: source.remittance === null ? null : {
          ...source.remittance,
          transferTotalThb: transferCurrencyMatches ? convert(source.remittance.transferTotalAmount) : null,
        },
      };
    }),
  };
}

function fxDescription(source: ForeignIncomeSourceDraft): string {
  if (source.inputMode === "worksheet_thb") return "รับค่า D/E/F จากช่องจำนวนเงิน THB ในตาราง; ไม่ใช้ค่าที่ส่งมาในฟิลด์ *Thb";
  const fx = source.fxReference!;
  return `แปลงด้วย ${fx.thbRate} THB ต่อ ${fx.baseUnits} ${fx.currencyCode} ณ ${fx.effectiveDate} (${fx.rateType}; ${fx.sourceKind}; ${fx.sourceLabel}; ${fx.educationalAssumption ?? "ไม่มีสมมติฐานเพิ่มเติม"})`;
}

function invalidResult(outcome: Exclude<Outcome, "ready">, messages: ValidationMessage[], policy: DemoPolicy): CalculationResult {
  return {
    outcome,
    allowableCredit: null,
    unroundedCountryCreditTotal: null,
    displayRoundingReconciliation: null,
    domesticAssessableIncome: null,
    totalRemittedIncome: null,
    totalAssessableIncome: null,
    thaiTaxBeforeFtc: null,
    countries: [],
    lines: [],
    validationMessages: messages,
    assumptions: [...policy.assumptions],
    policyVersion: policy.id,
    engineVersion: policy.engineVersion,
    roundingPolicy: policy.roundingPolicy,
  };
}

/** Pure calculator: trusts only raw D/E/F strings, never client-provided derived THB totals. */
export function calculateFTC(draft: FtcCaseDraft, policy: DemoPolicy = DEMO_POLICY): CalculationResult {
  const validation = assess(draft, policy);
  if (validation.outcome !== "ready") return invalidResult(validation.outcome, validation.messages, policy);

  const domestic = amount(draft.domesticAssessableIncome)!;
  const thaiTax = amount(draft.thaiTax.amountBeforeFtc)!;
  const lines: CalculationLine[] = [];
  const sourceRows = draft.sources.map((source) => {
    const converted = sourceAmounts(source);
    const share = converted.income.isZero() ? new CalcDecimal(0) : converted.remittedIncome.div(converted.income);
    const attributableTax = converted.remittedIncome.isZero() || converted.income.isZero()
      ? new CalcDecimal(0)
      : share.mul(converted.eligibleTax);
    const explanation = fxDescription(source);
    const values: Array<[string, string, Decimal]> = [
      ["source_D", "D — เงินได้ต่างประเทศที่เกี่ยวข้อง (THB)", converted.income],
      ["source_E_paid", "ภาษีต่างประเทศที่ชำระจริง (THB)", converted.actualTax],
      ["source_E_eligible", "E — ภาษีต่างประเทศตามสมมติฐานที่ยืนยัน (THB)", converted.eligibleTax],
      ["source_F", "F — เงินได้ที่นำเข้าไทย (THB)", converted.remittedIncome],
      ["source_share", "สัดส่วน F/D", share],
      ["source_G", "G — ภาษีต่างประเทศที่จัดสรรให้ F (THB)", attributableTax],
    ];
    for (const [code, label, value] of values) lines.push({ code, label, countryCode: source.countryCode, sourceId: source.id, value: text(value), explanation });
    if (converted.remittedIncome.isZero()) lines.push({ code: "source.zero_contribution", label: "ไม่มีเงินได้จากรายการนี้ที่นำเข้าไทย", countryCode: source.countryCode, sourceId: source.id, value: "0", explanation: "รายการนี้ไม่ก่อให้เกิดเครดิต และไม่หารด้วย D=0" });
    return { source, income: converted.income, actualTax: converted.actualTax, eligibleTax: converted.eligibleTax, remittedIncome: converted.remittedIncome, share, attributableTax };
  });

  const totalRemitted = sourceRows.reduce((sum, row) => sum.plus(row.remittedIncome), new CalcDecimal(0));
  const totalAssessable = domestic.plus(totalRemitted);
  const countryCodes = [...new Set(sourceRows.map(({ source }) => source.countryCode!))].sort();
  const countries: CountryCalculationResult[] = [];
  let unroundedTotal = new CalcDecimal(0);
  for (const countryCode of countryCodes) {
    const rows = sourceRows.filter(({ source }) => source.countryCode === countryCode);
    const remittedIncome = rows.reduce((sum, row) => sum.plus(row.remittedIncome), new CalcDecimal(0));
    const attributableTax = rows.reduce((sum, row) => sum.plus(row.attributableTax), new CalcDecimal(0));
    const limit = remittedIncome.isZero() || totalAssessable.isZero()
      ? new CalcDecimal(0)
      : remittedIncome.div(totalAssessable).mul(thaiTax);
    const credit = CalcDecimal.min(attributableTax, limit);
    const countryName = policy.supportedCountries[countryCode] ?? rows[0]?.source.countryName ?? countryCode;
    const result: CountryCalculationResult = {
      countryCode,
      countryName,
      remittedIncome: text(remittedIncome),
      attributableForeignTax: text(attributableTax),
      thaiTaxLimit: text(limit),
      allowableCredit: text(credit),
      displayedAllowableCredit: money(credit),
    };
    countries.push(result);
    unroundedTotal = unroundedTotal.plus(credit);
    const countryExplanation = `รวม ${rows.length} รายการจากประเทศเดียวกัน; ไม่รวมเพดานที่เหลือจากประเทศอื่น`;
    for (const [code, label, value] of [
      ["country_N", "N — เงินได้ที่นำเข้ารวมตามประเทศ", remittedIncome],
      ["country_O", "O — ภาษีต่างประเทศที่จัดสรรรวมตามประเทศ", attributableTax],
      ["country_P", "P — เพดานภาษีไทยตามประเทศ", limit],
      ["country_Q", "Q — เครดิตที่ใช้ได้ตามประเทศ", credit],
    ] as Array<[string, string, Decimal]>) {
      lines.push({ code, label, countryCode, sourceId: null, value: text(value), explanation: countryExplanation });
    }
  }

  const finalTotal = unroundedTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const displayedCountries = countries.reduce((sum, country) => sum.plus(country.displayedAllowableCredit), new CalcDecimal(0));
  const reconciliation = finalTotal.minus(displayedCountries);
  lines.push({ code: "case_J", label: "J — เงินได้พึงประเมินในประเทศ", countryCode: null, sourceId: null, value: text(domestic), explanation: "ผู้ใช้ระบุจากตัวอย่างที่จัดเตรียมไว้ ไม่ได้คำนวณจากข้อมูลนี้" });
  lines.push({ code: "case_I", label: "I — เงินได้ต่างประเทศที่นำเข้ารวม", countryCode: null, sourceId: null, value: text(totalRemitted), explanation: "ผลรวม F ที่แปลงเป็น THB ด้วยแหล่งอัตราที่แสดงในแต่ละรายการ" });
  lines.push({ code: "case_K", label: "K — เงินได้พึงประเมินรวมก่อนหักรายการอื่น", countryCode: null, sourceId: null, value: text(totalAssessable), explanation: "K = J + I" });
  lines.push({ code: "case_L", label: "L — ภาษีไทยก่อนเครดิตภาษีต่างประเทศ", countryCode: null, sourceId: null, value: text(thaiTax), explanation: draft.thaiTax.provenance! });
  lines.push({ code: "case_total_credit", label: "เครดิตรวมหลังปัดเศษ", countryCode: null, sourceId: null, value: money(finalTotal), explanation: "รวม Q ที่ยังไม่ปัดเศษก่อน แล้วปัดยอดรวมเป็นสองตำแหน่ง" });
  if (!reconciliation.isZero()) lines.push({ code: "case_display_reconciliation", label: "ยอดปรับให้ตารางแสดงตรงกับเครดิตรวม", countryCode: null, sourceId: null, value: text(reconciliation), explanation: "ยอดรวมสุดท้ายลบผลรวมเครดิตรายประเทศที่แสดงสองตำแหน่ง" });

  return {
    outcome: "ready",
    allowableCredit: money(finalTotal),
    unroundedCountryCreditTotal: text(unroundedTotal),
    displayRoundingReconciliation: reconciliation.isZero() ? "0" : text(reconciliation),
    domesticAssessableIncome: text(domestic),
    totalRemittedIncome: text(totalRemitted),
    totalAssessableIncome: text(totalAssessable),
    thaiTaxBeforeFtc: text(thaiTax),
    countries,
    lines,
    validationMessages: [],
    assumptions: [...policy.assumptions],
    policyVersion: policy.id,
    engineVersion: policy.engineVersion,
    roundingPolicy: policy.roundingPolicy,
  };
}

export interface SubmissionValidationContext {
  currentRevision: number;
  previewRevision: number | null;
  readyEvidence: readonly AttachmentMetadata[];
}

/** Submission adds confirmations, a current preview, positive remittance and ready evidence. */
export function validateSubmission(
  draft: FtcCaseDraft,
  result: CalculationResult,
  context: SubmissionValidationContext,
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  if (result.outcome !== "ready") messages.push(msg("submit.calculation_not_ready", "กรุณาแก้ไขข้อมูลให้คำนวณได้ครบถ้วนก่อนส่งตรวจ", []));
  if (!isThaiTaxConfirmationCurrent(draft)) messages.push(msg("confirmation.thai_tax_stale", "กรุณายืนยันจำนวนและที่มาของภาษีไทยกับข้อมูลปัจจุบัน", ["thaiTax"]));
  draft.sources.forEach((source, index) => {
    if (!isSourceEligibilityConfirmationCurrent(source)) messages.push(msg("confirmation.eligibility_stale", "กรุณายืนยันจำนวนภาษีต่างประเทศที่เข้าเกณฑ์และเหตุผลของแหล่งเงินได้นี้", ["sources", index, "eligibilityRationale"]));
  });
  const hasPositiveRemittance = draft.sources.some((source) => source.remittedIncomeAmount !== null && new CalcDecimal(source.remittedIncomeAmount).gt(0));
  if (!hasPositiveRemittance) messages.push(msg("submit.no_positive_remittance", "ต้องมีแหล่งเงินได้ที่รองรับและมีจำนวนเงินนำเข้าไทยมากกว่าศูนย์", ["sources"]));
  if (context.previewRevision === null || context.previewRevision !== context.currentRevision) {
    messages.push(msg("submit.preview_stale", "กรุณาคำนวณตัวอย่างใหม่หลังบันทึกการแก้ไขล่าสุด", []));
  }
  if (!context.readyEvidence.some((evidence) => evidence.status === "ready" && evidence.kind === "thai_tax" && evidence.sourceId === null)) {
    messages.push(msg("submit.thai_tax_evidence_missing", "กรุณาแนบหลักฐานภาษีไทยที่พร้อมใช้งาน", ["evidence"]));
  }
  draft.sources.forEach((source, index) => {
    if (source.id === null) {
      messages.push(msg("submit.source_id_missing", "บันทึกแหล่งเงินได้ก่อนแนบหลักฐาน", ["sources", index, "id"]));
      return;
    }
    for (const kind of ["foreign_income", "foreign_tax", "remittance"] as const) {
      const attached = context.readyEvidence.some((evidence) => evidence.status === "ready" && evidence.sourceId === source.id && evidence.kind === kind);
      if (!attached) messages.push(msg("submit.source_evidence_missing", "หลักฐานของแหล่งเงินได้นี้ยังไม่ครบหรือยังประมวลผลไม่เสร็จ", ["sources", index, "evidenceChecklist"]));
    }
  });
  return messages;
}
