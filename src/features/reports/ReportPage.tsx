import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CalculationSnapshot } from "../../../shared/contracts.js";
import { EDUCATIONAL_NOTICE } from "../../../shared/labels.js";
import { Worksheet } from "../../components/Worksheet.js";
import { apiFailureMessage, hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoCases } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";
import { ExcelExportButton } from "./ExcelExportButton.js";

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
      } catch (error) { if (active) setProblem(apiFailureMessage(error, "เปิดรายงานไม่สำเร็จ")); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [mode, snapshotId, user?.role]);

  if (loading) return <div className="loading-card" role="status">กำลังสร้างรายงานจากข้อมูลที่บันทึก…</div>;
  if (!snapshot) return <section className="card"><h1>เปิดรายงานไม่ได้</h1><div className="alert alert-error" role="alert">{problem ?? "ไม่พบรายงาน"}</div><a className="button button-secondary" href={mode === "demo" ? (user?.role === "officer" ? "/demo/officer" : "/demo/app") : (user?.role === "officer" ? "/officer" : "/app")}>กลับหน้าหลัก</a></section>;

  const draftReport = snapshot.kind === "preview";
  const outcomeText = snapshot.result.outcome === "ready" ? "คำนวณได้ตามข้อมูลและสมมติฐานที่ระบุ" : snapshot.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ" : "มีข้อมูลที่ต้องทบทวน";
  const caseReference = `FTC-${snapshot.caseId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  return <>
    <div className="report-toolbar no-print"><a className="button button-quiet" href={mode === "demo" ? (user?.role === "officer" ? "/demo/officer" : "/demo/app") : (user?.role === "officer" ? "/officer" : "/app")}>กลับไปหน้ารายการ</a><ExcelExportButton snapshot={snapshot} /><button className="button button-primary" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button></div>
    <article className="print-report">
      <header className="report-header"><div><p className="report-kicker">รายงานผลการคำนวณ</p><h1>รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ</h1><p>ผลนี้ไม่ใช่แบบยื่นภาษีหรือการรับรองสิทธิ</p></div><div className="report-mark" aria-hidden="true">ภาษี</div></header>
      {draftReport && <div className="draft-watermark">ร่าง — ยังไม่ได้ส่ง</div>}
      {!draftReport && <div className="submitted-report-label">รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว</div>}
      <div className="report-meta"><div><span>ปีภาษี</span><strong>{snapshot.inputs.taxYear ? snapshot.inputs.taxYear + 543 : "—"} ({snapshot.inputs.taxYear ?? "—"})</strong></div><div><span>เลขอ้างอิง</span><strong>{caseReference}</strong></div><div><span>ผลคำนวณบันทึกเมื่อ</span><strong>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt))}</strong></div><div><span>สถานะผล</span><strong>{outcomeText}</strong></div></div>
      <p className="report-timestamp-note">เวลาที่แสดงคือเวลาบันทึกผลคำนวณ ไม่ใช่เวลายื่นแบบภาษีต่อกรมสรรพากร</p>
      {snapshot.result.validationMessages.length > 0 && <section className="report-section"><h2>ข้อมูลที่ขาดหรือควรทบทวน</h2><ul className="report-list">{snapshot.result.validationMessages.map((message, index) => <li key={index}>{message.message}</li>)}</ul></section>}
      <Worksheet snapshot={snapshot} showEvidence />
      <footer className="report-footer">{EDUCATIONAL_NOTICE}</footer>
    </article>
  </>;
}
