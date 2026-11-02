import Decimal from "decimal.js";
import type { Row as ExcelRow, Worksheet as ExcelWorksheet } from "exceljs";
import type { CalculationSnapshot as SavedCalculationSnapshot, EvidenceKind, ForeignIncomeSourceDraft } from "../../../shared/contracts.js";
import { countryLabel, CURRENCY_CHOICES, displayKnownExampleNote, EVIDENCE_LABELS, incomeTypeLabel, worksheetLabel, WORKSHEET_SECTIONS } from "../../../shared/labels.js";
import { calculateResidenceDaysInYear, validateResidencePeriods } from "../../../shared/residence.js";
import { formatDate } from "../../components/money.js";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MONEY_FORMAT = "#,##0.00;[Red]-#,##0.00";

type ExcelWorkbook = import("exceljs").Workbook;

function safeFxSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function referenceFor(snapshot: SavedCalculationSnapshot): string {
  return `FTC-${snapshot.caseId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
}

function amountCell(value: string | null | undefined): number | string {
  if (value === null || value === undefined) return "—";
  try {
    const rounded = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const significantDigits = rounded.abs().toFixed(2).replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
    if (significantDigits > 15) return rounded.toFixed(2);
    const cents = Number(rounded.mul(100).toFixed(0));
    if (!Number.isSafeInteger(cents)) return rounded.toFixed(2);
    const numeric = Number(rounded.toFixed(2));
    return new Decimal(String(numeric)).equals(rounded) ? numeric : rounded.toFixed(2);
  } catch { return value; }
}

function sumDecimalValues(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => value !== null && value !== undefined);
  if (!present.length) return null;
  return present.reduce((sum, value) => sum.plus(value), new Decimal(0)).toString();
}

function sameAmount(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try { return new Decimal(left).equals(new Decimal(right)); } catch { return left === right; }
}

function percentCell(value: string | null | undefined): number | string {
  if (value === null || value === undefined) return "—";
  try {
    const decimal = new Decimal(value);
    const roundedPercent = decimal.mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const roundedFraction = roundedPercent.div(100);
    const numeric = roundedFraction.toNumber();
    if (!Number.isFinite(numeric) || !new Decimal(String(numeric)).equals(roundedFraction)) {
      return `${roundedPercent.toFixed(2)}%`;
    }
    return numeric;
  } catch { return value; }
}

function addMoneyRow(sheet: ExcelWorksheet, label: string, value: string | null): void {
  const row = sheet.addRow([label, amountCell(value)]);
  row.getCell(2).numFmt = MONEY_FORMAT;
}

function section(sheet: ExcelWorksheet, heading: string, columns = 9): ExcelRow {
  const row = sheet.addRow([heading]);
  sheet.mergeCells(row.number, 1, row.number, columns);
  const cell = row.getCell(1);
  cell.font = { bold: true, color: { argb: "FF174C9B" }, size: 12 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1FB" } };
  cell.alignment = { vertical: "middle", wrapText: true };
  row.height = 28;
  return row;
}

function tableHeader(sheet: ExcelWorksheet, values: string[]): ExcelRow {
  const row = sheet.addRow(values);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF17324D" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 44;
  return row;
}

function sourceValue(snapshot: SavedCalculationSnapshot, source: ForeignIncomeSourceDraft, index: number, code: "source_G" | "source_share"): string | null {
  const lines = snapshot.result.lines.filter((line) => line.code === code);
  if (source.id) return lines.find((line) => line.sourceId === source.id)?.value ?? null;
  const priorSameCountry = snapshot.inputs.sources.slice(0, index).filter((item) => item.countryCode === source.countryCode).length;
  return lines.filter((line) => line.countryCode === source.countryCode)[priorSameCountry]?.value ?? null;
}

function fxMethodLabel(value: string | null): string {
  switch (value) {
    case "bank_buying": return "อัตรารับซื้อของธนาคาร";
    case "bot_average_buying": return "อัตราเฉลี่ยรับซื้อของธนาคารแห่งประเทศไทย";
    case "manual": return "อัตราที่ผู้ใช้ระบุ";
    case "fixture": return "อัตราสมมติในตัวอย่าง";
    default: return "อัตราที่ระบุ";
  }
}

function fxSourceKindLabel(value: string | null): string {
  switch (value) {
    case "bank": return "ธนาคาร";
    case "bot": return "ธนาคารแห่งประเทศไทย";
    case "user_supplied": return "ผู้ใช้ระบุ";
    case "fixture": return "ตัวอย่างเพื่อการศึกษา";
    default: return "แหล่งอัตราที่ระบุ";
  }
}

function currencyLabel(code: string | null): string {
  if (!code) return "สกุลเงินไม่ระบุ";
  const label = CURRENCY_CHOICES.find((currency) => currency.code === code)?.label ?? "สกุลเงินที่ระบุ";
  return `${label} (${code})`;
}

function addDetailsRow(sheet: ExcelWorksheet, sourceName: string, label: string, value: string | number | Date | null): ExcelRow {
  const safeValue = typeof value === "string" ? String(value) : value;
  return sheet.addRow([sourceName, label, safeValue ?? "—"]);
}

function appendSourceDetails(sheet: ExcelWorksheet, source: ForeignIncomeSourceDraft): void {
  const sourceName = `${countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · ${incomeTypeLabel(source)}`;
  addDetailsRow(sheet, sourceName, "วันที่เกิดเงินได้", formatDate(source.earnedDate));
  addDetailsRow(sheet, sourceName, "วันที่นำเข้าไทย", formatDate(source.remittance?.remittanceDate));
  if (source.residenceDaysInEarnedYear !== null) addDetailsRow(sheet, sourceName, "วันพำนักในปีที่เกิดเงินได้", source.residenceDaysInEarnedYear);
  if (!sameAmount(source.actualForeignTaxPaidThb, source.eligibleForeignTaxThb)) {
    const row = addDetailsRow(sheet, sourceName, "ภาษีที่ชำระทั้งหมดตามหลักฐาน (บาท)", amountCell(source.actualForeignTaxPaidThb));
    row.getCell(3).numFmt = MONEY_FORMAT;
    const usedRow = addDetailsRow(sheet, sourceName, "จำนวน (E) ที่ใช้จัดสรร (G) (บาท)", amountCell(source.eligibleForeignTaxThb));
    usedRow.getCell(3).numFmt = MONEY_FORMAT;
    addDetailsRow(sheet, sourceName, "คำอธิบาย", "จำนวนภาษีจริงกับจำนวน (E) ที่นำไปคำนวณอาจต่างกัน ข้อมูลนี้เป็นจำนวนที่ผู้ใช้ระบุ ไม่ใช่การยืนยันสิทธิทางกฎหมาย");
  }
  if (source.inputMode === "original_currency") {
    addDetailsRow(sheet, sourceName, "สกุลเงินต้นทาง", currencyLabel(source.currencyCode));
    for (const [letter, amount] of [["D", source.grossIncomeAmount], ["E", source.eligibleForeignTax], ["F", source.remittedIncomeAmount]] as const) {
      const row = addDetailsRow(sheet, sourceName, worksheetLabel(letter), amountCell(amount));
      row.getCell(3).numFmt = MONEY_FORMAT;
    }
    if (!sameAmount(source.actualForeignTaxPaid, source.eligibleForeignTax)) {
      const actualRow = addDetailsRow(sheet, sourceName, "ภาษีที่ชำระทั้งหมดตามหลักฐาน", amountCell(source.actualForeignTaxPaid));
      actualRow.getCell(3).numFmt = MONEY_FORMAT;
    }
    const reference = source.fxReference;
    if (reference) {
      addDetailsRow(sheet, sourceName, "อัตราแลกเปลี่ยนที่ใช้", `${reference.thbRate ?? "—"} บาทต่อ ${reference.baseUnits ?? "—"} ${currencyLabel(reference.currencyCode)}`);
      addDetailsRow(sheet, sourceName, "วันที่อัตราแลกเปลี่ยน", reference.effectiveDate);
      addDetailsRow(sheet, sourceName, "วิธีที่ใช้", fxMethodLabel(reference.rateType));
      addDetailsRow(sheet, sourceName, "แหล่งอัตราแลกเปลี่ยนที่ผู้ใช้ระบุ", reference.sourceLabel);
      addDetailsRow(sheet, sourceName, "ประเภทแหล่งอัตรา", fxSourceKindLabel(reference.sourceKind));
      if (reference.educationalAssumption) addDetailsRow(sheet, sourceName, "สมมติฐานที่บันทึก", displayKnownExampleNote(reference.educationalAssumption));
      const sourceUrl = safeFxSourceUrl(reference.sourceUrl);
      if (sourceUrl) {
        const row = addDetailsRow(sheet, sourceName, "แหล่งอัตราแลกเปลี่ยน", null);
        row.getCell(3).value = { text: "แหล่งอัตราแลกเปลี่ยน", hyperlink: sourceUrl, tooltip: sourceUrl };
      }
    }
  }
  if (source.eligibilityRationale) addDetailsRow(sheet, sourceName, "เหตุผลของ (E) ที่ผู้ใช้ระบุ", displayKnownExampleNote(source.eligibilityRationale));
}

function appendResidenceSummary(sheet: ExcelWorksheet, snapshot: SavedCalculationSnapshot): void {
  const periods = snapshot.inputs.residencePeriods;
  if (periods === undefined) return;

  section(sheet, "สรุปช่วงเวลาที่พำนัก", 3);
  if (periods.length > 0) {
    periods.forEach((period, index) => addDetailsRow(
      sheet,
      "",
      `ช่วงที่ ${index + 1}`,
      `${period.startDate ?? "ไม่ระบุวันเริ่มต้น"} – ${period.endDate ?? "ไม่ระบุวันสิ้นสุด"}`,
    ));
  } else {
    addDetailsRow(sheet, "", "ช่วงที่พำนัก", "ไม่มีช่วงวันที่พำนักที่บันทึกไว้ในผลนี้");
  }

  const years = new Set<number>(snapshot.inputs.sources.flatMap((source) =>
    source.earnedTaxYear !== null && Number.isInteger(source.earnedTaxYear) ? [source.earnedTaxYear] : []));
  const periodIssues = validateResidencePeriods(periods);
  if (periodIssues.length === 0) {
    for (const period of periods) {
      const firstYear = Number(period.startDate?.slice(0, 4));
      const lastYear = Number(period.endDate?.slice(0, 4));
      if (!Number.isInteger(firstYear) || !Number.isInteger(lastYear) || lastYear < firstYear) continue;
      for (let year = firstYear; year <= lastYear; year += 1) years.add(year);
    }
  }

  if (years.size > 0) {
    for (const year of [...years].sort((left, right) => left - right)) {
      const days = periodIssues.length === 0 ? calculateResidenceDaysInYear(periods, year) : null;
      const earnedYear = snapshot.inputs.sources.some((source) => source.earnedTaxYear === year);
      const label = `ปี พ.ศ. ${year + 543} (ค.ศ. ${year})${earnedYear ? " · ปีที่เกิดเงินได้" : " · ปีปฏิทินในช่วงพำนัก"}`;
      const value = days === null
        ? "ช่วงวันที่ไม่ครบหรือไม่ถูกต้อง จึงยังสรุปจำนวนวันไม่ได้"
        : `${days} วัน · ${days >= 180 ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41"}`;
      addDetailsRow(sheet, "", label, value);
    }
  } else {
    addDetailsRow(sheet, "", "สรุปจำนวนวัน", "ยังไม่มีปีปฏิทินสำหรับสรุปจำนวนวันพำนัก");
  }

  addDetailsRow(sheet, "", "ข้อสังเกตช่วงพำนัก", "นับวันเริ่มต้นและวันสิ้นสุดรวมกัน และนับวันปฏิทินที่ซ้ำกันเพียงครั้งเดียว สรุปวันพำนักนี้แยกจากปีภาษีที่ใช้ยื่น และไม่ได้ยืนยันการรองรับการคำนวณ สิทธิ FTC หรือสิทธิตาม DTA");
}

function addEvidence(sheet: ExcelWorksheet, snapshot: SavedCalculationSnapshot): void {
  section(sheet, "เอกสารประกอบที่บันทึกกับผลนี้", 3);
  const appendGroup = (heading: string, files: SavedCalculationSnapshot["evidence"]) => {
    addDetailsRow(sheet, heading, "", null);
    if (!files.length) {
      addDetailsRow(sheet, heading, "สถานะ", "ไม่มีหลักฐานแนบในผลคำนวณที่บันทึกไว้นี้");
      return;
    }
    for (const file of files) addDetailsRow(sheet, heading, EVIDENCE_LABELS[file.kind as EvidenceKind], file.displayName);
  };
  appendGroup("หลักฐานภาษีไทย", snapshot.evidence.filter((file) => file.sourceId === null && file.kind === "thai_tax"));
  for (const source of snapshot.inputs.sources) {
    const name = `${countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · ${incomeTypeLabel(source)}`;
    appendGroup(name, snapshot.evidence.filter((file) => source.id !== null && file.sourceId === source.id));
  }
  const other = snapshot.evidence.filter((file) => file.sourceId === null && file.kind !== "thai_tax");
  if (other.length) appendGroup("เอกสารอื่นของกรณี", other);
}

function buildWorksheet(workbook: ExcelWorkbook, snapshot: SavedCalculationSnapshot): void {
  const sheet = workbook.addWorksheet("ผลคำนวณ");
  sheet.properties.defaultRowHeight = 22;
  sheet.columns = [
    { width: 34 }, { width: 31 }, { width: 33 }, { width: 32 }, { width: 24 },
    { width: 29 }, { width: 31 }, { width: 33 }, { width: 23 },
  ];
  const title = sheet.addRow(["รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ"]);
  sheet.mergeCells(title.number, 1, title.number, 9);
  title.getCell(1).font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  title.height = 32;

  const reference = referenceFor(snapshot);
  const date = new Date(snapshot.createdAt);
  const metadata = [
    ["เลขอ้างอิง", reference],
    ["ปีภาษี", snapshot.inputs.taxYear ? `${snapshot.inputs.taxYear + 543} (${snapshot.inputs.taxYear})` : "—"],
    ["ผลคำนวณบันทึกเมื่อ", Number.isNaN(date.getTime()) ? snapshot.createdAt : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date)],
    ["สถานะผล", snapshot.kind === "preview" ? "ร่าง — ยังไม่ได้ส่ง" : "รายงานจากผลที่ส่งแล้ว"],
  ];
  for (const [label, value] of metadata) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow(["", "เวลาที่แสดงคือเวลาบันทึกผลคำนวณ ไม่ใช่เวลายื่นแบบภาษีต่อกรมสรรพากร"]);
  const unitNote = sheet.addRow(["หน่วยเงิน", "ยอดเงินในตารางหลักแสดงเป็นบาท เว้นแต่ระบุสกุลเงินต้นทาง; (H) แสดงเป็นเปอร์เซ็นต์"]);
  sheet.mergeCells(unitNote.number, 2, unitNote.number, 9);
  sheet.addRow([]);

  section(sheet, WORKSHEET_SECTIONS[0]);
  const sourceHeader = tableHeader(sheet, ["แหล่งเงินได้", ...(["A", "B", "C", "D", "E", "F", "G", "H"] as const).map(worksheetLabel)]);
  for (const [index, source] of snapshot.inputs.sources.entries()) {
    const heading = `${countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · ${incomeTypeLabel(source)}`;
    const g = sourceValue(snapshot, source, index, "source_G");
    const h = sourceValue(snapshot, source, index, "source_share");
    const row = sheet.addRow([
      heading,
      source.earnedTaxYear === null ? "—" : source.earnedTaxYear + 543,
      countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ"),
      incomeTypeLabel(source),
      amountCell(source.grossIncomeThb),
      amountCell(source.eligibleForeignTaxThb),
      amountCell(source.remittedIncomeThb),
      amountCell(g),
      percentCell(h),
    ]);
    for (const column of [5, 6, 7, 8]) row.getCell(column).numFmt = MONEY_FORMAT;
    row.getCell(9).numFmt = "0.00%";
    row.eachCell((cell) => { cell.alignment = { vertical: "top", wrapText: true }; });
  }
  if (!snapshot.inputs.sources.length) sheet.addRow(["ยังไม่มีแหล่งเงินได้ในผลคำนวณนี้"]);
  const sourceGTotal = sumDecimalValues(snapshot.result.lines.filter((line) => line.code === "source_G").map((line) => line.value));
  const sourceTotal = sheet.addRow([
    "รวมทุกแหล่งเงินได้", "", "", "",
    amountCell(sumDecimalValues(snapshot.inputs.sources.map((source) => source.grossIncomeThb))),
    amountCell(sumDecimalValues(snapshot.inputs.sources.map((source) => source.eligibleForeignTaxThb))),
    amountCell(snapshot.result.totalRemittedIncome), amountCell(sourceGTotal), "—",
  ]);
  for (const column of [5, 6, 7, 8]) sourceTotal.getCell(column).numFmt = MONEY_FORMAT;
  sourceTotal.font = { bold: true };
  sheet.addRow([]);

  section(sheet, WORKSHEET_SECTIONS[1], 2);
  const summary = [
    ["I", snapshot.result.totalRemittedIncome],
    ["J", snapshot.result.domesticAssessableIncome],
    ["K", snapshot.result.totalAssessableIncome],
    ["L", snapshot.result.thaiTaxBeforeFtc],
  ] as const;
  for (const [letter, value] of summary) addMoneyRow(sheet, worksheetLabel(letter), value);
  addDetailsRow(sheet, "", "ที่มาของข้อมูล (L) ที่ผู้ใช้ระบุ", displayKnownExampleNote(snapshot.inputs.thaiTax.provenance) ?? "ไม่ได้ระบุ");
  addDetailsRow(sheet, "", "คำอธิบาย (L)", "(L) คือภาษีไทยที่ผู้ใช้ระบุว่าคำนวณหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว และก่อนใช้เครดิตภาษีต่างประเทศ ระบบไม่ได้คำนวณยอดนี้หรือยืนยันรายการหักจากเอกสารที่ให้ไว้");
  appendResidenceSummary(sheet, snapshot);
  sheet.addRow([]);

  section(sheet, WORKSHEET_SECTIONS[2], 5);
  tableHeader(sheet, (["M", "N", "O", "P", "Q"] as const).map(worksheetLabel));
  for (const country of snapshot.result.countries) {
    const row = sheet.addRow([
      countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ"),
      amountCell(country.remittedIncome),
      amountCell(country.attributableForeignTax),
      amountCell(country.thaiTaxLimit),
      amountCell(country.displayedAllowableCredit),
    ]);
    for (const column of [2, 3, 4, 5]) row.getCell(column).numFmt = MONEY_FORMAT;
  }
  const countryIncome = snapshot.result.totalRemittedIncome;
  const countryTax = sumDecimalValues(snapshot.result.countries.map((country) => country.attributableForeignTax));
  const countryTotal = sheet.addRow(["รวม", amountCell(countryIncome), amountCell(countryTax), "เพดานแยกตามประเทศ", amountCell(snapshot.result.allowableCredit)]);
  for (const column of [2, 3, 5]) countryTotal.getCell(column).numFmt = MONEY_FORMAT;
  countryTotal.font = { bold: true };
  addDetailsRow(sheet, "", "คำอธิบาย", "เพดาน (P) และเครดิต (Q) คำนวณแยกตามประเทศ ไม่มีการนำส่วนที่เหลือของประเทศหนึ่งไปเพิ่มเครดิตของอีกประเทศ");
  sheet.addRow([]);

  const totalRow = sheet.addRow([WORKSHEET_SECTIONS[3], amountCell(snapshot.result.allowableCredit)]);
  totalRow.font = { bold: true };
  totalRow.getCell(2).numFmt = MONEY_FORMAT;
  if (snapshot.result.displayRoundingReconciliation !== null && snapshot.result.displayRoundingReconciliation !== "0") {
    addMoneyRow(sheet, "ปรับการปัดเศษของยอดรายประเทศที่แสดง", snapshot.result.displayRoundingReconciliation);
  }
  addDetailsRow(sheet, "", "ข้อจำกัด", "ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น");
  sheet.addRow([]);

  section(sheet, "รายละเอียดประกอบแหล่งเงินได้", 3);
  tableHeader(sheet, ["แหล่งเงินได้", "รายการ", "ข้อมูลที่บันทึก"]);
  snapshot.inputs.sources.forEach((source) => appendSourceDetails(sheet, source));
  addEvidence(sheet, snapshot);

  sheet.views = [{ state: "frozen", ySplit: sourceHeader.number, xSplit: 1 }];
  const sourceLastRow = sourceHeader.number + snapshot.inputs.sources.length;
  sheet.autoFilter = { from: `A${sourceHeader.number}`, to: `I${Math.max(sourceHeader.number, sourceLastRow)}` };
  sheet.eachRow((row) => row.eachCell((cell) => { cell.alignment = { vertical: "top", wrapText: true, ...cell.alignment }; }));
}

export async function createSnapshotWorkbook(snapshot: SavedCalculationSnapshot): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ระบบต้นแบบเพื่อการศึกษา";
  workbook.title = "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ";
  workbook.subject = "ข้อมูลและผลจากผลคำนวณที่บันทึกไว้";
  const createdAt = new Date(snapshot.createdAt);
  if (!Number.isNaN(createdAt.getTime())) workbook.created = createdAt;
  buildWorksheet(workbook, snapshot);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], { type: XLSX_MIME_TYPE });
}

export function snapshotWorkbookFilename(snapshot: SavedCalculationSnapshot): string {
  const year = snapshot.inputs.taxYear ? `-${snapshot.inputs.taxYear + 543}` : "";
  return `FTC-${snapshot.caseId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}${year}.xlsx`;
}
