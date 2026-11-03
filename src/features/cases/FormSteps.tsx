import Decimal from "decimal.js";
import { useEffect, useState, type ReactNode } from "react";
import type { AttachmentMetadata, CalculationResult, EvidenceKind, FtcCaseDraft, ForeignIncomeSourceDraft, InputMode, UnsupportedClassification } from "../../../shared/contracts.js";
import { sourceEligibilityFingerprint, taxInputFingerprint } from "../../../shared/confirmations.js";
import { INCOME_CHOICES, RD_DTA_REGISTER_URL } from "../../../shared/coverage.js";
import { calculateFTC } from "../../../shared/calculator.js";
import { formatCalculationIssues, stepForCalculationIssue, validationTargetId, validationTargetLabel, type FormStepIssue } from "../../../shared/formValidation.js";
import { countryLabel, COUNTRY_CHOICES, CURRENCY_CHOICES, displayKnownExampleNote, EVIDENCE_LABELS, incomeTypeLabel, WORKSHEET_LABELS, WORKSHEET_SECTIONS, worksheetLabel, type WorksheetLetter } from "../../../shared/labels.js";
import { deriveResidenceDaysForDraft } from "../../../shared/residence.js";
import { effectiveForeignTaxAmount, hasEligibleTaxAdjustment } from "../../../shared/foreignTax.js";
import { missingEvidenceInventory } from "../../../shared/evidenceInventory.js";
import { createEmptySource } from "../../fixtures/index.js";
import { EvidenceFileActions } from "../../components/EvidenceFileActions.js";
import { FieldLabel } from "../../components/FieldLabel.js";
import { formatMoney } from "../../components/money.js";
import { ManualFxFields } from "./ManualFxFields.js";
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
const RD_FTC_MANUAL_URL = "https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf";
const RD_REVENUE_CODE_URL = "https://www.rd.go.th/5937.html";
const ACTUAL_FOREIGN_TAX_HELP = "คำนวณจากภาษีเงินได้ที่ชำระจริงเท่านั้น ไม่รวมเบี้ยปรับ เงินเพิ่ม หรือภาษีที่ไม่ใช่ภาษีเงินได้";
const SOURCE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const satisfies readonly WorksheetLetter[];
function incomeChoiceKey(source: ForeignIncomeSourceDraft): string {
  if (source.incomeType === null) return "";
  if (source.incomeType === "other") return INCOME_CHOICES.some((choice) => choice.key === source.subtype) ? source.subtype! : "other_unclassified";
  const exactChoice = INCOME_CHOICES.find((choice) => choice.incomeType === source.incomeType && choice.subtype === source.subtype);
  if (exactChoice) return exactChoice.key;
  return INCOME_CHOICES.find((choice) => choice.incomeType === source.incomeType)?.key ?? "";
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
      },
    };
  }
  preview = {
    ...preview,
    sources: preview.sources.map((source) => effectiveForeignTaxAmount(source) !== null
      && (!hasEligibleTaxAdjustment(source) || source.eligibilityRationale?.trim())
      ? {
        ...source,
        eligibilityConfirmedAt: source.eligibilityConfirmedAt ?? PREVIEW_CONFIRMATION_AT,
        eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source),
      }
      : source),
  };
  if (preview.thaiTax.amountBeforeFtc !== null) {
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

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true"> *</span>;
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
      onBlur={() => setOpen(false)}
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
  return fx !== null && [fx.thbRate, fx.effectiveDate, fx.rateType, fx.sourceKind, fx.sourceLabel, fx.sourceUrl, fx.educationalAssumption]
    .some((value) => value !== null && value !== "");
}

function clearDerivedAmounts(): Partial<ForeignIncomeSourceDraft> {
  return {
    grossIncomeThb: null,
    actualForeignTaxPaidThb: null,
    eligibleForeignTaxThb: null,
    remittedIncomeThb: null,
  };
}

function clearAmounts(): Partial<ForeignIncomeSourceDraft> {
  return {
    ...clearDerivedAmounts(),
    grossIncomeAmount: null,
    actualForeignTaxPaid: null,
    eligibleForeignTax: null,
    remittedIncomeAmount: null,
  };
}

type SourceResetTarget = { index: number; sourceId: string | null; sourceRef: ForeignIncomeSourceDraft };
type SourceResetPrompt =
  | (SourceResetTarget & { kind: "all"; change: string; next: Partial<ForeignIncomeSourceDraft> })
  | (SourceResetTarget & { kind: "date"; remittanceDate: string | null });

function pendingResetTargets(prompt: SourceResetPrompt | null, index: number, source: ForeignIncomeSourceDraft | null): boolean {
  if (!prompt || prompt.index !== index || source === null) return false;
  return prompt.sourceId !== null ? source.id === prompt.sourceId : source === prompt.sourceRef;
}

export function StepOne({ draft, onChange, validationErrors = [] }: StepProps) {
  const year = draft.taxYear;
  const currentYear = new Date().getFullYear();
  const taxYearChoices = [...new Set([
    ...Array.from({ length: Math.max(0, currentYear - 2024 + 1) }, (_, index) => 2024 + index),
    ...(year === null ? [] : [year]),
  ])].sort((left, right) => left - right);
  const updateResidenceYears = (residenceYears: NonNullable<FtcCaseDraft["residenceYears"]>) => {
    const next = { ...draft, residenceYears };
    delete next.residencePeriods;
    onChange(deriveResidenceDaysForDraft(next));
  };
  return (
    <section className="step-panel" aria-labelledby="step-title">
      <h2 id="step-title">ข้อมูลเบื้องต้น</h2>
      <p className="muted">กำหนดปีภาษีและบันทึกวันพำนักตามปีที่เกิดเงินได้ ปีที่เกิดเงินได้ วันที่นำเงินเข้า และวันยื่นแบบเป็นคนละข้อเท็จจริง</p>
      <section className="info-callout scope-overview" aria-label="ขอบเขตการคำนวณตามคู่มือกรมสรรพากร">
        <strong>ขอบเขตตามคู่มือกรมสรรพากร</strong>
        <dl className="scope-rows">
          <div><dt>ปีเงินได้และปีภาษี</dt><dd>เงินได้ที่เกิดตั้งแต่ปี 2024 · เลือกปีภาษีที่ตรงกับปีนำเงินเข้าไทย · วันที่เกิดเงินได้กับวันที่นำเข้าเป็นคนละข้อเท็จจริง</dd></div>
          <div><dt>ประเทศและประเภทเงินได้</dt><dd>เลือกประเทศที่มีอนุสัญญาภาษีซ้อนกับไทย · จำแนกเงินได้ตามมาตรา 40(1)–40(8) ตามจริง</dd></div>
          <div><dt>ผู้มีถิ่นที่อยู่</dt><dd>ตรวจวันพำนักในปีที่เกิดเงินได้ตามเกณฑ์อย่างน้อย 180 วันในมาตรา 41</dd></div>
          <div><dt>จำนวนเงินและอัตรา</dt><dd>ระบุจำนวนตามตารางเป็น THB หรือเลือกสกุลเงินและอัตราอ้างอิงตามจริง</dd></div>
        </dl>
        <p>การผ่านเกณฑ์ดังกล่าวไม่ได้ยืนยันสิทธิ FTC หรือข้อสรุปตามอนุสัญญาภาษีซ้อน</p>
      </section>
      <label className="field field-narrow"><span>ปีภาษี (พ.ศ.) <RequiredMark /></span><select id="case-taxYear" required aria-required="true" value={year === null ? "" : String(year + 543)} onChange={(event) => onChange({ ...draft, taxYear: event.target.value === "" ? null : Number(event.target.value) - 543 })}>
        <option value="">เลือกปีภาษี</option>{taxYearChoices.map((taxYear) => <option key={taxYear} value={String(taxYear + 543)}>{taxYear + 543} ({taxYear})</option>)}
      </select></label>
      {validationErrors.filter((issue) => issue.path?.[0] === "taxYear").map((issue, index) => <div className="alert alert-error" role="alert" key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} /></div>)}
      {validationErrors.filter((issue) => issue.path?.[0] === "residenceYears" || issue.path?.[0] === "residencePeriods").map((issue, index) => <div className="alert alert-error" role="alert" key={`residence-${index}`}><span>{issue.message}</span><ValidationFieldLink issue={issue} /></div>)}
      <ResidenceSection
        periods={draft.residencePeriods}
        residenceYears={draft.residenceYears}
        sources={draft.sources}
        calculationTaxYear={draft.taxYear}
        onChange={(residencePeriods) => onChange(deriveResidenceDaysForDraft({ ...draft, residencePeriods }))}
        onResidenceYearsChange={updateResidenceYears}
      />
      <div className="alert alert-info"><strong>ข้อมูลนี้เป็นตัวอย่างเพื่อการศึกษา</strong><span>ระบบไม่ได้ยืนยันสิทธิภาษีตามอนุสัญญา และไม่ใช่แบบยื่นภาษีหรือคำวินิจฉัยของกรมสรรพากร</span></div>
    </section>
  );
}

export function StepTwo({ draft, onChange, attachments, onNavigateStep, validationErrors = [] }: StepProps) {
  const [pendingRemovalIndex, setPendingRemovalIndex] = useState<number | null>(null);
  const [blockedRemovalIndex, setBlockedRemovalIndex] = useState<number | null>(null);
  const [adjustmentOpenBySource, setAdjustmentOpenBySource] = useState<Record<string, boolean>>({});
  const [pendingReset, setPendingReset] = useState<SourceResetPrompt | null>(null);
  useEffect(() => {
    if (pendingReset && !pendingResetTargets(pendingReset, pendingReset.index, draft.sources[pendingReset.index] ?? null)) {
      setPendingReset(null);
    }
  }, [draft.sources, pendingReset]);
  const updateSource = (index: number, update: Partial<ForeignIncomeSourceDraft>) => {
    const sources = draft.sources.map((source, currentIndex) => currentIndex === index ? { ...source, ...update } : source);
    onChange(deriveResidenceDaysForDraft({ ...draft, sources }));
  };
  const requestFullReset = (index: number, change: string, next: Partial<ForeignIncomeSourceDraft>) => {
    const source = draft.sources[index];
    if (!source) return;
    if (!hasAmounts(source) && !hasFxQuote(source)) {
      updateSource(index, { ...clearAmounts(), remittance: source.remittance === null ? null : { ...source.remittance, transferTotalThb: null }, ...next });
      return;
    }
    setPendingReset({ kind: "all", index, sourceId: source.id, sourceRef: source, change, next });
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
    label: `${country.label} (${country.code})`,
    searchText: country.code,
  }));
  const currencyOptions: SearchOption[] = CURRENCY_CHOICES.filter((currency) => currency.code !== "THB").map((currency) => ({ value: currency.code, label: `${currency.code} · ${currency.label}`, searchText: currency.label }));

  return <section className="step-panel" aria-labelledby="step-title">
    <div className="step-section-head"><div><h2 id="step-title">{WORKSHEET_SECTIONS[0]}</h2><p className="muted">ระบุข้อมูล (A)–(F) ในแหล่งเดียวกัน ระบบแสดง (G) และ (H) ตามสูตรเมื่อข้อมูลพร้อม รองรับไม่เกิน 20 แหล่ง</p></div><button className="button button-secondary button-small" onClick={add} type="button" disabled={draft.sources.length >= 20}>＋ เพิ่มแหล่งเงินได้</button></div>
    <section className="info-callout source-entry-guidance" aria-label="หลักเกณฑ์กรมสรรพากรสำหรับข้อมูลแหล่งเงินได้">
      <strong>หลักเกณฑ์และแหล่งอ้างอิง</strong>
      <p>{ACTUAL_FOREIGN_TAX_HELP}</p>
      <p>จำแนกตามลักษณะเงินจริงและประเภทที่รายงานใน ภ.ง.ด.90/91 โดยแยกแต่ละประเทศและมาตรา 40 เป็นคนละรายการ</p>
      <p>อนุสัญญาภาษีซ้อนอาจกำหนดเงื่อนไขสิทธิและข้อจำกัด แต่วิธีคำนวณในตารางใช้สูตรเดียวกันทุกประเทศ</p>
      <ul className="source-reference-links">
        <li><a href={RD_FTC_MANUAL_URL} target="_blank" rel="noopener noreferrer">คู่มือกรมสรรพากรสำหรับการคำนวณเครดิตภาษีต่างประเทศ</a></li>
        <li><a href={RD_REVENUE_CODE_URL} target="_blank" rel="noopener noreferrer">ประมวลรัษฎากร มาตรา 40 และมาตรา 41</a></li>
        <li><a href={RD_DTA_REGISTER_URL} target="_blank" rel="noopener noreferrer">รายชื่ออนุสัญญาภาษีซ้อนและสถานะจากกรมสรรพากร</a></li>
      </ul>
    </section>
    <p className="field-hint">จำแนกตามลักษณะเงินจริงและประเภทที่รายงานใน ภ.ง.ด.90/91 โดยแยกแต่ละประเทศและมาตรา 40 เป็นคนละรายการ</p>
    {validationErrors.filter((issue) => issue.path?.length === 1 && issue.path[0] === "sources").map((issue, index) => <div className="alert alert-error" role="alert" key={index}>{issue.message}</div>)}
    {draft.sources.length === 0 && <div className="empty-inline"><strong>ยังไม่มีแหล่งเงินได้</strong><span>เพิ่มรายการเพื่อบันทึกประเทศ ประเภทเงินได้ วันที่ และจำนวน (D), (E), (F)</span><button type="button" className="button button-secondary" onClick={add}>เพิ่มแหล่งเงินได้แรก</button></div>}
    <div className="source-list">{draft.sources.map((source, index) => {
      const remittance = source.remittance ?? { remittanceDate: null, transferTotalAmount: null, transferCurrencyCode: source.currencyCode, transferTotalThb: null, classification: null, classificationNote: null };
      const sourceCountry = COUNTRY_CHOICES.find((item) => item.code === source.countryCode);
      const legacyCountryOption = source.countryCode !== null && sourceCountry === undefined
        ? { value: source.countryCode, label: `${source.countryName?.trim() || source.countryCode} (${source.countryCode}) · ไม่พบในรายชื่อ DTA ที่รองรับ`, searchText: `${source.countryName ?? ""} ${source.countryCode}` }
        : null;
      const sourceCountryOptions = legacyCountryOption ? [legacyCountryOption, ...countryOptions] : countryOptions;
      const residenceRecord = source.earnedTaxYear === null ? undefined : draft.residenceYears?.find((record) => record.earnedTaxYear === source.earnedTaxYear);
      const openResidenceRecord = () => {
        if (source.earnedTaxYear === null) return;
        onNavigateStep?.(0);
        window.setTimeout(() => {
          const target = document.getElementById(`residence-year-${source.earnedTaxYear}-mode`)
            ?? document.getElementById(`residence-year-${source.earnedTaxYear}-add`)
            ?? document.getElementById("residence-year-add-input");
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.focus({ preventScroll: true });
        }, 50);
      };
      const amountUnit = source.inputMode === "original_currency" ? source.currencyCode ?? "สกุลเงินต้นทาง" : source.inputMode === "worksheet_thb" ? "บาท" : "เลือกรูปแบบก่อน";
      const sourceIssues = validationErrors.filter((issue) => issue.path?.[0] === "sources" && issue.path[1] === index);
      const hasTaxAdjustment = hasEligibleTaxAdjustment(source);
      const adjustmentKey = source.id ?? `new-${index}`;
      const adjustmentOpen = hasTaxAdjustment || (adjustmentOpenBySource[adjustmentKey] ?? false);
      const sourcePreview = previewCalculation({ ...draft, sources: [source] }, true);
      const earnedDateIssues = source.earnedDate === null ? [] : sourcePreview.validationMessages.filter((issue) =>
        ["source.earned_after_claim_year", "source.earned_date_year_mismatch", "source.income_before_tool_window", "source.remittance_before_earned"].includes(issue.code));
      const computedG = previewSourceLine(sourcePreview, [source], 0, "source_G");
      const computedShare = previewSourceLine(sourcePreview, [source], 0, "source_share");
      const sourceReset = pendingReset && pendingResetTargets(pendingReset, index, source) ? pendingReset : null;
      const confirmReset = () => {
        const reset = pendingReset;
        if (!reset || !pendingResetTargets(reset, index, source)) { setPendingReset(null); return; }
        if (reset.kind === "date") {
          updateSource(index, {
            ...clearDerivedAmounts(),
            fxReference: null,
            remittance: { ...remittance, remittanceDate: reset.remittanceDate, transferTotalThb: null },
          });
        } else {
          updateSource(index, {
            ...clearAmounts(),
            remittance: source.remittance === null ? null : { ...remittance, transferTotalThb: null },
            ...reset.next,
          });
        }
        setPendingReset(null);
      };
      return <article className="source-card" key={source.id ?? `source-${index}`} aria-label={`แหล่งเงินได้ ${index + 1}`}>
        <div className="source-card-title"><div><p className="eyebrow">แหล่งที่ {String(index + 1).padStart(2, "0")}</p><h3>แหล่งเงินได้ {index + 1}</h3></div><button type="button" className="button button-danger-quiet button-small" onClick={() => remove(index)} aria-label={`ลบแหล่งเงินได้ ${index + 1}`}>ลบรายการ</button></div>
        {sourceReset && <div className="source-delete-prompt" role="alertdialog" aria-labelledby={`source-${index}-fx-reset-title`}>
          <strong id={`source-${index}-fx-reset-title`}>{sourceReset.kind === "date" ? "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" : `ยืนยันการเปลี่ยน${sourceReset.change}`}</strong>
          <p>{sourceReset.kind === "date"
            ? "การยืนยันจะล้างเฉพาะอัตราเดิมและจำนวนเงินบาทที่แปลงไว้ โดยคงจำนวน (D), (E) และ (F) กับข้อมูลรายการอื่นไว้"
            : "การยืนยันจะล้างจำนวน (D), (E), (F) และข้อมูลอัตราแลกเปลี่ยนเดิม"}</p>
          <div><button type="button" className="button button-secondary button-small" onClick={() => setPendingReset(null)}>ยกเลิก</button><button type="button" className="button button-primary button-small" onClick={confirmReset}>เปลี่ยนและล้างข้อมูล</button></div>
        </div>}
        {blockedRemovalIndex === index && <div className="alert alert-warning" role="alert"><span>ยังมีไฟล์แนบ {attachments.filter((file) => file.sourceId === source.id && file.status !== "deleted").length} รายการ ลบไฟล์ในขั้นหลักฐานก่อนลบแหล่งเงินได้นี้</span><button type="button" className="button button-secondary button-small" onClick={() => onNavigateStep?.(4)}>ไปยังหลักฐานแหล่งเงินได้ {index + 1}</button></div>}
        {pendingRemovalIndex === index && <div className="source-delete-prompt" role="alertdialog" aria-labelledby={`source-delete-title-${index}`}><strong id={`source-delete-title-${index}`}>ยืนยันการลบแหล่งเงินได้ {index + 1}</strong><p>การลบรายการนี้จะเอาข้อมูลแหล่งเงินได้ออกจากร่าง</p><div><button type="button" className="button button-danger-quiet button-small" onClick={confirmRemove}>ยืนยันลบรายการ</button><button type="button" className="button button-secondary button-small" onClick={() => setPendingRemovalIndex(null)}>ยกเลิก</button></div></div>}
        {sourceIssues.length > 0 && <div className="alert alert-error" role="alert"><ul>{sourceIssues.map((issue, issueIndex) => <li key={issueIndex}><span>{issue.message}</span><ValidationFieldLink issue={issue} sourceIndex={index} onNavigateStep={onNavigateStep} targetStep={issue.path?.[2] === "residenceDaysInEarnedYear" ? 0 : undefined} /></li>)}</ul></div>}
        {source.inputMode === null && <p className="field-hint">เลือกโหมดจำนวนเงินด้านล่างก่อนกรอกจำนวน (D), (E) และ (F)</p>}
        <div className="table-scroll source-worksheet-wrap"><table className="source-worksheet-table" aria-label={`${WORKSHEET_SECTIONS[0]} · แหล่งเงินได้ ${index + 1}`}>
          <thead><tr>{SOURCE_LETTERS.map((letter) => <th key={letter} scope="col"><FieldLabel letter={letter} />{["B", "C", "D", "E", "F"].includes(letter) && <RequiredMark />}{["D", "E", "F"].includes(letter) && source.inputMode !== null && <span style={{ display: "block" }}>{source.currencyCode ?? "ยังไม่เลือกสกุลเงิน"}</span>}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td data-label={worksheetLabel("A")}><output className="readonly-value" aria-label={worksheetLabel("A")}>พ.ศ. {thaiYear(source.earnedTaxYear)}{source.earnedTaxYear !== null && ` (ค.ศ. ${source.earnedTaxYear})`}</output><small className="field-hint">ปีจากวันที่เกิดเงินได้ ใช้ตรวจวันพำนักในปีนั้น</small></td>
              <td data-label={`${worksheetLabel("B")} *`}><SearchableChoice id={`source-${index}-countryCode`} label={worksheetLabel("B")} hiddenLabel value={source.countryCode} options={sourceCountryOptions} required onChange={(code) => {
                const country = COUNTRY_CHOICES.find((item) => item.code === code);
                const suggestedCurrency = source.inputMode === "original_currency" && source.currencyCode === null && !hasAmounts(source)
                  ? country?.suggestedCurrency && CURRENCY_CHOICES.some((currency) => currency.code === country.suggestedCurrency) ? country.suggestedCurrency : null
                  : source.currencyCode;
                updateSource(index, { countryCode: code, countryName: country?.storedName ?? null,
                  ...(suggestedCurrency !== source.currencyCode ? { currencyCode: suggestedCurrency } : {}) });
              }} /></td>
              <td data-label={`${worksheetLabel("C")} *`}><label className="field"><span className="sr-only">{worksheetLabel("C")}</span><select id={`source-${index}-incomeType`} required aria-required="true" value={incomeChoiceKey(source)} onChange={(event) => {
                const choice = INCOME_CHOICES.find((item) => item.key === event.target.value);
                updateSource(index, {
                  incomeType: (choice?.incomeType ?? null) as ForeignIncomeSourceDraft["incomeType"],
                  subtype: choice?.subtype ?? null,
                  ...(choice && source.unsupportedClassification === "unsupported_income_type" ? { unsupportedClassification: null } : {}),
                });
              }}><option value="">เลือกประเภท</option>{incomeChoiceKey(source) === "other_unclassified" && <option value="other_unclassified">รายการเดิมที่ยังไม่จำแนกตามมาตรา 40</option>}{INCOME_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label></td>
              <td data-label={`${worksheetLabel("D")} *`}><MoneyField id={`source-${index}-grossIncomeAmount`} label={<span className="sr-only">{worksheetLabel("D")}</span>} value={source.grossIncomeAmount} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { grossIncomeAmount: value })} /></td>
              <td data-label={`${worksheetLabel("E")} *`}>{adjustmentOpen ? <output className="readonly-value" aria-label={worksheetLabel("E")}>{effectiveForeignTaxAmount(source) === null ? "—" : `${formatMoney(effectiveForeignTaxAmount(source))} ${amountUnit}`}</output> : <MoneyField id={`source-${index}-actualForeignTaxPaid`} label={<span className="sr-only">{worksheetLabel("E")}</span>} value={effectiveForeignTaxAmount(source)} unit={amountUnit} required disabled={source.inputMode === null} hint={ACTUAL_FOREIGN_TAX_HELP} onChange={(value) => updateSource(index, { actualForeignTaxPaid: value, ...(source.eligibleForeignTax !== null ? { eligibleForeignTax: value } : {}) })} />}</td>
              <td data-label={`${worksheetLabel("F")} *`}><MoneyField id={`source-${index}-remittedIncomeAmount`} label={<span className="sr-only">{worksheetLabel("F")}</span>} value={source.remittedIncomeAmount} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { remittedIncomeAmount: value })} /></td>
              <td data-label={worksheetLabel("G")}><output className="readonly-value" aria-label={worksheetLabel("G")}>{computedG === null ? "—" : `${formatMoney(computedG)} บาท`}</output></td>
              <td data-label={worksheetLabel("H")}><output className="readonly-value" aria-label={worksheetLabel("H")}>{formatPercentage(computedShare)}</output></td>
            </tr>
            <tr><td className="worksheet-source-details" colSpan={8}><div className="field-grid">
              <label className="field"><span>วันที่เกิดเงินได้ <RequiredMark /></span><input id={`source-${index}-earnedDate`} aria-label="วันที่เกิดเงินได้" type="date" required aria-required="true" aria-invalid={earnedDateIssues.length > 0} aria-describedby={`source-${index}-earnedDate-help${earnedDateIssues.length ? ` source-${index}-earnedDate-errors` : ""}`} value={source.earnedDate ?? ""} onChange={(event) => updateSource(index, { earnedDate: nullableText(event.target.value), earnedTaxYear: event.target.value ? Number(event.target.value.slice(0, 4)) : null })} /><small id={`source-${index}-earnedDate-help`} className="field-hint">ปี (A) คำนวณจากวันที่นี้ ใช้ตรวจวันพำนักในปีที่เกิดเงินได้และช่วงเงินได้ตามคู่มือ แยกจากปีที่นำเงินเข้าไทย</small>
                {earnedDateIssues.length > 0 && <span id={`source-${index}-earnedDate-errors`} className="field-error">{earnedDateIssues.map((issue) => <span key={issue.code} style={{ display: "block" }}>{issue.code === "source.remittance_before_earned" ? "วันที่เกิดเงินได้ต้องไม่หลังวันที่นำเงินเข้าไทย" : issue.message}</span>)}</span>}
              </label>
              <label className="field"><span>วันพำนักในปีที่เกิดเงินได้</span>
                {residenceRecord?.mode === "declared"
                  ? <output id={`source-${index}-residenceDaysInEarnedYear`} className="readonly-value">ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน · ยังไม่ผ่านการตรวจสอบ</output>
                  : <span className="input-unit"><input id={`source-${index}-residenceDaysInEarnedYear`} value={source.residenceDaysInEarnedYear ?? ""} readOnly aria-readonly="true" /><span>วัน</span></span>}
                {residenceRecord?.mode === "declared"
                  ? <small className="field-hint">ไม่มีจำนวนวันแน่นอน ข้อมูลนี้เป็นคำยืนยันของผู้ใช้</small>
                  : draft.residenceYears !== undefined && residenceRecord === undefined
                    ? <small className="field-hint">ยังไม่มีข้อมูลวันพำนักสำหรับปีที่เกิดเงินได้นี้</small>
                    : <small className="field-hint">คำนวณจากข้อมูลวันพำนักในขั้นข้อมูลเบื้องต้น</small>}
                {draft.residenceYears !== undefined && source.earnedTaxYear !== null && <button type="button" className="text-link residence-record-link" onClick={openResidenceRecord}>ดูข้อมูลวันพำนักปี พ.ศ. {source.earnedTaxYear + 543}</button>}
              </label>
              <label className="field"><span>รูปแบบจำนวนเงินของช่อง (D), (E) และ (F) <RequiredMark /></span><select id={`source-${index}-inputMode`} required aria-required="true" value={source.inputMode ?? ""} onChange={(event) => {
                const nextMode = (event.target.value || null) as InputMode | null;
                if (source.inputMode === nextMode) return;
                if (nextMode === "worksheet_thb") requestFullReset(index, "รูปแบบการกรอก", { inputMode: nextMode, currencyCode: "THB", fxReference: null });
                else if (nextMode === "original_currency") {
                  const currency = COUNTRY_CHOICES.find((country) => country.code === source.countryCode)?.suggestedCurrency ?? null;
                  const suggestedCurrency = currency !== null && CURRENCY_CHOICES.some((choice) => choice.code === currency) ? currency : null;
                  requestFullReset(index, "รูปแบบการกรอก", { inputMode: nextMode, currencyCode: suggestedCurrency, fxReference: null });
                } else requestFullReset(index, "รูปแบบการกรอก", { inputMode: null, currencyCode: null, fxReference: null });
              }}><option value="">เลือกรูปแบบ</option><option value="worksheet_thb">จำนวนเงินตามตาราง (THB)</option><option value="original_currency">สกุลเงินต้นทาง</option></select></label>
              {source.inputMode === "original_currency" && <SearchableChoice id={`source-${index}-currencyCode`} label={<>สกุลเงินต้นทาง <RequiredMark /></>} value={source.currencyCode} options={currencyOptions} required onChange={(currencyCode) => {
                const changed = currencyCode !== source.currencyCode;
                if (changed) requestFullReset(index, "สกุลเงิน", { currencyCode, fxReference: null });
              }} />}
              <label className="field"><span>วันที่นำเงินเข้าไทย <RequiredMark /></span><input id={`source-${index}-remittance-remittanceDate`} type="date" required aria-required="true" value={remittance.remittanceDate ?? ""} onChange={(event) => {
                const nextDate = nullableText(event.target.value);
                if (nextDate === remittance.remittanceDate) return;
                if (hasFxQuote(source)) setPendingReset({ kind: "date", index, sourceId: source.id, sourceRef: source, remittanceDate: nextDate });
                else updateSource(index, { remittance: { ...remittance, remittanceDate: nextDate, transferTotalThb: null } });
              }} /></label>
              {!adjustmentOpen && source.eligibilityRationale?.trim() && <p className="field-hint field-span" role="note">หมายเหตุเดิมที่บันทึกไว้: {displayKnownExampleNote(source.eligibilityRationale)}</p>}
              <details className="unsupported-details field-span" open={adjustmentOpen} onToggle={(event) => {
                const nextOpen = event.currentTarget.open;
                setAdjustmentOpenBySource((current) => ({ ...current, [adjustmentKey]: nextOpen }));
              }}><summary>รายละเอียดเพิ่มเติมของภาษีที่ชำระจริงและจำนวน (E)</summary>{adjustmentOpen && <div className="field-grid details-grid">
                <p className="field-hint field-span">กรอกส่วนนี้เมื่อจำนวน (E) ที่ใช้คำนวณต่างจากภาษีที่ชำระจริง หรือเมื่อจำเป็นต้องเก็บข้อมูลเดิมไว้แยกกัน</p>
                <MoneyField id={`source-${index}-actualForeignTaxPaid`} label={<>ภาษีต่างประเทศที่ชำระจริงทั้งหมด <RequiredMark /></>} value={source.actualForeignTaxPaid} unit={amountUnit} required disabled={source.inputMode === null} onChange={(value) => updateSource(index, { actualForeignTaxPaid: value })} />
                <MoneyField id={`source-${index}-eligibleForeignTax`} label={<>จำนวน (E) ที่ใช้คำนวณ</>} value={source.eligibleForeignTax} unit={amountUnit} disabled={source.inputMode === null} onChange={(value) => updateSource(index, { eligibleForeignTax: value })} hint="เว้นว่างเมื่อใช้จำนวนภาษีที่ชำระจริงเป็น (E)" />
                <label className="field field-span"><span>เหตุผลของการปรับจำนวน (E){hasTaxAdjustment && <RequiredMark />}</span><textarea id={`source-${index}-eligibilityRationale`} rows={2} maxLength={1000} required={hasTaxAdjustment} aria-required={hasTaxAdjustment} value={displayKnownExampleNote(source.eligibilityRationale) ?? ""} onChange={(event) => updateSource(index, { eligibilityRationale: nullableText(event.target.value) })} placeholder="กรอกเฉพาะเมื่อจำนวน (E) ต่างจากภาษีที่ชำระจริง" /></label>
              </div>}</details>
              {source.inputMode === "original_currency" && <ManualFxFields
                sourceIndex={index}
                currencyCode={source.currencyCode}
                remittanceDate={remittance.remittanceDate}
                reference={source.fxReference}
                onChange={(fxReference) => updateSource(index, { fxReference })}
                onReplaceLegacy={() => updateSource(index, {
                  ...clearDerivedAmounts(),
                  fxReference: null,
                  remittance: source.remittance === null ? null : { ...remittance, transferTotalThb: null },
                })}
              />}
            </div></td></tr>
          </tbody>
        </table></div>
        {source.inputMode === "original_currency" && <section className="conversion-breakdown" aria-label="การแปลงจำนวนเงินเป็นบาท">
          <strong>กรอก (D), (E), (F) เป็น {source.currencyCode ?? "สกุลเงินต้นทาง"} ก่อนแปลงเป็นบาท</strong>
          <p className="field-hint">แปลงด้วยอัตราเดียวกันที่กรอกไว้ ระบุวันที่ แหล่งอัตรา และข้อมูลให้ครบเพื่อแสดงจำนวนบาท</p>
          <dl className="conversion-values">{([
            ["D", "เงินได้", source.grossIncomeAmount, "source_D"],
            ["E", "ภาษีต่างประเทศ", effectiveForeignTaxAmount(source), "source_E_eligible"],
            ["F", "นำเข้าไทย", source.remittedIncomeAmount, "source_F"],
          ] as const).map(([letter, label, raw, code]) => <div key={letter}><dt>{label} ({letter})</dt><dd>{formatMoney(raw)} {source.currencyCode ?? "—"} → <strong>{formatMoney(previewSourceLine(sourcePreview, [source], 0, code))} บาท</strong></dd></div>)}</dl>
        </section>}
        {source.inputMode === "worksheet_thb" && <p className="field-hint">จำนวน (D), (E), (F) เป็นบาท (THB) ที่แปลงแล้ว ไม่ใช้อัตราแลกเปลี่ยนซ้ำ</p>}
        {sourceCountry?.treatyUrl && <p className="field-hint source-treaty-reference" role="note">
          <a href={sourceCountry.treatyUrl} target="_blank" rel="noopener noreferrer">ข้อมูลอนุสัญญาภาษีซ้อนของ{sourceCountry.label}</a>{" "}
          <a href={RD_DTA_REGISTER_URL} target="_blank" rel="noopener noreferrer">ตรวจสอบสถานะและพิธีสารปัจจุบันในทะเบียนกรมสรรพากร</a>
        </p>}
        <p className="field-hint">คำนวณ (G) จาก ((F) ÷ (D)) × (E) และ (H) จาก (F) ÷ (D)</p>
        <UnsupportedEditor source={source} sourceIndex={index} onChange={(update) => updateSource(index, update)} />
      </article>;
    })}</div>
  </section>;
}

export function StepThree({ draft, onChange, onNavigateStep, validationErrors = [] }: StepProps) {
  const result = calculateFTC(draft);
  const totalRemitted = result.totalRemittedIncome;
  const totalAssessable = result.totalAssessableIncome;
  const issues = validationErrors.filter((issue) => issue.path?.[0] === "domesticAssessableIncome" || issue.path?.[0] === "thaiTax");
  const rawRemittanceIssues = result.validationMessages.filter((issue) =>
    issue.path?.[0] === "sources" && typeof issue.path[1] === "number"
    && ["inputMode", "currencyCode", "remittedIncomeAmount", "fxReference"].includes(String(issue.path[2]))
  );
  const remittanceIssues = formatCalculationIssues(draft, rawRemittanceIssues);
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">{WORKSHEET_SECTIONS[1]}</h2>
    <p className="muted">กรอกเงินได้ในประเทศและภาษีไทยก่อนเครดิตจากข้อมูลที่เตรียมไว้ ระบบรวมเงินได้ต่างประเทศให้โดยอัตโนมัติ</p>
    {issues.length > 0 && <div className="alert alert-error" role="alert"><ul>{issues.map((issue, index) => <li key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} /></li>)}</ul></div>}
    <div className="assessable-income-grid">
      <article className="assessable-amount assessable-computed" aria-labelledby="amount-heading-i">
        <p className="assessable-kind">คำนวณจากแหล่งเงินได้</p>
        <h3 id="amount-heading-i">เงินได้ต่างประเทศที่นำเข้าไทย <span>(I)</span></h3>
        <div className="field"><span><span className="sr-only">{worksheetLabel("I")}</span></span><output className="readonly-value assessable-output" aria-label={WORKSHEET_LABELS.I}>{totalRemitted === null ? "—" : <><strong>{formatMoney(totalRemitted)}</strong>{" "}<span>บาท</span></>}</output><small className="field-hint">ผลรวมเงินได้ที่นำเข้าจากทุกแหล่ง ตามอัตราที่บันทึกไว้</small></div>
      </article>
      <article className="assessable-amount" aria-labelledby="amount-heading-j">
        <p className="assessable-kind">ผู้ใช้กรอกจำนวน</p>
        <h3 id="amount-heading-j">เงินได้พึงประเมินในประเทศ <span>(J)</span><RequiredMark /></h3>
        <MoneyField id="case-domesticAssessableIncome" label={<span className="sr-only">{worksheetLabel("J")}</span>} required formatOnBlur value={draft.domesticAssessableIncome} onChange={(value) => onChange({ ...draft, domesticAssessableIncome: value })} hint="จำนวนก่อนหักค่าใช้จ่ายและค่าลดหย่อนที่เกี่ยวข้อง" />
      </article>
      <article className="assessable-amount assessable-computed" aria-labelledby="amount-heading-k">
        <p className="assessable-kind">คำนวณจาก I + J</p>
        <h3 id="amount-heading-k">เงินได้พึงประเมินรวม <span>(K)</span></h3>
        <div className="field"><span><span className="sr-only">{worksheetLabel("K")}</span></span><output className="readonly-value assessable-output" aria-label={WORKSHEET_LABELS.K}>{totalAssessable === null ? "—" : <><strong>{formatMoney(totalAssessable)}</strong>{" "}<span>บาท</span></>}</output><small className="field-hint">ยอดรวมเงินได้ต่างประเทศที่นำเข้าและเงินได้ในประเทศ</small></div>
      </article>
      <article className="assessable-amount" aria-labelledby="amount-heading-l">
        <p className="assessable-kind">ผู้ใช้กรอกจากแบบภาษีที่เตรียมไว้</p>
        <h3 id="amount-heading-l">ภาษีไทยก่อนเครดิตภาษีต่างประเทศ <span>(L)</span><RequiredMark /></h3>
        <MoneyField id="case-thaiTax-amountBeforeFtc" label={<span className="sr-only">{worksheetLabel("L")} · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ</span>} required formatOnBlur value={draft.thaiTax.amountBeforeFtc} onChange={(value) => onChange({ ...draft, thaiTax: { ...draft.thaiTax, amountBeforeFtc: value } })} hint="ระบุจำนวนหลังหักค่าใช้จ่ายและค่าลดหย่อนที่เกี่ยวข้อง แต่ก่อนใช้เครดิตภาษีต่างประเทศ ไม่คำนวณจาก J เพียงอย่างเดียว" />
      </article>
      {totalRemitted === null && remittanceIssues.length > 0 && <div className="field field-span" role="status"><strong>ยังสรุปยอด (I) ไม่ได้</strong><ul>{remittanceIssues.map((issue, index) => <li key={index}><span>{issue.message}</span><ValidationFieldLink issue={issue} sourceIndex={typeof issue.path?.[1] === "number" ? issue.path[1] : undefined} onNavigateStep={onNavigateStep} targetStep={stepForCalculationIssue(rawRemittanceIssues[index]!)} /></li>)}</ul></div>}
      {draft.thaiTax.provenance && <p className="field-hint field-span">หมายเหตุเดิมที่บันทึกไว้: {displayKnownExampleNote(draft.thaiTax.provenance)}</p>}
    </div>
    <p className="assessable-formula">เงินได้รวม <strong>(K) = (I) + (J)</strong> · ใช้ยอดก่อนหักค่าใช้จ่ายและค่าลดหย่อน</p>
    <div className="info-callout assessable-confirmation"><strong>ยืนยันภาษีไทยในขั้นตรวจทาน</strong><p>เมื่อข้อมูลรายได้ วันพำนัก หรืออัตราเปลี่ยน ให้ตรวจทานการยืนยันอีกครั้ง</p></div>
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

export function StepFive({ draft, attachments, onUpload, onDeleteAttachment, busy, mode = "demo" }: StepProps) {
  const allItems = [{ sourceId: null, sourceIndex: undefined as number | undefined, label: "ภาษีไทย · ที่มาของ (L)" }, ...draft.sources.map((source, index) => ({ sourceId: source.id, sourceIndex: index, label: `แหล่งเงินได้ ${index + 1} · ${countryLabel(source.countryCode, "ยังไม่เลือกประเทศ", source.countryName)} · ${incomeTypeLabel(source)}` }))];
  const missingEvidence = missingEvidenceInventory(draft, attachments.filter((file) => file.status === "ready"));
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">หลักฐานและตรวจทาน</h2>
    <p className="muted">แนบเอกสารที่มีและตรวจดูหมวดที่ยังไม่มีไฟล์พร้อมใช้งาน แต่ละไฟล์ไม่เกิน 3 MiB, PDF/JPEG/PNG เท่านั้น การมีไฟล์ไม่ได้ยืนยันเนื้อหาหรือความถูกต้องของเอกสาร</p>
    {mode === "demo"
      ? <div className="alert alert-info"><strong>ไฟล์เก็บไว้ในเบราว์เซอร์นี้</strong><span>โหมดสาธิตเก็บข้อมูลไฟล์จริงไว้ในเบราว์เซอร์นี้เพื่อเปิดดูตัวอย่างหรือดาวน์โหลด โดยไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์</span></div>
      : <div className="alert alert-warning"><strong>โหมดระบบที่เชื่อมต่อเซิร์ฟเวอร์</strong><span>ไฟล์ที่แนบจะออกจากอุปกรณ์และถูกจัดเก็บในพื้นที่หลักฐานฝั่งเซิร์ฟเวอร์ของโครงการ โปรดใช้เฉพาะเอกสารสมมติสำหรับการสาธิต</span></div>}
    <div className="evidence-list">
      {allItems.map(({ sourceId, sourceIndex, label }) => {
        const source = sourceIndex === undefined ? null : draft.sources[sourceIndex] ?? null;
        const items = attachments.filter((file) => sourceIndex === undefined ? file.sourceId === null : sourceId !== null && file.sourceId === sourceId);
        const needsSourceProof = !isZeroAmount(source?.remittedIncomeAmount);
        const missingKinds = missingEvidence.find((group) => group.sourceIndex === sourceIndex)?.missingKinds ?? [];
        return <article className="evidence-card" key={sourceIndex === undefined ? "thai-tax-evidence" : `source-evidence-${sourceIndex}`}>
          <div className="evidence-title"><div><h3>{label}</h3><p>ไฟล์ {items.length}/5 · รวมไม่เกิน 30 MiB ต่อกรณี</p></div><div className="evidence-upload-actions">
            {sourceIndex === undefined ? <UploadButton label="แนบหลักฐานภาษีไทย" kind="thai_tax" sourceId={null} disabled={busy || items.length >= 5} onUpload={onUpload} /> : evidenceKinds.map(({ kind, label: kindLabel }) => <UploadButton key={kind} label={`แนบ: ${kindLabel}`} kind={kind} sourceId={sourceId} sourceIndex={sourceIndex} disabled={busy || items.length >= 5} onUpload={onUpload} />)}
          </div></div>
          <ul className="file-list">{items.map((item) => <li key={item.id}><span className="file-icon" aria-hidden="true">{evidenceMediaType(item.mediaType)}</span><span className="file-name"><strong>{item.displayName}</strong><small>{EVIDENCE_LABELS[item.kind]} · {evidenceMediaType(item.mediaType)} · {formatBytes(item.byteSize)} · {item.status === "ready" ? "พร้อมใช้งาน" : item.status === "pending" ? "กำลังตรวจสอบ" : "อัปโหลดไม่สำเร็จ"}</small></span><EvidenceFileActions file={item} mode={mode} onDelete={onDeleteAttachment} busy={busy} /></li>)}</ul>
          {items.length === 0 && <p className="empty-evidence">ยังไม่มีไฟล์แนบ</p>}
          {missingKinds.length > 0 && <p className="field-hint evidence-missing"><strong>ยังไม่มีไฟล์พร้อมใช้งานสำหรับ:</strong> {missingKinds.map((kind) => EVIDENCE_LABELS[kind]).join(" · ")}</p>}
          {sourceIndex !== undefined && !needsSourceProof && <p className="field-hint">(F) = 0: ระบบไม่กำหนดให้แนบหลักฐานแหล่งเงินได้สำหรับยอดที่ไม่ได้นำเข้าไทย</p>}
        </article>;
      })}
    </div>
    <section className="info-callout foreign-tax-confirmation-guidance" aria-label="หลักเกณฑ์ยืนยันภาษีต่างประเทศ">
      <strong>ตรวจทานจำนวน (E) ก่อนยืนยัน</strong>
      <p>จำนวนภาษีที่นำมาใช้เป็น (E) ควรเป็นภาษีเงินได้ที่ชำระจริงเท่านั้น ไม่รวมเบี้ยปรับ เงินเพิ่ม หรือภาษีที่ไม่ใช่ภาษีเงินได้ และต้องตรวจเงื่อนไขตามอนุสัญญาภาษีซ้อนของประเทศนั้น</p>
      <p>การตรวจสิทธิและข้อจำกัดตามอนุสัญญาไม่เปลี่ยนสูตรคำนวณ ตารางใช้สูตรเดียวกันทุกประเทศและแยกเพดานเครดิตตามประเทศ</p>
      <a href={RD_FTC_MANUAL_URL} target="_blank" rel="noopener noreferrer">คู่มือกรมสรรพากรสำหรับการคำนวณเครดิตภาษีต่างประเทศ</a>
    </section>
    <div className="review-assumptions"><h3>ขอบเขตและสมมติฐาน</h3><ul><li>การคำนวณนี้เป็นตัวอย่างทางการศึกษา ไม่ใช่การวินิจฉัยสิทธิหรือแบบยื่นภาษี</li><li>จำนวนภาษีไทย (L) มาจากข้อมูลที่ผู้ใช้ระบุ ไม่ได้อนุมานจาก (J)</li><li>ภาษีที่จ่ายจริงจะแสดงแยกจาก (E) เมื่อมีการระบุการปรับจำนวน (E)</li><li>เมื่อยืนยันข้อมูล ผลคำนวณจะใช้ข้อมูลต้นทางและอัตราแลกเปลี่ยนที่แสดงในรายงาน</li></ul></div>
    <p className="field-hint">ยืนยันจำนวน L และ E ได้จากปุ่มด้านล่าง ระบบจะบันทึกการยืนยันร่วมกับร่าง</p>
  </section>;
}

function UnsupportedEditor({ source, sourceIndex, onChange }: { source: ForeignIncomeSourceDraft; sourceIndex: number; onChange: (update: Partial<ForeignIncomeSourceDraft>) => void }) {
  return <details className="unsupported-details"><summary>มีข้อเท็จจริงที่ต้องตรวจสอบเพิ่มเติมหรือไม่?</summary><div className="field-grid details-grid">
    <label className="field"><span>สถานะตรวจสอบ</span><select id={`source-${sourceIndex}-unsupportedClassification`} value={source.unsupportedClassification ?? ""} onChange={(event) => onChange({ unsupportedClassification: (event.target.value || null) as UnsupportedClassification | null })}><option value="">ไม่มีข้อเท็จจริงเพิ่มเติม</option><option value="unknown_treaty_treatment">ยังไม่ทราบสิทธิหรือเงื่อนไขตามอนุสัญญาภาษีซ้อน</option><option value="cross_year_remittance">ปีที่นำเข้าไม่ตรงกับปีภาษีที่ขอเครดิต</option><option value="nonresident_earned_income">วันพำนักไม่ถึง 180 วันตามมาตรา 41 ในปีที่เกิดเงินได้</option><option value="unsupported_income_type">ยังจำแนกประเภทเงินได้ตามมาตรา 40 ไม่ได้</option><option value="mixed_principal_and_income">ยอดโอนรวมเงินต้นและเงินได้</option><option value="ambiguous_gross_net">ข้อเท็จจริง gross/net กำกวม</option><option value="tax_refund">รายการเป็นเงินคืนภาษี</option><option value="multiple_remittances">มีการนำเข้าเงินหลายครั้ง</option><option value="other">กรณีอื่นที่ต้องตรวจสอบ</option></select></label>
    <label className="field"><span>คำอธิบายเพิ่มเติม</span><textarea rows={2} value={source.unsupportedExplanation ?? ""} onChange={(event) => onChange({ unsupportedExplanation: nullableText(event.target.value) })} /></label>
    {source.unsupportedClassification && <div className="field-span alert alert-warning">เก็บรายการนี้เป็นข้อเท็จจริงที่ต้องตรวจสอบก่อนสรุปเครดิตภาษี</div>}
  </div></details>;
}

export function MoneyField({ id, label, value, onChange, hint, unit = "บาท", required = false, disabled = false, formatOnBlur = false }: { id?: string; label: ReactNode; value: string | null; onChange: (value: string | null) => void; hint?: string; unit?: string; required?: boolean; disabled?: boolean; formatOnBlur?: boolean }) {
  const [editing, setEditing] = useState(false);
  const formattedValue = formatOnBlur && value !== null && /^\d{1,9}(?:\.\d{1,2})?$/.test(value) ? formatMoney(value) : null;
  const showFormatted = !editing && formattedValue !== null;
  // Keep the input's canonical text stable during focus and selection; grouping is display-only.
  return <label className="field"><span>{label}</span><span className="input-unit">
    <input id={id} inputMode="decimal" autoComplete="off" value={value ?? ""} style={showFormatted ? { color: "transparent" } : undefined} onFocus={() => { if (formatOnBlur) setEditing(true); }} onBlur={() => setEditing(false)} onChange={(event) => onChange(nullableText(event.target.value))} placeholder="0.00" aria-required={required} required={required} disabled={disabled} />
    {showFormatted && <span className="money-display" aria-hidden="true">{formattedValue}</span>}
    <span>{unit}</span>
  </span>{hint && <small className="field-hint">{hint}</small>}</label>;
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
