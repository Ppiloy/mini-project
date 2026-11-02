import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord, OfficerReviewPoint, OfficerWorklistItem } from "../../../shared/contracts.js";
import { classifySubmittedSnapshot, officerReviewScope } from "../../../shared/review.js";
import { countryLabel, incomeTypeLabel } from "../../../shared/labels.js";
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

type WorklistStatusFilter = "all" | "awaiting_review";
type WorklistPointsFilter = "all" | "with" | "without";

function sortWorklist(cases: readonly OfficerWorklistItem[]): OfficerWorklistItem[] {
  return [...cases].sort((left, right) => Number(right.reviewPointCount > 0) - Number(left.reviewPointCount > 0)
    || left.submittedAt.localeCompare(right.submittedAt) || left.caseId.localeCompare(right.caseId));
}

function filterWorklist(cases: readonly OfficerWorklistItem[], status: WorklistStatusFilter, points: WorklistPointsFilter): OfficerWorklistItem[] {
  return sortWorklist(cases.filter((item) => (status === "all" || item.reviewStatus === "awaiting_review")
    && (points === "all" || (points === "with" ? item.reviewPointCount > 0 : item.reviewPointCount === 0))));
}

function demoWorklist(): OfficerWorklistItem[] {
  return listDemoCases("officer").flatMap((record) => {
    if (!record.submittedSnapshotId) return [];
    const snapshot = findDemoSnapshot(record.submittedSnapshotId);
    if (!snapshot) return [];
    const reviewPoints = classifySubmittedSnapshot(snapshot);
    return [{ caseId: snapshot.caseId, reference: snapshot.caseId, taxYear: snapshot.inputs.taxYear,
      sourceCount: snapshot.inputs.sources.length, totalFtc: snapshot.result.allowableCredit,
      submittedAt: record.submittedAt ?? snapshot.createdAt, reviewStatus: "awaiting_review", reviewPointCount: reviewPoints.length,
      reviewPoints } satisfies OfficerWorklistItem];
  });
}

const reviewPointCategoryLabels: Readonly<Record<OfficerReviewPoint["category"], string>> = {
  invalid: "ข้อมูลที่ควรแก้ไข",
  missingEvidence: "หลักฐานที่ขาด",
  unsupported: "กรณีที่ยังไม่รองรับ",
  substantive: "ประเด็นสาระสำคัญที่ควรทบทวน",
};

function reviewPointSourceLabel(point: OfficerReviewPoint, snapshot: CalculationSnapshot): string {
  if (point.sourceIndex === null) return "ข้อมูลภาพรวมของกรณี";
  const source = snapshot.inputs.sources[point.sourceIndex];
  if (!source) return `แหล่งเงินได้ ${point.sourceIndex + 1}`;
  return `แหล่งเงินได้ ${point.sourceIndex + 1} · ${countryLabel(source.countryCode)} · ${incomeTypeLabel(source)}`;
}

export function OfficerQueuePage({ mode }: { mode: Mode }) {
  const [records, setRecords] = useState<OfficerWorklistItem[]>([]);
  const [year, setYear] = useState("");
  const [reference, setReference] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorklistStatusFilter>("all");
  const [pointsFilter, setPointsFilter] = useState<WorklistPointsFilter>("all");
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setBusy(true);
      setProblem(null);
      try {
        const cases = mode === "demo" ? demoWorklist()
          : (await hostedApi.listOfficerWorklist({ status: statusFilter, reviewPoints: pointsFilter })).cases;
        if (active) setRecords(filterWorklist(cases, statusFilter, pointsFilter));
      }
      catch (error) { if (active) setProblem(apiFailureMessage(error, "โหลดคิวไม่สำเร็จ")); }
      finally { if (active) setBusy(false); }
    };
    void load();
    return () => { active = false; };
  }, [mode, statusFilter, pointsFilter, refreshKey]);
  const filtered = useMemo(() => records.filter((record) => {
    const ref = record.reference.toLowerCase();
    return (!year || String((record.taxYear ?? 0) + 543) === year) && (!reference || ref.includes(reference.trim().toLowerCase()));
  }), [records, year, reference]);
  return <>
    <PageHeading title="คิวกรณีที่ส่งเข้าตรวจสอบ">
      แสดงข้อมูลที่ส่งไว้และจุดตรวจเชิงโครงสร้างสำหรับรายการที่ได้รับมอบหมาย
    </PageHeading>
    {mode === "demo" && <div className="alert alert-info"><strong>คิวเจ้าหน้าที่จำลอง</strong><span>ข้อมูลนี้เป็นกรณีสมมติที่ส่งจากโหมดสาธิตในเบราว์เซอร์นี้เท่านั้น</span></div>}
    {problem && <div className="alert alert-error" role="alert">{problem}{mode === "hosted" && problem.includes("เซสชัน") && <a href="/officer/login">เข้าสู่ระบบเจ้าหน้าที่อีกครั้ง</a>}</div>}
    <section className="filter-panel card officer-worklist-filters" aria-label="ตัวกรองคิวเจ้าหน้าที่">
      <label className="field"><span>ปีภาษี</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">ทุกปี</option><option value="2568">2568 (2025)</option></select></label>
      <label className="field"><span>เลขอ้างอิงตัวอย่าง</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="ค้นหาท้ายเลขอ้างอิง" /></label>
      <label className="field"><span>สถานะการตรวจทาน</span><select aria-label="สถานะการตรวจทาน" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as WorklistStatusFilter)}>
        <option value="all">ทุกสถานะ</option><option value="awaiting_review">รอการตรวจทาน</option>
      </select></label>
      <label className="field"><span>จุดที่ควรตรวจ</span><select aria-label="จุดที่ควรตรวจ" value={pointsFilter} onChange={(event) => setPointsFilter(event.target.value as WorklistPointsFilter)}>
        <option value="all">ทั้งหมด</option><option value="with">มีจุดที่ควรตรวจ</option><option value="without">ไม่มีจุดที่ควรตรวจ</option>
      </select></label>
      <button className="button button-secondary" onClick={() => setRefreshKey((current) => current + 1)}>รีเฟรชคิว</button>
    </section>
    <section className="content-section card breakdown-section">
      <div className="section-heading"><div><h2>รายการที่ได้รับมอบหมาย</h2></div><span className="queue-count">{filtered.length} กรณี</span></div>
      {busy ? <div className="loading-card" role="status">กำลังโหลดคิว…</div> : filtered.length === 0
        ? <div className="empty-state"><h3>{records.length === 0 ? "ยังไม่มีกรณีในคิว" : "ไม่พบกรณีที่ตรงกับตัวกรอง"}</h3><p>{records.length === 0 ? "เมื่อผู้เสียภาษีส่งกรณี รายการที่ได้รับมอบหมายจะแสดงที่นี่" : "ลองเปลี่ยนหรือล้างตัวกรอง"}</p></div>
        : <div className="table-scroll"><table className="data-table officer-worklist-table" aria-label="รายการกรณีที่ส่งเข้าตรวจสอบ">
          <thead><tr><th>เลขอ้างอิง</th><th>ปีภาษี</th><th>แหล่งเงินได้</th><th>เครดิตภาษีรวม</th><th>วันที่ส่ง</th><th>สถานะ</th><th>จุดที่ควรตรวจ</th><th>เปิดรายการ</th></tr></thead>
          <tbody>{filtered.map((record) => <tr key={record.caseId} data-case-id={record.caseId}>
            <th scope="row">{record.reference.slice(-8).toUpperCase()}</th>
            <td>{record.taxYear === null ? "ไม่ระบุ" : <>พ.ศ. {record.taxYear + 543} <small>({record.taxYear})</small></>}</td>
            <td>{record.sourceCount} รายการ</td>
            <td>{formatMoney(record.totalFtc)} บาท</td>
            <td>{formatDate(record.submittedAt)}</td>
            <td><span className="status-badge status-submitted">รอการตรวจทาน</span></td>
            <td><span aria-label={`${record.reviewPointCount} จุดที่ควรตรวจ`}>{record.reviewPointCount}</span></td>
            <td><a className="button button-primary button-small" href={`${mode === "demo" ? "/demo" : ""}/officer/cases/${encodeURIComponent(record.caseId)}`}>ตรวจทาน</a></td>
          </tr>)}</tbody>
        </table></div>}
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
  const points = classifySubmittedSnapshot(snapshot);
  return <>
    <PageHeading eyebrow="กรณีที่ได้รับมอบหมาย" title="ตรวจทานกรณีที่ส่งแล้ว">
      ข้อมูลและผลคำนวณที่ส่งมาแสดงแบบอ่านอย่างเดียว เจ้าหน้าที่เปิดดูได้โดยไม่แก้ไขตัวเลขต้นฉบับ
    </PageHeading>
    {mode === "demo" && <div className="alert alert-info">ข้อมูลจำลอง · การเปิดหน้านี้แสดงเหตุการณ์ในประวัติการเข้าถึงจำลอง</div>}
    <div className="submitted-banner"><div><span className="status-badge status-submitted">ส่งแล้ว · อ่านอย่างเดียว</span><p>ส่งเมื่อ {formatDate(record.submittedAt)}</p></div><a className="button button-secondary" href={`${root}/reports/${snapshot.id}`}>ดูรายงาน</a></div>
    <Worksheet snapshot={snapshot} attachments={attachments} evidenceMode={mode} />
    <section className="content-section card review-points" aria-labelledby="review-points-heading">
      <h2 id="review-points-heading">จุดที่ควรตรวจ</h2>
      <p>{officerReviewScope}</p>
      {points.length > 0 ? <ul>{points.map((point, index) => <li key={`${point.code}-${point.sourceId ?? point.sourceIndex ?? "case"}-${index}`} data-review-category={point.category}>
        <span className={`review-point-category review-point-category-${point.category}`}>{reviewPointCategoryLabels[point.category]}</span>
        <strong>{reviewPointSourceLabel(point, snapshot)} · {point.title}</strong>
        <p><strong>เหตุผล:</strong> {point.reason}</p>
        <p><strong>ขั้นตอนถัดไป:</strong> {point.nextAction}</p>
      </li>)}</ul> : <p className="review-points-empty">ไม่พบข้อมูลผิดปกติหรือหลักฐานที่ขาดจากการตรวจเชิงโครงสร้างในข้อมูลที่บันทึกไว้ การไม่มีจุดตรวจไม่ได้ยืนยันสิทธิหรืออนุมัติรายการ และการมีไฟล์แนบไม่ได้ยืนยันว่าเอกสารถูกต้อง</p>}
    </section>
    <section className="content-section card breakdown-section"><div className="section-heading"><div><h2>ประวัติการเข้าถึง</h2></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>เหตุการณ์</th><th>ผู้ใช้</th><th>วันและเวลา</th></tr></thead><tbody>{audit.map((event, index) => <tr key={`${event.event}-${index}`}><td>{auditEventLabel(event.event)}</td><td>{event.actor}</td><td>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</td></tr>)}</tbody></table></div></section>
    <div className="result-actions"><a className="button button-quiet" href={mode === "demo" ? "/demo/officer" : "/officer"}>กลับไปหน้ารายการ</a></div>
  </>;
}
