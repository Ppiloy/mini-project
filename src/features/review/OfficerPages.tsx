import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { countryLabel, displayKnownExampleNote, incomeTypeLabel } from "../../../shared/labels.js";
import { formatDate, formatMoney } from "../../components/money.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { Worksheet } from "../../components/Worksheet.js";
import { apiFailureMessage, hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoAttachments, listDemoCases } from "../../data/demoRepository.js";

type Mode = "demo" | "hosted";

const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  "เปิดดูกรณี": "เจ้าหน้าที่เปิดดูกรณี",
  preview_created: "บันทึกผลคำนวณตัวอย่าง",
  evidence_upload_reserved: "เริ่มแนบหลักฐาน",
  evidence_upload_failed: "แนบหลักฐานไม่สำเร็จ",
  evidence_uploaded: "แนบหลักฐานแล้ว",
  evidence_deleted: "ลบหลักฐานก่อนส่ง",
  case_submitted: "ส่งกรณีเข้าตรวจสอบ",
  officer_queue_accessed: "เจ้าหน้าที่เปิดคิวตรวจสอบ",
  officer_case_accessed: "เจ้าหน้าที่เปิดดูกรณี",
  officer_snapshot_accessed: "เจ้าหน้าที่เปิดดูผลที่ส่งแล้ว",
  officer_evidence_accessed: "เจ้าหน้าที่เปิดดูหลักฐาน",
};

function auditEventLabel(event: string): string {
  return AUDIT_EVENT_LABELS[event] ?? "เหตุการณ์อื่น";
}

function reviewPoints(snapshot: CalculationSnapshot): Array<{ title: string; detail: string }> {
  const points: Array<{ title: string; detail: string }> = [];
  const thaiTax = snapshot.inputs.thaiTax;
  if (thaiTax.amountBeforeFtc !== null || thaiTax.provenance) {
    points.push({
      title: "ข้อมูลภาษีไทยก่อนเครดิต (L)",
      detail: `ผู้ใช้ระบุ ${formatMoney(thaiTax.amountBeforeFtc)} บาท · ที่มา: ${displayKnownExampleNote(thaiTax.provenance) ?? "ไม่ได้ระบุ"} ตรวจเทียบจำนวนและที่มากับเอกสารประกอบ`,
    });
  }
  for (const source of snapshot.inputs.sources) {
    const sourceName = `${countryLabel(source.countryCode, "ประเทศอื่นหรือยังไม่ระบุ")} · ${incomeTypeLabel(source)}`;
    if (source.fxReference?.rateType === "manual" || source.fxReference?.sourceKind === "user_supplied") {
      points.push({
        title: `อัตราแลกเปลี่ยนที่ผู้ใช้ระบุ — ${sourceName}`,
        detail: "ตรวจสอบอัตรา วันที่ใช้ และเอกสารอ้างอิงที่ผู้ใช้ระบุ",
      });
    }
    if (source.eligibilityRationale) {
      points.push({
        title: `ข้อมูลภาษีต่างประเทศ — ${sourceName}`,
        detail: `เหตุผลที่ผู้ใช้ให้ไว้: ${displayKnownExampleNote(source.eligibilityRationale)} เปรียบเทียบจำนวนและเอกสารที่แนบกับข้อเท็จจริงของรายการนี้`,
      });
    }
  }
  return points;
}

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
  if (problem || !record || !snapshot) return <section className="card"><h1>เปิดกรณีไม่ได้</h1><div className="alert alert-error" role="alert">{problem ?? "ไม่พบข้อมูล"}</div><a className="button button-secondary" href={mode === "demo" ? "/demo/officer" : "/officer"}>กลับไปหน้ารายการ</a></section>;
  const root = mode === "demo" ? "/demo" : "";
  const points = reviewPoints(snapshot);
  return <>
    <PageHeading eyebrow="กรณีที่ได้รับมอบหมาย" title="ตรวจทานกรณีที่ส่งแล้ว">
      ข้อมูลและผลคำนวณที่ส่งมาแสดงแบบอ่านอย่างเดียว เจ้าหน้าที่เปิดดูได้โดยไม่แก้ไขตัวเลขต้นฉบับ
    </PageHeading>
    {mode === "demo" && <div className="alert alert-info">ข้อมูลจำลอง · การเปิดหน้านี้แสดงเหตุการณ์ในประวัติการเข้าถึงจำลอง</div>}
    <div className="submitted-banner"><div><span className="status-badge status-submitted">ส่งแล้ว · อ่านอย่างเดียว</span><p>ส่งเมื่อ {formatDate(record.submittedAt)}</p></div><a className="button button-secondary" href={`${root}/reports/${snapshot.id}`}>ดูรายงาน</a></div>
    <Worksheet snapshot={snapshot} attachments={attachments} evidenceMode={mode} />
    <section className="content-section card review-points" aria-labelledby="review-points-heading">
      <h2 id="review-points-heading">จุดที่ควรทบทวน</h2>
      <p>รายการนี้ช่วยจัดหัวข้อสำหรับตรวจข้อมูลและเอกสาร ไม่ใช่ผลอนุมัติหรือการวินิจฉัยสิทธิ</p>
      {points.length > 0 ? <ul>{points.map((point, index) => <li key={`${point.title}-${index}`}><strong>{point.title}</strong><span>{point.detail}</span></li>)}</ul> : <p>ไม่มีหัวข้อเพิ่มเติมจากข้อมูลที่บันทึกไว้</p>}
    </section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><h2>ประวัติการเข้าถึง</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>เหตุการณ์</th><th>ผู้ใช้</th><th>วันและเวลา</th></tr></thead><tbody>{audit.map((event, index) => <tr key={`${event.event}-${index}`}><td>{auditEventLabel(event.event)}</td><td>{event.actor}</td><td>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</td></tr>)}</tbody></table></div></section>
    <div className="result-actions"><a className="button button-quiet" href={mode === "demo" ? "/demo/officer" : "/officer"}>กลับไปหน้ารายการ</a></div>
  </>;
}
