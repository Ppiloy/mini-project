import Decimal from "decimal.js";
import type { CalculationSnapshot, CountryCalculationResult } from "../../../shared/contracts.js";
import { countryLabel } from "../../../shared/labels.js";
import { formatMoney } from "../../components/money.js";

function limitingExplanation(country: CountryCalculationResult): string {
  try {
    const comparison = new Decimal(country.attributableForeignTax).comparedTo(country.thaiTaxLimit);
    if (comparison === null) return "ยังระบุจำนวนที่จำกัดเครดิตจากค่าที่บันทึกไว้ไม่ได้";
    if (comparison < 0) return "เครดิต (Q) ถูกจำกัดด้วยภาษีต่างประเทศที่จัดสรร (O)";
    if (comparison > 0) return "เครดิต (Q) ถูกจำกัดด้วยเพดานภาษีไทย (P)";
    return "ภาษีต่างประเทศที่จัดสรร (O) และเพดานภาษีไทย (P) เท่ากัน จึงได้เครดิต (Q) เท่ากับจำนวนดังกล่าว";
  } catch {
    return "ยังระบุจำนวนที่จำกัดเครดิตจากค่าที่บันทึกไว้ไม่ได้";
  }
}

function hasDisplayRoundingAdjustment(value: string | null): value is string {
  try {
    return value !== null && !new Decimal(value).isZero();
  } catch {
    return false;
  }
}

export function ResultSummary({ snapshot }: { snapshot: CalculationSnapshot }) {
  const result = snapshot.result;
  if (result.outcome !== "ready" || result.allowableCredit === null) return null;
  const roundingAdjustment = hasDisplayRoundingAdjustment(result.displayRoundingReconciliation)
    ? result.displayRoundingReconciliation : null;

  return <section className="result-credit-summary card" aria-label="สรุปเครดิตภาษี">
    <div className="result-credit-summary-head">
      <div>
        <h2>เครดิตภาษีที่ใช้ได้รวม</h2>
        <p>ตามผลคำนวณที่บันทึกไว้</p>
      </div>
      <strong className="result-credit-total">{formatMoney(result.allowableCredit)} บาท</strong>
    </div>
    {roundingAdjustment !== null && <p className="result-rounding-note" role="note">
      <span>เครดิตรายประเทศที่แสดงอาจรวมกันต่างจากเครดิตรวมที่แสดง เพราะระบบรวมเครดิตจากผลคำนวณก่อนปัดเศษ แล้วจึงปัดยอดรวมเพื่อแสดง</span>
      <strong>ยอดปรับการแสดงผล: {formatMoney(roundingAdjustment)} บาท</strong>
      <span>ส่วนต่างนี้ไม่ได้กระจายกลับไปยังเครดิตรายประเทศ</span>
    </p>}
    {result.countries.length > 0
      ? <div className="result-country-summary-list">{result.countries.map((country) => {
        const name = countryLabel(country.countryCode, "ประเทศอื่นหรือยังไม่ระบุ", country.countryName);
        return <article className="result-country-summary" key={country.countryCode}>
          <h3>{name}</h3>
          <dl className="result-country-values">
            <div><dt>ภาษีต่างประเทศที่จัดสรร (O)</dt><dd>{formatMoney(country.attributableForeignTax)} บาท</dd></div>
            <div><dt>เพดานภาษีไทย (P)</dt><dd>{formatMoney(country.thaiTaxLimit)} บาท</dd></div>
            <div><dt>เครดิตภาษีที่ใช้ได้ (Q)</dt><dd>{formatMoney(country.displayedAllowableCredit)} บาท</dd></div>
          </dl>
          <p className="result-country-limiting">{limitingExplanation(country)}</p>
        </article>;
      })}</div>
      : <p className="result-summary-empty">ผลนี้ไม่มีรายการเครดิตภาษีแยกตามประเทศ</p>}
  </section>;
}
