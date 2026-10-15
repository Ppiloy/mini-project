import Decimal from "decimal.js";

/** Group a decimal string without converting it to IEEE-754 Number. */
export function formatMoney(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return normalized;
  const formatted = new Decimal(normalized).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits);
  const negative = formatted.startsWith("-");
  const unsigned = negative ? formatted.slice(1) : formatted;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${digits === 0 ? grouped : `${grouped}.${fractionPart}`}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(date);
}
