import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CalculationSnapshot } from "../../../shared/contracts.js";
import { formatDate, formatMoney } from "../../components/money.js";
import { hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoCases } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";

type Mode = "demo" | "hosted";

export function ReportPage({ mode }: { mode: Mode }) {
  const { snapshotId = "" } = useParams();
  const { user } = useAppSession();
  const [snapshot, setSnapshot] = useState<CalculationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (mode === "demo") {
          const local = findDemoSnapshot(snapshotId);
          if (!local) throw new Error("ไม่พบรายงานในข้อมูลสาธิตนี้");
          const accessible = user?.role === "officer"
            ? listDemoCases("officer").some((record) => record.id === local.caseId)
            : Boolean(findDemoCase(local.caseId, "taxpayer"));
          if (!accessible) throw new Error("ไม่มีสิทธิ์เปิดรายงานกรณีนี้ในโหมดสาธิต");
          if (active) setSnapshot(local);
        } else {
          const response = await hostedApi.snapshot(snapshotId);
          if (active) setSnapshot(response.snapshot);
        }
      } catch (error) { if (active) setProblem(error instanceof Error ? error.message : "เปิดรายงานไม่สำเร็จ"); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [mode, snapshotId, user?.role]);

  if (loading) return <div className="loading-card" role="status">กำลังสร้างรายงานจากข้อมูลที่บันทึก…</div>;
  if (!snapshot) return <section className="card"><h1>เปิดรายงานไม่ได้</h1><div className="alert alert-error" role="alert">{problem ?? "ไม่พบรายงาน"}</div><a className="button button-secondary" href={mode === "demo" ? (user?.role === "officer" ? "/demo/officer" : "/demo/app") : (user?.role === "officer" ? "/officer" : "/app")}>กลับหน้าหลัก</a></section>;

  const draftReport = snapshot.kind === "preview";
  const lines = snapshot.result.lines;
  return <>
    <div className="report-toolbar no-print"><a className="button button-quiet" href={mode === "demo" ? (user?.role === "officer" ? "/demo/officer" : "/demo/app") : (user?.role === "officer" ? "/officer" : "/app")}>← กลับ</a><button className="button button-primary" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button></div>
    <article className="print-report">
      <header className="report-header"><div><p className="report-kicker">FOREIGN TAX CREDIT · EDUCATIONAL PROTOTYPE</p><h1>รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ</h1><p>ระบบต้นแบบเพื่อการศึกษา · ไม่ใช่แบบยื่นภาษีหรือการยืนยันสิทธิ</p></div><div className="report-mark" aria-hidden="true">FTC</div></header>
      {draftReport && <div className="draft-watermark">ร่าง — ยังไม่ได้ส่ง</div>}
      {!draftReport && <div className="submitted-report-label">รายงานจาก snapshot ที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว</div>}
      <div className="report-meta"><div><span>เลขอ้างอิงตัวอย่าง</span><strong>{snapshot.caseId.slice(-8).toUpperCase()}</strong></div><div><span>ปีภาษี</span><strong>{snapshot.inputs.taxYear ? snapshot.inputs.taxYear + 543 : "—"} ({snapshot.inputs.taxYear ?? "—"})</strong></div><div><span>รุ่นข้อมูล</span><strong>{snapshot.revision}</strong></div><div><span>บันทึกเมื่อ</span><strong>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt))}</strong></div></div>
      <section className="report-section"><h2>สรุปผล</h2><div className="report-total"><div><span>เครดิตภาษีต่างประเทศที่ใช้ได้ตามสมมติฐาน</span><small>สถานะ: {snapshot.result.outcome === "ready" ? "คำนวณได้" : snapshot.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบ" : "ต้องตรวจสอบ / อยู่นอกขอบเขต"}</small></div><strong>{formatMoney(snapshot.result.allowableCredit)} <small>บาท</small></strong></div><div className="report-summary-grid"><div><span>I · เงินได้ต่างประเทศที่นำเข้า</span><strong>{formatMoney(snapshot.result.totalRemittedIncome)} บาท</strong></div><div><span>K · เงินได้พึงประเมินรวม</span><strong>{formatMoney(snapshot.result.totalAssessableIncome)} บาท</strong></div><div><span>J · เงินได้พึงประเมินในประเทศ</span><strong>{formatMoney(snapshot.inputs.domesticAssessableIncome)} บาท</strong></div><div><span>L · ภาษีไทยก่อน FTC</span><strong>{formatMoney(snapshot.inputs.thaiTax.amountBeforeFtc)} บาท</strong></div></div><p className="report-provenance">ที่มาของ L: {snapshot.inputs.thaiTax.provenance ?? "ไม่ได้ระบุ"}</p></section>
      {snapshot.result.validationMessages.length > 0 && <section className="report-section"><h2>ข้อมูลที่ขาดหรืออยู่นอกขอบเขต</h2><ul className="report-list">{snapshot.result.validationMessages.map((message, index) => <li key={index}>{message.message}{message.path?.length ? <small>ช่อง: {message.path.join(" › ")}</small> : null}</li>)}</ul></section>}
      <section className="report-section"><h2>รายละเอียดแหล่งเงินได้</h2>{snapshot.inputs.sources.length === 0 && <p>ยังไม่มีแหล่งเงินได้</p>}{snapshot.inputs.sources.map((source, index) => <article className="report-source" key={source.id ?? index}>
        <div className="report-source-heading"><h3>{index + 1}. {source.countryName ?? "ไม่ระบุประเทศ"} · {source.incomeType ?? "ไม่ระบุประเภท"} {source.subtype ? `(${source.subtype})` : ""}</h3><span>{source.inputMode === "original_currency" ? "สกุลเงินต้นทาง" : "Worksheet THB"}</span></div>
        <div className="report-source-grid"><div><span>D · เงินได้ต้นทาง</span><strong>{formatMoney(source.grossIncomeAmount)} {source.currencyCode ?? ""}</strong></div><div><span>ภาษีที่จ่ายจริง</span><strong>{formatMoney(source.actualForeignTaxPaid)} {source.currencyCode ?? ""}</strong></div><div><span>E · ภาษีที่สมมติว่าเข้าเกณฑ์</span><strong>{formatMoney(source.eligibleForeignTax)} {source.currencyCode ?? ""}</strong></div><div><span>F · ส่วนเงินได้ที่นำเข้าไทย</span><strong>{formatMoney(source.remittedIncomeAmount)} {source.currencyCode ?? ""}</strong></div><div><span>วันพำนักในปีที่เกิดเงินได้</span><strong>{source.residenceDaysInEarnedYear ?? "—"} วัน</strong></div><div><span>วันที่เกิด / วันที่นำเข้า</span><strong>{formatDate(source.earnedDate)} / {formatDate(source.remittance?.remittanceDate)}</strong></div></div>
        <p>สมมติฐานและเหตุผลของ E: {source.eligibilityRationale ?? "ไม่ได้ระบุ"}</p>
        <p>FX: {source.fxReference ? `${source.fxReference.thbRate ?? "—"} THB ต่อ ${source.fxReference.baseUnits ?? "—"} ${source.fxReference.currencyCode ?? ""} · ${source.fxReference.rateType ?? "—"} · ${source.fxReference.sourceLabel ?? "ไม่ได้ระบุแหล่ง"} · ${formatDate(source.fxReference.effectiveDate)}` : "จำนวนเงินต้นทางเป็น THB ตามตารางตัวอย่าง ไม่มีการแปลง FX เพิ่ม"}</p>
        <div className="report-converted"><span>D/E/F หลังแปลงเป็น THB:</span><strong>{formatMoney(source.grossIncomeThb)} / {formatMoney(source.eligibleForeignTaxThb)} / {formatMoney(source.remittedIncomeThb)} บาท</strong></div>
      </article>)}</section>
      <section className="report-section"><h2>ขั้นคำนวณและสรุปตามประเทศ</h2><div className="report-table-wrap"><table className="report-table"><thead><tr><th>ประเทศ</th><th>N · เงินได้นำเข้า</th><th>O · ภาษีจัดสรร</th><th>P · เพดาน</th><th>Q · เครดิตที่ใช้ได้</th></tr></thead><tbody>{snapshot.result.countries.map((country) => <tr key={country.countryCode}><th>{country.countryName}</th><td>{formatMoney(country.remittedIncome)}</td><td>{formatMoney(country.attributableForeignTax)}</td><td>{formatMoney(country.thaiTaxLimit)}</td><td>{formatMoney(country.displayedAllowableCredit)}</td></tr>)}{snapshot.result.countries.length === 0 && <tr><td colSpan={5}>ยังไม่มีผลลัพธ์รายประเทศ</td></tr>}</tbody></table></div><div className="report-lines">{lines.map((line) => <div className="report-line" key={line.code}><span><strong>{line.label}</strong><small>{line.explanation}</small></span><b>{line.value === null ? "—" : formatMoney(line.value)}</b></div>)}</div><p>การปัดเศษ: {snapshot.result.roundingPolicy}</p>{snapshot.result.displayRoundingReconciliation && snapshot.result.displayRoundingReconciliation !== "0" && <p>ผลปรับการปัดเศษของตาราง: {formatMoney(snapshot.result.displayRoundingReconciliation)} บาท</p>}</section>
      <section className="report-section"><h2>สมมติฐานและแหล่งอ้างอิง</h2><ul className="report-list">{snapshot.policy.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul><p>รหัสนโยบาย: {snapshot.policy.id} · รุ่นเครื่องคำนวณ: {snapshot.result.engineVersion} · วันที่ทบทวนนโยบาย: {formatDate(snapshot.policy.reviewedAt)}</p><ul className="report-list">{snapshot.policy.sourceUrls.map((url) => <li key={url}><a href={url}>{url}</a></li>)}</ul><div className="source-discrepancy"><strong>หมายเหตุความคลาดเคลื่อนของสไลด์ตัวอย่างต้นทาง</strong><p>สไลด์แสดงยอด 143,554.30 บาท ขณะที่คำนวณตามสูตรและตัวเลขที่แสดงได้ 143,544.30 บาท ต่างกัน 10.00 บาท รายงานนี้ไม่ปรับยอดกรณีปัจจุบันตามยอดในสไลด์</p></div></section>
      <footer className="report-footer"><span>ระบบต้นแบบเพื่อการศึกษา · ข้อมูลสมมติสำหรับปีภาษี 2568</span><span>รายงานนี้ไม่ใช่เอกสารรับรองหรือผลการประเมินภาษี</span></footer>
    </article>
  </>;
}
