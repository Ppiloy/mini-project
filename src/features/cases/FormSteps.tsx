import type { AttachmentMetadata, EvidenceKind, FtcCaseDraft, ForeignIncomeSourceDraft, InputMode, UnsupportedClassification } from "../../../shared/contracts.js";
import { createEmptySource } from "../../fixtures/index.js";

interface StepProps {
  draft: FtcCaseDraft;
  onChange: (next: FtcCaseDraft) => void;
  attachments: AttachmentMetadata[];
  onUpload: (sourceId: string | null, kind: EvidenceKind, file: File, sourceIndex?: number) => Promise<void>;
  onDeleteAttachment: (id: string) => Promise<void>;
  onDownloadAttachment: (attachment: AttachmentMetadata) => Promise<void>;
  busy: boolean;
}

const countries = [{ code: "VN", name: "เวียดนาม (Vietnam)" }, { code: "CN", name: "จีน (China)" }, { code: "XX", name: "ประเทศอื่น — ยังไม่รองรับ" }];
const evidenceKinds: Array<{ kind: EvidenceKind; label: string }> = [
  { kind: "foreign_income", label: "หลักฐานเงินได้ต่างประเทศ" },
  { kind: "foreign_tax", label: "หลักฐานภาษีที่ชำระในต่างประเทศ" },
  { kind: "remittance", label: "หลักฐานการนำเงินเข้าไทย" },
];

function nullableText(value: string): string | null { return value === "" ? null : value; }

export function StepOne({ draft, onChange }: StepProps) {
  const year = draft.taxYear;
  const unsupported = year !== null && year !== 2025;
  return (
    <section className="step-panel" aria-labelledby="step-title">
      <h2 id="step-title">ปีภาษีและขอบเขตกรณี</h2>
      <p className="muted">เลือกปีภาษีและบันทึกข้อเท็จจริงเรื่องถิ่นที่อยู่ สำหรับการคำนวณตัวอย่างนี้รองรับเฉพาะปี 2568 (ค.ศ. 2025)</p>
      <label className="field field-narrow"><span>ปีภาษี (พ.ศ.)</span><select value={year === null ? "" : String(year + 543)} onChange={(event) => onChange({ ...draft, taxYear: event.target.value === "" ? null : Number(event.target.value) - 543 })}>
        <option value="">เลือกปีภาษี</option><option value="2568">2568 (2025)</option><option value="2567">2567 (2024) — ยังไม่รองรับ</option><option value="2569">2569 (2026) — ยังไม่รองรับ</option>
      </select></label>
      {unsupported && <div className="alert alert-warning" role="status"><strong>กรณีนี้อยู่นอกขอบเขตตัวอย่าง</strong><span>บันทึกร่างไว้แก้ไขได้ แต่ระบบจะไม่สร้างยอดเครดิตภาษี</span></div>}
      <div className="info-callout"><strong>ขอบเขตที่ระบบต้นแบบแสดง</strong><p>เงินได้ปีเดียวกับการนำเข้าไทย · เวียดนามและจีน · เงินเดือนตามมาตรา 40(1) และเงินปันผลตัวอย่างตามมาตรา 40(4) · ผู้มีถิ่นที่อยู่ตามเกณฑ์ 180 วัน</p></div>
      <div className="alert alert-info"><strong>ข้อมูลนี้เป็นตัวอย่างเพื่อการศึกษา</strong><span>ระบบไม่ได้ยืนยันสิทธิภาษีตามอนุสัญญา และไม่ใช่แบบยื่นภาษีหรือคำวินิจฉัยของกรมสรรพากร</span></div>
    </section>
  );
}

export function StepTwo({ draft, onChange }: StepProps) {
  const updateSource = (index: number, update: Partial<ForeignIncomeSourceDraft>) => {
    const sources = draft.sources.map((source, i) => i === index ? { ...source, ...update } : source);
    onChange({ ...draft, sources });
  };
  const add = () => onChange({ ...draft, sources: [...draft.sources, createEmptySource()] });
  const remove = (index: number) => onChange({ ...draft, sources: draft.sources.filter((_, i) => i !== index) });
  return (
    <section className="step-panel" aria-labelledby="step-title">
      <div className="step-section-head"><div><h2 id="step-title">แหล่งเงินได้จากต่างประเทศ</h2><p className="muted">แยกเงินได้ที่เกิดขึ้นต่างประเทศออกจากจำนวนที่นำเข้าประเทศไทย ระบบรองรับไม่เกิน 20 แหล่ง</p></div><button className="button button-secondary button-small" onClick={add} type="button" disabled={draft.sources.length >= 20}>＋ เพิ่มแหล่งเงินได้</button></div>
      {draft.sources.length === 0 && <div className="empty-inline"><strong>ยังไม่มีแหล่งเงินได้</strong><span>เพิ่มรายการเพื่อบันทึกประเทศ ประเภทเงินได้ วันที่เกิดรายได้ และวันพำนัก</span><button type="button" className="button button-secondary" onClick={add}>เพิ่มแหล่งเงินได้แรก</button></div>}
      <div className="source-list">{draft.sources.map((source, index) => <article className="source-card" key={source.id ?? `source-${index}`}>
        <div className="source-card-title"><div><p className="eyebrow">SOURCE {String(index + 1).padStart(2, "0")}</p><h3>แหล่งเงินได้ {index + 1}</h3></div><button type="button" className="button button-danger-quiet button-small" onClick={() => remove(index)} aria-label={`ลบแหล่งเงินได้ ${index + 1}`}>ลบรายการ</button></div>
        <div className="field-grid">
          <label className="field"><span>ประเทศที่เกิดเงินได้</span><select value={source.countryCode ?? ""} onChange={(event) => {
            const code = nullableText(event.target.value);
            const country = countries.find((item) => item.code === code);
            updateSource(index, { countryCode: code, countryName: code === "VN" ? "Vietnam" : code === "CN" ? "China" : country?.name ?? null });
          }}><option value="">เลือกประเทศ</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          <label className="field"><span>ประเภทเงินได้</span><select value={source.incomeType ?? ""} onChange={(event) => {
            const type = event.target.value as ForeignIncomeSourceDraft["incomeType"];
            updateSource(index, { incomeType: type || null, subtype: type === "salary_40_1" ? "salary" : type === "dividend_40_4" ? "dividend" : null });
          }}><option value="">เลือกประเภท</option><option value="salary_40_1">เงินเดือน ม.40(1)</option><option value="dividend_40_4">เงินปันผล ม.40(4)</option><option value="other">ประเภทอื่น — ยังไม่รองรับ</option></select></label>
          <label className="field"><span>วันที่เกิดเงินได้</span><input type="date" value={source.earnedDate ?? ""} onChange={(event) => updateSource(index, { earnedDate: nullableText(event.target.value), earnedTaxYear: event.target.value ? Number(event.target.value.slice(0, 4)) : null })} /></label>
          <label className="field"><span>วันพำนักในประเทศไทยในปีที่เกิดเงินได้</span><span className="input-unit"><input inputMode="numeric" pattern="[0-9]*" value={source.residenceDaysInEarnedYear ?? ""} onChange={(event) => updateSource(index, { residenceDaysInEarnedYear: event.target.value === "" ? null : /^\d+$/.test(event.target.value) ? Number(event.target.value) : source.residenceDaysInEarnedYear })} /><span>วัน</span></span><small className="field-hint">180 วันขึ้นไปอยู่ในกรณีตัวอย่างที่รองรับ</small></label>
          <label className="field"><span>รูปแบบการกรอก</span><select value={source.inputMode ?? ""} onChange={(event) => {
            const mode = event.target.value as InputMode;
            const hasAmounts = [source.grossIncomeAmount, source.actualForeignTaxPaid, source.eligibleForeignTax, source.remittedIncomeAmount, source.remittance?.transferTotalAmount].some((value) => value !== null);
            if (source.inputMode && source.inputMode !== mode && hasAmounts && !window.confirm("การเปลี่ยนรูปแบบจะล้างจำนวนเงิน D/E/F และยอดโอน เพื่อไม่ให้ตีความตัวเลขเดิมเป็นคนละสกุลเงิน ต้องการเปลี่ยนหรือไม่?")) return;
            const cleared = source.inputMode !== mode && hasAmounts ? { grossIncomeAmount: null, actualForeignTaxPaid: null, eligibleForeignTax: null, remittedIncomeAmount: null, remittance: source.remittance ? { ...source.remittance, transferTotalAmount: null } : null } : {};
            if (mode === "worksheet_thb") updateSource(index, { ...cleared, inputMode: mode, currencyCode: "THB", fxReference: null, remittance: source.remittance ? { ...source.remittance, ...("remittance" in cleared && cleared.remittance ? { transferTotalAmount: cleared.remittance.transferTotalAmount } : {}), transferCurrencyCode: "THB" } : null });
            else updateSource(index, { ...cleared, inputMode: mode || null, currencyCode: null });
          }}><option value="">เลือกรูปแบบ</option><option value="worksheet_thb">จำนวนเงินตามตาราง (THB)</option><option value="original_currency">สกุลเงินต้นทาง D/E/F</option></select></label>
          {source.inputMode === "original_currency" && <label className="field"><span>สกุลเงินต้นทาง</span><input maxLength={3} autoCapitalize="characters" value={source.currencyCode ?? ""} placeholder="เช่น USD" onChange={(event) => {
            const currencyCode = nullableText(event.target.value.toUpperCase());
            const changed = source.currencyCode !== null && currencyCode !== source.currencyCode;
            const hasAmounts = [source.grossIncomeAmount, source.actualForeignTaxPaid, source.eligibleForeignTax, source.remittedIncomeAmount, source.remittance?.transferTotalAmount].some((value) => value !== null);
            if (changed && hasAmounts && !window.confirm("การเปลี่ยนสกุลเงินจะล้างจำนวนเงิน D/E/F และยอดโอนเดิม ต้องการเปลี่ยนหรือไม่?")) return;
            const cleared = changed && hasAmounts ? { grossIncomeAmount: null, actualForeignTaxPaid: null, eligibleForeignTax: null, remittedIncomeAmount: null, remittance: source.remittance ? { ...source.remittance, transferTotalAmount: null } : null } : {};
            updateSource(index, { ...cleared, currencyCode, fxReference: source.fxReference ? { ...source.fxReference, currencyCode } : null, remittance: source.remittance ? { ...source.remittance, ...("remittance" in cleared && cleared.remittance ? { transferTotalAmount: cleared.remittance.transferTotalAmount } : {}), transferCurrencyCode: currencyCode } : null });
          }} /></label>}
        </div>
        <UnsupportedEditor source={source} onChange={(update) => updateSource(index, update)} />
      </article>)}</div>
    </section>
  );
}

export function StepThree({ draft, onChange }: StepProps) {
  const updateSource = (index: number, update: Partial<ForeignIncomeSourceDraft>) => onChange({ ...draft, sources: draft.sources.map((source, i) => i === index ? { ...source, ...update } : source) });
  return (
    <section className="step-panel" aria-labelledby="step-title">
      <h2 id="step-title">การนำเงินเข้าและภาษีต่างประเทศ</h2>
      <p className="muted">D คือเงินได้ต้นทาง · E คือภาษีที่สมมติว่าเข้าเกณฑ์ · F คือส่วนเงินได้ที่นำเข้าไทย ระบุจำนวนเงินจริงและสมมติฐานแยกกัน</p>
      {draft.sources.length === 0 && <div className="alert alert-warning">เพิ่มแหล่งเงินได้ในขั้นก่อนหน้าเพื่อกรอกข้อมูลการนำเงินเข้า</div>}
      <div className="source-list">{draft.sources.map((source, index) => {
        const fx = source.fxReference ?? { currencyCode: source.currencyCode, thbRate: null, baseUnits: 1 as const, effectiveDate: null, rateType: null, sourceKind: null, sourceLabel: null, sourceUrl: null, educationalAssumption: null };
        const remittance = source.remittance ?? { remittanceDate: null, transferTotalAmount: null, transferCurrencyCode: source.currencyCode, transferTotalThb: null, classification: null, classificationNote: null };
        return <article className="source-card" key={source.id ?? `source-${index}`}><div className="source-card-title"><div><p className="eyebrow">SOURCE {String(index + 1).padStart(2, "0")}</p><h3>{source.countryName ?? `แหล่งเงินได้ ${index + 1}`}</h3></div><span className="source-id">{source.inputMode === "original_currency" ? source.currencyCode ?? "สกุลเงินต้นทาง" : "THB"}</span></div>
          <div className="field-grid">
            <MoneyField label="D · เงินได้พึงประเมินต้นทาง" value={source.grossIncomeAmount} onChange={(value) => updateSource(index, { grossIncomeAmount: value })} />
            <MoneyField label="ภาษีต่างประเทศที่ชำระจริง" value={source.actualForeignTaxPaid} onChange={(value) => updateSource(index, { actualForeignTaxPaid: value })} hint="แสดงแยกจาก E และไม่ถือว่าเข้าเกณฑ์โดยอัตโนมัติ" />
            <MoneyField label="E · ภาษีที่สมมติว่าเข้าเกณฑ์" value={source.eligibleForeignTax} onChange={(value) => updateSource(index, { eligibleForeignTax: value })} hint="ต้องไม่เกินภาษีต่างประเทศที่ชำระจริง" />
            <label className="field"><span>เหตุผลของสมมติฐาน E</span><textarea rows={2} maxLength={1000} value={source.eligibilityRationale ?? ""} onChange={(event) => updateSource(index, { eligibilityRationale: nullableText(event.target.value) })} placeholder="อธิบายสมมติฐานที่ใช้ในตัวอย่าง" /></label>
            <MoneyField label="F · ส่วนเงินได้ที่นำเข้าไทย" value={source.remittedIncomeAmount} onChange={(value) => updateSource(index, { remittedIncomeAmount: value })} hint="F เป็นส่วนเงินได้ ไม่จำเป็นต้องเท่ากับยอดโอนทั้งหมด" />
            <label className="field"><span>วันที่นำเงินเข้าไทย</span><input type="date" value={remittance.remittanceDate ?? ""} onChange={(event) => updateSource(index, { remittance: { ...remittance, remittanceDate: nullableText(event.target.value) } })} /></label>
            <MoneyField label="ยอดโอนทั้งหมด (ข้อมูลประกอบ)" value={remittance.transferTotalAmount} onChange={(value) => updateSource(index, { remittance: { ...remittance, transferTotalAmount: value } })} hint="อย่าใช้ยอดโอนแทน F หากรวมเงินต้นหรือมีข้อเท็จจริงกำกวม" />
            <label className="field"><span>ลักษณะการโอน</span><select value={remittance.classification ?? ""} onChange={(event) => updateSource(index, { remittance: { ...remittance, classification: (event.target.value || null) as typeof remittance.classification } })}><option value="">เลือกลักษณะ</option><option value="income_only">ระบุได้ว่าเป็นส่วนเงินได้อย่างเดียว</option><option value="mixed_principal_and_income">รวมเงินต้นกับเงินได้ — ต้องตรวจสอบ</option><option value="gross_net_ambiguous">ไม่ชัดเจนระหว่างยอดสุทธิ/ยอดก่อนหัก — ต้องตรวจสอบ</option><option value="tax_refund">เป็นเงินคืนภาษี — ต้องตรวจสอบ</option><option value="unknown">ยังไม่ทราบ — ต้องตรวจสอบ</option></select></label>
            {source.inputMode === "original_currency" && <>
              <MoneyField label="อัตรา THB ต่อหน่วยฐาน" value={fx.thbRate} onChange={(value) => updateSource(index, { fxReference: { ...fx, thbRate: value } })} hint={`ใบเสนอราคา ${fx.baseUnits ?? 1} ${fx.currencyCode ?? "หน่วย"}`} />
              <label className="field"><span>หน่วยของอัตรา</span><select value={fx.baseUnits ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, baseUnits: event.target.value === "100" ? 100 : event.target.value === "1" ? 1 : null } })}><option value="">เลือกหน่วย</option><option value="1">ต่อ 1 หน่วย</option><option value="100">ต่อ 100 หน่วย</option></select></label>
              <label className="field"><span>วันที่อัตราแลกเปลี่ยน</span><input type="date" value={fx.effectiveDate ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, effectiveDate: nullableText(event.target.value) } })} /></label>
              <label className="field"><span>ประเภทอัตรา</span><select value={fx.rateType ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, rateType: nullableText(event.target.value) as typeof fx.rateType, sourceKind: event.target.value === "manual" ? "user_supplied" : event.target.value === "fixture" ? "fixture" : event.target.value === "bank_buying" ? "bank" : event.target.value ? "bot" : null } })}><option value="">เลือกประเภท</option><option value="bank_buying">ธนาคาร อัตราซื้อ</option><option value="bot_average_buying">BOT อัตราซื้อเฉลี่ย</option><option value="manual">กรอกเอง</option><option value="fixture">อัตราสมมติสำหรับการศึกษา</option></select></label>
              <label className="field"><span>แหล่งที่มาอัตรา</span><input value={fx.sourceLabel ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, sourceLabel: nullableText(event.target.value) } })} placeholder="ชื่อธนาคารหรือแหล่งข้อมูล" /></label>
              <label className="field"><span>ลิงก์แหล่งอัตรา (ถ้ามี)</span><input type="url" value={fx.sourceUrl ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, sourceUrl: nullableText(event.target.value) } })} /></label>
              {(fx.rateType === "manual" || fx.rateType === "fixture") && <label className="field field-span"><span>สมมติฐานเพื่อการศึกษา</span><textarea rows={2} value={fx.educationalAssumption ?? ""} onChange={(event) => updateSource(index, { fxReference: { ...fx, educationalAssumption: nullableText(event.target.value) } })} /></label>}
            </>}
          </div>
          {source.inputMode === "original_currency" && <div className="info-callout compact"><strong>ใช้แหล่งอัตราเดียวกันกับ D, E และ F</strong><p>ระบบคำนวณ THB = จำนวนเงินต้นทาง × อัตรา ÷ หน่วยฐาน และเก็บค่า D/E/F เดิมไว้ในรายงาน</p></div>}
          <div className="alert alert-info compact-alert"><span>การจัดสรรเบื้องต้น G = (F ÷ D) × E แสดงตามข้อมูลที่คุณระบุ ระบบไม่สรุปสิทธิภาษีจากประเทศที่เลือก</span></div>
        </article>;
      })}</div>
    </section>
  );
}

export function StepFour({ draft, onChange }: StepProps) {
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">เงินได้ในประเทศและภาษีไทย</h2>
    <p className="muted">J คือเงินได้พึงประเมินในประเทศก่อนหักค่าใช้จ่าย/ค่าลดหย่อน ส่วน L คือภาษีไทยจากตัวอย่างที่คำนวณหลังหักรายการดังกล่าวและก่อนเครดิตภาษีต่างประเทศ</p>
    <div className="field-grid field-grid-single">
      <MoneyField label="J · เงินได้พึงประเมินในประเทศก่อนหักรายการ" value={draft.domesticAssessableIncome} onChange={(value) => onChange({ ...draft, domesticAssessableIncome: value })} />
      <MoneyField label="L · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ" value={draft.thaiTax.amountBeforeFtc} onChange={(value) => onChange({ ...draft, thaiTax: { ...draft.thaiTax, amountBeforeFtc: value } })} />
      <label className="field field-span"><span>ที่มาของจำนวน L</span><textarea rows={3} maxLength={1000} value={draft.thaiTax.provenance ?? ""} onChange={(event) => onChange({ ...draft, thaiTax: { ...draft.thaiTax, provenance: nullableText(event.target.value) } })} placeholder="เช่น ภาษีจากตัวอย่างที่จัดเตรียมไว้ ไม่ได้คำนวณจาก J เพียงอย่างเดียว" /><small className="field-hint">ไม่ต้องกรอกยอดภาษีหัก ณ ที่จ่าย และอย่าใช้ L เป็นภาษีหลังหักเครดิตนี้</small></label>
    </div>
    <div className="info-callout"><strong>ต้องยืนยันภาษีไทยให้ตรงกับข้อมูลปัจจุบัน</strong><p>การเปลี่ยน J, แหล่งเงินได้, การนำเงินเข้า หรืออัตราแลกเปลี่ยน จะล้างการยืนยัน L จนกว่าจะยืนยันใหม่</p></div>
    <p className="muted">เมื่อกรอกข้อมูลครบ ระบบจะแสดงช่องยืนยันในขั้นทบทวนและคำนวณ</p>
  </section>;
}

export function StepFive({ draft, onChange, attachments, onUpload, onDeleteAttachment, onDownloadAttachment, busy }: StepProps) {
  const allItems = [{ sourceId: null, sourceIndex: undefined as number | undefined, label: "ภาษีไทย · ที่มาของ L" }, ...draft.sources.map((source, index) => ({ sourceId: source.id, sourceIndex: index, label: `แหล่งเงินได้ ${index + 1} · ${source.countryName ?? "ยังไม่เลือกประเทศ"}` }))];
  return <section className="step-panel" aria-labelledby="step-title">
    <h2 id="step-title">หลักฐานและตรวจทาน</h2>
    <p className="muted">แนบตัวอย่างเอกสารเพื่อจำลองรายการตรวจสอบก่อนส่ง แต่ละไฟล์ไม่เกิน 3 MiB, PDF/JPEG/PNG เท่านั้น</p>
    <div className="alert alert-info"><strong>ข้อมูลจำลองเท่านั้น</strong><span>ในโหมดสาธิตจะแสดงชื่อและชนิดไฟล์ โดยไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์หรือใช้เป็นหลักฐานจริง</span></div>
    <div className="evidence-list">
      {allItems.map(({ sourceId, sourceIndex, label }, itemIndex) => {
        const items = attachments.filter((file) => file.sourceId === sourceId);
        return <article className="evidence-card" key={sourceIndex === undefined ? "thai-tax-evidence" : `source-evidence-${sourceIndex}`}>
          <div className="evidence-title"><div><h3>{label}</h3><p>ไฟล์ {items.length}/5 · รวมไม่เกิน 30 MiB ต่อกรณี</p></div><div className="evidence-upload-actions">
            {sourceIndex === undefined ? <UploadButton label="แนบหลักฐานภาษีไทย" kind="thai_tax" sourceId={null} disabled={busy || items.length >= 5} onUpload={onUpload} /> : evidenceKinds.map(({ kind, label: kindLabel }) => <UploadButton key={kind} label={`แนบ: ${kindLabel}`} kind={kind} sourceId={sourceId} sourceIndex={sourceIndex} disabled={busy || items.length >= 5} onUpload={onUpload} />)}
          </div></div>
          <ul className="file-list">{items.map((item) => <li key={item.id}><span className="file-icon" aria-hidden="true">{item.mediaType.includes("pdf") ? "PDF" : "IMG"}</span><span className="file-name"><strong>{item.displayName}</strong><small>{item.kind.replaceAll("_", " ")} · {item.mediaType} · {formatBytes(item.byteSize)} · {item.status === "ready" ? "พร้อมใช้งาน" : item.status === "pending" ? "กำลังตรวจสอบ" : "อัปโหลดไม่สำเร็จ"}</small></span><button className="button button-quiet button-small" disabled={item.status !== "ready"} onClick={() => void onDownloadAttachment(item)}>ดาวน์โหลด</button><button className="button button-danger-quiet button-small" disabled={busy} onClick={() => void onDeleteAttachment(item.id)}>ลบ</button></li>)}</ul>
          {items.length === 0 && <p className="empty-evidence">ยังไม่มีไฟล์แนบ</p>}
          {sourceId !== null && <div className="evidence-checklist"><strong>รายการหลักฐานที่ควรมี</strong><div className="checklist-items">{evidenceKinds.map(({ kind, label: kindLabel }) => <label key={kind}><input type="checkbox" checked={draft.sources[itemIndex - 1]?.evidenceChecklist.includes(kind) ?? false} onChange={(event) => {
            const sourceIndex = itemIndex - 1;
            const source = draft.sources[sourceIndex];
            if (!source) return;
            const evidenceChecklist = event.target.checked ? [...new Set([...source.evidenceChecklist, kind])] : source.evidenceChecklist.filter((value) => value !== kind);
            onChange({ ...draft, sources: draft.sources.map((item, index) => index === sourceIndex ? { ...item, evidenceChecklist } : item) });
          }} />{kindLabel}</label>)}</div></div>}
        </article>;
      })}
    </div>
    <div className="review-assumptions"><h3>ขอบเขตและสมมติฐาน</h3><ul><li>การคำนวณนี้เป็นตัวอย่างทางการศึกษา ไม่ใช่การวินิจฉัยสิทธิหรือแบบยื่นภาษี</li><li>ยอดภาษีไทย L เป็นจำนวนที่ผู้ใช้ระบุ ไม่ได้อนุมานจาก J</li><li>ระบบแยกภาษีต่างประเทศที่จ่ายจริงออกจาก E ที่ผู้ใช้สมมติว่าเข้าเกณฑ์</li><li>เมื่อยืนยันข้อมูล ค่าที่คำนวณจะใช้ข้อมูลต้นทางและอัตราแลกเปลี่ยนที่แสดงในรายงาน</li></ul></div>
    <div className="confirm-grid">
      <label className="confirm-card"><input type="checkbox" checked={draft.thaiTax.confirmedAt !== null && draft.thaiTax.confirmedInputFingerprint !== null} readOnly aria-label="สถานะยืนยันภาษีไทย" /><span><strong>ยืนยันจำนวนและที่มาของภาษีไทย L</strong><small>การยืนยันเป็นสมมติฐานเพื่อการศึกษา ไม่ได้พิสูจน์ว่า L ถูกต้อง</small></span></label>
      {draft.sources.map((source, index) => <label className="confirm-card" key={source.id ?? `confirmation-${index}`}><input type="checkbox" checked={source.eligibilityConfirmedAt !== null && source.eligibilityConfirmedInputFingerprint !== null} readOnly aria-label={`สถานะยืนยัน E ของแหล่งเงินได้ ${index + 1}`} /><span><strong>ยืนยัน E และเหตุผล · แหล่งเงินได้ {index + 1}</strong><small>{source.eligibilityRationale ?? "กรุณาระบุเหตุผลของสมมติฐาน E ก่อนยืนยัน"}</small></span></label>)}
    </div>
    <p className="field-hint">ยืนยันจำนวน L และ E ได้จากปุ่มในแถบด้านล่าง ระบบจะบันทึกการยืนยันร่วมกับร่าง</p>
  </section>;
}

function UnsupportedEditor({ source, onChange }: { source: ForeignIncomeSourceDraft; onChange: (update: Partial<ForeignIncomeSourceDraft>) => void }) {
  return <details className="unsupported-details"><summary>มีข้อเท็จจริงที่ยังไม่รองรับหรือไม่?</summary><div className="field-grid details-grid">
    <label className="field"><span>สถานะตรวจสอบ</span><select value={source.unsupportedClassification ?? ""} onChange={(event) => onChange({ unsupportedClassification: (event.target.value || null) as UnsupportedClassification | null })}><option value="">ไม่มีข้อเท็จจริงเพิ่มเติม</option><option value="unknown_treaty_treatment">ยังไม่ทราบสิทธิ/เงื่อนไขตาม DTA</option><option value="cross_year_remittance">การนำเข้าอยู่คนละปีภาษี</option><option value="nonresident_earned_income">วันพำนักต่ำกว่าเกณฑ์ตัวอย่าง</option><option value="unsupported_income_type">ประเภทเงินได้ยังไม่รองรับ</option><option value="mixed_principal_and_income">ยอดโอนรวมเงินต้นและเงินได้</option><option value="ambiguous_gross_net">ข้อเท็จจริง gross/net กำกวม</option><option value="tax_refund">รายการเป็นเงินคืนภาษี</option><option value="multiple_remittances">มีการนำเข้าหลายครั้ง</option><option value="other">กรณีอื่นที่ต้องตรวจสอบ</option></select></label>
    <label className="field"><span>คำอธิบายเพิ่มเติม</span><textarea rows={2} value={source.unsupportedExplanation ?? ""} onChange={(event) => onChange({ unsupportedExplanation: nullableText(event.target.value) })} /></label>
    {source.unsupportedClassification && <div className="field-span alert alert-warning">รายการนี้จะบันทึกร่างได้ แต่จะไม่คำนวณเครดิตเหมือนกรณีที่รองรับ</div>}
  </div></details>;
}

export function MoneyField({ label, value, onChange, hint }: { label: string; value: string | null; onChange: (value: string | null) => void; hint?: string }) {
  return <label className="field"><span>{label}</span><span className="input-unit"><input inputMode="decimal" autoComplete="off" value={value ?? ""} onChange={(event) => onChange(nullableText(event.target.value))} placeholder="0.00" aria-label={label} /><span>บาท / หน่วย</span></span>{hint && <small className="field-hint">{hint}</small>}</label>;
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
