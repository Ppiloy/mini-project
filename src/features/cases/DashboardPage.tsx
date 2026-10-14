import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FtcCaseRecord } from "../../../shared/contracts.js";
import { partialRemittanceFixture, slideDiscrepancyFixture } from "../../fixtures/index.js";
import { hostedApi } from "../../data/api.js";
import { createDemoCase, createDemoCaseFromDraft, listDemoCases } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";
import { PageHeading } from "../../components/SiteFrame.js";

type Mode = "demo" | "hosted";

export function DashboardPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { user, csrfToken } = useAppSession();
  const [cases, setCases] = useState<FtcCaseRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const createRequestId = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "demo") setCases(listDemoCases("taxpayer"));
      else setCases((await hostedApi.listCases()).cases);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "โหลดกรณีไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const startCase = async () => {
    if (creating) return;
    setCreating(true);
    setProblem(null);
    try {
      let record: FtcCaseRecord;
      if (mode === "demo") record = createDemoCase();
      else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง ข้อมูลที่กรอกในหน้าปัจจุบันยังอยู่");
        record = (await hostedApi.createCase(csrfToken, createRequestId.current)).case;
        createRequestId.current = crypto.randomUUID();
      }
      navigate(`${mode === "demo" ? "/demo" : ""}/cases/${encodeURIComponent(record.id)}/edit`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "สร้างกรณีไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  };

  const startExample = (draft: typeof partialRemittanceFixture.draft) => {
    const record = createDemoCaseFromDraft(draft);
    navigate(`/demo/cases/${encodeURIComponent(record.id)}/edit`);
  };

  return (
    <>
      <div className="dashboard-heading">
        <PageHeading eyebrow="TAXPAYER WORKSPACE" title="กรณีของผู้เสียภาษีตัวอย่าง">
          เริ่มกรณีใหม่หรือกลับไปทำร่างที่บันทึกไว้ ข้อมูลสาธิตนี้เป็นข้อมูลสมมติสำหรับปีภาษี 2568
        </PageHeading>
        <button className="button button-primary" onClick={startCase} disabled={creating}>
          <span aria-hidden="true">＋</span> {creating ? "กำลังสร้าง…" : "สร้างกรณีใหม่"}
        </button>
      </div>
      <section className="summary-strip" aria-label="ข้อมูลบัญชีตัวอย่าง">
        <div><span className="summary-label">ผู้ใช้</span><strong>{user?.displayName ?? "ผู้เสียภาษีตัวอย่าง"}</strong></div>
        <div><span className="summary-label">ปีภาษีที่รองรับ</span><strong>2568 <span className="muted-inline">(2025)</span></strong></div>
        <div><span className="summary-label">นโยบายคำนวณ</span><strong>rd-ftc-demo-2568-v1</strong></div>
      </section>
      {mode === "demo" && <section className="fixture-launch card"><div><p className="eyebrow">WORKED EXAMPLES</p><h2>เริ่มจากข้อมูลคำนวณตัวอย่าง</h2><p>คัดลอกตัวอย่างลงในกรณีสมมติใหม่เพื่อสำรวจ D/E/F, การจัดสรรภาษี และความคลาดเคลื่อนต้นทาง</p></div><div className="fixture-launch-actions"><button className="button button-secondary" onClick={() => startExample(partialRemittanceFixture.draft)}>ตัวอย่างนำเข้า 50% · G = 2,500</button><button className="button button-secondary" onClick={() => startExample(slideDiscrepancyFixture.draft)}>ตัวอย่างเวียดนามและจีน · 143,544.30</button></div></section>}
      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">MY CASES</p><h2>กรณีคำนวณเครดิตภาษี</h2></div><button className="button button-quiet button-small" onClick={() => void load()}>รีเฟรชรายการ</button></div>
        {problem && <div className="alert alert-error" role="alert"><span>{problem}</span>{mode === "hosted" && <a href="/login">เข้าสู่ระบบอีกครั้ง</a>}</div>}
        {busy ? <div className="loading-card" role="status">กำลังโหลดรายการ…</div> : cases.length === 0 ? (
          <div className="empty-state card"><div className="empty-icon" aria-hidden="true">＋</div><h3>ยังไม่มีกรณีคำนวณ</h3><p>สร้างกรณีเพื่อเริ่มบันทึกรายได้และข้อมูลการนำเงินเข้าประเทศ</p><button className="button button-secondary" onClick={startCase} disabled={creating}>สร้างกรณีแรก</button></div>
        ) : (
          <div className="case-list">
            {cases.map((record) => <CaseCard key={record.id} record={record} mode={mode} />)}
          </div>
        )}
      </section>
      {mode === "demo" && <p className="demo-storage-note">บันทึกแยกเฉพาะข้อมูลสมมติในเบราว์เซอร์นี้ การบันทึกที่แสดงว่าสำเร็จเป็นการจำลองในโหมดสาธิต</p>}
    </>
  );
}

function CaseCard({ record, mode }: { record: FtcCaseRecord; mode: Mode }) {
  const hrefRoot = mode === "demo" ? "/demo" : "";
  const destination = record.status === "submitted" ? `${hrefRoot}/cases/${record.id}/result` : `${hrefRoot}/cases/${record.id}/edit`;
  const updated = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.updatedAt));
  return (
    <article className="case-card card">
      <div className="case-card-main"><div className="case-title-row"><h3>กรณีปีภาษี {record.draft.taxYear ? record.draft.taxYear + 543 : 2568}</h3><span className={`status-badge ${record.status === "submitted" ? "status-submitted" : "status-draft"}`}>{record.status === "submitted" ? "ส่งแล้ว · คิวจำลอง" : "ร่าง"}</span></div><p className="case-ref">เลขอ้างอิงตัวอย่าง {record.id.slice(-8).toUpperCase()}</p><p className="case-updated">แก้ไขล่าสุด {updated}</p></div>
      <div className="case-card-action"><a className="button button-secondary" href={destination}>{record.status === "submitted" ? "ดูผลและรายงาน" : "ทำร่างต่อ"}</a></div>
    </article>
  );
}
