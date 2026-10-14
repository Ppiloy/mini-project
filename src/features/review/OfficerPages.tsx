import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { formatDate, formatMoney } from "../../components/money.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { apiFailureMessage, hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoAttachments, listDemoCases } from "../../data/demoRepository.js";

type Mode = "demo" | "hosted";

export function OfficerQueuePage({ mode }: { mode: Mode }) {
  const [records, setRecords] = useState<FtcCaseRecord[]>([]);
  const [year, setYear] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const load = async () => {
    setBusy(true);
    setProblem(null);
    try { setRecords(mode === "demo" ? listDemoCases("officer") : (await hostedApi.listOfficerCases()).cases); }
    catch (error) { setProblem(apiFailureMessage(error, "โหลดคิวไม่สำเร็จ")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [mode]);
  const filtered = useMemo(() => records.filter((record) => {
    const ref = record.id.slice(-8).toLowerCase();
    return (!year || String((record.draft.taxYear ?? 0) + 543) === year) && (!reference || ref.includes(reference.trim().toLowerCase()));
  }), [records, year, reference]);
  return <>
    <PageHeading eyebrow="REVIEWER WORKLIST" title="คิวกรณีที่ส่งเข้าตรวจสอบ">
      แสดงเฉพาะกรณีที่ได้รับมอบหมายและส่งแล้ว เจ้าหน้าที่ดูข้อมูลได้แบบอ่านอย่างเดียว
    </PageHeading>
    {mode === "demo" && <div className="alert alert-info"><strong>คิวเจ้าหน้าที่จำลอง</strong><span>ข้อมูลนี้เป็นกรณีสมมติที่ส่งจากโหมดสาธิตในเบราว์เซอร์นี้เท่านั้น</span></div>}
    {problem && <div className="alert alert-error" role="alert">{problem}{mode === "hosted" && problem.includes("เซสชัน") && <a href="/officer/login">เข้าสู่ระบบเจ้าหน้าที่อีกครั้ง</a>}</div>}
    <section className="filter-panel card">
      <label className="field"><span>ปีภาษี</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">ทุกปี</option><option value="2568">2568 (2025)</option></select></label>
      <label className="field"><span>เลขอ้างอิงตัวอย่าง</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="ค้นหาท้ายเลขอ้างอิง" /></label>
      <button className="button button-secondary" onClick={() => void load()}>รีเฟรชคิว</button>
    </section>
    <section className="content-section">
      <div className="section-heading"><div><p className="eyebrow">ASSIGNED CASES</p><h2>รายการที่ได้รับมอบหมาย</h2></div><span className="queue-count">{filtered.length} กรณี</span></div>
      {busy ? <div className="loading-card" role="status">กำลังโหลดคิว…</div> : filtered.length === 0 ? <div className="empty-state card"><div className="empty-icon" aria-hidden="true">✓</div><h3>{records.length === 0 ? "ยังไม่มีกรณีในคิว" : "ไม่พบกรณีที่ตรงกับตัวกรอง"}</h3><p>{records.length === 0 ? "เมื่อผู้เสียภาษีส่งกรณีในระบบต้นแบบ รายการจะปรากฏที่นี่" : "ลองล้างตัวกรองปีภาษีหรือเลขอ้างอิง"}</p></div> : <div className="case-list">{filtered.map((record) => <article key={record.id} className="case-card card">
        <div className="case-card-main"><div className="case-title-row"><h3>กรณีปีภาษี {record.draft.taxYear ? record.draft.taxYear + 543 : 2568}</h3><span className="status-badge status-submitted">ส่งแล้ว</span></div><p className="case-ref">เลขอ้างอิงตัวอย่าง {record.id.slice(-8).toUpperCase()}</p><p className="case-updated">ส่งเมื่อ {formatDate(record.submittedAt)} · {record.draft.sources.length} แหล่งเงินได้</p></div>
        <div className="case-card-action"><a className="button button-primary" href={`${mode === "demo" ? "/demo" : ""}/officer/cases/${encodeURIComponent(record.id)}`}>ตรวจทานแบบอ่านอย่างเดียว</a></div>
      </article>)}</div>}
    </section>
  </>;
}

export function OfficerCasePage({ mode }: { mode: Mode }) {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<FtcCaseRecord | null>(null);
  const [snapshot, setSnapshot] = useState<CalculationSnapshot | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [audit, setAudit] = useState<Array<{ event: string; actor: string; occurredAt: string }>>([]);
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setBusy(true); setProblem(null);
      try {
        if (mode === "demo") {
          const loaded = findDemoCase(id, "officer");
          if (!loaded || !loaded.submittedSnapshotId) throw new Error("ไม่พบกรณีที่ส่งแล้วและได้รับมอบหมายในคิวจำลอง");
          const frozen = findDemoSnapshot(loaded.submittedSnapshotId);
          if (!frozen) throw new Error("ไม่พบผลคำนวณที่บันทึกไว้");
          if (active) { setRecord(loaded); setSnapshot(frozen); setAttachments(listDemoAttachments(id)); setAudit([{ event: "เปิดดูกรณี", actor: "เจ้าหน้าที่ตัวอย่าง", occurredAt: new Date().toISOString() }]); }
        } else {
          const response = await hostedApi.getOfficerCase(id);
          if (response.case.status !== "submitted" || !response.case.submittedSnapshotId) throw new Error("กรณีนี้ไม่อยู่ในคิวที่เจ้าหน้าที่ได้รับมอบหมาย");
          if (active) { setRecord(response.case); setSnapshot(response.snapshot); setAttachments(response.attachments); setAudit(response.auditEvents); }
        }
      } catch (error) { if (active) setProblem(apiFailureMessage(error, "เปิดกรณีไม่สำเร็จ")); }
      finally { if (active) setBusy(false); }
    };
    void load();
    return () => { active = false; };
  }, [id, mode]);

  if (busy) return <div className="loading-card" role="status">กำลังโหลดกรณีที่ได้รับมอบหมาย…</div>;
  if (problem || !record || !snapshot) return <section className="card"><h1>เปิดกรณีไม่ได้</h1><div className="alert alert-error" role="alert">{problem ?? "ไม่พบข้อมูล"}</div><a className="button button-secondary" href={mode === "demo" ? "/demo/officer" : "/officer"}>กลับคิวเจ้าหน้าที่</a></section>;
  const result = snapshot.result;
  const root = mode === "demo" ? "/demo" : "";
  const downloadFixtureNote = (file: AttachmentMetadata) => {
    const blob = new Blob([`รายการไฟล์จำลองในระบบต้นแบบ\nชื่อไฟล์: ${file.displayName}\nชนิด: ${file.mediaType}\nระบบไม่ได้เก็บ bytes ของไฟล์จริงในโหมดสาธิต.`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file.displayName}.demo.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <>
    <PageHeading eyebrow={`ASSIGNED CASE · ${id.slice(-8).toUpperCase()}`} title="ตรวจทานกรณีที่ส่งแล้ว">
      ข้อมูลและผลคำนวณเป็น snapshot ที่ส่งมา เจ้าหน้าที่เปิดดูได้โดยไม่แก้ไขตัวเลขต้นฉบับ
    </PageHeading>
    {mode === "demo" && <div className="alert alert-info">ข้อมูลจำลอง · การเปิดหน้านี้แสดงเหตุการณ์เข้าถึงใน audit trail จำลอง</div>}
    <div className="submitted-banner"><div><span className="status-badge status-submitted">ส่งแล้ว · อ่านอย่างเดียว</span><p>ส่งเมื่อ {formatDate(record.submittedAt)} · เลขอ้างอิงตัวอย่าง {record.id.slice(-8).toUpperCase()}</p></div><a className="button button-secondary" href={`${root}/reports/${snapshot.id}`}>เปิดรายงานเดียวกัน</a></div>
    <section className="result-total card"><div><p className="eyebrow">FROZEN SUBMISSION SNAPSHOT</p><h2>เครดิตที่ใช้ได้ตามสมมติฐาน</h2><p>นโยบาย {result.policyVersion} · รุ่นข้อมูล {snapshot.revision}</p></div><strong className="total-amount">{formatMoney(result.allowableCredit)} <small>บาท</small></strong></section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><p className="eyebrow">COUNTRY BREAKDOWN</p><h2>ผลคำนวณแยกตามประเทศ</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>ประเทศ</th><th>เงินได้นำเข้า N</th><th>ภาษีจัดสรร O</th><th>เพดาน P</th><th>เครดิต Q</th></tr></thead><tbody>{result.countries.map((country) => <tr key={country.countryCode}><th scope="row">{country.countryName}</th><td>{formatMoney(country.remittedIncome)}</td><td>{formatMoney(country.attributableForeignTax)}</td><td>{formatMoney(country.thaiTaxLimit)}</td><td>{formatMoney(country.displayedAllowableCredit)}</td></tr>)}</tbody></table></div></section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><p className="eyebrow">ORIGINAL SUBMISSION</p><h2>ข้อมูลที่ผู้เสียภาษีส่ง</h2></div></div><div className="officer-source-list">{snapshot.inputs.sources.map((source, index) => <article className="officer-source" key={source.id ?? index}><h3>{source.countryName} · {source.incomeType} {source.subtype && `(${source.subtype})`}</h3><div className="amount-grid"><div><dt>D · เงินได้ต่างประเทศ</dt><dd>{formatMoney(source.grossIncomeAmount)} {source.currencyCode}</dd></div><div><dt>ภาษีที่ชำระจริง</dt><dd>{formatMoney(source.actualForeignTaxPaid)} {source.currencyCode}</dd></div><div><dt>E · สมมติฐานภาษีเข้าเกณฑ์</dt><dd>{formatMoney(source.eligibleForeignTax)} {source.currencyCode}</dd></div><div><dt>F · นำเข้าไทย</dt><dd>{formatMoney(source.remittedIncomeAmount)} {source.currencyCode}</dd></div><div><dt>วันพำนัก</dt><dd>{source.residenceDaysInEarnedYear ?? "—"} วัน</dd></div><div><dt>วันที่เกิดเงินได้ / นำเข้า</dt><dd>{formatDate(source.earnedDate)} / {formatDate(source.remittance?.remittanceDate)}</dd></div></div><p className="assumption-note">เหตุผลและสมมติฐาน E: {source.eligibilityRationale ?? "—"}</p>{source.fxReference && <p className="fx-provenance">FX: {source.fxReference.thbRate} THB / {source.fxReference.baseUnits} {source.fxReference.currencyCode} · {source.fxReference.sourceLabel} · {formatDate(source.fxReference.effectiveDate)}</p>}</article>)}</div><div className="thai-tax-row"><strong>J · เงินได้ในประเทศ:</strong> {formatMoney(snapshot.inputs.domesticAssessableIncome)} บาท · <strong>L · ภาษีไทยก่อน FTC:</strong> {formatMoney(snapshot.inputs.thaiTax.amountBeforeFtc)} บาท · {snapshot.inputs.thaiTax.provenance}</div></section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><p className="eyebrow">EVIDENCE</p><h2>เอกสารที่แนบมา</h2></div></div><ul className="file-list">{attachments.map((file) => <li key={file.id}><span className="file-icon" aria-hidden="true">{file.mediaType.includes("pdf") ? "PDF" : "IMG"}</span><span className="file-name"><strong>{file.displayName}</strong><small>{file.kind.replaceAll("_", " ")} · {file.mediaType} · {formatMoney(String(file.byteSize), 0)} bytes · {file.status === "ready" ? "พร้อมใช้งาน" : file.status}</small></span>{mode === "hosted" ? <a className="button button-quiet button-small" href={`/api/attachments/${encodeURIComponent(file.id)}`} download>ดาวน์โหลด</a> : <button className="button button-quiet button-small" onClick={() => downloadFixtureNote(file)}>ดาวน์โหลดรายการจำลอง</button>}</li>)}</ul>{attachments.length === 0 && <p className="empty-evidence">ไม่มีไฟล์แนบ</p>}{mode === "demo" && <p className="field-hint">ข้อมูลจำลองเก็บเฉพาะชื่อ/สถานะไฟล์ ไม่มีเนื้อหาไฟล์จริงให้ดาวน์โหลด</p>}</section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><p className="eyebrow">ACCESS HISTORY</p><h2>ประวัติการเข้าถึง</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>เหตุการณ์</th><th>ผู้ใช้</th><th>วันและเวลา</th></tr></thead><tbody>{audit.map((event, index) => <tr key={`${event.event}-${index}`}><td>{event.event}</td><td>{event.actor}</td><td>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</td></tr>)}</tbody></table></div></section>
    <div className="result-actions"><a className="button button-quiet" href={mode === "demo" ? "/demo/officer" : "/officer"}>กลับคิว</a><a className="button button-primary" href={`${root}/reports/${snapshot.id}`}>ดูรายงานที่พิมพ์ได้</a></div>
  </>;
}
