import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import type { CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { COUNTRY_CHOICES, DEMO_EXAMPLE_LABELS } from "../../../shared/labels.js";
import { partialRemittanceFixture, slideDiscrepancyFixture } from "../../fixtures/index.js";
import { apiFailureMessage, hostedApi } from "../../data/api.js";
import { createDemoCase, createDemoCaseFromDraft, deleteDemoCase, findDemoCase, findDemoSnapshot, latestDemoPreview, listDemoCases } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { formatMoney } from "../../components/money.js";

type Mode = "demo" | "hosted";

export function DashboardPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { user, csrfToken } = useAppSession();
  const currentTaxYear = new Date().getFullYear();
  const [cases, setCases] = useState<FtcCaseRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDeletions, setPendingDeletions] = useState<Record<string, string>>({});
  const createRequestId = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "demo") {
        setCases(listDemoCases("taxpayer"));
        setPendingDeletions({});
      } else {
        const result = await hostedApi.listCases();
        setCases(result.cases);
        setPendingDeletions(Object.fromEntries((result.pendingDeletions ?? []).map((item) => [item.caseId, item.requestId])));
      }
    } catch (error) {
      setProblem(apiFailureMessage(error, "โหลดกรณีไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }, [mode]);

  const removeCase = useCallback((caseId: string) => {
    setCases((current) => current.filter((record) => record.id !== caseId));
    setPendingDeletions((current) => {
      const next = { ...current };
      delete next[caseId];
      return next;
    });
  }, []);

  const markDeletionPending = useCallback((caseId: string, requestId: string) => {
    setPendingDeletions((current) => ({ ...current, [caseId]: requestId }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startCase = async () => {
    if (creating) return;
    setCreating(true);
    setProblem(null);
    try {
      let record: FtcCaseRecord;
      if (mode === "demo") record = createDemoCase();
      else {
        if (!csrfToken) throw new Error("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง ข้อมูลที่กรอกในหน้ายังอยู่");
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
        <PageHeading title="รายการคำนวณเครดิตภาษี">
          {mode === "demo" ? "เริ่มคำนวณใหม่หรือทำร่างตัวอย่างที่บันทึกไว้ต่อ" : "เริ่มคำนวณใหม่หรือทำร่างที่บันทึกไว้ต่อ"}
        </PageHeading>
        <button className="button button-primary" onClick={startCase} disabled={creating}>
          <span aria-hidden="true">＋</span> {creating ? "กำลังสร้าง…" : "เริ่มคำนวณใหม่"}
        </button>
      </div>
      <section className="summary-strip" aria-label="ข้อมูลบัญชี">
        <div><span className="summary-label">ผู้ใช้</span><strong>{user?.displayName ?? "ผู้เสียภาษีตัวอย่าง"}</strong></div>
        <div><span className="summary-label">ปีภาษีที่เลือกได้</span><strong>2567–{currentTaxYear + 543} <span className="muted-inline">(2024–{currentTaxYear})</span></strong></div>
        <div><span className="summary-label">ประเทศและประเภทเงินได้</span><strong>{COUNTRY_CHOICES.length} ประเทศที่มีอนุสัญญาภาษีซ้อนกับไทย · มาตรา 40(1)–40(8)</strong></div>
      </section>
      {mode === "demo" && <section className="fixture-launch card"><div><h2>กรณีตัวอย่าง</h2><p>เปิดกรณีสาธิตที่มีข้อมูลตั้งต้น หรือเริ่มกรณีใหม่จากข้อมูลว่าง</p></div><div className="fixture-launch-actions"><button className="button button-secondary" onClick={() => startExample(partialRemittanceFixture.draft)}>{DEMO_EXAMPLE_LABELS.partialRemittance}</button><button className="button button-secondary" onClick={() => startExample(slideDiscrepancyFixture.draft)}>{DEMO_EXAMPLE_LABELS.vietnamAndChina}</button></div></section>}
      <section className="content-section">
        <div className="section-heading"><div><h2>กรณีที่บันทึกไว้</h2></div></div>
        {problem && <div className="alert alert-error" role="alert"><span>{problem}</span>{mode === "hosted" && <Link to="/login">เข้าสู่ระบบอีกครั้ง</Link>}</div>}
        {busy ? <div className="loading-card" role="status">กำลังโหลดรายการ…</div> : cases.length === 0 ? (
          <div className="empty-state card"><div className="empty-icon" aria-hidden="true">＋</div><h3>ยังไม่มีกรณีคำนวณ</h3><p>เริ่มบันทึกรายได้และข้อมูลการนำเงินเข้าประเทศ</p><button className="button button-secondary" onClick={startCase} disabled={creating}>เริ่มคำนวณ</button></div>
        ) : (
          <div className="case-list">
            {cases.map((record) => <CaseCard key={record.id} record={record} mode={mode}
              pendingDeleteRequestId={pendingDeletions[record.id] ?? null} onDeleted={removeCase} onDeletionPending={markDeletionPending} />)}
          </div>
        )}
      </section>
    </>
  );
}

type CaseCardLoad =
  | { key: string; state: "loading"; record: FtcCaseRecord }
  | { key: string; state: "none"; record: FtcCaseRecord }
  | { key: string; state: "snapshot"; record: FtcCaseRecord; snapshot: CalculationSnapshot }
  | { key: string; state: "failed"; record: FtcCaseRecord; error: string };

function CaseCard({ record, mode, pendingDeleteRequestId, onDeleted, onDeletionPending }: {
  record: FtcCaseRecord;
  mode: Mode;
  pendingDeleteRequestId: string | null;
  onDeleted(caseId: string): void;
  onDeletionPending(caseId: string, requestId: string): void;
}) {
  const { user, csrfToken } = useAppSession();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<CaseCardLoad | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const key = `${mode}:${user?.id ?? ""}:${record.id}:${record.status}:${record.draft.revision}:${record.submittedSnapshotId ?? ""}:${attempt}:${pendingDeleteRequestId ?? ""}`;
  const current = loaded?.key === key ? loaded : { key, state: "loading" as const, record };

  useEffect(() => {
    let active = true;
    if (pendingDeleteRequestId) {
      setLoaded({ key, state: "none", record });
      return () => { active = false; };
    }
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
  }, [key, mode, pendingDeleteRequestId, record, user]);

  const currentRecord = current.record;
  const hrefRoot = mode === "demo" ? "/demo" : "/app";
  const destination = currentRecord.status === "submitted" ? `${hrefRoot}/cases/${currentRecord.id}/result` : `${hrefRoot}/cases/${currentRecord.id}/edit`;
  const updated = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(currentRecord.updatedAt));
  const snapshot = current.state === "snapshot" ? current.snapshot : null;
  const reportHref = snapshot ? `${mode === "demo" ? "/demo" : ""}/reports/${encodeURIComponent(snapshot.id)}` : null;
  const resultStatus = snapshot?.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ"
    : snapshot?.result.outcome === "needs_review" ? "มีข้อมูลที่ควรตรวจสอบ หรืออยู่นอกขอบเขตที่ระบบคำนวณได้"
      : snapshot?.result.outcome === "ready" ? "ผลคำนวณพร้อมแล้ว แต่ไม่มียอดเครดิตที่แสดงได้" : "";
  const deleteDraft = async () => {
    if (deleting || record.status !== "draft" || !user) return;
    if (!pendingDeleteRequestId && !window.confirm(`ต้องการลบร่างกรณีปีภาษี ${record.draft.taxYear ? record.draft.taxYear + 543 : 2568} หรือไม่ ไฟล์แนบในร่างนี้จะถูกลบด้วย`)) return;
    setDeleting(true);
    setDeleteProblem(null);
    const requestId = pendingDeleteRequestId ?? crypto.randomUUID();
    try {
      if (mode === "demo") {
        if (!await deleteDemoCase(record.id, user.id)) throw new Error("ลบได้เฉพาะร่างของบัญชีนี้");
        onDeleted(record.id);
        return;
      }
      if (!csrfToken) throw new Error("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
      const result = await hostedApi.deleteDraftCase(record.id, record.draft.revision, csrfToken, requestId);
      if (result.deleted) onDeleted(record.id);
      else onDeletionPending(record.id, requestId);
    } catch (error) {
      if (mode === "hosted") {
        try {
          const current = await hostedApi.listCases();
          const pending = current.pendingDeletions?.find((item) => item.caseId === record.id);
          if (pending) onDeletionPending(record.id, pending.requestId);
          else if (!current.cases.some((item) => item.id === record.id)) {
            onDeleted(record.id);
            return;
          }
        } catch { /* keep the original error visible when reconciliation is unavailable */ }
      }
      setDeleteProblem(apiFailureMessage(error, "ลบร่างไม่สำเร็จ"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="case-card card">
      <div className="case-card-main"><div className="case-title-row"><h3>กรณีปีภาษี {currentRecord.draft.taxYear ? currentRecord.draft.taxYear + 543 : 2568}</h3><span className={`status-badge ${currentRecord.status === "submitted" ? "status-submitted" : "status-draft"}`}>{pendingDeleteRequestId ? "กำลังลบ" : currentRecord.status === "submitted" ? (mode === "demo" ? "ส่งแล้ว · ข้อมูลตัวอย่าง" : "ส่งแล้ว · รอการตรวจทาน") : "ร่าง"}</span></div><p className="case-ref">เลขอ้างอิง {currentRecord.id.slice(-8).toUpperCase()}</p><p className="case-updated">แก้ไขล่าสุด {updated}</p>
        {pendingDeleteRequestId
          ? <p className="case-calculation-note" role="status">รอลบไฟล์แนบให้เสร็จ คุณลองดำเนินการต่อได้จากปุ่มด้านล่าง</p>
          : current.state === "loading" && <p className="case-calculation-note" role="status">กำลังตรวจผลคำนวณที่บันทึกไว้…</p>}
        {deleteProblem && <p className="case-calculation-note" role="alert">{deleteProblem}</p>}
        {!pendingDeleteRequestId && current.state === "none" && <p className="case-calculation-note">ยังไม่มีผลคำนวณที่บันทึกไว้สำหรับร่างนี้</p>}
        {current.state === "failed" && <div className="case-calculation-note" role="alert"><span>{current.error}</span><button className="button button-quiet button-small" onClick={() => setAttempt((value) => value + 1)}>ลองโหลดผลคำนวณอีกครั้ง</button></div>}
        {!pendingDeleteRequestId && snapshot && <div className="case-calculation-note"><span>ผลคำนวณที่บันทึกไว้</span>{snapshot.result.outcome === "ready" && snapshot.result.allowableCredit !== null
          ? <strong>เครดิตภาษีที่ใช้ได้ {formatMoney(snapshot.result.allowableCredit)} บาท</strong>
          : <span>{resultStatus}</span>}</div>}
      </div>
      <div className="case-card-action">{!pendingDeleteRequestId && <Link className="button button-secondary" to={destination}>{currentRecord.status === "submitted" ? "ดูผลคำนวณ" : "แก้ไขต่อ"}</Link>}{!pendingDeleteRequestId && reportHref && <Link className="button button-quiet button-small" to={reportHref}>ดูรายงาน</Link>}{currentRecord.status === "draft" && <button className="button button-quiet button-small" onClick={() => void deleteDraft()} disabled={deleting}>{deleting ? "กำลังลบ…" : pendingDeleteRequestId ? "ลองลบไฟล์ที่เหลืออีกครั้ง" : "ลบร่าง"}</button>}</div>
    </article>
  );
}
