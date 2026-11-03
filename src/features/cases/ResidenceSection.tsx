import { useState } from "react";
import type { ResidencePeriodDraft, ResidenceYearDraft } from "../../../shared/contracts.js";
import { assessResidenceYear, calculateResidenceDaysInYear, validateResidencePeriods } from "../../../shared/residence.js";

export interface ResidenceSectionProps {
  /** Undefined marks a legacy draft that only stored per-source day totals. */
  periods?: readonly ResidencePeriodDraft[];
  /** Undefined preserves the legacy global-period editor; [] starts the new per-earned-year model. */
  residenceYears?: readonly ResidenceYearDraft[];
  sources: readonly { earnedTaxYear: number | null; residenceDaysInEarnedYear: number | null }[];
  calculationTaxYear?: number | null;
  relevantYears?: readonly number[];
  onChange: (periods: ResidencePeriodDraft[]) => void;
  onResidenceYearsChange?: (records: ResidenceYearDraft[]) => void;
}

function issueText(code: ReturnType<typeof validateResidencePeriods>[number]["code"]): string {
  if (code === "required") return "กรุณาระบุวันที่นี้";
  if (code === "reversed") return "วันสิ้นสุดต้องไม่มาก่อนวันเริ่มต้น";
  return "กรุณาระบุวันที่จริง";
}

function LegacyResidenceSection({ periods, sources, calculationTaxYear = null, relevantYears = [], onChange }: ResidenceSectionProps) {
  const hasPeriodData = periods !== undefined;
  const periodList = periods ?? [];
  const issues = validateResidencePeriods(periodList);
  const periodCalendarYears = periodList.flatMap((period) => {
    if (period.startDate === null || period.endDate === null) return [];
    const first = Number(period.startDate.slice(0, 4));
    const last = Number(period.endDate.slice(0, 4));
    if (!Number.isInteger(first) || !Number.isInteger(last)) return [];
    if (last < first) return [...new Set([first, last])];
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });
  const years = [...new Set([
    ...sources.flatMap(({ earnedTaxYear }) => earnedTaxYear === null ? [] : [earnedTaxYear]),
    ...relevantYears,
    ...(calculationTaxYear === null ? [] : [calculationTaxYear]),
    ...periodCalendarYears,
  ].filter(Number.isInteger))].sort((left, right) => left - right);
  const legacyGroups = new Map<number, Set<number | null>>();
  if (!hasPeriodData) {
    for (const source of sources) {
      if (source.earnedTaxYear === null) continue;
      const counts = legacyGroups.get(source.earnedTaxYear) ?? new Set<number | null>();
      counts.add(source.residenceDaysInEarnedYear);
      legacyGroups.set(source.earnedTaxYear, counts);
    }
  }
  const updatePeriod = (index: number, field: keyof ResidencePeriodDraft, value: string | null) => {
    onChange(periodList.map((period, periodIndex) => periodIndex === index ? { ...period, [field]: value } : { ...period }));
  };

  return (
    <section className="card residence-period-section" aria-labelledby="residence-period-heading">
      <div className="section-heading">
        <div>
          <h2 id="residence-period-heading">ช่วงเวลาที่พำนักในประเทศไทย</h2>
        </div>
        <button id="residence-period-add" className="button button-secondary button-small" type="button" onClick={() => onChange([...periodList.map((period) => ({ ...period })), { startDate: null, endDate: null }])}>
          เพิ่มช่วงเวลา
        </button>
      </div>

      <p className="field-hint">ระบุวันแรกและวันสุดท้ายที่อยู่ในประเทศไทยของแต่ละช่วง นับทั้งสองวันรวมกัน และนับวันปฏิทินที่ซ้ำกันเพียงครั้งเดียว</p>

      {!hasPeriodData && sources.length > 0 && <p className="field-hint">ร่างเดิมบันทึกจำนวนวันแยกตามแหล่งเงินได้ไว้ เมื่อเพิ่มช่วงวันที่ ระบบจะคำนวณยอดจากช่วงเวลาสำหรับทุกแหล่งเงินได้ตามปีที่เกิดรายได้</p>}

      {periodList.length === 0 ? <p className="muted-inline">{hasPeriodData ? "ยังไม่มีช่วงเวลาที่บันทึกไว้" : "ยังไม่มีช่วงเวลาที่บันทึกไว้ในร่างนี้"}</p> : (
        <div className="field-grid">
          {periodList.map((period, index) => {
            const startIssue = issues.find((issue) => issue.periodIndex === index && issue.field === "startDate");
            const endIssue = issues.find((issue) => issue.periodIndex === index && issue.field === "endDate");
            return (
              <div className="field-span residence-period-row" key={`residence-period-${index}`}>
                <div className="field-grid">
                  <label className="field">
                    <span>วันแรกที่พำนัก · ช่วงที่ {index + 1} <span aria-hidden="true">*</span></span>
                    <input id={`residence-period-${index}-startDate`} type="date" required aria-required="true" value={period.startDate ?? ""} aria-invalid={startIssue ? "true" : "false"}
                      onChange={(event) => updatePeriod(index, "startDate", event.target.value || null)} />
                    {startIssue && <small className="field-error">{issueText(startIssue.code)}</small>}
                  </label>
                  <label className="field">
                    <span>วันสุดท้ายที่พำนัก · ช่วงที่ {index + 1} <span aria-hidden="true">*</span></span>
                    <input id={`residence-period-${index}-endDate`} type="date" required aria-required="true" value={period.endDate ?? ""} aria-invalid={endIssue ? "true" : "false"}
                      onChange={(event) => updatePeriod(index, "endDate", event.target.value || null)} />
                    {endIssue && <small className="field-error">{issueText(endIssue.code)}</small>}
                  </label>
                </div>
                <button className="button button-quiet button-small" type="button" aria-label={`ลบช่วงพำนัก ${index + 1}`}
                  onClick={() => onChange(periodList.filter((_, periodIndex) => periodIndex !== index).map((item) => ({ ...item })))}>
                  ลบช่วงนี้
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!hasPeriodData && legacyGroups.size > 0 && (
        <div className="residence-year-summary" aria-label="จำนวนวันพำนักเดิมแยกตามปี">
          <h3>จำนวนวันพำนักที่บันทึกไว้ในร่างเดิม</h3>
          {[...legacyGroups.entries()].sort(([left], [right]) => left - right).map(([year, counts]) => {
            const uniqueCounts = [...counts];
            const days = uniqueCounts.length === 1 ? uniqueCounts[0] : undefined;
            const summary = days === undefined
              ? "ข้อมูลเดิมของปีนี้ไม่ตรงกันระหว่างแหล่งเงินได้ กรุณาระบุช่วงวันที่เพื่อคำนวณยอดเดียวกัน"
              : days === null
                ? "ยังไม่ได้ระบุจำนวนวัน"
                : `${days} วัน · ${days >= 180 ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41"}`;
            return <p key={year}><strong>ปี พ.ศ. {year + 543} <span className="muted-inline">(ค.ศ. {year})</span></strong>{" · "}{summary}</p>;
          })}
        </div>
      )}

      {hasPeriodData && years.length > 0 && (
        <div className="residence-year-summary" aria-label="สรุปวันพำนักตามปีที่เกิดเงินได้">
          <h3>สรุปวันพำนักตามปีที่เกี่ยวข้อง</h3>
          {years.map((year) => {
            const invalid = issues.length > 0;
            const days = invalid ? null : calculateResidenceDaysInYear(periodList, year);
            return <p key={year}><strong>ปี พ.ศ. {year + 543} <span className="muted-inline">(ค.ศ. {year})</span></strong>{" · "}
              {days === null ? "กรุณาตรวจสอบช่วงวันที่" : `${days} วัน · ${days >= 180 ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41"}`}</p>;
          })}
        </div>
      )}

      <p className="field-hint">เกณฑ์ 180 วันเป็นเรื่องจำนวนวันพำนักในประเทศตามมาตรา 41 แยกจากการรองรับของตัวอย่าง สิทธิ FTC และสิทธิตาม DTA รายละเอียดการนับวันจากหลักฐานเข้าออกยังขึ้นกับข้อเท็จจริงของแต่ละกรณี</p>
    </section>
  );
}

function thaiYear(year: number): string {
  return `ปี พ.ศ. ${year + 543} (ค.ศ. ${year})`;
}

function recordFor(records: readonly ResidenceYearDraft[], year: number): ResidenceYearDraft | undefined {
  return records.find((record) => record.earnedTaxYear === year);
}

function ResidenceYearSection({ records, sources, onChange }: {
  records: readonly ResidenceYearDraft[];
  sources: ResidenceSectionProps["sources"];
  onChange: NonNullable<ResidenceSectionProps["onResidenceYearsChange"]>;
}) {
  const [newYear, setNewYear] = useState("");
  const [pendingRemovalYear, setPendingRemovalYear] = useState<number | null>(null);
  const sourceYears = sources.flatMap(({ earnedTaxYear }) => earnedTaxYear === null ? [] : [earnedTaxYear]);
  const years = [...new Set([...records.map(({ earnedTaxYear }) => earnedTaxYear), ...sourceYears])].sort((left, right) => left - right);
  const addYear = (year: number) => {
    if (!Number.isInteger(year) || year < 1900 || year > 2200 || recordFor(records, year)) return;
    onChange([...records.map((record) => structuredClone(record)), { earnedTaxYear: year, mode: "periods", periods: [] }]);
    setNewYear("");
  };
  const updateYear = (year: number, update: (record: ResidenceYearDraft) => ResidenceYearDraft) => {
    onChange(records.map((record) => record.earnedTaxYear === year ? update(structuredClone(record)) : structuredClone(record)));
  };
  const updatePeriod = (year: number, index: number, field: keyof ResidencePeriodDraft, value: string | null) => {
    updateYear(year, (record) => record.mode !== "periods" ? record : {
      ...record,
      periods: record.periods.map((period, periodIndex) => periodIndex === index ? { ...period, [field]: value } : { ...period }),
    });
  };
  const removeYear = (year: number) => {
    onChange(records.filter((item) => item.earnedTaxYear !== year).map((item) => structuredClone(item)));
    setPendingRemovalYear(null);
  };
  const requestYearRemoval = (year: number, record: ResidenceYearDraft | undefined) => {
    if (record?.mode === "declared" || (record?.mode === "periods" && record.periods.length > 0)) {
      setPendingRemovalYear(year);
    } else {
      removeYear(year);
    }
  };

  return <section className="card residence-period-section" aria-labelledby="residence-period-heading">
    <div className="section-heading"><div><h2 id="residence-period-heading">ข้อมูลวันพำนักตามปีที่เกิดเงินได้</h2></div></div>
    <p className="field-hint">เลือกข้อมูลแยกตามปีที่เกิดเงินได้ ไม่อนุมานจากปีภาษีหรือวันที่ยื่นแบบ ป้อนวันแรกและวันสุดท้ายที่อยู่ในประเทศไทยของแต่ละช่วง โดยนับวันต้นและวันปลายรวมกัน และนับวันปฏิทินที่ซ้ำกันครั้งเดียว</p>
    <div className="field-grid residence-year-add">
      <label className="field field-narrow" htmlFor="residence-year-add-input"><span>ปีที่เกิดเงินได้ (ค.ศ.)</span>
        <input id="residence-year-add-input" type="number" min="1900" max="2200" step="1" value={newYear} onChange={(event) => setNewYear(event.target.value)} />
        <small className="field-hint">ปีนี้ใช้จัดกลุ่มข้อมูลวันพำนักให้ตรงกับปีจากวันที่เกิดเงินได้ในขั้นถัดไป แยกจากปีนำเงินเข้าไทย</small>
      </label>
      <div className="field-action"><button className="button button-secondary button-small" type="button" disabled={!Number.isInteger(Number(newYear)) || newYear === "" || Number(newYear) < 1900 || Number(newYear) > 2200 || recordFor(records, Number(newYear)) !== undefined} onClick={() => addYear(Number(newYear))}>เพิ่มปีที่เกิดเงินได้</button></div>
    </div>
    {years.length === 0 && <p className="muted-inline">ยังไม่มีข้อมูลวันพำนักตามปีที่เกิดเงินได้ ให้เพิ่มปีที่ต้องการบันทึกก่อนดำเนินการต่อ</p>}
    <div className="residence-year-record-list">
      {years.map((year) => {
        const record = recordFor(records, year);
        const assessment = assessResidenceYear(record, year);
        const issues = assessment.issues;
        return <article className="card residence-year-card" key={year} aria-label={thaiYear(year)}>
          <div className="section-heading"><h3>{thaiYear(year)}</h3>{record && <button className="button button-quiet button-small" type="button" aria-label={`ลบข้อมูลวันพำนัก ${thaiYear(year)}`} onClick={() => requestYearRemoval(year, record)}>ลบปีนี้</button>}</div>
          {pendingRemovalYear === year && <div className="alert alert-warning" role="alertdialog" aria-label="ยืนยันการลบข้อมูลวันพำนัก">
            <span>การลบจะลบข้อมูลวันและคำยืนยันทั้งหมดของปีนี้</span>
            <div className="form-actions-right"><button className="button button-secondary button-small" type="button" onClick={() => removeYear(year)}>ลบข้อมูลปีนี้</button><button className="button button-quiet button-small" type="button" onClick={() => setPendingRemovalYear(null)}>ยกเลิก</button></div>
          </div>}
          {!record ? <div className="stack-form"><p className="muted-inline">ปีที่เกิดเงินได้นี้ยังไม่มีข้อมูลวันพำนัก</p><button id={`residence-year-${year}-add`} className="button button-secondary button-small" type="button" onClick={() => addYear(year)}>เพิ่มข้อมูลปีนี้</button></div> : <>
            <label className="field field-narrow"><span>รูปแบบข้อมูลวันพำนัก</span>
              <select id={`residence-year-${year}-mode`} value={record.mode} onChange={(event) => updateYear(year, (current) => event.target.value === "declared"
                ? { earnedTaxYear: year, mode: "declared", declaration: "at_least_180_days" }
                : current.mode === "periods" ? current : { earnedTaxYear: year, mode: "periods", periods: [] })}>
                <option value="periods">ระบุช่วงวันที่อยู่ในประเทศไทย</option>
                <option value="declared" disabled={record.mode === "periods" && record.periods.length > 0}>ยืนยันว่าพำนักอย่างน้อย 180 วัน</option>
              </select>
            </label>
            {record.mode === "periods" ? <>
              {record.periods.map((period, index) => {
                const startIssue = issues.find((issue) => issue.periodIndex === index && issue.field === "startDate");
                const endIssue = issues.find((issue) => issue.periodIndex === index && issue.field === "endDate");
                return <div className="field-span residence-period-row" key={`residence-${year}-${index}`}>
                  <div className="field-grid">
                    <label className="field"><span>วันแรกที่พำนัก · ช่วงที่ {index + 1}</span><input id={`residence-year-${year}-period-${index}-startDate`} type="date" value={period.startDate ?? ""} aria-invalid={startIssue ? "true" : "false"} onChange={(event) => updatePeriod(year, index, "startDate", event.target.value || null)} />{startIssue && <small className="field-error">{issueText(startIssue.code)}</small>}</label>
                    <label className="field"><span>วันสุดท้ายที่พำนัก · ช่วงที่ {index + 1}</span><input id={`residence-year-${year}-period-${index}-endDate`} type="date" value={period.endDate ?? ""} aria-invalid={endIssue ? "true" : "false"} onChange={(event) => updatePeriod(year, index, "endDate", event.target.value || null)} />{endIssue && <small className="field-error">{issueText(endIssue.code)}</small>}</label>
                  </div>
                  <button className="button button-quiet button-small" type="button" aria-label={`ลบช่วงพำนัก ${index + 1} ของ${thaiYear(year)}`} onClick={() => updateYear(year, (current) => current.mode !== "periods" ? current : { ...current, periods: current.periods.filter((_, periodIndex) => periodIndex !== index).map((item) => ({ ...item })) })}>ลบช่วงนี้</button>
                </div>;
              })}
              <button id={`residence-year-${year}-add`} className="button button-secondary button-small" type="button" aria-label={`เพิ่มช่วงวันที่พำนัก ${thaiYear(year)}`} onClick={() => updateYear(year, (current) => current.mode !== "periods" ? current : { ...current, periods: [...current.periods.map((period) => ({ ...period })), { startDate: null, endDate: null }] })}>เพิ่มช่วงวันที่</button>
              <div className="residence-year-summary" role="status" aria-label={`สรุปวันพำนัก ${thaiYear(year)}`}>
                {assessment.status === "invalid" ? <p>กรุณากรอกและตรวจสอบช่วงวันที่ให้ครบก่อนคำนวณ</p>
                  : assessment.days === null ? <p>เพิ่มช่วงวันที่เพื่อคำนวณยอด หรือเปลี่ยนรูปแบบเมื่อไม่มีวันที่บันทึกไว้</p>
                    : <p><strong>{assessment.days} วัน</strong> · {assessment.meets180Days ? "ครบเกณฑ์ 180 วันตามมาตรา 41" : "ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41; แก้ไขหรือล้างช่วงวันที่ก่อนเปลี่ยนรูปแบบ"}</p>}
              </div>
            </> : <div className="residence-year-summary" role="status" aria-label={`สถานะคำยืนยันวันพำนัก ${thaiYear(year)}`}>
              <p><strong>ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน</strong> · ยังไม่ผ่านการตรวจสอบ · ไม่มีการระบุจำนวนวันแน่นอน</p>
              <p>คำยืนยันนี้เป็นข้อมูลที่ผู้ใช้ระบุ ไม่ใช่การตรวจสอบสิทธิ FTC หรือสิทธิตาม DTA</p>
            </div>}
          </>}
        </article>;
      })}
    </div>
    <p className="field-hint">เกณฑ์ 180 วันเป็นจำนวนวันพำนักในประเทศไทยตามมาตรา 41 แยกจากปีภาษี วันยื่นแบบ การรองรับของตัวอย่าง และสิทธิ FTC หรือ DTA รายละเอียดการนับวันจากหลักฐานเข้าออกขึ้นกับข้อเท็จจริงแต่ละกรณี</p>
  </section>;
}

export function ResidenceSection(props: ResidenceSectionProps) {
  if (props.residenceYears === undefined) return <LegacyResidenceSection {...props} />;
  if (!props.onResidenceYearsChange) throw new Error("Residence-year input requires an onChange handler.");
  return <ResidenceYearSection records={props.residenceYears} sources={props.sources} onChange={props.onResidenceYearsChange} />;
}
