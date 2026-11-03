import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord, SubmissionAcknowledgement } from "../../../shared/contracts.js";
import { validateSubmission } from "../../../shared/calculator.js";
import { missingEvidenceInventory } from "../../../shared/evidenceInventory.js";
import { AVAILABLE_EVIDENCE_STATEMENT_V1, countryLabel, EVIDENCE_LABELS, incomeTypeLabel } from "../../../shared/labels.js";
import { DEMO_POLICY } from "../../../shared/policy.js";
import { formatDate } from "../../components/money.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { Worksheet } from "../../components/Worksheet.js";
import { ResultSummary } from "./ResultSummary.js";
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
  const [acknowledgedPreviewKey, setAcknowledgedPreviewKey] = useState<string | null>(null);
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
  const revisionMatches = Boolean(record && snapshot && snapshot.revision === record.draft.revision);
  const versionMatches = Boolean(snapshot
    && snapshot.policy.id === DEMO_POLICY.id
    && snapshot.result.policyVersion === DEMO_POLICY.id
    && snapshot.result.engineVersion === DEMO_POLICY.engineVersion);
  const isCurrent = revisionMatches && versionMatches;
  const acknowledgementKey = record && snapshot ? `${record.id}:${record.draft.revision}:${snapshot.id}` : null;
  const acknowledgementCurrent = acknowledgementKey !== null && acknowledgedPreviewKey === acknowledgementKey;
  const unresolvedAttachments = attachments.filter((item) => item.status === "pending" || item.status === "failed");
  const canSubmit = !isSubmitted && snapshot?.kind === "preview" && isCurrent && snapshot.result.outcome === "ready"
    && unresolvedAttachments.length === 0 && acknowledgementCurrent;

  const submit = async () => {
    if (!record || !snapshot || !isCurrent || snapshot.kind !== "preview" || !acknowledgementCurrent) return;
    const evidenceAcknowledgement: SubmissionAcknowledgement = {
      version: 1,
      acknowledged: true,
      revision: record.draft.revision,
      previewSnapshotId: snapshot.id,
    };
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
        let submitted: Awaited<ReturnType<typeof submitDemoCase>>;
        try {
          submitted = await submitDemoCase(record.id, evidenceAcknowledgement);
        } catch (error) {
          const latest = findDemoCase(record.id, "taxpayer");
          if (latest) {
            setRecord(latest);
            setAttachments(listDemoAttachments(record.id));
            setAcknowledgedPreviewKey(null);
            if (latest.status === "submitted" && latest.submittedSnapshotId) {
              const committedSnapshot = findDemoSnapshot(latest.submittedSnapshotId);
              if (committedSnapshot) {
                setSnapshot(committedSnapshot);
                setConfirmedSubmitted(true);
                return;
              }
            }
            const latestPreview = latestDemoPreview(record.id, latest.draft.revision);
            if (latestPreview) setSnapshot(latestPreview);
          }
          throw error;
        }
        setRecord(submitted.case);
        setSnapshot(submitted.snapshot);
        setConfirmedSubmitted(true);
      } else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        try {
          const response = await hostedApi.submit(record.id, record.draft.revision, snapshot.id, csrfToken, evidenceAcknowledgement, requestId);
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
  const missingEvidence = missingEvidenceInventory(snapshot.inputs, snapshot.evidence);
  const stale = !isCurrent && !isSubmitted;
  const staleBecauseDraftChanged = !revisionMatches;
  const outcomeText = snapshot.result.outcome === "ready" ? "คำนวณได้ตามข้อมูลและสมมติฐานที่ระบุ" : snapshot.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ" : "มีข้อมูลที่ต้องทบทวน";
  const savedAt = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt));

  return <>
    <PageHeading eyebrow="ผลการคำนวณ" title="ผลคำนวณเครดิตภาษีต่างประเทศ">
      ผลนี้แสดงตามข้อมูลและสมมติฐานที่บันทึกไว้ และไม่ใช่การวินิจฉัยสิทธิภาษี
      <span className="result-saved-note">ผลคำนวณนี้บันทึกไว้เมื่อ {savedAt} และยังไม่ได้ยื่นแบบภาษีต่อกรมสรรพากร</span>
    </PageHeading>
    {confirmedSubmitted && <div className="alert alert-success" role="status"><strong>{mode === "demo" ? "ส่งเข้าคิวสาธิตแล้ว" : "ส่งให้เจ้าหน้าที่แล้ว"}</strong><span>{mode === "demo" ? "รายการนี้อยู่ในคิวสาธิตของเบราว์เซอร์นี้เท่านั้น" : "รายการนี้ส่งให้เจ้าหน้าที่ที่ได้รับมอบหมายแล้ว"}</span></div>}
    {problem && <div className="alert alert-error" role="alert"><strong>ยังส่งแบบร่างให้เจ้าหน้าที่ไม่ได้</strong><span>{problem}</span>{mode === "hosted" && problem.includes("เซสชันหมดอายุ") && <a href="/login">เข้าสู่ระบบอีกครั้ง</a>}{submitFieldProblems.length > 0 && <div><p>รายละเอียดช่องที่ต้องตรวจ</p><ul>{submitFieldProblems.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}<button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
    {stale && <div className="alert alert-warning" role="status"><strong>{staleBecauseDraftChanged ? "ผลนี้เป็นข้อมูลก่อนการแก้ไขล่าสุด" : "ผลคำนวณนี้ใช้เงื่อนไขหรือวิธีคำนวณรุ่นก่อน"}</strong><span>{staleBecauseDraftChanged ? "มีการเปลี่ยนแปลงในร่างหลังบันทึกผลนี้ กรุณาบันทึกและคำนวณใหม่ก่อนส่งเข้าคิว" : "ระบบมีการเปลี่ยนแปลงเงื่อนไขหรือวิธีคำนวณหลังบันทึกผลนี้ กรุณาคำนวณใหม่ก่อนส่งเข้าคิว"}</span></div>}
    {snapshot.result.outcome !== "ready" && <div className={`alert ${snapshot.result.outcome === "needs_review" ? "alert-warning" : "alert-info"}`} role="status"><strong>{outcomeText}</strong><ul>{snapshot.result.validationMessages.map((message, index) => <li key={`${message.code}-${index}`}>{message.message}</li>)}</ul></div>}
    {!stale && <ResultSummary snapshot={snapshot} />}
    {!isSubmitted && snapshot.kind === "preview" && isCurrent && snapshot.result.outcome === "ready" && <section className="card submission-acknowledgement" aria-labelledby="submission-acknowledgement-heading">
      <h2 id="submission-acknowledgement-heading">ทบทวนเอกสารก่อนส่ง</h2>
      <p>รายการด้านล่างแสดงหมวดที่ยังไม่มีไฟล์พร้อมใช้งานจากข้อมูลปัจจุบัน การมีไฟล์ไม่ได้ยืนยันเนื้อหาหรือความถูกต้องของเอกสาร</p>
      <p className="field-hint">{mode === "demo" ? "เมื่อส่งแล้ว รายการจะอยู่ในคิวสาธิตของเบราว์เซอร์นี้เท่านั้น" : "เมื่อส่งแล้ว รายการจะไปยังเจ้าหน้าที่ที่ได้รับมอบหมายในบัญชีระบบที่เชื่อมต่อ"}</p>
      <div className="submission-available-inventory" aria-label="รายการไฟล์ที่บันทึกว่าพร้อมใช้งาน">
        <h3>ไฟล์ที่บันทึกว่าพร้อมใช้งาน ({snapshot.evidence.length})</h3>
        {snapshot.evidence.length === 0 ? <p className="empty-evidence">ไม่มีไฟล์แนบ (0)</p> : <ul>{snapshot.evidence.map((file) => {
          const sourceIndex = snapshot.inputs.sources.findIndex((source) => source.id === file.sourceId && source.id !== null);
          const source = sourceIndex < 0 ? null : snapshot.inputs.sources[sourceIndex]!;
          const groupLabel = file.kind === "thai_tax" && file.sourceId === null ? "ภาษีไทย"
            : source ? `แหล่งเงินได้ ${sourceIndex + 1} · ${countryLabel(source.countryCode)} · ${incomeTypeLabel(source)}` : "เอกสารอื่นของกรณี";
          return <li key={file.id}><strong>{file.displayName}</strong><small>{groupLabel} · {EVIDENCE_LABELS[file.kind]}</small></li>;
        })}</ul>}
        <p className="field-hint">ระบบจะตรวจสอบไฟล์ต้นฉบับอีกครั้งก่อนบันทึกผลส่งตรวจ</p>
      </div>
      {missingEvidence.length > 0 ? <ul className="missing-evidence-groups">{missingEvidence.map((group) => {
        const source = group.sourceIndex === null ? null : snapshot.inputs.sources[group.sourceIndex] ?? null;
        const heading = source === null ? "ภาษีไทย" : `แหล่งเงินได้ ${group.sourceIndex! + 1} · ${countryLabel(source.countryCode)} · ${incomeTypeLabel(source)}`;
        return <li key={`${group.sourceId ?? "case"}-${group.sourceIndex ?? ""}`}><strong>{heading}</strong><span>{group.missingKinds.map((kind) => EVIDENCE_LABELS[kind]).join(" · ")}</span></li>;
      })}</ul> : <p className="empty-evidence">ไม่พบหมวดที่ยังไม่มีไฟล์พร้อมใช้งานตามข้อมูลปัจจุบัน</p>}
      {unresolvedAttachments.length > 0 && <div className="alert alert-warning" role="status"><strong>ยังส่งแบบร่างให้เจ้าหน้าที่ไม่ได้</strong><p>มีไฟล์กำลังอัปโหลดหรืออัปโหลดไม่สำเร็จ</p><ul>{unresolvedAttachments.map((file) => <li key={file.id}>{file.displayName} · {file.status === "pending" ? "กำลังตรวจสอบ" : "อัปโหลดไม่สำเร็จ"}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปตรวจสอบไฟล์</button></div>}
      <label className="submission-acknowledgement-choice"><input type="checkbox" checked={acknowledgementCurrent} disabled={unresolvedAttachments.length > 0} onChange={(event) => setAcknowledgedPreviewKey(event.target.checked ? acknowledgementKey : null)} />{AVAILABLE_EVIDENCE_STATEMENT_V1}</label>
    </section>}
    <details className="result-worksheet-details">
      <summary>ดูตารางรายละเอียดทั้งหมด</summary>
      <Worksheet snapshot={snapshot} attachments={attachments} evidenceMode={mode} />
    </details>
    <div className="result-actions">
      <a className="button button-secondary" href={reportHref}>ดูรายงาน</a>
      {!isSubmitted && <><button className="button button-quiet" onClick={calculateCurrent}>แก้ไขข้อมูล</button><button className="button button-primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "กำลังตรวจสอบสถานะ…" : "ส่งให้เจ้าหน้าที่ตรวจ"}</button></>}
      {isSubmitted && <div className="alert alert-success"><strong>ส่งแล้วเมื่อ {formatDate(record.submittedAt)}</strong><span>แสดงผลที่ส่งแล้วแบบอ่านอย่างเดียว</span></div>}
    </div>
    {submitProblems.length > 0 && <div className="alert alert-warning" role="alert"><strong>ยังส่งแบบร่างให้เจ้าหน้าที่ไม่ได้</strong><ul>{submitProblems.map((message, index) => <li key={index}>{message}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
  </>;
}
