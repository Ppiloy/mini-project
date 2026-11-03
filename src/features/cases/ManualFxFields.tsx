import { useState } from "react";
import type { ExchangeRateReference } from "../../../shared/contracts.js";
import { displayKnownExampleNote, fxRateTypeLabel, fxSourceKindLabel } from "../../../shared/labels.js";
import { fxDateBasisLabel, MANUAL_FX_NOTICE, manualFxDateIssue } from "../../../shared/manualFx.js";

const BOT_EXCHANGE_RATE_URL = "https://www.bot.or.th/th/statistics/exchange-rate.html";

export function defaultFxBaseUnits(currencyCode: string | null): 1 | 100 | null {
  if (currencyCode === null) return null;
  return 1;
}

function hasStoredReference(reference: ExchangeRateReference): boolean {
  return [reference.thbRate, reference.effectiveDate, reference.rateType, reference.sourceKind,
    reference.sourceLabel, reference.sourceUrl, reference.educationalAssumption]
    .some((value) => value !== null && value !== "");
}

function canEditManualQuote(reference: ExchangeRateReference, currencyCode: string | null): boolean {
  return (reference.rateType === "manual" || reference.rateType === "bank_buying" || reference.rateType === "bot_average_buying")
    && reference.sourceKind === "user_supplied"
    && reference.currencyCode === currencyCode
    && reference.baseUnits !== null;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

function freshManualQuote(currencyCode: string): ExchangeRateReference {
  return {
    currencyCode,
    thbRate: null,
    baseUnits: defaultFxBaseUnits(currencyCode),
    effectiveDate: null,
    rateType: "bot_average_buying",
    sourceKind: "user_supplied",
    sourceLabel: null,
    sourceUrl: null,
    educationalAssumption: MANUAL_FX_NOTICE,
  };
}

function nullableText(value: string): string | null { return value === "" ? null : value; }

export function ManualFxFields({
  sourceIndex,
  currencyCode,
  remittanceDate,
  reference,
  onChange,
  onReplaceLegacy,
}: {
  sourceIndex: number;
  currencyCode: string | null;
  remittanceDate: string | null;
  reference: ExchangeRateReference | null;
  onChange: (reference: ExchangeRateReference) => void;
  onReplaceLegacy: () => void;
}) {
  const [replacementPrompt, setReplacementPrompt] = useState(false);
  const hasReference = reference !== null && (hasStoredReference(reference) || reference.baseUnits === 100);
  const isEditableManual = reference !== null && canEditManualQuote(reference, currencyCode);

  if (hasReference && !isEditableManual) {
    const saved = reference!;
    const savedUrl = safeHttpUrl(saved.sourceUrl);
    return <div id={`source-${sourceIndex}-fxReference-thbRate`} className="field-span manual-fx-legacy" tabIndex={-1}>
      <p className="field-hint">อัตราที่บันทึกไว้: {saved.baseUnits ?? "—"} {saved.currencyCode ?? "—"} = {saved.thbRate ?? "—"} บาท · วันที่ใช้แปลง {saved.effectiveDate ?? "—"}</p>
      <details>
        <summary>ข้อมูลอัตราเดิมที่บันทึกไว้</summary>
        <p>{saved.baseUnits ?? "—"} {saved.currencyCode ?? "—"} = {saved.thbRate ?? "—"} บาท · {fxRateTypeLabel(saved.rateType)} · {fxSourceKindLabel(saved.sourceKind)} · {saved.sourceLabel ?? "—"} · วันที่ใช้แปลง {saved.effectiveDate ?? "—"}</p>
        {saved.educationalAssumption && <p>{displayKnownExampleNote(saved.educationalAssumption)}</p>}
        {savedUrl && <p><a href={savedUrl} target="_blank" rel="noopener noreferrer">แหล่งอ้างอิงเดิม</a></p>}
      </details>
      {!replacementPrompt
        ? <button type="button" className="button button-secondary button-small" onClick={() => setReplacementPrompt(true)}>แทนอัตราเดิมด้วยอัตราที่ผู้ใช้กรอกเอง</button>
        : <div className="source-delete-prompt" role="alertdialog" aria-labelledby={`source-${sourceIndex}-fx-replace-title`}>
          <strong id={`source-${sourceIndex}-fx-replace-title`}>แทนอัตราเดิมด้วยอัตราที่กรอกเองหรือไม่</strong>
          <p>ข้อมูลอัตราเดิมจะถูกล้าง แต่จำนวน (D), (E) และ (F) จะคงเดิม</p>
          <div>
            <button type="button" className="button button-secondary button-small" onClick={() => setReplacementPrompt(false)}>ยกเลิก</button>
            <button type="button" className="button button-primary button-small" onClick={onReplaceLegacy}>เปลี่ยนและล้างข้อมูล</button>
          </div>
        </div>}
    </div>;
  }

  const current = isEditableManual ? reference! : null;
  const units = current?.baseUnits ?? defaultFxBaseUnits(currencyCode);
  if (currencyCode === null || units === null) {
    return <p className="field-hint field-span">เลือกสกุลเงินต้นทางก่อนกรอกอัตราแลกเปลี่ยน</p>;
  }

  const update = (change: Partial<ExchangeRateReference>) => onChange({
    ...(current ?? freshManualQuote(currencyCode)),
    ...change,
    educationalAssumption: current?.educationalAssumption?.trim() ? current.educationalAssumption : MANUAL_FX_NOTICE,
  });

  const method = current?.rateType ?? "bot_average_buying";
  const dateIssue = manualFxDateIssue(method, current?.effectiveDate ?? null, remittanceDate);
  return <div className="field-grid details-grid field-span manual-fx-fields">
    <div className="field-span"><strong>กรอกอัตราแลกเปลี่ยนด้วยตนเอง</strong><p className="field-hint">ใช้สกุลเงิน {currencyCode} และอัตราเดียวกันแปลง (D), (E) และ (F) เป็นบาท</p></div>
    <label className="field"><span>วิธีอ้างอิงอัตราแลกเปลี่ยน <span aria-hidden="true">*</span></span>
      <select id={`source-${sourceIndex}-fxReference-rateType`} value={method} required onChange={(event) => update({ rateType: event.target.value as ExchangeRateReference["rateType"] })}>
        <option value="bot_average_buying">อัตราเฉลี่ยรับซื้อ ธปท. (แนะนำ)</option>
        <option value="bank_buying">อัตรารับซื้อของธนาคารพาณิชย์</option>
        {method === "manual" && <option value="manual">อัตราที่กรอกไว้เดิม · วันนำเข้าไทย</option>}
      </select>
    </label>
    <label className="field"><span>อัตราแลกเปลี่ยน · บาทต่อ {units} {currencyCode} <span aria-hidden="true">*</span></span>
      <input id={`source-${sourceIndex}-fxReference-thbRate`} aria-label={`อัตราแลกเปลี่ยน (บาทต่อ ${units} ${currencyCode})`} inputMode="decimal" autoComplete="off" value={current?.thbRate ?? ""} onChange={(event) => update({ thbRate: nullableText(event.target.value) })} placeholder="0.00" required aria-required="true" />
    </label>
    <label className="field"><span>วันที่อ้างอิงอัตราแลกเปลี่ยน <span aria-hidden="true">*</span></span>
      <input id={`source-${sourceIndex}-fxReference-effectiveDate`} aria-label="วันที่อ้างอิงอัตราแลกเปลี่ยน" type="date" value={current?.effectiveDate ?? ""} onChange={(event) => update({ effectiveDate: nullableText(event.target.value) })} required aria-required="true" aria-invalid={dateIssue !== null} aria-describedby={`source-${sourceIndex}-fx-date-help`} />
      <small id={`source-${sourceIndex}-fx-date-help`} className="field-hint">{fxDateBasisLabel(method)} · วันที่นำเข้าไทย {remittanceDate ?? "ยังไม่ระบุ"}</small>
      {dateIssue && <small className="field-error">{dateIssue.message}</small>}
    </label>
    <label className="field"><span>แหล่งอัตราที่ผู้ใช้ระบุ <span aria-hidden="true">*</span></span>
      <input id={`source-${sourceIndex}-fxReference-sourceLabel`} value={current?.sourceLabel ?? ""} maxLength={200} onChange={(event) => update({ sourceLabel: nullableText(event.target.value) })} placeholder="เช่น ธปท. อัตราเฉลี่ยรับซื้อ หรือชื่อธนาคาร" required aria-required="true" />
    </label>
    <label className="field field-span">
      <span>ลิงก์แหล่งอ้างอิงที่ผู้ใช้ระบุ (ไม่บังคับ)</span>
      <input
        id={`source-${sourceIndex}-fxReference-sourceUrl`}
        type="url"
        value={current?.sourceUrl ?? ""}
        onChange={(event) => update({ sourceUrl: nullableText(event.target.value) })}
      />
    </label>
    <p className="field-hint field-span">
      <a href={BOT_EXCHANGE_RATE_URL} target="_blank" rel="noopener noreferrer">แนะนำอัตราอ้างอิง ธปท.</a>
      <span> · ระบบไม่ดึงค่าอัตโนมัติ</span>
    </p>
    <p className="field-hint field-span">{MANUAL_FX_NOTICE}</p>
  </div>;
}
