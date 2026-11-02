import Decimal from "decimal.js";
import { useState, type ReactNode } from "react";
import type { AttachmentMetadata, CalculationResult, EvidenceKind, FtcCaseDraft, ForeignIncomeSourceDraft, InputMode, UnsupportedClassification } from "../../../shared/contracts.js";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "../../../shared/confirmations.js";
import { calculateFTC } from "../../../shared/calculator.js";
import { formatCalculationIssues, stepForCalculationIssue, validationTargetId, validationTargetLabel, type FormStepIssue } from "../../../shared/formValidation.js";
import { countryLabel, COUNTRY_CHOICES, CURRENCY_CHOICES, displayKnownExampleNote, EVIDENCE_LABELS, incomeTypeLabel, WORKSHEET_LABELS, WORKSHEET_SECTIONS, worksheetLabel, type WorksheetLetter } from "../../../shared/labels.js";
import { deriveResidenceDaysForDraft } from "../../../shared/residence.js";
import { createEmptySource } from "../../fixtures/index.js";
import { EvidenceFileActions } from "../../components/EvidenceFileActions.js";
import { FieldLabel } from "../../components/FieldLabel.js";
import { formatMoney } from "../../components/money.js";
import { ResidenceSection } from "./ResidenceSection.js";

interface StepProps {
  draft: FtcCaseDraft;
  onChange: (next: FtcCaseDraft) => void;
  attachments: AttachmentMetadata[];
  onUpload: (sourceId: string | null, kind: EvidenceKind, file: File, sourceIndex?: number) => Promise<void>;
  onDeleteAttachment: (id: string) => Promise<void>;
  onNavigateStep?: (step: number) => void;
  busy: boolean;
  validationErrors?: FormStepIssue[];
  mode?: "demo" | "hosted";
}

const evidenceKinds: Array<{ kind: EvidenceKind; label: string }> = [
  { kind: "foreign_income", label: EVIDENCE_LABELS.foreign_income },
  { kind: "foreign_tax", label: EVIDENCE_LABELS.foreign_tax },
  { kind: "remittance", label: EVIDENCE_LABELS.remittance },
  { kind: "other", label: EVIDENCE_LABELS.other },
];

const PREVIEW_CONFIRMATION_AT = "2000-01-01T00:00:00.000Z";
const SOURCE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const satisfies readonly WorksheetLetter[];
const INCOME_CHOICES = [
  { key: "40_1", label: "40(1) เงินได้จากการจ้างแรงงาน", incomeType: "salary_40_1", subtype: "salary", supported: true },
  { key: "40_2", label: "40(2) เงินได้จากหน้าที่หรือตำแหน่งงาน หรือรับทำงานให้", incomeType: "other", subtype: "40_2", supported: false },
  { key: "40_3", label: "40(3) ค่าแห่งลิขสิทธิ์ สิทธิอื่น และเงินปี", incomeType: "other", subtype: "40_3", supported: false },
  { key: "40_4_interest", label: "40(4) ดอกเบี้ยหรือเงินได้จากการลงทุนอื่น", incomeType: "other", subtype: "40_4_interest", supported: false },
  { key: "40_4_dividend", label: "40(4) เงินปันผล · ตัวอย่างที่รองรับ", incomeType: "dividend_40_4", subtype: "dividend", supported: true },
  { key: "40_5", label: "40(5) เงินได้จากการให้เช่าทรัพย์สิน", incomeType: "other", subtype: "40_5", supported: false },
  { key: "40_6", label: "40(6) เงินได้จากวิชาชีพอิสระ", incomeType: "other", subtype: "40_6", supported: false },
  { key: "40_7", label: "40(7) เงินได้จากการรับเหมา", incomeType: "other", subtype: "40_7", supported: false },
  { key: "40_8", label: "40(8) เงินได้จากธุรกิจหรือกิจการอื่น", incomeType: "other", subtype: "40_8", supported: false },
  { key: "other_unclassified", label: "ประเภทอื่นที่ยังไม่รองรับ", incomeType: "other", subtype: "other_unclassified", supported: false },
] as const;

function incomeChoiceKey(source: ForeignIncomeSourceDraft): string {
  if (source.incomeType === null) return "";
  if (source.incomeType === "salary_40_1") return "40_1";
  if (source.incomeType === "dividend_40_4") return "40_4_dividend";
  return INCOME_CHOICES.some((choice) => choice.key === source.subtype) ? source.subtype! : "other_unclassified";
}

function previewCalculation(draft: FtcCaseDraft, allowMissingDomestic: boolean): CalculationResult {
  let preview = deriveResidenceDaysForDraft(draft);
  if (allowMissingDomestic) {
    preview = {
      ...preview,
      domesticAssessableIncome: "0.00",
      thaiTax: {
        ...preview.thaiTax,
        amountBeforeFtc: "0.00",
        provenance: "ค่าชั่วคราวสำหรับแสดงสูตรในแบบฟอร์ม",
      },
    };
  }
  preview = {
    ...preview,
    sources: preview.sources.map((source) => source.eligibleForeignTax !== null && source.eligibilityRationale?.trim()
      ? {
        ...source,
        eligibilityConfirmedAt: source.eligibilityConfirmedAt ?? PREVIEW_CONFIRMATION_AT,
        eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source),
      }
      : source),
  };
  if (preview.thaiTax.amountBeforeFtc !== null && preview.thaiTax.provenance?.trim()) {
    preview = {
      ...preview,
      thaiTax: {
        ...preview.thaiTax,
        confirmedAt: preview.thaiTax.confirmedAt ?? PREVIEW_CONFIRMATION_AT,
        confirmedInputFingerprint: taxInputFingerprint(preview),
      },
    };
  }
  return calculateFTC(preview);
}

function previewSourceLine(result: CalculationResult, sources: readonly ForeignIncomeSourceDraft[], index: number, code: string): string | null {
  const source = sources[index];
  if (!source) return null;
  const lines = result.lines.filter((line) => line.code === code);
  if (source.id !== null) return lines.find((line) => line.sourceId === source.id)?.value ?? null;
  const precedingRows = sources.slice(0, index).filter((item) => item.countryCode === source.countryCode).length;
  return lines.filter((line) => line.countryCode === source.countryCode)[precedingRows]?.value ?? null;
}

function formatPercentage(value: string | null): string {
  if (value === null) return "—";
  try { return `${new Decimal(value).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}%`; }
  catch { return "—"; }
}

function thaiYear(value: number | null): string {
  return value === null ? "—" : String(value + 543);
}

function equalAmounts(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try { return new Decimal(left).equals(new Decimal(right)); } catch { return left === right; }
}

function sumAmounts(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  try { return new Decimal(left).plus(right).toFixed(2); } catch { return null; }
}

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true"> *</span>;
}

function worksheetTitle(letter: WorksheetLetter, required = false) {
  return <><FieldLabel letter={letter} />{required && <RequiredMark />}</>;
}

interface SearchOption { value: string; label: string; searchText?: string; }

function SearchableChoice({ id, label, value, options, onChange, required = false, hiddenLabel = false }: {
  id: string;
  label: ReactNode;
  value: string | null;
  options: readonly SearchOption[];
  onChange: (value: string | null) => void;
  required?: boolean;
  hiddenLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const shownValue = open ? query : selected?.label ?? "";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) => `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase().includes(normalizedQuery));
  const listId = `${id}-options`;
  const choose = (option: SearchOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };
  return <div className="field searchable-choice">
    <label htmlFor={id}><span className={hiddenLabel ? "sr-only" : undefined}>{label}</span></label>
    <input
      id={id}
      type="search"
      role="combobox"
      aria-label={typeof label === "string" ? label : undefined}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      aria-required={required}
      value={shownValue}
      placeholder="พิมพ์เพื่อค้นหา"
      onFocus={() => { setQuery(""); setActiveIndex(0); setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 100)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
        if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]!); }
        if (event.key === "Escape") { setQuery(""); setOpen(false); }
      }}
    />
    {required && <RequiredMark />}
    {open && <div className="searchable-choice-options" id={listId} role="listbox" aria-label={typeof label === "string" ? label : "ตัวเลือก"}>
      {filtered.length === 0 ? <p className="searchable-choice-empty">ไม่พบตัวเลือก</p> : filtered.map((option, index) => <div
        id={`${listId}-${index}`}
        role="option"
        aria-selected={option.value === value}
        key={option.value}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(option)}
      >{option.label}</div>)}
    </div>}
  </div>;
}

function nullableText(value: string): string | null { return value === "" ? null : value; }
function isZeroAmount(value: string | null | undefined): boolean { return value !== null && value !== undefined && /^[-+]?0(?:\.0+)?$/.test(value); }

function ValidationFieldLink({ issue, sourceIndex, onNavigateStep, targetStep }: { issue: FormStepIssue; sourceIndex?: number; onNavigateStep?: (step: number) => void; targetStep?: number }) {
  const targetId = validationTargetId(issue.path);
  if (!targetId) return null;
  const sourceSuffix = sourceIndex === undefined ? "" : `ของแหล่งเงินได้ ${sourceIndex + 1}`;
  return <button type="button" className="button button-quiet button-small" aria-label={`ไปยัง${validationTargetLabel(issue.path)}${sourceSuffix}`} onClick={() => {
    if (targetStep !== undefined && onNavigateStep) {
      onNavigateStep(targetStep);
      window.setTimeout(() => {
        const target = document.getElementById(targetId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      }, 50);
    } else {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }
  }}>ไปยังช่อง</button>;
}

function hasAmounts(source: ForeignIncomeSourceDraft): boolean {
  return [source.grossIncomeAmount, source.actualForeignTaxPaid, source.eligibleForeignTax, source.remittedIncomeAmount]
    .some((value) => value !== null && value !== undefined && value !== "");
}

function hasFxQuote(source: ForeignIncomeSourceDraft): boolean {
  const fx = source.fxReference;
  return fx !== null && [fx.thbRate, fx.effectiveDate, fx.rateType, fx.sourceLabel, fx.sourceUrl, fx.educationalAssumption]
    .some((value) => value !== null && value !== "");
}

function clearAmounts(): Partial<ForeignIncomeSourceDraft> {
  return {
    grossIncomeAmount: null,
    actualForeignTaxPaid: null,
    eligibleForeignTax: null,
    remittedIncomeAmount: null,
  };
}

function clearFxQuote(source: ForeignIncomeSourceDraft, currencyCode: string | null) {
  if (!source.fxReference) return null;
  return {
    ...source.fxReference,
    currencyCode,
    thbRate: null,
    effectiveDate: null,
    rateType: null,
    sourceKind: null,
    sourceLabel: null,
    sourceUrl: null,
    educationalAssumption: null,
  };
}

function confirmCurrencyReset(source: ForeignIncomeSourceDraft, change: string): boolean {
  if (!hasAmounts(source) && !hasFxQuote(source)) return true;
  return window.confirm(`การเปลี่ยน${change}จะล้างจำนวน (D), (E), (F) และข้อมูลอัตราแลกเปลี่ยนเดิมเพื่อไม่ให้ตีความข้อมูลผิด ต้องการเปลี่ยนหรือไม่?`);
}

export function StepOne({ draft, onChange, validationErrors = [] }: StepProps) {
  const year = draft.taxYear;
  const unsupported = year !== null && year !== 2025;
  return (
    <section className="step-panel" aria-labelledby="step-title">
      <h2 id="step-title">ข้อมูลเบื้องต้น</h2>
      <p className="muted">กำหนดปีภาษีที่คำนวณและช่วงวันที่พำนักในประเทศไทย ปีที่เกิดเงินได้ในช่อง (A) และวันที่นำเงินเข้าเป็นคนละข้อเท็จจริง ส่วนวันยื่นแบบไม่ได้ใช้คำนวณในกรณีนี้</p>
      <label className="field field-narrow"><span>ปีภาษี (พ.ศ.) <RequiredMark /></span><select id="case-taxYear" required aria-required="true" value={year === null ? "" : String(year + 543)} onChange={(event) => onChange({ ...draft, taxYear: event.target.value === "" ? null : Number(event.target.value) - 543 })}>
        <option value="">เลือกปีภาษี</option><option value="2568">2568 (2025)</option><option value="2567">2567 (2024) — ยังไม่รองรับ</option><option value="2569">2569 (2026) — ยังไม่รองรับ</option>
      </select></label>
      {validationErrors.filter((issue) => issue.path?.[0] === "taxYear").map((issue, index) => <div className="alert alert-error" role="alert" key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} /></div>)}
      <ResidenceSection
        periods={draft.residencePeriods}
        sources={draft.sources}
        calculationTaxYear={draft.taxYear}
        onChange={(residencePeriods) => onChange(deriveResidenceDaysForDraft({ ...draft, residencePeriods }))}
      />
      {unsupported && <div className="alert alert-warning" role="status"><strong>กรณีนี้อยู่นอกขอบเขตตัวอย่าง</strong><span>บันทึกร่างไว้แก้ไขได้ แต่ระบบจะไม่สร้างยอดเครดิตภาษี</span></div>}
      <div className="info-callout"><strong>ขอบเขตที่ระบบต้นแบบแสดง</strong><p>เงินได้ปีเดียวกับการนำเข้าไทย · กรณีที่ทบทวนแล้ว: เวียดนามและจีน · เงินเดือนตามมาตรา 40(1) และเงินปันผลตัวอย่างตามมาตรา 40(4) · ผู้มีถิ่นที่อยู่ตามเกณฑ์ 180 วัน</p><p>สหรัฐอเมริกาและสิงคโปร์เลือกบันทึกได้ แต่ยังไม่รองรับการคำนวณเครดิต</p></div>
      <div className="alert alert-info"><strong>ข้อมูลนี้เป็นตัวอย่างเพื่อการศึกษา</strong><span>ระบบไม่ได้ยืนยันสิทธิภาษีตามอนุสัญญา และไม่ใช่แบบยื่นภาษีหรือคำวินิจฉัยของกรมสรรพากร</span></div>
    </section>
  );
}

export function StepTwo({ draft, onChange, attachments, onNavigateStep, validationErrors = [] }: StepProps) {
  const [pendingRemovalIndex, setPendingRemovalIndex] = useState<number | null>(null);
  const [blockedRemovalIndex, setBlockedRemovalIndex] = useState<number | null>(null);
  const updateSource = (index: number, update: Partial<ForeignIncomeSourceDraft>) => {
    const sources = draft.sources.map((source, currentIndex) => currentIndex === index ? { ...source, ...update } : source);
    onChange(deriveResidenceDaysForDraft({ ...draft, sources }));
  };
  const add = () => onChange({ ...draft, sources: [...draft.sources, createEmptySource()] });
  const remove = (index: number) => {
    const source = draft.sources[index];
    const linkedFiles = source?.id === null || source === undefined ? [] : attachments.filter((file) => file.sourceId === source.id && file.status !== "deleted");
    if (linkedFiles.length > 0) { setPendingRemovalIndex(null); setBlockedRemovalIndex(index); return; }
    setBlockedRemovalIndex(null);
    setPendingRemovalIndex(index);
  };
  const confirmRemove = () => {
    if (pendingRemovalIndex === null) return;
    onChange(deriveResidenceDaysForDraft({ ...draft, sources: draft.sources.filter((_, index) => index !== pendingRemovalIndex) }));
    setPendingRemovalIndex(null);
  };
  const countryOptions: SearchOption[] = COUNTRY_CHOICES.map((country) => ({
    value: country.code,
    label: `${country.label} (${country.code})${country.reviewed ? "" : " · ยังไม่รองรับในตัวอย่าง"}`,
    searchText: country.code,
  }));
  const currencyOptions: SearchOption[] = CURRENCY_CHOICES.filter((currency) => currency.code !== "THB").map((currency) => ({ value: currency.code, label: `${currency.code} · ${currency.label}`, searchText: currency.label }));

  return <section className="step-panel" aria-labelledby="step-title">
    <div className="step-section-head"><div><h2 id="step-title">{WORKSHEET_SECTIONS[0]}</h2><p className="muted">ระบุข้อมูล (A)–(F) ในแหล่งเดียวกัน ระบบแสดง (G) และ (H) ตามสูตรเมื่อข้อมูลพร้อม รองรับไม่เกิน 20 แหล่ง</p></div><button className="button button-secondary button-small" onClick={add} type="button" disabled={draft.sources.length >= 20}>＋ เพิ่มแหล่งเงินได้</button></div>
    <p className="field-hint">รายการเงินได้ตามมาตรา 40(1)–40(8) แสดงเพื่อบันทึกและคัดแยกกรณีเท่านั้น ตัวอย่างคำนวณยังรองรับเฉพาะ 40(1) และเงินปันผลตาม 40(4) ที่ทบทวนแล้ว</p>
    {validationErrors.filter((issue) => issue.path?.length === 1 && issue.path[0] === "sources").map((issue, index) => <div className="alert alert-error" role="alert" key={index}>{issue.message}</div>)}
    {draft.sources.length === 0 && <div className="empty-inline"><strong>ยังไม่มีแหล่งเงินได้</strong><span>เพิ่มรายการเพื่อบันทึกประเทศ ประเภทเงินได้ วันที่ และจำนวน (D), (E), (F)</span><button type="button" className="button button-secondary" onClick={add}>เพิ่มแหล่งเงินได้แรก</button></div>}
    <div className="source-list">{draft.sources.map((source, index) => {
      const fx = source.fxReference ?? { currencyCode: source.currencyCode, thbRate: null, baseUnits: null, effectiveDate: null, rateType: null, sourceKind: null, sourceLabel: null, sourceUrl: null, educationalAssumption: null };
      const remittance = source.remittance ?? { remittanceDate: null, transferTotalAmount: null, transferCurrencyCode: source.currencyCode, transferTotalThb: null, classification: null, classificationNote: null };
      const amountUnit = source.inputMode === "original_currency" ? source.currencyCode ?? "สกุลเงินต้นทาง" : source.inputMode === "worksheet_thb" ? "บาท" : "เลือกรูปแบบก่อน";
      const sourceIssues = validationErrors.filter((issue) => issue.path?.[0] === "sources" && issue.path[1] === index);
      const eligibleMatchesPaid = source.actualForeignTaxPaid !== null && equalAmounts(source.actualForeignTaxPaid, source.eligibleForeignTax);
      const sourcePreview = previewCalculation({ ...draft, sources: [source] }, true);
      const computedG = previewSourceLine(sourcePreview, [source], 0, "source_G");
      const computedShare = previewSourceLine(sourcePreview, [source], 0, "source_share");
      const updateFx = (update: Partial<NonNullable<ForeignIncomeSourceDraft["fxReference"]>>) => updateSource(index, { fxReference: { ...fx, ...update } });
      return <article className="source-card" key={source.id ?? `source-${index}`} aria-label={`แหล่งเงินได้ ${index + 1}`}>
        <div className="source-card-title"><div><p className="eyebrow">แหล่งที่ {String(index + 1).padStart(2, "0")}</p><h3>แหล่งเงินได้ {index + 1}</h3></div><button type="button" className="button button-danger-quiet button-small" onClick={() => remove(index)} aria-label={`ลบแหล่งเงินได้ ${index + 1}`}>ลบรายการ</button></div>
        {blockedRemovalIndex === index && <div className="alert alert-warning" role="alert"><span>ยังมีไฟล์แนบ {attachments.filter((file) => file.sourceId === source.id && file.status !== "deleted").length} รายการ ลบไฟล์ในขั้นหลักฐานก่อนลบแหล่งเงินได้นี้</span><button type="button" className="button button-secondary button-small" onClick={() => onNavigateStep?.(4)}>ไปยังหลักฐานแหล่งเงินได้ {index + 1}</button></div>}
        {pendingRemovalIndex === index && <div className="source-delete-prompt" role="alertdialog" aria-labelledby={`source-delete-title-${index}`}><strong id={`source-delete-title-${index}`}>ยืนยันการลบแหล่งเงินได้ {index + 1}</strong><p>การลบรายการนี้จะเอาข้อมูลแหล่งเงินได้ออกจากร่าง</p><div><button type="button" className="button button-danger-quiet button-small" onClick={confirmRemove}>ยืนยันลบรายการ</button><button type="button" className="button button-secondary button-small" onClick={() => setPendingRemovalIndex(null)}>ยกเลิก</button></div></div>}
        {sourceIssues.length > 0 && <div className="alert alert-error" role="alert"><ul>{sourceIssues.map((issue, issueIndex) => <li key={issueIndex}><span>{issue.message}</span><ValidationFieldLink issue={issue} sourceIndex={index} onNavigateStep={onNavigateStep} targetStep={issue.path?.[2] === "residenceDaysInEarnedYear" ? 0 : undefined} /></li>)}</ul></div>}
        {source.inputMode === null && <p className="field-hint">เลือกโหมดจำนวนเงินด้านล่างก่อนกรอกจำนวน (D), (E) และ (F)</p>}
        <div className="table-scroll source-worksheet-wrap"><table className="source-worksheet-table" aria-label={`${WORKSHEET_SECTIONS[0]} · แหล่งเงินได้ ${index + 1}`}>
          <thead><tr>{SOURCE_LETTERS.map((letter) => <th key={letter} scope="col"><FieldLabel letter={letter} />{["B", "C", "D", "E", "F"].includes(letter) && <RequiredMark />}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td data-label={worksheetLabel("A")}><output className="readonly-value" aria-label={worksheetLabel("A")}>พ.ศ. {thaiYear(source.earnedTaxYear)}</output></td>
              <td data-label={`${worksheetLabel("B")} *`}><SearchableChoice id={`source-${index}-countryCode`} label={worksheetLabel("B")} hiddenLabel value={source.countryCode} options={countryOptions} required onChange={(code) => {
                const country = COUNTRY_CHOICES.find((item) => item.code === code);
                const previousCountry = COUNTRY_CHOICES.find((item) => item.code === source.countryCode);
                const followsSuggestion = source.currencyCode === null || source.currencyCode === previousCountry?.suggestedCurrency;
                const suggestedCurrency = source.inputMode === "original_currency" && followsSuggestion ? country?.suggestedCurrency ?? null : source.currencyCode;
                const currencyChanged = source.inputMode === "original_currency" && suggestedCurrency !== source.currencyCode;
                if (currencyChanged && !confirmCurrencyReset(source, "ประเทศและสกุลเงินที่แนะนำ")) return;
                updateSource(index, { countryCode: code, countryName: country?.storedName ?? null, ...(currencyChanged ? clearAmounts() : {}), ...(currencyChanged ? { currencyCode: suggestedCurrency, fxReference: clearFxQuote(source, suggestedCurrency) } : {}) });
              }} /></td>
              <td data-label={`${worksheetLabel("C")} *`}><label className="field"><span className="sr-only">{worksheetLabel("C")}</span><select id={`source-${index}-incomeType`} required aria-required="true" value={incomeChoiceKey(source)} onChange={(event) => {
                const choice = INCOME_CHOICES.find((item) => item.key === event.target.value);
                updateSource(index, { incomeType: (choice?.incomeType ?? null) as ForeignIncomeSourceDraft["incomeType"], subtype: choice?.subtype ?? null });
              }}><option value="">เลือกประเภท</option>{INCOME_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label></td>
              <td data-label={`${worksheetLabel("D")} *`}><MoneyField id={`source-${index}-grossIncomeAmount`} label={<span className="sr-only">{worksheetLabel("D")}</span>} value={source.grossIncomeAmount} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { grossIncomeAmount: value })} /></td>
              <td data-label={`${worksheetLabel("E")} *`}><MoneyField id={`source-${index}-eligibleForeignTax`} label={<span className="sr-only">{worksheetLabel("E")}</span>} value={source.eligibleForeignTax} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { eligibleForeignTax: value, ...(source.actualForeignTaxPaid !== null && equalAmounts(source.actualForeignTaxPaid, source.eligibleForeignTax) ? { actualForeignTaxPaid: value } : {}) })} /></td>
              <td data-label={`${worksheetLabel("F")} *`}><MoneyField id={`source-${index}-remittedIncomeAmount`} label={<span className="sr-only">{worksheetLabel("F")}</span>} value={source.remittedIncomeAmount} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { remittedIncomeAmount: value })} /></td>
              <td data-label={worksheetLabel("G")}><output className="readonly-value" aria-label={worksheetLabel("G")}>{computedG === null ? "—" : `${formatMoney(computedG)} บาท`}</output></td>
              <td data-label={worksheetLabel("H")}><output className="readonly-value" aria-label={worksheetLabel("H")}>{formatPercentage(computedShare)}</output></td>
            </tr>
            <tr><td className="worksheet-source-details" colSpan={8}><div className="field-grid">
              <label className="field"><span>วันที่เกิดเงินได้ <RequiredMark /></span><input id={`source-${index}-earnedDate`} type="date" required aria-required="true" value={source.earnedDate ?? ""} onChange={(event) => updateSource(index, { earnedDate: nullableText(event.target.value), earnedTaxYear: event.target.value ? Number(event.target.value.slice(0, 4)) : null })} /><small className="field-hint">ระบุวันที่จริงเพื่อกำหนดปี (A)</small></label>
              <label className="field"><span>วันพำนักในปีที่เกิดเงินได้</span><span className="input-unit"><input id={`source-${index}-residenceDaysInEarnedYear`} value={source.residenceDaysInEarnedYear ?? ""} readOnly aria-readonly="true" /><span>วัน</span></span><small className="field-hint">คำนวณจากช่วงวันที่ในขั้นข้อมูลเบื้องต้น</small></label>
              <label className="field"><span>รูปแบบจำนวนเงินของช่อง (D), (E) และ (F) <RequiredMark /></span><select id={`source-${index}-inputMode`} required aria-required="true" value={source.inputMode ?? ""} onChange={(event) => {
                const nextMode = (event.target.value || null) as InputMode | null;
                if (source.inputMode !== nextMode && !confirmCurrencyReset(source, "รูปแบบการกรอก")) return;
                if (nextMode === "worksheet_thb") updateSource(index, { ...clearAmounts(), inputMode: nextMode, currencyCode: "THB", fxReference: null });
                else if (nextMode === "original_currency") {
                  const suggestedCurrency = COUNTRY_CHOICES.find((country) => country.code === source.countryCode)?.suggestedCurrency ?? null;
                  updateSource(index, { ...clearAmounts(), inputMode: nextMode, currencyCode: suggestedCurrency, fxReference: null });
                } else updateSource(index, { ...clearAmounts(), inputMode: null, currencyCode: null, fxReference: null });
              }}><option value="">เลือกรูปแบบ</option><option value="worksheet_thb">จำนวนเงินตามตาราง (THB)</option><option value="original_currency">สกุลเงินต้นทาง</option></select></label>
              {source.inputMode === "original_currency" && <SearchableChoice id={`source-${index}-currencyCode`} label={<>สกุลเงินต้นทาง <RequiredMark /></>} value={source.currencyCode} options={currencyOptions} required onChange={(currencyCode) => {
                const changed = currencyCode !== source.currencyCode;
                if (changed && !confirmCurrencyReset(source, "สกุลเงิน")) return;
                updateSource(index, { ...(changed ? clearAmounts() : {}), currencyCode, fxReference: changed ? clearFxQuote(source, currencyCode) : source.fxReference });
              }} />}
              <label className="field"><span>วันที่นำเงินเข้าไทย <RequiredMark /></span><input id={`source-${index}-remittance-remittanceDate`} type="date" required aria-required="true" value={remittance.remittanceDate ?? ""} onChange={(event) => updateSource(index, { remittance: { ...remittance, remittanceDate: nullableText(event.target.value) } })} /></label>
              <label className="field field-span"><span>เหตุผลของจำนวน (E) <RequiredMark /></span><textarea id={`source-${index}-eligibilityRationale`} rows={2} maxLength={1000} required aria-required="true" value={displayKnownExampleNote(source.eligibilityRationale) ?? ""} onChange={(event) => updateSource(index, { eligibilityRationale: nullableText(event.target.value) })} placeholder="อธิบายที่มาของจำนวนภาษีในช่อง (E)" /></label>
              <label className="confirm-card source-paid-equals-eligible field-span"><input type="checkbox" aria-label={`ยืนยันว่าจำนวนภาษีต่างประเทศที่จ่ายจริงเท่ากับ (E) · แหล่งเงินได้ ${index + 1}`} checked={eligibleMatchesPaid} disabled={source.eligibleForeignTax === null} onChange={(event) => updateSource(index, { actualForeignTaxPaid: event.target.checked ? source.eligibleForeignTax : null })} /><span><strong>จำนวนภาษีที่จ่ายจริงเท่ากับจำนวน (E)</strong><small>จำนวนภาษีที่จ่ายจริงและจำนวน (E) ที่ใช้คำนวณเป็นคนละข้อเท็จจริง ระบบจะไม่เติมจำนวนที่จ่ายจริงให้อัตโนมัติ เลือกเมื่อยอดจริงตรงกับจำนวน (E) ทุกประการ</small></span></label>
              {!eligibleMatchesPaid && <details className="unsupported-details field-span" open><summary>จำนวนภาษีที่จ่ายจริงต่างจาก (E)</summary><div className="field-grid details-grid"><MoneyField id={`source-${index}-actualForeignTaxPaid`} label={<>ภาษีต่างประเทศที่ชำระจริงทั้งหมด <RequiredMark /></>} value={source.actualForeignTaxPaid} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { actualForeignTaxPaid: value })} hint="กรอกยอดจริงตามเอกสาร หากยังไม่ทราบ ให้บันทึกร่างและกลับมากรอกภายหลัง" /></div></details>}
              {source.inputMode === "original_currency" && <div className="field-grid details-grid field-span">
                <MoneyField id={`source-${index}-fxReference-thbRate`} label={<>อัตรา THB ต่อหน่วยฐาน <RequiredMark /></>} value={fx.thbRate} unit="บาท / หน่วย" required onChange={(value) => updateFx({ thbRate: value })} />
                <label className="field"><span>หน่วยของอัตรา <RequiredMark /></span><select id={`source-${index}-fxReference-baseUnits`} required aria-required="true" value={fx.baseUnits ?? ""} onChange={(event) => updateFx({ baseUnits: event.target.value === "100" ? 100 : event.target.value === "1" ? 1 : null })}><option value="">เลือกหน่วย</option><option value="1">ต่อ 1 หน่วย</option><option value="100">ต่อ 100 หน่วย</option></select></label>
                <label className="field"><span>วันที่อัตราแลกเปลี่ยน <RequiredMark /></span><input id={`source-${index}-fxReference-effectiveDate`} type="date" required aria-required="true" value={fx.effectiveDate ?? ""} onChange={(event) => updateFx({ effectiveDate: nullableText(event.target.value) })} /></label>
                <label className="field"><span>ประเภทอัตรา <RequiredMark /></span><select id={`source-${index}-fxReference-rateType`} required aria-required="true" value={fx.rateType ?? ""} onChange={(event) => updateFx({ rateType: nullableText(event.target.value) as typeof fx.rateType, sourceKind: event.target.value === "manual" ? "user_supplied" : event.target.value === "fixture" ? "fixture" : event.target.value === "bank_buying" ? "bank" : event.target.value ? "bot" : null })}><option value="">เลือกประเภท</option><option value="bank_buying">ธนาคาร อัตราซื้อ</option><option value="bot_average_buying">ธปท. อัตราซื้อเฉลี่ย</option><option value="manual">กรอกเอง</option><option value="fixture">อัตราสมมติสำหรับการศึกษา</option></select></label>
                <label className="field"><span>แหล่งที่มาอัตรา <RequiredMark /></span><input id={`source-${index}-fxReference-sourceLabel`} required aria-required="true" value={fx.sourceLabel ?? ""} onChange={(event) => updateFx({ sourceLabel: nullableText(event.target.value) })} placeholder="ชื่อธนาคารหรือแหล่งข้อมูล" /></label>
                <label className="field"><span>ลิงก์แหล่งอัตรา (ถ้ามี)</span><input type="url" value={fx.sourceUrl ?? ""} onChange={(event) => updateFx({ sourceUrl: nullableText(event.target.value) })} /></label>
                {(fx.rateType === "manual" || fx.rateType === "fixture") && <label className="field field-span"><span>สมมติฐานเพื่อการศึกษา <RequiredMark /></span><textarea rows={2} value={fx.educationalAssumption ?? ""} onChange={(event) => updateFx({ educationalAssumption: nullableText(event.target.value) })} placeholder="อธิบายเหตุผลและข้อจำกัดของอัตรานี้" /></label>}
              </div>}
            </div></td></tr>
          </tbody>
        </table></div>
        <p className="field-hint">คำนวณ (G) จาก ((F) ÷ (D)) × (E) และ (H) จาก (F) ÷ (D) · ระบบไม่สรุปสิทธิภาษีจากประเทศที่เลือก</p>
        <UnsupportedEditor source={source} sourceIndex={index} onChange={(update) => updateSource(index, update)} />
      </article>;
    })}</div>
  </section>;
}

export function StepThree({ draft, onChange, validationErrors = [] }: StepProps) {
  const preview = previewCalculation(draft, true);
  const totalRemitted = preview.totalRemittedIncome;
  const totalAssessable = sumAmounts(draft.domesticAssessableIncome, totalRemitted);
  const issues = validationErrors.filter((issue) => issue.path?.[0] === "domesticAssessableIncome" || issue.path?.[0] === "thaiTax");
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">{WORKSHEET_SECTIONS[1]}</h2>
    <p className="muted">ระบุเงินได้ในประเทศ (J) และภาษีไทยก่อนเครดิต (L) ระบบรวมเงินได้ที่นำเข้าจากทุกแหล่งเป็น (I) และแสดง (K) = (I) + (J)</p>
    {issues.length > 0 && <div className="alert alert-error" role="alert"><ul>{issues.map((issue, index) => <li key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} /></li>)}</ul></div>}
    <div className="field-grid field-grid-single">
      <div className="field"><span>{worksheetTitle("I")}</span><output className="readonly-value" aria-label={WORKSHEET_LABELS.I}>{totalRemitted === null ? "—" : `${formatMoney(totalRemitted)} บาท`}</output></div>
      <MoneyField id="case-domesticAssessableIncome" label={worksheetTitle("J", true)} required value={draft.domesticAssessableIncome} onChange={(value) => onChange({ ...draft, domesticAssessableIncome: value })} />
      <div className="field"><span>{worksheetTitle("K")}</span><output className="readonly-value" aria-label={WORKSHEET_LABELS.K}>{totalAssessable === null ? "—" : `${formatMoney(totalAssessable)} บาท`}</output><small className="field-hint">คำนวณจาก (I) + (J)</small></div>
      <MoneyField id="case-thaiTax-amountBeforeFtc" label={worksheetTitle("L", true)} required value={draft.thaiTax.amountBeforeFtc} onChange={(value) => onChange({ ...draft, thaiTax: { ...draft.thaiTax, amountBeforeFtc: value } })} />
      <label className="field field-span"><span>ที่มาของจำนวน (L) <RequiredMark /></span><textarea id="case-thaiTax-provenance" rows={3} maxLength={1000} required aria-required="true" value={displayKnownExampleNote(draft.thaiTax.provenance) ?? ""} onChange={(event) => onChange({ ...draft, thaiTax: { ...draft.thaiTax, provenance: nullableText(event.target.value) } })} placeholder="อธิบายที่มาของภาษีไทยจากตัวอย่างหรือข้อมูลที่ใช้" /><small className="field-hint">(L) คือภาษีไทยก่อนเครดิต หลังหักค่าใช้จ่ายและค่าลดหย่อนที่เกี่ยวข้อง ไม่ใช่ยอดหัก ณ ที่จ่าย</small></label>
    </div>
    <div className="info-callout"><strong>ยืนยันภาษีไทยในขั้นตรวจทาน</strong><p>การเปลี่ยน (J), แหล่งเงินได้, ช่วงพำนัก หรืออัตราแลกเปลี่ยน จะทำให้ต้องตรวจทานการยืนยันอีกครั้ง</p></div>
  </section>;
}

export function StepFour({ draft, onNavigateStep }: StepProps) {
  const result = previewCalculation(draft, false);
  const countryLetters = ["M", "N", "O", "P", "Q"] as const satisfies readonly WorksheetLetter[];
  const resultIssues = formatCalculationIssues(draft, result.validationMessages);
  const total = result.outcome === "ready" ? result.allowableCredit : null;
  const totalIncome = result.outcome === "ready" ? result.totalRemittedIncome : null;
  const totalAllocatedTax = result.outcome === "ready" ? result.lines.filter((line) => line.code === "country_O").reduce((sum, line) => sum.plus(line.value ?? "0"), new Decimal(0)).toFixed(2) : null;
  return <section className="step-panel worksheet-section" aria-labelledby="step-title">
    <h2 id="step-title">{WORKSHEET_SECTIONS[2]}</h2>
    <p className="muted">แสดงเครดิตแยกตามประเทศจากสูตรที่ใช้ในผลคำนวณ เมื่อข้อมูลยังไม่ครบหรืออยู่นอกขอบเขต ระบบจะไม่แสดงผลรวมเครดิต</p>
    {result.outcome !== "ready" ? <div className="alert alert-info" role="status"><strong>ยังไม่มีผลเครดิตรายประเทศให้แสดง</strong><span>กรอกและตรวจทานข้อมูลในขั้นก่อนหน้าให้ครบ กรณีนอกขอบเขตจะไม่สร้างเครดิตตัวอย่าง</span>{resultIssues.length > 0 && <ul>{resultIssues.map((issue, index) => <li key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} sourceIndex={typeof issue.path?.[1] === "number" ? issue.path[1] : undefined} targetStep={stepForCalculationIssue(result.validationMessages[index]!)} onNavigateStep={onNavigateStep} /></li>)}</ul>}</div> : <>
      <div className="table-scroll worksheet-country-table-wrap"><table className="data-table worksheet-country-table" aria-label={WORKSHEET_SECTIONS[2]}>
        <thead><tr>{countryLetters.map((letter) => <th key={letter} scope="col"><FieldLabel letter={letter} /></th>)}</tr></thead>
        <tbody>{result.countries.map((country) => <tr key={country.countryCode}>
          <th scope="row">{countryLabel(country.countryCode)}</th><td>{formatMoney(country.remittedIncome)} บาท</td><td>{formatMoney(country.attributableForeignTax)} บาท</td><td>{formatMoney(country.thaiTaxLimit)} บาท</td><td><strong>{formatMoney(country.displayedAllowableCredit)} บาท</strong></td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">รวม</th><td>{formatMoney(totalIncome)} บาท</td><td>{formatMoney(totalAllocatedTax)} บาท</td><td>แยกเพดานตามประเทศ</td><td><strong>{formatMoney(total)} บาท</strong></td></tr></tfoot>
      </table></div>
      <div className="worksheet-country-cards">{result.countries.map((country) => <article className="worksheet-country-card" key={country.countryCode}>
        <h3>{countryLabel(country.countryCode)}</h3><dl>{countryLetters.map((letter) => <div key={letter}><dt><FieldLabel letter={letter} /></dt><dd>{letter === "M" ? countryLabel(country.countryCode) : letter === "N" ? `${formatMoney(country.remittedIncome)} บาท` : letter === "O" ? `${formatMoney(country.attributableForeignTax)} บาท` : letter === "P" ? `${formatMoney(country.thaiTaxLimit)} บาท` : `${formatMoney(country.displayedAllowableCredit)} บาท`}</dd></div>)}</dl>
      </article>)}<div className="worksheet-country-total"><strong>{WORKSHEET_SECTIONS[3]}</strong><span><FieldLabel letter="N" />: {formatMoney(totalIncome)} บาท</span><span><FieldLabel letter="O" />: {formatMoney(totalAllocatedTax)} บาท</span><span><FieldLabel letter="Q" />: {formatMoney(total)} บาท</span><small>เพดาน (P) แยกตามประเทศ</small></div></div>
    </>}
  </section>;
}

export function StepFive({ draft, onChange, attachments, onUpload, onDeleteAttachment, busy, mode = "demo" }: StepProps) {
  const allItems = [{ sourceId: null, sourceIndex: undefined as number | undefined, label: "ภาษีไทย · ที่มาของ (L)" }, ...draft.sources.map((source, index) => ({ sourceId: source.id, sourceIndex: index, label: `แหล่งเงินได้ ${index + 1} · ${countryLabel(source.countryCode, "ยังไม่เลือกประเทศ")} · ${incomeTypeLabel(source)}` }))];
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">หลักฐานและตรวจทาน</h2>
    <p className="muted">แนบตัวอย่างเอกสารเพื่อจำลองรายการตรวจสอบก่อนส่ง แต่ละไฟล์ไม่เกิน 3 MiB, PDF/JPEG/PNG เท่านั้น รายการตรวจสอบเป็นคำแจ้งของผู้ใช้ ไม่ใช่การตรวจยืนยันไฟล์</p>
    {mode === "demo"
      ? <div className="alert alert-info"><strong>ไฟล์เก็บไว้ในเบราว์เซอร์นี้</strong><span>โหมดสาธิตเก็บข้อมูลไฟล์จริงไว้ในเบราว์เซอร์นี้เพื่อเปิดดูตัวอย่างหรือดาวน์โหลด โดยไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์</span></div>
      : <div className="alert alert-warning"><strong>โหมดระบบที่เชื่อมต่อเซิร์ฟเวอร์</strong><span>ไฟล์ที่แนบจะออกจากอุปกรณ์และถูกจัดเก็บในพื้นที่หลักฐานฝั่งเซิร์ฟเวอร์ของโครงการ โปรดใช้เฉพาะเอกสารสมมติสำหรับการสาธิต</span></div>}
    <div className="evidence-list">
      {allItems.map(({ sourceId, sourceIndex, label }, itemIndex) => {
        const source = sourceIndex === undefined ? null : draft.sources[sourceIndex] ?? null;
        const items = attachments.filter((file) => sourceIndex === undefined ? file.sourceId === null : sourceId !== null && file.sourceId === sourceId);
        const needsSourceProof = !isZeroAmount(source?.remittedIncomeAmount);
        const checklistKinds = evidenceKinds.filter(({ kind }) => kind !== "foreign_tax" || !isZeroAmount(source?.eligibleForeignTax));
        return <article className="evidence-card" key={sourceIndex === undefined ? "thai-tax-evidence" : `source-evidence-${sourceIndex}`}>
          <div className="evidence-title"><div><h3>{label}</h3><p>ไฟล์ {items.length}/5 · รวมไม่เกิน 30 MiB ต่อกรณี</p></div><div className="evidence-upload-actions">
            {sourceIndex === undefined ? <UploadButton label="แนบหลักฐานภาษีไทย" kind="thai_tax" sourceId={null} disabled={busy || items.length >= 5} onUpload={onUpload} /> : evidenceKinds.map(({ kind, label: kindLabel }) => <UploadButton key={kind} label={`แนบ: ${kindLabel}`} kind={kind} sourceId={sourceId} sourceIndex={sourceIndex} disabled={busy || items.length >= 5} onUpload={onUpload} />)}
          </div></div>
          <ul className="file-list">{items.map((item) => <li key={item.id}><span className="file-icon" aria-hidden="true">{evidenceMediaType(item.mediaType)}</span><span className="file-name"><strong>{item.displayName}</strong><small>{EVIDENCE_LABELS[item.kind]} · {evidenceMediaType(item.mediaType)} · {formatBytes(item.byteSize)} · {item.status === "ready" ? "พร้อมใช้งาน" : item.status === "pending" ? "กำลังตรวจสอบ" : "อัปโหลดไม่สำเร็จ"}</small></span><EvidenceFileActions file={item} mode={mode} onDelete={onDeleteAttachment} busy={busy} /></li>)}</ul>
          {items.length === 0 && <p className="empty-evidence">ยังไม่มีไฟล์แนบ</p>}
          {sourceIndex !== undefined && needsSourceProof && <div className="evidence-checklist"><strong>รายการหลักฐานที่ผู้ใช้แจ้งว่ามี</strong><p className="field-hint">การเลือกช่องนี้ไม่ตรวจสอบเนื้อหาหรือชื่อไฟล์โดยอัตโนมัติ</p><div className="checklist-items">{checklistKinds.map(({ kind, label: kindLabel }) => <label key={kind}><input type="checkbox" checked={source?.evidenceChecklist.includes(kind) ?? false} onChange={(event) => {
            const sourceIndex = itemIndex - 1;
            const source = draft.sources[sourceIndex];
            if (!source) return;
            const evidenceChecklist = event.target.checked ? [...new Set([...source.evidenceChecklist, kind])] : source.evidenceChecklist.filter((value) => value !== kind);
            onChange({ ...draft, sources: draft.sources.map((item, index) => index === sourceIndex ? { ...item, evidenceChecklist } : item) });
          }} />{kindLabel}</label>)}</div></div>}
          {sourceIndex !== undefined && !needsSourceProof && <p className="field-hint">(F) = 0: ระบบไม่กำหนดให้แนบหลักฐานแหล่งเงินได้สำหรับยอดที่ไม่ได้นำเข้าไทย</p>}
        </article>;
      })}
    </div>
    <div className="review-assumptions"><h3>ขอบเขตและสมมติฐาน</h3><ul><li>การคำนวณนี้เป็นตัวอย่างทางการศึกษา ไม่ใช่การวินิจฉัยสิทธิหรือแบบยื่นภาษี</li><li>จำนวนภาษีไทย (L) มาจากข้อมูลที่ผู้ใช้ระบุ ไม่ได้อนุมานจาก (J)</li><li>ระบบแสดงจำนวนภาษีต่างประเทศที่จ่ายจริงแยกจากจำนวน (E) ที่ใช้ในตัวอย่างคำนวณ</li><li>เมื่อยืนยันข้อมูล ผลคำนวณจะใช้ข้อมูลต้นทางและอัตราแลกเปลี่ยนที่แสดงในรายงาน</li></ul></div>
    <p className="field-hint">ยืนยันจำนวน L และ E ได้จากปุ่มด้านล่าง ระบบจะบันทึกการยืนยันร่วมกับร่าง</p>
  </section>;
}

function UnsupportedEditor({ source, sourceIndex, onChange }: { source: ForeignIncomeSourceDraft; sourceIndex: number; onChange: (update: Partial<ForeignIncomeSourceDraft>) => void }) {
  return <details className="unsupported-details"><summary>มีข้อเท็จจริงที่ยังไม่รองรับหรือไม่?</summary><div className="field-grid details-grid">
    <label className="field"><span>สถานะตรวจสอบ</span><select id={`source-${sourceIndex}-unsupportedClassification`} value={source.unsupportedClassification ?? ""} onChange={(event) => onChange({ unsupportedClassification: (event.target.value || null) as UnsupportedClassification | null })}><option value="">ไม่มีข้อเท็จจริงเพิ่มเติม</option><option value="unknown_treaty_treatment">ยังไม่ทราบสิทธิ/เงื่อนไขตาม DTA</option><option value="cross_year_remittance">การนำเข้าอยู่คนละปีภาษี</option><option value="nonresident_earned_income">วันพำนักต่ำกว่าเกณฑ์ตัวอย่าง</option><option value="unsupported_income_type">ประเภทเงินได้ยังไม่รองรับ</option><option value="mixed_principal_and_income">ยอดโอนรวมเงินต้นและเงินได้</option><option value="ambiguous_gross_net">ข้อเท็จจริง gross/net กำกวม</option><option value="tax_refund">รายการเป็นเงินคืนภาษี</option><option value="multiple_remittances">มีการนำเข้าหลายครั้ง</option><option value="other">กรณีอื่นที่ต้องตรวจสอบ</option></select></label>
    <label className="field"><span>คำอธิบายเพิ่มเติม</span><textarea rows={2} value={source.unsupportedExplanation ?? ""} onChange={(event) => onChange({ unsupportedExplanation: nullableText(event.target.value) })} /></label>
    {source.unsupportedClassification && <div className="field-span alert alert-warning">รายการนี้จะบันทึกร่างได้ แต่จะไม่คำนวณเครดิตเหมือนกรณีที่รองรับ</div>}
  </div></details>;
}

export function MoneyField({ id, label, value, onChange, hint, unit = "บาท", required = false, disabled = false }: { id?: string; label: ReactNode; value: string | null; onChange: (value: string | null) => void; hint?: string; unit?: string; required?: boolean; disabled?: boolean }) {
  return <label className="field"><span>{label}</span><span className="input-unit"><input id={id} inputMode="decimal" autoComplete="off" value={value ?? ""} onChange={(event) => onChange(nullableText(event.target.value))} placeholder="0.00" aria-required={required} required={required} disabled={disabled} /><span>{unit}</span></span>{hint && <small className="field-hint">{hint}</small>}</label>;
}

function evidenceMediaType(mediaType: string): string {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "image/jpeg") return "JPEG";
  if (mediaType === "image/png") return "PNG";
  return "ชนิดไฟล์ที่ไม่ทราบ";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function UploadButton({ label, kind, sourceId, sourceIndex, disabled, onUpload }: {
  label: string;
  kind: EvidenceKind;
  sourceId: string | null;
  sourceIndex?: number;
  disabled: boolean;
  onUpload: StepProps["onUpload"];
}) {
  return <label className={`button button-secondary button-small ${disabled ? "is-disabled" : ""}`}>
    {label}<input aria-label={label} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={disabled} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      if (file) void onUpload(sourceId, kind, file, sourceIndex);
      event.currentTarget.value = "";
    }} hidden />
  </label>;
}
