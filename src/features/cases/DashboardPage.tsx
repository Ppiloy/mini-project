import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import type { CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { partialRemittanceFixture, slideDiscrepancyFixture } from "../../fixtures/index.js";
import { apiFailureMessage, hostedApi } from "../../data/api.js";
import { createDemoCase, createDemoCaseFromDraft, findDemoCase, findDemoSnapshot, latestDemoPreview, listDemoCases } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { formatMoney } from "../../components/money.js";

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
      setProblem(apiFailureMessage(error, "โหลดกรณีไม่สำเร็จ"));
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
      navigate(`${mode === "demo" ? "/demo" : "/app"}/cases/${encodeURIComponent(record.id)}/edit`);
    } catch (error) {
      setProblem(apiFailureMessage(error, "สร้างกรณีไม่สำเร็จ"));
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
        {problem && <div className="alert alert-error" role="alert"><span>{problem}</span>{mode === "hosted" && <Link to="/login">เข้าสู่ระบบอีกครั้ง</Link>}</div>}
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

type CaseCardLoad =
  | { key: string; state: "loading"; record: FtcCaseRecord }
  | { key: string; state: "none"; record: FtcCaseRecord }
  | { key: string; state: "snapshot"; record: FtcCaseRecord; snapshot: CalculationSnapshot }
  | { key: string; state: "failed"; record: FtcCaseRecord; error: string };

function CaseCard({ record, mode }: { record: FtcCaseRecord; mode: Mode }) {
  const { user } = useAppSession();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<CaseCardLoad | null>(null);
  const key = `${mode}:${user?.id ?? ""}:${record.id}:${record.status}:${record.draft.revision}:${record.submittedSnapshotId ?? ""}:${attempt}`;
  const current = loaded?.key === key ? loaded : { key, state: "loading" as const, record };

  useEffect(() => {
    let active = true;
    setLoaded({ key, state: "loading", record });
    const load = async () => {
      let currentRecord = record;
      try {
        if (!user || record.ownerId !== user.id) throw new Error("ไม่สามารถยืนยันเจ้าของกรณีนี้ได้");

        let snapshot: CalculationSnapshot | null = null;
        if (mode === "demo") {
          const saved = findDemoCase(record.id, "taxpayer");
          if (!saved || saved.ownerId !== user.id) throw new Error("ไม่พบกรณีนี้ในข้อมูลสาธิตของบัญชีปัจจุบัน");
          currentRecord = saved;
          if (saved.status === "submitted") {
            if (!saved.submittedSnapshotId) throw new Error("ไม่พบรหัสผลคำนวณที่ส่งแล้ว");
            const submitted = findDemoSnapshot(saved.submittedSnapshotId);
            if (!submitted) throw new Error("ไม่พบผลคำนวณฉบับที่ส่งแล้วในข้อมูลสาธิต");
            snapshot = submitted;
          } else snapshot = latestDemoPreview(saved.id, saved.draft.revision) ?? null;
        } else {
          const detail = await hostedApi.getCase(record.id);
          if (detail.case.id !== record.id || detail.case.ownerId !== user.id) throw new Error("ไม่สามารถยืนยันเจ้าของกรณีนี้ได้");
          currentRecord = detail.case;
          if (detail.case.status === "submitted") {
            if (!detail.case.submittedSnapshotId) throw new Error("ไม่พบรหัสผลคำนวณที่ส่งแล้ว");
            snapshot = (await hostedApi.snapshot(detail.case.submittedSnapshotId)).snapshot;
          } else snapshot = detail.currentPreview;
        }

        if (snapshot) {
          const matchesCurrentRecord = snapshot.caseId === currentRecord.id && snapshot.revision === currentRecord.draft.revision;
          const matchesStatus = currentRecord.status === "submitted"
            ? snapshot.id === currentRecord.submittedSnapshotId && snapshot.kind === "submitted"
            : snapshot.kind === "preview";
          if (!matchesCurrentRecord || !matchesStatus) {
            if (currentRecord.status === "submitted") throw new Error("ผลคำนวณที่ส่งแล้วไม่ตรงกับกรณีนี้ จึงยังเปิดยอดที่บันทึกไม่ได้");
            snapshot = null;
          }
        }
        if (active) setLoaded(snapshot
          ? { key, state: "snapshot", record: currentRecord, snapshot }
          : { key, state: "none", record: currentRecord });
      } catch (error) {
        if (active) setLoaded({ key, state: "failed", record: currentRecord, error: apiFailureMessage(error, "โหลดผลคำนวณที่บันทึกไว้ไม่สำเร็จ") });
      }
    };
    void load();
    return () => { active = false; };
  }, [key, mode, record, user]);

  const currentRecord = current.record;
  const hrefRoot = mode === "demo" ? "/demo" : "/app";
  const destination = currentRecord.status === "submitted" ? `${hrefRoot}/cases/${currentRecord.id}/result` : `${hrefRoot}/cases/${currentRecord.id}/edit`;
  const updated = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(currentRecord.updatedAt));
  const snapshot = current.state === "snapshot" ? current.snapshot : null;
  const reportHref = snapshot ? `${mode === "demo" ? "/demo" : ""}/reports/${encodeURIComponent(snapshot.id)}` : null;
  const resultStatus = snapshot?.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ"
    : snapshot?.result.outcome === "needs_review" ? "มีข้อเท็จจริงที่ต้องตรวจสอบ / อยู่นอกขอบเขตตัวอย่าง"
      : snapshot?.result.outcome === "ready" ? "ผลคำนวณพร้อมแล้ว แต่ไม่มียอดเครดิตที่แสดงได้" : "";
  return (
    <article className="case-card card">
      <div className="case-card-main"><div className="case-title-row"><h3>กรณีปีภาษี {currentRecord.draft.taxYear ? currentRecord.draft.taxYear + 543 : 2568}</h3><span className={`status-badge ${currentRecord.status === "submitted" ? "status-submitted" : "status-draft"}`}>{currentRecord.status === "submitted" ? (mode === "demo" ? "ส่งแล้ว · คิวจำลอง" : "ส่งแล้ว · คิวตรวจสอบ") : "ร่าง"}</span></div><p className="case-ref">เลขอ้างอิงตัวอย่าง {currentRecord.id.slice(-8).toUpperCase()}</p><p className="case-updated">แก้ไขล่าสุด {updated}</p>
        {current.state === "loading" && <p className="case-calculation-note" role="status">กำลังตรวจผลคำนวณที่บันทึกไว้…</p>}
        {current.state === "none" && <p className="case-calculation-note">ยังไม่มีผลคำนวณสำหรับร่างรุ่นปัจจุบัน</p>}
        {current.state === "failed" && <div className="case-calculation-note" role="alert"><span>{current.error}</span><button className="button button-quiet button-small" onClick={() => setAttempt((value) => value + 1)}>ลองโหลดผลคำนวณอีกครั้ง</button></div>}
        {snapshot && <div className="case-calculation-note"><span>ผลคำนวณรุ่น {snapshot.revision}</span>{snapshot.result.outcome === "ready" && snapshot.result.allowableCredit !== null
          ? <strong>เครดิตภาษีที่ใช้ได้ {formatMoney(snapshot.result.allowableCredit)} บาท</strong>
          : <span>{resultStatus}</span>}</div>}
      </div>
      <div className="case-card-action"><Link className="button button-secondary" to={destination}>{currentRecord.status === "submitted" ? "ดูผลและรายงาน" : "ทำร่างต่อ"}</Link>{reportHref && <Link className="button button-quiet button-small" to={reportHref}>เปิดรายงาน</Link>}</div>
    </article>
  );
}
