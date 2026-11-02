import type { ResidencePeriodDraft } from "../../../shared/contracts.js";
import { calculateResidenceDaysInYear, validateResidencePeriods } from "../../../shared/residence.js";

export interface ResidenceSectionProps {
  /** Undefined marks a legacy draft that only stored per-source day totals. */
  periods?: readonly ResidencePeriodDraft[];
  sources: readonly { earnedTaxYear: number | null; residenceDaysInEarnedYear: number | null }[];
  calculationTaxYear?: number | null;
  relevantYears?: readonly number[];
  onChange: (periods: ResidencePeriodDraft[]) => void;
}

function issueText(code: ReturnType<typeof validateResidencePeriods>[number]["code"]): string {
  if (code === "required") return "กรุณาระบุวันที่นี้";
  if (code === "reversed") return "วันสิ้นสุดต้องไม่มาก่อนวันเริ่มต้น";
  return "กรุณาระบุวันที่จริง";
}

export function ResidenceSection({ periods, sources, calculationTaxYear = null, relevantYears = [], onChange }: ResidenceSectionProps) {
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
