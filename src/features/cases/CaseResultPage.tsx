import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { validateSubmission } from "../../../shared/calculator.js";
import { formatDate } from "../../components/money.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { Worksheet } from "../../components/Worksheet.js";
import { ApiClientError, apiFailureContext, apiFailureMessage, hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoAttachments, latestDemoPreview, submitDemoCase } from "../../data/demoRepository.js";
import { useAppSession } from "../../app/App.js";

type Mode = "demo" | "hosted";

export function CaseResultPage({ mode }: { mode: Mode }) {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { csrfToken, user } = useAppSession();
  const submitRequestId = useRef<{ key: string; value: string } | null>(null);
  const [record, setRecord] = useState<FtcCaseRecord | null>(null);
  const [snapshot, setSnapshot] = useState<CalculationSnapshot | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitProblems, setSubmitProblems] = useState<string[]>([]);
  const [submitFieldProblems, setSubmitFieldProblems] = useState<string[]>([]);
  const [confirmedSubmitted, setConfirmedSubmitted] = useState(false);
  const requestedSnapshotId = search.get("preview");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setProblem(null);
      try {
        if (mode === "demo") {
          const loaded = findDemoCase(id, "taxpayer");
          if (!loaded) throw new Error("ไม่พบกรณีนี้ในข้อมูลสาธิต");
          const targetId = requestedSnapshotId ?? loaded.submittedSnapshotId;
          const savedSnapshot = targetId ? findDemoSnapshot(targetId) : latestDemoPreview(id, loaded.draft.revision);
          if (!savedSnapshot) throw new Error("ยังไม่มีผลคำนวณที่บันทึกไว้ กรุณาคำนวณจากแบบฟอร์มก่อน");
          if (active) { setRecord(loaded); setSnapshot(savedSnapshot); setAttachments(listDemoAttachments(id)); }
        } else {
          const detail = await hostedApi.getCase(id);
          const loaded = detail.case;
          const targetId = requestedSnapshotId ?? loaded.submittedSnapshotId;
          if (!targetId) throw new Error("ยังไม่มีผลคำนวณที่บันทึกไว้ กรุณาบันทึกร่างและคำนวณก่อน");
          const savedSnapshot = (await hostedApi.snapshot(targetId)).snapshot;
          if (active) { setRecord(loaded); setSnapshot(savedSnapshot); setAttachments(detail.attachments ?? []); }
        }
      } catch (error) {
        if (active) setProblem(apiFailureMessage(error, "โหลดผลคำนวณไม่สำเร็จ"));
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [id, mode, requestedSnapshotId]);

  const calculateCurrent = () => navigate(`${mode === "demo" ? "/demo" : "/app"}/cases/${encodeURIComponent(id)}/edit`);
  const isSubmitted = record?.status === "submitted";
  const isCurrent = record && snapshot && snapshot.revision === record.draft.revision;
  const canSubmit = !isSubmitted && snapshot?.kind === "preview" && isCurrent && snapshot.result.outcome === "ready";

  const submit = async () => {
    if (!record || !snapshot || !isCurrent || snapshot.kind !== "preview") return;
    const idempotencyKey = `ftc.submit.pending.${user?.id ?? "anonymous"}.${record.id}.${snapshot.id}`;
    let submitId = submitRequestId.current;
    if (!submitId || submitId.key !== idempotencyKey) {
      const stored = sessionStorage.getItem(idempotencyKey);
      const value = stored ?? crypto.randomUUID();
      sessionStorage.setItem(idempotencyKey, value);
      submitId = { key: idempotencyKey, value };
      submitRequestId.current = submitId;
    }
    const requestId = submitId.value;
    setBusy(true);
    setProblem(null);
    setSubmitProblems([]);
    setSubmitFieldProblems([]);
    try {
      if (mode === "demo") {
        const messages = validateSubmission(record.draft, snapshot.result, {
          currentRevision: record.draft.revision,
          previewRevision: snapshot.revision,
          attachments,
        });
        if (messages.length) { setSubmitProblems(messages.map((item) => item.message)); return; }
        const frozenSnapshot: CalculationSnapshot = { ...snapshot, id: `demo-submitted-${crypto.randomUUID()}`, kind: "submitted", createdAt: new Date().toISOString() };
        const submitted = await submitDemoCase(record.id, frozenSnapshot);
        setRecord(submitted);
        setSnapshot(frozenSnapshot);
        setConfirmedSubmitted(true);
      } else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        try {
          const response = await hostedApi.submit(record.id, record.draft.revision, snapshot.id, csrfToken, requestId);
          setRecord(response.case);
          setSnapshot(response.snapshot);
          setConfirmedSubmitted(true);
        } catch (error) {
          // A lost response may follow a committed submission. Read the case before offering a retry.
          const latestDetail = await hostedApi.getCase(record.id);
          const latest = latestDetail.case;
          if (latest.status === "submitted" && latest.submittedSnapshotId) {
            const original = (await hostedApi.snapshot(latest.submittedSnapshotId)).snapshot;
            setRecord(latest);
            setSnapshot(original);
            setConfirmedSubmitted(true);
          } else {
            setRecord(latest);
            setAttachments(latestDetail.attachments ?? []);
            if (latest.draft.revision > snapshot.revision) {
              setProblem(`มีการเปลี่ยนแปลงในร่างหลังบันทึกผลนี้ กรุณาบันทึกและคำนวณใหม่ก่อนส่ง${apiFailureContext(error)}`);
            } else throw error;
          }
        }
      }
    } catch (error) {
      setProblem(apiFailureMessage(error, "ส่งเข้าคิวไม่สำเร็จ ตรวจสอบสถานะกรณีก่อนลองซ้ำ"));
      if (error instanceof ApiClientError && error.fields?.length) {
        setSubmitFieldProblems(error.fields.map((item) => item.message));
      }
    } finally { setBusy(false); }
  };

  if (loading) return <div className="loading-card" role="status">กำลังโหลดผลคำนวณที่บันทึกไว้…</div>;
  if (problem && (!record || !snapshot)) return <section className="card"><h1>แสดงผลคำนวณไม่ได้</h1><div className="alert alert-error" role="alert">{problem}</div><a className="button button-secondary" href={mode === "demo" ? "/demo/app" : "/app"}>กลับรายการกรณี</a></section>;
  if (!record || !snapshot) return null;

  const reportRoot = mode === "demo" ? "/demo" : "";
  const reportHref = `${reportRoot}/reports/${encodeURIComponent(snapshot.id)}`;
  const stale = !isCurrent && !isSubmitted;
  const outcomeText = snapshot.result.outcome === "ready" ? "คำนวณได้ตามข้อมูลและสมมติฐานที่ระบุ" : snapshot.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ" : "มีข้อมูลที่ต้องทบทวน";
  const savedAt = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt));

  return <>
    <PageHeading eyebrow="ผลการคำนวณ" title="ผลคำนวณเครดิตภาษีต่างประเทศ">
      ผลนี้แสดงตามข้อมูลและสมมติฐานที่บันทึกไว้ และไม่ใช่การวินิจฉัยสิทธิภาษี
      <span className="result-saved-note">ผลคำนวณนี้บันทึกไว้เมื่อ {savedAt} และยังไม่ได้ยื่นแบบภาษีต่อกรมสรรพากร</span>
    </PageHeading>
    {confirmedSubmitted && <div className="alert alert-success" role="status"><strong>ส่งเข้าคิวจำลองแล้ว</strong><span>ระบบต้นแบบบันทึกผลสำเร็จและไม่สร้างรายการซ้ำเมื่อยืนยันสถานะ</span></div>}
    {problem && <div className="alert alert-error" role="alert">{problem}{mode === "hosted" && problem.includes("เซสชันหมดอายุ") && <a href="/login">เข้าสู่ระบบอีกครั้ง</a>}</div>}
    {stale && <div className="alert alert-warning" role="status"><strong>ผลนี้เป็นข้อมูลก่อนการแก้ไขล่าสุด</strong><span>มีการเปลี่ยนแปลงในร่างหลังบันทึกผลนี้ กรุณาบันทึกและคำนวณใหม่ก่อนส่งเข้าคิว</span></div>}
    {snapshot.result.outcome !== "ready" && <div className={`alert ${snapshot.result.outcome === "needs_review" ? "alert-warning" : "alert-info"}`} role="status"><strong>{outcomeText}</strong><ul>{snapshot.result.validationMessages.map((message, index) => <li key={`${message.code}-${index}`}>{message.message}</li>)}</ul></div>}
    <Worksheet snapshot={snapshot} attachments={attachments} evidenceMode={mode} />
    <div className="result-actions">
      <a className="button button-secondary" href={reportHref}>ดูรายงาน</a>
      {!isSubmitted && <><button className="button button-quiet" onClick={calculateCurrent}>แก้ไขข้อมูล</button><button className="button button-primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "กำลังตรวจสอบสถานะ…" : "ส่งให้เจ้าหน้าที่ตรวจ"}</button></>}
      {isSubmitted && <div className="alert alert-success"><strong>ส่งแล้วเมื่อ {formatDate(record.submittedAt)}</strong><span>แสดงผลที่ส่งแล้วแบบอ่านอย่างเดียว</span></div>}
    </div>
    {submitProblems.length > 0 && <div className="alert alert-warning" role="alert"><strong>ยังส่งกรณีไม่ได้</strong><ul>{submitProblems.map((message, index) => <li key={index}>{message}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
    {submitFieldProblems.length > 0 && <div className="alert alert-warning" role="alert"><strong>รายละเอียดช่องที่ต้องตรวจ</strong><ul>{submitFieldProblems.map((message, index) => <li key={index}>{message}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
  </>;
}
