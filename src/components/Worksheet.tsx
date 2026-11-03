import Decimal from "decimal.js";
import { fxDateBasisLabel, MANUAL_FX_NOTICE } from "../../shared/manualFx.js";
import { Fragment, useEffect, useRef } from "react";
import type { AttachmentMetadata, CalculationSnapshot, ForeignIncomeSourceDraft, FrozenEvidenceReference } from "../../shared/contracts.js";
import { countryLabel, CURRENCY_CHOICES, displayKnownExampleNote, EVIDENCE_LABELS, incomeTypeLabel, WORKSHEET_SECTIONS, type WorksheetLetter } from "../../shared/labels.js";
import { EvidenceFileActions } from "./EvidenceFileActions.js";
import { FieldLabel } from "./FieldLabel.js";
import { formatDate, formatMoney } from "./money.js";
import { assessResidenceYear, calculateResidenceDaysInYear, validateResidencePeriods } from "../../shared/residence.js";
import { effectiveForeignTaxAmount, hasEligibleTaxAdjustment } from "../../shared/foreignTax.js";
import { missingEvidenceInventory } from "../../shared/evidenceInventory.js";

type Mode = "demo" | "hosted";

const SOURCE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const satisfies readonly WorksheetLetter[];
const SUMMARY_LETTERS = ["I", "J", "K", "L"] as const;
const COUNTRY_LETTERS = ["M", "N", "O", "P", "Q"] as const satisfies readonly WorksheetLetter[];

function thaiYear(year: number | null | undefined): string {
  return year ? String(year + 543) : "—";
}

function thaiCurrency(code: string | null | undefined): string {
  const label = CURRENCY_CHOICES.find((currency) => currency.code === code)?.label ?? (code ? "สกุลเงินที่ระบุ" : "สกุลเงินไม่ระบุ");
  return code ? `${label} (${code})` : label;
}

function formatRate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const rounded = new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
    return rounded.replace(/0+$/, "").replace(/\.$/, "");
  } catch { return "—"; }
}

function sumValues(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => value !== null && value !== undefined);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed();
}

function percentage(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  try { return `${new Decimal(value).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}%`; }
  catch { return "—"; }
}

function sourceLineValue(snapshot: CalculationSnapshot, source: ForeignIncomeSourceDraft, sourceIndex: number, code: string): string | null {
  const lines = snapshot.result.lines.filter((line) => line.code === code);
  if (source.id) return lines.find((line) => line.sourceId === source.id)?.value ?? null;
  const precedingSourcesInCountry = snapshot.inputs.sources.slice(0, sourceIndex).filter((item) => item.countryCode === source.countryCode).length;
  return lines.filter((line) => line.countryCode === source.countryCode)[precedingSourcesInCountry]?.value ?? null;
}

function sourceFieldValue(snapshot: CalculationSnapshot, source: ForeignIncomeSourceDraft, index: number, letter: typeof SOURCE_LETTERS[number]): string {
  if (letter === "A") return thaiYear(source.earnedTaxYear);
  if (letter === "B") return countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", source.countryName);
  if (letter === "C") return incomeTypeLabel(source);
  if (letter === "D") return `${formatMoney(source.grossIncomeThb)} บาท`;
  if (letter === "E") {
    const value = sourceLineValue(snapshot, source, index, "source_E_eligible") ?? source.eligibleForeignTaxThb;
    return `${formatMoney(value)} บาท`;
  }
  if (letter === "F") return `${formatMoney(source.remittedIncomeThb)} บาท`;
  if (letter === "G") {
    const value = sourceLineValue(snapshot, source, index, "source_G");
    return value === null ? "—" : `${formatMoney(value)} บาท`;
  }
  return percentage(sourceLineValue(snapshot, source, index, "source_share"));
}

function fxRateTypeLabel(rateType: string | null): string {
  switch (rateType) {
    case "bank_buying": return "อัตรารับซื้อของธนาคาร";
    case "bot_average_buying": return "อัตราเฉลี่ยรับซื้อของธนาคารแห่งประเทศไทย";
    case "manual": return "อัตราที่ผู้ใช้ระบุ";
    case "fixture": return "อัตราสมมติในตัวอย่าง";
    default: return "อัตราที่ระบุ";
  }
}

function fxSourceLabel(sourceKind: string | null): string {
  switch (sourceKind) {
    case "bank": return "ธนาคาร";
    case "bot": return "ธนาคารแห่งประเทศไทย";
    case "user_supplied": return "ผู้ใช้ระบุ";
    case "fixture": return "ตัวอย่างเพื่อการศึกษา";
    default: return "แหล่งอัตราที่ระบุ";
  }
}

function safeFxSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function FxReferenceDetails({ reference }: { reference: NonNullable<ForeignIncomeSourceDraft["fxReference"]> }) {
  const sourceUrl = safeFxSourceUrl(reference.sourceUrl);
  return <>
    <span>อัตรา {formatRate(reference.thbRate)} บาทต่อ {reference.baseUnits ?? "—"} {thaiCurrency(reference.currencyCode)} · วิธี: {fxRateTypeLabel(reference.rateType)} · แหล่งที่ผู้ใช้ระบุ: {reference.sourceLabel ?? "ไม่ระบุ"} · {fxSourceLabel(reference.sourceKind)} · วันที่ {formatDate(reference.effectiveDate)}</span>
    {reference.sourceKind === "user_supplied" && <span>{fxDateBasisLabel(reference.rateType)} · {MANUAL_FX_NOTICE}</span>}
    {reference.educationalAssumption && <span className="worksheet-fx-assumption">{displayKnownExampleNote(reference.educationalAssumption)}</span>}
    {sourceUrl && <a className="worksheet-fx-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">แหล่งอัตราแลกเปลี่ยน</a>}
  </>;
}

function SourceValues({ snapshot, source, index }: { snapshot: CalculationSnapshot; source: ForeignIncomeSourceDraft; index: number }) {
  const differentTaxAmount = hasEligibleTaxAdjustment(source);
  const effectiveTax = effectiveForeignTaxAmount(source);

  return <>
    <tr className="worksheet-source-values">
      {SOURCE_LETTERS.map((letter) => <td key={letter}>{sourceFieldValue(snapshot, source, index, letter)}</td>)}
    </tr>
    <tr className="worksheet-source-details"><td colSpan={8}>
      <div className="worksheet-source-meta">
        <span><strong>วันที่เกิดเงินได้:</strong> {formatDate(source.earnedDate)}</span>
        <span><strong>วันที่นำเข้าไทย:</strong> {formatDate(source.remittance?.remittanceDate)}</span>
        <SourceResidenceSummaryLink snapshot={snapshot} source={source} />
      </div>
      {source.inputMode === "original_currency" && <div className="worksheet-original-currency">
        <strong>จำนวนเงินต้นทาง</strong>
        <span>เงินได้ (D) {formatMoney(source.grossIncomeAmount)} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "D")}</span>
        <span>ภาษีจำนวน (E) ที่ใช้คำนวณ {formatMoney(effectiveTax)} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "E")}</span>
        {differentTaxAmount && <span>ภาษีที่ชำระทั้งหมดตามหลักฐาน {formatMoney(source.actualForeignTaxPaid)} {thaiCurrency(source.currencyCode)}</span>}
        <span>เงินได้ที่นำเข้า (F) {formatMoney(source.remittedIncomeAmount)} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "F")}</span>
        {source.fxReference && <FxReferenceDetails reference={source.fxReference} />}
      </div>}
      {differentTaxAmount && <p className="worksheet-assumption-note">ภาษีที่ชำระจริง: {formatMoney(source.actualForeignTaxPaidThb)} บาท · จำนวน (E) ที่ใช้คำนวณ (G): {formatMoney(sourceLineValue(snapshot, source, index, "source_E_eligible") ?? source.eligibleForeignTaxThb)} บาท</p>}
      {source.eligibilityRationale && <p className="worksheet-source-rationale"><strong>{differentTaxAmount ? "เหตุผลการปรับจำนวน (E) ที่ผู้ใช้ระบุ:" : "หมายเหตุเดิมที่บันทึกไว้:"}</strong> {displayKnownExampleNote(source.eligibilityRationale)}</p>}
    </td></tr>
  </>;
}

function SourceTotals({ snapshot }: { snapshot: CalculationSnapshot }) {
  const sources = snapshot.inputs.sources;
  const totalGrossIncome = sumValues(sources.map((source) => source.grossIncomeThb));
  const totalCalculationTax = sumValues(snapshot.result.lines.filter((line) => line.code === "source_E_eligible").map((line) => line.value));
  const totalAllocatedTax = sumValues(snapshot.result.lines.filter((line) => line.code === "source_G").map((line) => line.value));
  const totalActualTax = sumValues(snapshot.result.lines.filter((line) => line.code === "source_E_paid").map((line) => line.value));
  const actualTaxDiffers = sources.some(hasEligibleTaxAdjustment);
  return <>
    <div className="worksheet-source-totals-mobile">
      <strong>รวมทุกแหล่งเงินได้</strong>
      <span><FieldLabel letter="D" />: {formatMoney(totalGrossIncome)} บาท</span>
      <span><FieldLabel letter="E" />: {formatMoney(totalCalculationTax)} บาท</span>
      <span><FieldLabel letter="F" />: {formatMoney(snapshot.result.totalRemittedIncome)} บาท</span>
      <span><FieldLabel letter="G" />: {formatMoney(totalAllocatedTax)} บาท</span>
      {actualTaxDiffers && <span>ภาษีที่ชำระทั้งหมดตามหลักฐาน: {formatMoney(totalActualTax)} บาท</span>}
    </div>
    {actualTaxDiffers && <p className="worksheet-paid-tax-total">ภาษีที่ชำระทั้งหมดตามหลักฐาน: {formatMoney(totalActualTax)} บาท</p>}
  </>;
}

function SourceCards({ snapshot }: { snapshot: CalculationSnapshot }) {
  return <div className="worksheet-source-cards">
    {snapshot.inputs.sources.map((source, index) => <article className="worksheet-source-card" key={source.id ?? `source-${index}`}>
      <h3>{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", source.countryName)} · {incomeTypeLabel(source)}</h3>
      <dl>
        {SOURCE_LETTERS.map((letter) => <div key={letter}><dt><FieldLabel letter={letter} /></dt><dd>{sourceFieldValue(snapshot, source, index, letter)}</dd></div>)}
      </dl>
      <div className="worksheet-source-meta">
        <span><strong>วันที่เกิดเงินได้:</strong> {formatDate(source.earnedDate)}</span>
        <span><strong>วันที่นำเข้าไทย:</strong> {formatDate(source.remittance?.remittanceDate)}</span>
        <SourceResidenceSummaryLink snapshot={snapshot} source={source} />
      </div>
      {source.inputMode === "original_currency" && <div className="worksheet-original-currency"><strong>จำนวนเงินต้นทาง</strong>
        <span>เงินได้ (D) {formatMoney(source.grossIncomeAmount)} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "D")}</span>
        <span>ภาษีจำนวน (E) ที่ใช้คำนวณ {formatMoney(effectiveForeignTaxAmount(source))} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "E")}</span>
        {hasEligibleTaxAdjustment(source) && <span>ภาษีที่ชำระจริง {formatMoney(source.actualForeignTaxPaid)} {thaiCurrency(source.currencyCode)}</span>}
        <span>เงินได้ที่นำเข้า (F) {formatMoney(source.remittedIncomeAmount)} {thaiCurrency(source.currencyCode)} = {sourceFieldValue(snapshot, source, index, "F")}</span>
        {source.fxReference && <FxReferenceDetails reference={source.fxReference} />}</div>}
      {hasEligibleTaxAdjustment(source) && <p className="worksheet-assumption-note">ภาษีที่ชำระจริง: {formatMoney(source.actualForeignTaxPaidThb)} บาท · จำนวน (E) ที่ใช้คำนวณ (G): {formatMoney(sourceLineValue(snapshot, source, index, "source_E_eligible") ?? source.eligibleForeignTaxThb)} บาท</p>}
      {source.eligibilityRationale && <p className="worksheet-source-rationale"><strong>{hasEligibleTaxAdjustment(source) ? "เหตุผลการปรับจำนวน (E) ที่ผู้ใช้ระบุ:" : "หมายเหตุเดิมที่บันทึกไว้:"}</strong> {displayKnownExampleNote(source.eligibilityRationale)}</p>}
    </article>)}
  </div>;
}

function CountryTable({ snapshot }: { snapshot: CalculationSnapshot }) {
  const { countries, allowableCredit } = snapshot.result;
  const totalIncome = sumValues(countries.map((country) => country.remittedIncome));
  const totalAllocatedTax = sumValues(countries.map((country) => country.attributableForeignTax));
  return <div className="table-scroll worksheet-country-table-wrap"><table aria-labelledby="worksheet-country-heading" className="data-table worksheet-country-table">
    <thead><tr>{COUNTRY_LETTERS.map((letter) => <th key={letter} scope="col"><FieldLabel letter={letter} /></th>)}</tr></thead>
    <tbody>
      {countries.map((country) => <tr key={country.countryCode}>
        <th scope="row">{countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", country.countryName)}</th>
        <td>{formatMoney(country.remittedIncome)} บาท</td>
        <td>{formatMoney(country.attributableForeignTax)} บาท</td>
        <td>{formatMoney(country.thaiTaxLimit)} บาท</td>
        <td><strong>{formatMoney(country.displayedAllowableCredit)} บาท</strong></td>
      </tr>)}
      {countries.length === 0 && <tr><td colSpan={5} className="empty-cell">ยังไม่มีผลรายประเทศที่คำนวณได้</td></tr>}
    </tbody>
    <tfoot><tr><th scope="row">รวม</th><td>{formatMoney(totalIncome)} บาท</td><td>{formatMoney(totalAllocatedTax)} บาท</td><td>ไม่รวมเพดานข้ามประเทศ</td><td><strong>{formatMoney(allowableCredit)} บาท</strong></td></tr></tfoot>
  </table></div>;
}

function CountryCards({ snapshot }: { snapshot: CalculationSnapshot }) {
  const { countries, allowableCredit } = snapshot.result;
  const totalIncome = sumValues(countries.map((country) => country.remittedIncome));
  const totalAllocatedTax = sumValues(countries.map((country) => country.attributableForeignTax));
  return <div className="worksheet-country-cards">
    {countries.map((country) => <article className="worksheet-country-card" key={country.countryCode}>
      <h3>{countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", country.countryName)}</h3>
      <dl>{COUNTRY_LETTERS.map((letter) => <div key={letter}>
        <dt><FieldLabel letter={letter} /></dt>
        <dd>{letter === "M" ? countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", country.countryName) : letter === "N" ? `${formatMoney(country.remittedIncome)} บาท` : letter === "O" ? `${formatMoney(country.attributableForeignTax)} บาท` : letter === "P" ? `${formatMoney(country.thaiTaxLimit)} บาท` : `${formatMoney(country.displayedAllowableCredit)} บาท`}</dd>
      </div>)}</dl>
    </article>)}
    {countries.length === 0 && <p className="empty-cell">ยังไม่มีผลรายประเทศที่คำนวณได้</p>}
    <div className="worksheet-country-total"><strong>รวม</strong><span><FieldLabel letter="N" />: {formatMoney(totalIncome)} บาท</span><span><FieldLabel letter="O" />: {formatMoney(totalAllocatedTax)} บาท</span><span><FieldLabel letter="Q" />: {formatMoney(allowableCredit)} บาท</span><small>เพดาน (P) คงแยกตามประเทศ</small></div>
  </div>;
}

function ResidencePeriodSummary({ snapshot }: { snapshot: CalculationSnapshot }) {
  const residenceYears = snapshot.inputs.residenceYears;
  if (residenceYears !== undefined) {
    const years = [...new Set([
      ...residenceYears.map((record) => record.earnedTaxYear),
      ...snapshot.inputs.sources.flatMap((source) => source.earnedTaxYear === null ? [] : [source.earnedTaxYear]),
    ])].sort((left, right) => left - right);
    return <section id="worksheet-residence-summary" className="worksheet-residence-summary" aria-label="สรุปช่วงเวลาที่พำนัก">
      <h3>สรุปช่วงเวลาที่พำนักตามปีที่เกิดเงินได้</h3>
      {years.length === 0 && <p>ยังไม่มีข้อมูลวันพำนักตามปีที่เกิดเงินได้ในผลนี้</p>}
      <dl className="worksheet-residence-years">{years.map((year) => {
        const record = residenceYears.find((item) => item.earnedTaxYear === year);
        const assessment = assessResidenceYear(record, year);
        return <div key={year}>
          <dt>{thaiYear(year)} · ปีที่เกิดเงินได้</dt>
          <dd>{!record ? "ยังไม่มีข้อมูลวันพำนักสำหรับปีนี้"
            : record.mode === "declared" ? "ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน · ยังไม่ผ่านการตรวจสอบ · ไม่มีจำนวนวันแน่นอน"
              : assessment.status !== "computed" || assessment.days === null ? "ช่วงวันที่ไม่ครบหรือไม่ถูกต้อง จึงยังสรุปจำนวนวันไม่ได้"
                : `${assessment.days} วัน · ${assessment.days >= 180 ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41"}`}</dd>
          {record?.mode === "periods" && record.periods.length > 0 && <dd><ul className="worksheet-residence-periods">{record.periods.map((period, index) => <li key={`${year}-${index}`}><strong>ช่วงที่ {index + 1}:</strong> {period.startDate ?? "ไม่ระบุวันเริ่มต้น"} – {period.endDate ?? "ไม่ระบุวันสิ้นสุด"}</li>)}</ul></dd>}
        </div>;
      })}</dl>
      <p className="worksheet-residence-note">ช่วงวันที่นับวันแรกและวันสุดท้ายรวมกัน และนับวันปฏิทินที่ซ้ำกันครั้งเดียว คำยืนยันของผู้ใช้ยังไม่ผ่านการตรวจสอบ รายละเอียดการนับวันจากหลักฐานเข้าออกขึ้นกับข้อเท็จจริงแต่ละกรณี เกณฑ์วันพำนักแยกจากการรองรับของตัวอย่างและสิทธิ FTC หรือ DTA</p>
    </section>;
  }
  const periods = snapshot.inputs.residencePeriods;
  if (periods === undefined) return null;

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

  return <section className="worksheet-residence-summary" aria-label="สรุปช่วงเวลาที่พำนัก">
    <h3>สรุปช่วงเวลาที่พำนัก</h3>
    {periods.length > 0
      ? <ul className="worksheet-residence-periods">{periods.map((period, index) => <li key={`saved-residence-period-${index}`}>
        <strong>ช่วงที่ {index + 1}:</strong> {period.startDate ?? "ไม่ระบุวันเริ่มต้น"} – {period.endDate ?? "ไม่ระบุวันสิ้นสุด"}
      </li>)}</ul>
      : <p>ไม่มีช่วงวันที่พำนักที่บันทึกไว้ในผลนี้</p>}
    {years.size > 0
      ? <dl className="worksheet-residence-years">{[...years].sort((left, right) => left - right).map((year) => {
        const days = periodIssues.length === 0 ? calculateResidenceDaysInYear(periods, year) : null;
        const earnedYear = snapshot.inputs.sources.some((source) => source.earnedTaxYear === year);
        return <div key={year}>
          <dt>ปี พ.ศ. {year + 543} (ค.ศ. {year}){earnedYear ? " · ปีที่เกิดเงินได้" : " · ปีปฏิทินในช่วงพำนัก"}</dt>
          <dd>{days === null ? "ช่วงวันที่ไม่ครบหรือไม่ถูกต้อง จึงยังสรุปจำนวนวันไม่ได้"
            : `${days} วัน · ${days >= 180 ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41"}`}</dd>
        </div>;
      })}</dl>
      : <p>ยังไม่มีปีปฏิทินสำหรับสรุปจำนวนวันพำนัก</p>}
    <p className="worksheet-residence-note">นับวันเริ่มต้นและวันสิ้นสุดรวมกัน และนับวันปฏิทินที่ซ้ำกันเพียงครั้งเดียว สรุปวันพำนักนี้แยกจากปีภาษีที่ใช้ยื่น และไม่ได้ยืนยันการรองรับการคำนวณ สิทธิ FTC หรือสิทธิตาม DTA</p>
  </section>;
}

function SourceResidenceSummaryLink({ snapshot, source }: { snapshot: CalculationSnapshot; source: ForeignIncomeSourceDraft }) {
  if (snapshot.inputs.residenceYears !== undefined && source.earnedTaxYear !== null) {
    return <a href="#worksheet-residence-summary">ดูข้อมูลวันพำนักปี พ.ศ. {source.earnedTaxYear + 543}</a>;
  }
  return source.residenceDaysInEarnedYear === null ? null : <span>วันพำนักในปีที่เกิดเงินได้: {source.residenceDaysInEarnedYear} วัน</span>;
}

function WorksheetEvidence({ snapshot, attachments = [], mode }: { snapshot: CalculationSnapshot; attachments?: AttachmentMetadata[]; mode?: Mode }) {
  const metadataById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const frozen = snapshot.evidence;
  const renderFile = (file: FrozenEvidenceReference) => {
    const metadata = metadataById.get(file.id);
    return <li key={file.id}>
      <span className="file-icon" aria-hidden="true">{file.mediaType === "application/pdf" ? "PDF" : "IMG"}</span>
      <span className="file-name"><strong>{file.displayName}</strong><small>{EVIDENCE_LABELS[file.kind]} · {formatMoney(String(file.byteSize), 0)} ไบต์</small></span>
      {metadata && mode ? <EvidenceFileActions file={metadata} mode={mode} /> : !metadata && mode ? <span className="worksheet-evidence-unavailable">ไฟล์ต้นฉบับไม่พร้อมใช้งาน</span> : null}
    </li>;
  };
  const thaiTaxFiles = frozen.filter((file) => file.sourceId === null && file.kind === "thai_tax");
  const otherCaseFiles = frozen.filter((file) => file.sourceId === null && file.kind !== "thai_tax");
  const sourceFiles = snapshot.inputs.sources.map((source, index) => ({ source, index, files: frozen.filter((file) => file.sourceId === source.id && source.id !== null) }));
  const missingEvidence = snapshot.submissionMetadata?.missingEvidence ?? missingEvidenceInventory(snapshot.inputs, frozen);
  const missingFor = (sourceIndex: number | null) => missingEvidence.find((group) => group.sourceIndex === sourceIndex)?.missingKinds ?? [];
  const renderMissing = (sourceIndex: number | null) => {
    const kinds = missingFor(sourceIndex);
    return kinds.length ? <p className="field-hint evidence-missing"><strong>ยังไม่มีไฟล์พร้อมใช้งานสำหรับ:</strong> {kinds.map((kind) => EVIDENCE_LABELS[kind]).join(" · ")}</p> : null;
  };

  return <section className="content-section card worksheet-section worksheet-evidence" aria-labelledby="worksheet-evidence-heading">
    <h2 id="worksheet-evidence-heading">เอกสารประกอบที่บันทึกกับผลนี้</h2>
    {snapshot.submissionMetadata && <div className="submission-declaration"><strong>คำยืนยันเรื่องเอกสารของผู้ส่ง · เวอร์ชัน {snapshot.submissionMetadata.version}</strong><p>{snapshot.submissionMetadata.statement}</p><small>บันทึกโดยบัญชีผู้ส่งเมื่อ {formatDate(snapshot.submissionMetadata.acknowledgedAt)}</small></div>}
    {frozen.length === 0 && <p className="empty-evidence">ไม่มีไฟล์แนบในผลคำนวณที่บันทึกไว้นี้</p>}
    <div className="worksheet-evidence-group"><h3>หลักฐานภาษีไทย</h3>{thaiTaxFiles.length ? <ul className="file-list">{thaiTaxFiles.map(renderFile)}</ul> : <p className="empty-evidence">ไม่มีหลักฐานภาษีไทยที่บันทึกไว้กับผลนี้</p>}{renderMissing(null)}</div>
    {sourceFiles.map(({ source, index, files }) => <div className="worksheet-evidence-group" key={source.id ?? `evidence-source-${index}`}>
      <h3>{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", source.countryName)} · {incomeTypeLabel(source)}</h3>
      {files.length ? <ul className="file-list">{files.map(renderFile)}</ul> : <p className="empty-evidence">ไม่มีหลักฐานแนบสำหรับแหล่งเงินได้นี้</p>}
      {renderMissing(index)}
    </div>)}
    {otherCaseFiles.length > 0 && <div className="worksheet-evidence-group"><h3>เอกสารอื่นของกรณี</h3><ul className="file-list">{otherCaseFiles.map(renderFile)}</ul></div>}
  </section>;
}

export function Worksheet({ snapshot, attachments, evidenceMode, showEvidence = Boolean(attachments && evidenceMode) }: { snapshot: CalculationSnapshot; attachments?: AttachmentMetadata[]; evidenceMode?: Mode; showEvidence?: boolean }) {
  const formulaDetails = useRef<HTMLDetailsElement>(null);
  const formulaDetailsWasOpen = useRef<boolean | null>(null);
  useEffect(() => {
    const details = formulaDetails.current;
    if (!details) return;
    const beforePrint = () => {
      if (formulaDetailsWasOpen.current === null) formulaDetailsWasOpen.current = details.open;
      details.open = true;
    };
    const afterPrint = () => {
      if (formulaDetailsWasOpen.current === null) return;
      details.open = formulaDetailsWasOpen.current;
      formulaDetailsWasOpen.current = null;
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const result = snapshot.result;
  const summaryValues: Record<"I" | "J" | "K" | "L", string | null> = {
    I: result.totalRemittedIncome,
    J: result.domesticAssessableIncome,
    K: result.totalAssessableIncome,
    L: result.thaiTaxBeforeFtc,
  };

  return <div className="worksheet" data-testid="canonical-worksheet">
    <section className="content-section card worksheet-section" aria-labelledby="worksheet-source-heading">
      <h2 id="worksheet-source-heading">{WORKSHEET_SECTIONS[0]}</h2>
      <p className="worksheet-explanation">(D), (E), (F), (G) และ (H) แสดงตามข้อมูลที่บันทึกไว้ ภาษีที่ชำระจริงกับจำนวนที่ผู้ใช้ระบุให้นำไปคำนวณอาจต่างกัน การบันทึกจำนวนดังกล่าวไม่ได้ยืนยันสิทธิทางกฎหมาย</p>
      {snapshot.inputs.sources.length === 0 ? <p className="empty-state">ยังไม่มีแหล่งเงินได้ในผลคำนวณนี้</p> : <>
        <div className="worksheet-source-desktop table-scroll"><table aria-labelledby="worksheet-source-heading" className="data-table worksheet-source-table">
          <thead><tr>{SOURCE_LETTERS.map((letter) => <th key={letter} scope="col"><FieldLabel letter={letter} /></th>)}</tr></thead>
          <tbody>{snapshot.inputs.sources.map((source, index) => <Fragment key={source.id ?? `source-${index}`}>
            <tr className="worksheet-source-name"><th colSpan={8} scope="rowgroup">{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", source.countryName)} · {incomeTypeLabel(source)}</th></tr>
            <SourceValues snapshot={snapshot} source={source} index={index} />
          </Fragment>)}</tbody>
          <tfoot><tr><th colSpan={3} scope="row">รวมทุกแหล่งเงินได้</th><td>{formatMoney(sumValues(snapshot.inputs.sources.map((source) => source.grossIncomeThb)))} บาท</td><td>{formatMoney(sumValues(snapshot.result.lines.filter((line) => line.code === "source_E_eligible").map((line) => line.value)))} บาท</td><td>{formatMoney(snapshot.result.totalRemittedIncome)} บาท</td><td>{formatMoney(sumValues(snapshot.result.lines.filter((line) => line.code === "source_G").map((line) => line.value)))} บาท</td><td>—</td></tr></tfoot>
        </table></div>
        <SourceCards snapshot={snapshot} />
        <SourceTotals snapshot={snapshot} />
      </>}
    </section>

    <section className="content-section card worksheet-section worksheet-tax-summary" aria-labelledby="worksheet-summary-heading">
      <h2 id="worksheet-summary-heading">{WORKSHEET_SECTIONS[1]}</h2>
      <div className="table-scroll worksheet-summary-table-wrap"><table aria-labelledby="worksheet-summary-heading" className="data-table worksheet-summary-table"><tbody>
        {SUMMARY_LETTERS.map((letter) => <tr key={letter}><th scope="row"><FieldLabel letter={letter} /></th><td>{formatMoney(summaryValues[letter])} บาท</td></tr>)}
      </tbody></table></div>
      <div className="worksheet-provenance"><strong>ข้อมูลประกอบ (L):</strong><p>{displayKnownExampleNote(snapshot.inputs.thaiTax.provenance) ?? "ผู้ใช้ระบุจำนวนภาษีไทยก่อนเครดิต (L)"}</p></div>
      <p className="worksheet-explanation">(L) คือภาษีไทยที่ผู้ใช้ระบุว่าคำนวณหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว และก่อนใช้เครดิตภาษีต่างประเทศ ระบบไม่ได้คำนวณยอดนี้หรือยืนยันรายการหักจากเอกสารที่ให้ไว้</p>
      <ResidencePeriodSummary snapshot={snapshot} />
    </section>

    <section className="content-section card worksheet-section" aria-labelledby="worksheet-country-heading">
      <h2 id="worksheet-country-heading">{WORKSHEET_SECTIONS[2]}</h2>
      <CountryTable snapshot={snapshot} />
      <CountryCards snapshot={snapshot} />
      <p className="worksheet-explanation">เพดาน (P) และเครดิต (Q) คำนวณแยกตามประเทศ ไม่มีการนำภาษีหรือเพดานที่เหลือของประเทศหนึ่งไปเพิ่มเครดิตของอีกประเทศ</p>
    </section>

    <section className="content-section card worksheet-section worksheet-total" aria-labelledby="worksheet-total-heading">
      <h2 id="worksheet-total-heading">{WORKSHEET_SECTIONS[3]}</h2>
      <div className="worksheet-total-value"><strong>{formatMoney(result.allowableCredit)} บาท</strong><span>รวมเครดิตรายประเทศตามข้อมูลและสมมติฐานที่บันทึก</span></div>
      {result.displayRoundingReconciliation !== null && result.displayRoundingReconciliation !== "0" && <p className="worksheet-explanation">ปรับการปัดเศษของยอดรายประเทศที่แสดง: {formatMoney(result.displayRoundingReconciliation)} บาท</p>}
      <details ref={formulaDetails} className="worksheet-formulas"><summary>ดูสูตรและวิธีจัดสรรที่ใช้ในผลนี้</summary>
        <strong className="worksheet-formula-print-heading">วิธีคำนวณและการจัดสรร</strong>
        <ul>
          <li>(G) แบ่งจำนวนภาษีใน (E) ตามสัดส่วน (F) ÷ (D) ของแต่ละแหล่งเงินได้</li>
          <li>(H) แสดงสัดส่วน (F) ÷ (D) เป็นร้อยละ</li>
          <li>(O) รวม (G) และ (P) คำนวณจาก (N) ÷ (K) × (L) แยกตามประเทศ</li>
          <li>(Q) ของแต่ละประเทศเป็นจำนวนที่น้อยกว่าระหว่าง (O) กับ (P); เครดิตคงเหลือไม่ย้ายข้ามประเทศ</li>
          <li>รวม (Q) จากประเทศต่าง ๆ แล้วปัดยอดรวมเป็นสองตำแหน่งตามวิธีที่บันทึกไว้</li>
        </ul>
      </details>
    </section>

    {showEvidence && <WorksheetEvidence snapshot={snapshot} attachments={attachments} mode={evidenceMode} />}
  </div>;
}
