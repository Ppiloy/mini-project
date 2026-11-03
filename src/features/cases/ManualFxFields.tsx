import { useState } from "react";
import type { ExchangeRateReference } from "../../../shared/contracts.js";
import { displayKnownExampleNote, fxRateTypeLabel, fxSourceKindLabel } from "../../../shared/labels.js";

const BOT_EXCHANGE_RATE_URL = "https://www.bot.or.th/th/statistics/exchange-rate.html";
const USER_SUPPLIED_SOURCE_LABEL = "ผู้ใช้กรอกเอง";
const USER_SUPPLIED_NOTE = "อัตราที่ผู้ใช้กรอกเอง ระบบไม่ได้ดึงหรือยืนยันค่า";

export function defaultFxBaseUnits(currencyCode: string | null): 1 | 100 | null {
  if (currencyCode === null) return null;
  return currencyCode === "JPY" || currencyCode === "VND" ? 100 : 1;
}

function hasStoredReference(reference: ExchangeRateReference): boolean {
  return [reference.thbRate, reference.effectiveDate, reference.rateType, reference.sourceKind,
    reference.sourceLabel, reference.sourceUrl, reference.educationalAssumption]
    .some((value) => value !== null && value !== "");
}

function canEditManualQuote(reference: ExchangeRateReference, currencyCode: string | null, remittanceDate: string | null): boolean {
  return reference.rateType === "manual"
    && reference.sourceKind === "user_supplied"
    && reference.currencyCode === currencyCode
    && reference.baseUnits !== null
    && reference.effectiveDate !== null
    && reference.effectiveDate === remittanceDate
    && reference.sourceLabel !== null
    && reference.educationalAssumption !== null;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

function freshManualQuote(currencyCode: string, remittanceDate: string | null): ExchangeRateReference {
  return {
    currencyCode,
    thbRate: null,
    baseUnits: defaultFxBaseUnits(currencyCode),
    effectiveDate: remittanceDate,
    rateType: "manual",
    sourceKind: "user_supplied",
    sourceLabel: USER_SUPPLIED_SOURCE_LABEL,
    sourceUrl: null,
    educationalAssumption: USER_SUPPLIED_NOTE,
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
  const hasReference = reference !== null && hasStoredReference(reference);
  const isEditableManual = reference !== null && canEditManualQuote(reference, currencyCode, remittanceDate);

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
    ...(current ?? freshManualQuote(currencyCode, remittanceDate)),
    ...change,
  });

  return <div className="field-grid details-grid field-span manual-fx-fields">
    <label className="field field-span">
      <span>อัตราที่ใช้สำหรับวันที่นำเงินได้เข้าไทย <span aria-hidden="true">*</span></span>
      <span className="manual-fx-quotation" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: 8 }}>
        <span>{units} {currencyCode} =</span>
        <input
          id={`source-${sourceIndex}-fxReference-thbRate`}
          aria-label={`${units} ${currencyCode} = บาท`}
          inputMode="decimal"
          autoComplete="off"
          value={current?.thbRate ?? ""}
          onChange={(event) => update({ thbRate: nullableText(event.target.value) })}
          placeholder="0.00"
          required
          aria-required="true"
          readOnly={remittanceDate === null}
          aria-readonly={remittanceDate === null}
        />
        <span>บาท</span>
      </span>
      <small className="field-hint">
        อัตรานี้ใช้แปลง (D), (E) และ (F) โดยอิงวันที่ใช้แปลง {remittanceDate ?? "กรุณาระบุวันที่นำเงินเข้าไทย"}; ระบบไม่ดึงหรือยืนยันอัตรา
      </small>
    </label>
    <label className="field field-span">
      <span>ลิงก์แหล่งอ้างอิงที่ผู้ใช้ระบุ (ไม่บังคับ)</span>
      <input
        id={`source-${sourceIndex}-fxReference-sourceUrl`}
        type="url"
        value={current?.sourceUrl ?? ""}
        onChange={(event) => update({ sourceUrl: nullableText(event.target.value) })}
        readOnly={remittanceDate === null}
        aria-readonly={remittanceDate === null}
      />
    </label>
    <p className="field-hint field-span">
      <a href={BOT_EXCHANGE_RATE_URL} target="_blank" rel="noopener noreferrer">ดูข้อมูลอัตราแลกเปลี่ยนของ ธปท.</a>
      <span> ลิงก์นี้เป็นแหล่งอ้างอิงเสริม ระบบไม่ดึงค่าอัตโนมัติ</span>
    </p>
  </div>;
}
