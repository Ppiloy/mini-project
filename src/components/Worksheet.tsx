import Decimal from "decimal.js";
import { Fragment, useEffect, useRef } from "react";
import type { AttachmentMetadata, CalculationSnapshot, EvidenceKind, ForeignIncomeSourceDraft, FrozenEvidenceReference } from "../../shared/contracts.js";
import { countryLabel, CURRENCY_CHOICES, displayKnownExampleNote, EVIDENCE_LABELS, incomeTypeLabel, WORKSHEET_SECTIONS, type WorksheetLetter } from "../../shared/labels.js";
import { EvidenceFileActions } from "./EvidenceFileActions.js";
import { FieldLabel } from "./FieldLabel.js";
import { formatDate, formatMoney } from "./money.js";

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

function equalAmounts(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try { return new Decimal(left).equals(new Decimal(right)); } catch { return left === right; }
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
  if (letter === "B") return countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ");
  if (letter === "C") return incomeTypeLabel(source);
  if (letter === "D") return `${formatMoney(source.grossIncomeThb)} บาท`;
  if (letter === "E") return `${formatMoney(source.eligibleForeignTaxThb)} บาท`;
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
    {reference.educationalAssumption && <span className="worksheet-fx-assumption">{displayKnownExampleNote(reference.educationalAssumption)}</span>}
    {sourceUrl && <a className="worksheet-fx-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">แหล่งอัตราแลกเปลี่ยน</a>}
  </>;
}

function SourceValues({ snapshot, source, index }: { snapshot: CalculationSnapshot; source: ForeignIncomeSourceDraft; index: number }) {
  const differentTaxAmount = !equalAmounts(source.actualForeignTaxPaidThb, source.eligibleForeignTaxThb);

  return <>
    <tr className="worksheet-source-values">
      {SOURCE_LETTERS.map((letter) => <td key={letter}>{sourceFieldValue(snapshot, source, index, letter)}</td>)}
    </tr>
    <tr className="worksheet-source-details"><td colSpan={8}>
      <div className="worksheet-source-meta">
        <span><strong>วันที่เกิดเงินได้:</strong> {formatDate(source.earnedDate)}</span>
        <span><strong>วันที่นำเข้าไทย:</strong> {formatDate(source.remittance?.remittanceDate)}</span>
        {source.residenceDaysInEarnedYear !== null && <span><strong>วันพำนักในปีที่เกิดเงินได้:</strong> {source.residenceDaysInEarnedYear} วัน</span>}
      </div>
      {source.inputMode === "original_currency" && <div className="worksheet-original-currency">
        <strong>จำนวนเงินต้นทาง</strong>
        <span>เงินได้ {formatMoney(source.grossIncomeAmount)} {thaiCurrency(source.currencyCode)}</span>
        <span>ภาษีจำนวน (E) ที่ใช้คำนวณ {formatMoney(source.eligibleForeignTax)} {thaiCurrency(source.currencyCode)}</span>
        {differentTaxAmount && <span>ภาษีที่ชำระทั้งหมดตามหลักฐาน {formatMoney(source.actualForeignTaxPaid)} {thaiCurrency(source.currencyCode)}</span>}
        <span>เงินได้ที่นำเข้า {formatMoney(source.remittedIncomeAmount)} {thaiCurrency(source.currencyCode)}</span>
        {source.fxReference && <FxReferenceDetails reference={source.fxReference} />}
      </div>}
      {differentTaxAmount && <p className="worksheet-assumption-note">ภาษีที่ชำระทั้งหมดตามหลักฐาน: {formatMoney(source.actualForeignTaxPaidThb)} บาท · จำนวน (E) ที่ใช้จัดสรร (G): {formatMoney(source.eligibleForeignTaxThb)} บาท โดยผู้ใช้ระบุและยืนยันจำนวนนี้ ระบบยังไม่ได้ตรวจสอบสิทธิทางกฎหมาย</p>}
      {source.eligibilityRationale && <p className="worksheet-source-rationale"><strong>เหตุผลของ (E) ที่ผู้ใช้ระบุ:</strong> {displayKnownExampleNote(source.eligibilityRationale)}</p>}
    </td></tr>
  </>;
}

function SourceTotals({ snapshot }: { snapshot: CalculationSnapshot }) {
  const sources = snapshot.inputs.sources;
  const totalGrossIncome = sumValues(sources.map((source) => source.grossIncomeThb));
  const totalCalculationTax = sumValues(sources.map((source) => source.eligibleForeignTaxThb));
  const totalAllocatedTax = sumValues(snapshot.result.lines.filter((line) => line.code === "source_G").map((line) => line.value));
  const totalActualTax = sumValues(sources.map((source) => source.actualForeignTaxPaidThb));
  const actualTaxDiffers = sources.some((source) => !equalAmounts(source.actualForeignTaxPaidThb, source.eligibleForeignTaxThb));
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
      <h3>{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · {incomeTypeLabel(source)}</h3>
      <dl>
        {SOURCE_LETTERS.map((letter) => <div key={letter}><dt><FieldLabel letter={letter} /></dt><dd>{sourceFieldValue(snapshot, source, index, letter)}</dd></div>)}
      </dl>
      <div className="worksheet-source-meta">
        <span><strong>วันที่เกิดเงินได้:</strong> {formatDate(source.earnedDate)}</span>
        <span><strong>วันที่นำเข้าไทย:</strong> {formatDate(source.remittance?.remittanceDate)}</span>
        {source.residenceDaysInEarnedYear !== null && <span><strong>วันพำนักในปีที่เกิดเงินได้:</strong> {source.residenceDaysInEarnedYear} วัน</span>}
      </div>
      {source.inputMode === "original_currency" && <div className="worksheet-original-currency"><strong>จำนวนเงินต้นทาง (D)/(E)/(F)</strong><span>{formatMoney(source.grossIncomeAmount)} / {formatMoney(source.eligibleForeignTax)} / {formatMoney(source.remittedIncomeAmount)} {thaiCurrency(source.currencyCode)}</span>{source.fxReference && <FxReferenceDetails reference={source.fxReference} />}{!equalAmounts(source.actualForeignTaxPaidThb, source.eligibleForeignTaxThb) && <span>ภาษีที่ชำระทั้งหมดตามหลักฐาน {formatMoney(source.actualForeignTaxPaid)} {thaiCurrency(source.currencyCode)}</span>}</div>}
      {!equalAmounts(source.actualForeignTaxPaidThb, source.eligibleForeignTaxThb) && <p className="worksheet-assumption-note">ภาษีที่ชำระทั้งหมดตามหลักฐาน: {formatMoney(source.actualForeignTaxPaidThb)} บาท · จำนวน (E) ที่ใช้จัดสรร (G): {formatMoney(source.eligibleForeignTaxThb)} บาท โดยผู้ใช้ระบุและยืนยันจำนวนนี้ ระบบยังไม่ได้ตรวจสอบสิทธิทางกฎหมาย</p>}
      {source.eligibilityRationale && <p className="worksheet-source-rationale"><strong>เหตุผลของ (E) ที่ผู้ใช้ระบุ:</strong> {displayKnownExampleNote(source.eligibilityRationale)}</p>}
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
        <th scope="row">{countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")}</th>
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
      <h3>{countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")}</h3>
      <dl>{COUNTRY_LETTERS.map((letter) => <div key={letter}>
        <dt><FieldLabel letter={letter} /></dt>
        <dd>{letter === "M" ? countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ") : letter === "N" ? `${formatMoney(country.remittedIncome)} บาท` : letter === "O" ? `${formatMoney(country.attributableForeignTax)} บาท` : letter === "P" ? `${formatMoney(country.thaiTaxLimit)} บาท` : `${formatMoney(country.displayedAllowableCredit)} บาท`}</dd>
      </div>)}</dl>
    </article>)}
    {countries.length === 0 && <p className="empty-cell">ยังไม่มีผลรายประเทศที่คำนวณได้</p>}
    <div className="worksheet-country-total"><strong>รวม</strong><span><FieldLabel letter="N" />: {formatMoney(totalIncome)} บาท</span><span><FieldLabel letter="O" />: {formatMoney(totalAllocatedTax)} บาท</span><span><FieldLabel letter="Q" />: {formatMoney(allowableCredit)} บาท</span><small>เพดาน (P) คงแยกตามประเทศ</small></div>
  </div>;
}

function WorksheetEvidence({ snapshot, attachments = [], mode }: { snapshot: CalculationSnapshot; attachments?: AttachmentMetadata[]; mode?: Mode }) {
  const metadataById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const frozen = snapshot.evidence;
  const filesFor = (files: FrozenEvidenceReference[], kind: EvidenceKind) => files.filter((file) => file.kind === kind);
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

  if (frozen.length === 0) return <section className="content-section card worksheet-section worksheet-evidence" aria-labelledby="worksheet-evidence-heading">
    <h2 id="worksheet-evidence-heading">เอกสารประกอบที่บันทึกกับผลนี้</h2>
    <p className="empty-evidence">ไม่มีหลักฐานแนบในผลคำนวณที่บันทึกไว้นี้</p>
  </section>;

  return <section className="content-section card worksheet-section worksheet-evidence" aria-labelledby="worksheet-evidence-heading">
    <h2 id="worksheet-evidence-heading">เอกสารประกอบที่บันทึกกับผลนี้</h2>
    <div className="worksheet-evidence-group"><h3>หลักฐานภาษีไทย</h3>{thaiTaxFiles.length ? <ul className="file-list">{filesFor(thaiTaxFiles, "thai_tax").map(renderFile)}</ul> : <p className="empty-evidence">ไม่มีหลักฐานภาษีไทยที่บันทึกไว้กับผลนี้</p>}</div>
    {sourceFiles.map(({ source, index, files }) => <div className="worksheet-evidence-group" key={source.id ?? `evidence-source-${index}`}>
      <h3>{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · {incomeTypeLabel(source)}</h3>
      {files.length ? <ul className="file-list">{files.map(renderFile)}</ul> : <p className="empty-evidence">ไม่มีหลักฐานแนบสำหรับแหล่งเงินได้นี้</p>}
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
            <tr className="worksheet-source-name"><th colSpan={8} scope="rowgroup">{countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · {incomeTypeLabel(source)}</th></tr>
            <SourceValues snapshot={snapshot} source={source} index={index} />
          </Fragment>)}</tbody>
          <tfoot><tr><th colSpan={3} scope="row">รวมทุกแหล่งเงินได้</th><td>{formatMoney(sumValues(snapshot.inputs.sources.map((source) => source.grossIncomeThb)))} บาท</td><td>{formatMoney(sumValues(snapshot.inputs.sources.map((source) => source.eligibleForeignTaxThb)))} บาท</td><td>{formatMoney(snapshot.result.totalRemittedIncome)} บาท</td><td>{formatMoney(sumValues(snapshot.result.lines.filter((line) => line.code === "source_G").map((line) => line.value)))} บาท</td><td>—</td></tr></tfoot>
        </table></div>
        <SourceCards snapshot={snapshot} />
        <SourceTotals snapshot={snapshot} />
      </>}
    </section>

    <section className="content-section card worksheet-section" aria-labelledby="worksheet-summary-heading">
      <h2 id="worksheet-summary-heading">{WORKSHEET_SECTIONS[1]}</h2>
      <div className="table-scroll worksheet-summary-table-wrap"><table aria-labelledby="worksheet-summary-heading" className="data-table worksheet-summary-table"><tbody>
        {SUMMARY_LETTERS.map((letter) => <tr key={letter}><th scope="row"><FieldLabel letter={letter} /></th><td>{formatMoney(summaryValues[letter])} บาท</td></tr>)}
      </tbody></table></div>
      <div className="worksheet-provenance"><strong>ที่มาของข้อมูล (L) ที่ผู้ใช้ระบุ:</strong><p>{displayKnownExampleNote(snapshot.inputs.thaiTax.provenance) ?? "ไม่ได้ระบุ"}</p></div>
      <p className="worksheet-explanation">(L) คือภาษีไทยที่ผู้ใช้ระบุว่าคำนวณหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว และก่อนใช้เครดิตภาษีต่างประเทศ ระบบไม่ได้คำนวณยอดนี้หรือยืนยันรายการหักจากเอกสารที่ให้ไว้</p>
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
      <p className="worksheet-disclaimer">ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น</p>
    </section>

    {showEvidence && <WorksheetEvidence snapshot={snapshot} attachments={attachments} mode={evidenceMode} />}
  </div>;
}
