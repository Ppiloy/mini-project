import type { FtcCaseDraft, ResidencePeriodDraft, ResidenceYearDraft } from "./contracts.js";

export type ResidencePeriodIssueCode = "required" | "invalid_date" | "reversed";

export interface ResidencePeriodIssue {
  periodIndex: number;
  field: "startDate" | "endDate";
  code: ResidencePeriodIssueCode;
}

export type ResidenceYearStatus = "missing" | "invalid" | "computed" | "declared";

export interface ResidenceYearAssessment {
  status: ResidenceYearStatus;
  days: number | null;
  meets180Days: boolean | null;
  issues: ResidencePeriodIssue[];
}

export interface ResidenceYearPeriodIssue extends ResidencePeriodIssue {
  yearIndex: number;
  earnedTaxYear: number;
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year! < 1 || year! > 9999 || month! < 1 || month! > 12 || day! < 1 || day! > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / millisecondsPerDay);
}

export function validateResidencePeriods(periods: readonly ResidencePeriodDraft[]): ResidencePeriodIssue[] {
  const issues: ResidencePeriodIssue[] = [];
  periods.forEach((period, periodIndex) => {
    const start = period.startDate === null ? null : dayNumber(period.startDate);
    const end = period.endDate === null ? null : dayNumber(period.endDate);
    if (period.startDate === null) issues.push({ periodIndex, field: "startDate", code: "required" });
    else if (start === null) issues.push({ periodIndex, field: "startDate", code: "invalid_date" });
    if (period.endDate === null) issues.push({ periodIndex, field: "endDate", code: "required" });
    else if (end === null) issues.push({ periodIndex, field: "endDate", code: "invalid_date" });
    if (start !== null && end !== null && end < start) issues.push({ periodIndex, field: "endDate", code: "reversed" });
  });
  return issues;
}

/** Counts the union of inclusive physical-presence dates clipped to one earned-income year. */
export function calculateResidenceDaysInYear(periods: readonly ResidencePeriodDraft[], year: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError("Residence year must be a whole calendar year.");
  if (validateResidencePeriods(periods).length > 0) {
    throw new RangeError("Residence periods must have valid, complete dates in chronological order.");
  }

  const yearStart = dayNumber(`${String(year).padStart(4, "0")}-01-01`)!;
  const yearEnd = dayNumber(`${String(year).padStart(4, "0")}-12-31`)!;
  const intervals = periods.flatMap((period) => {
    const start = Math.max(dayNumber(period.startDate!)!, yearStart);
    const end = Math.min(dayNumber(period.endDate!)!, yearEnd);
    return start <= end ? [{ start, end }] : [];
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  let days = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of intervals) {
    if (current === null) {
      current = { ...interval };
    } else if (interval.start <= current.end + 1) {
      current.end = Math.max(current.end, interval.end);
    } else {
      days += current.end - current.start + 1;
      current = { ...interval };
    }
  }
  if (current !== null) days += current.end - current.start + 1;
  return days;
}

/** Keeps declaration-only facts explicitly unverified and does not assign them an exact count. */
export function assessResidenceYear(record: ResidenceYearDraft | undefined, year: number): ResidenceYearAssessment {
  if (!record) return { status: "missing", days: null, meets180Days: null, issues: [] };
  if (record.mode === "declared") return { status: "declared", days: null, meets180Days: true, issues: [] };
  if (record.periods.length === 0) {
    return { status: "invalid", days: null, meets180Days: null, issues: [{ periodIndex: 0, field: "startDate", code: "required" }] };
  }
  const issues = validateResidencePeriods(record.periods);
  if (issues.length > 0) return { status: "invalid", days: null, meets180Days: null, issues };
  const days = calculateResidenceDaysInYear(record.periods, year);
  return { status: "computed", days, meets180Days: days >= 180, issues: [] };
}

export function validateResidenceYearPeriods(records: readonly ResidenceYearDraft[]): ResidenceYearPeriodIssue[] {
  return records.flatMap((record, yearIndex) => record.mode === "periods"
    ? (record.periods.length === 0 ? [{ periodIndex: 0, field: "startDate" as const, code: "required" as const }] : validateResidencePeriods(record.periods))
      .map((issue) => ({ ...issue, yearIndex, earnedTaxYear: record.earnedTaxYear }))
    : []);
}

/** Derives each source's days from its earned year whenever periods are explicitly supplied. */
export function deriveResidenceDaysForDraft(draft: FtcCaseDraft): FtcCaseDraft {
  if (draft.residenceYears !== undefined) {
    const recordsByYear = new Map(draft.residenceYears.map((record) => [record.earnedTaxYear, record]));
    return {
      ...draft,
      sources: draft.sources.map((source) => {
        if (source.earnedTaxYear === null) return { ...source, residenceDaysInEarnedYear: null };
        const assessment = assessResidenceYear(recordsByYear.get(source.earnedTaxYear), source.earnedTaxYear);
        return { ...source, residenceDaysInEarnedYear: assessment.status === "computed" ? assessment.days : null };
      }),
    };
  }
  if (draft.residencePeriods === undefined) return draft;
  const periods = draft.residencePeriods;
  const hasInvalidPeriods = validateResidencePeriods(periods).length > 0;
  return {
    ...draft,
    sources: draft.sources.map((source) => ({
      ...source,
      residenceDaysInEarnedYear: hasInvalidPeriods || source.earnedTaxYear === null
        ? null
        : calculateResidenceDaysInYear(periods, source.earnedTaxYear),
    })),
  };
}
