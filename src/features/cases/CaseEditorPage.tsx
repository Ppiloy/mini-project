import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, EvidenceKind, FtcCaseDraft, FtcCaseRecord, FrozenEvidenceReference } from "../../../shared/contracts.js";
import { isSourceEligibilityConfirmationCurrent, isThaiTaxConfirmationCurrent, sourceEligibilityFingerprint, stripStaleConfirmations, taxInputFingerprint } from "../../../shared/confirmations.js";
import { draftSchema } from "../../../shared/draft.js";
import { DEMO_POLICY } from "../../../shared/policy.js";
import { createCalculationSnapshot } from "../../../shared/snapshot.js";
import { ApiClientError, hostedApi } from "../../data/api.js";
import { addDemoAttachment, deleteDemoAttachment, findDemoCase, listDemoAttachments, saveDemoDraft, saveDemoSnapshot } from "../../data/demoRepository.js";
import { hostedPendingDraftKey, useAppSession } from "../../app/App.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { StepFive, StepFour, StepOne, StepThree, StepTwo } from "./FormSteps.js";

type Mode = "demo" | "hosted";
const stepLabels = ["ปีภาษี", "เงินได้", "นำเข้าและภาษี", "ภาษีไทย", "หลักฐานและทบทวน"];

export function CaseEditorPage({ mode }: { mode: Mode }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { csrfToken } = useAppSession();
  const [record, setRecord] = useState<FtcCaseRecord | null>(null);
  const [draft, setDraft] = useState<FtcCaseDraft | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ path?: Array<string | number>; message: string }>>([]);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [conflictLatest, setConflictLatest] = useState<FtcCaseRecord | null>(null);
  const [failedUpload, setFailedUpload] = useState<{ sourceId: string | null; sourceIndex?: number; kind: EvidenceKind; file: File } | null>(null);
  const saveRequest = useRef<{ caseId: string; revision: number; contentKey: string; requestId: string } | null>(null);

  const isDirty = draft !== null && JSON.stringify(draft) !== savedJson;
  const loadCase = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      let loaded: FtcCaseRecord;
      let files: AttachmentMetadata[] = [];
      if (mode === "demo") {
        const fixture = findDemoCase(id, "taxpayer");
        if (!fixture) throw new Error("ไม่พบกรณีในพื้นที่สาธิตนี้");
        loaded = fixture;
        files = listDemoAttachments(id);
      } else {
        const response = await hostedApi.getCase(id);
        loaded = response.case;
        files = response.attachments ?? [];
        if (loaded.status === "submitted") throw new Error("กรณีที่ส่งแล้วเปิดดูได้ในหน้าแสดงผลแบบอ่านอย่างเดียว");
      }
      setRecord(loaded);
      let visibleDraft = structuredClone(loaded.draft);
      if (mode === "hosted") {
        const pendingKey = hostedPendingDraftKey(loaded.ownerId, loaded.id);
        const rawPending = sessionStorage.getItem(pendingKey);
        if (rawPending) {
          try {
            const pending = JSON.parse(rawPending) as { ownerId?: string; caseId?: string; draft?: FtcCaseDraft };
            if (pending.ownerId === loaded.ownerId && pending.caseId === loaded.id && pending.draft?.id === loaded.id) {
              visibleDraft = pending.draft;
              setSavedMessage("เรียกคืนข้อความที่ยังไม่ได้บันทึกจากเซสชันเดิมแล้ว ตรวจทานและบันทึกอีกครั้ง");
            } else sessionStorage.removeItem(pendingKey);
          } catch { sessionStorage.removeItem(pendingKey); }
        }
      }
      setDraft(visibleDraft);
      setSavedJson(JSON.stringify(loaded.draft));
      setAttachments(files);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "โหลดร่างไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [id, mode]);

  useEffect(() => { void loadCase(); }, [loadCase]);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const catchLink = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (window.confirm("มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", catchLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", catchLink, true);
    };
  }, [isDirty]);

  const updateDraft = (next: FtcCaseDraft) => {
    const current = stripStaleConfirmations(next);
    setDraft(current);
    setSavedMessage(null);
    setProblem(null);
    setFieldErrors([]);
  };

  const saveDraft = async (confirmation = true): Promise<FtcCaseRecord | null> => {
    if (!record || !draft) return null;
    setSaving(true);
    setProblem(null);
    setFieldErrors([]);
    setSavedMessage(null);
    const parsed = draftSchema.safeParse({ ...draft, id: record.id, revision: record.draft.revision });
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"), message: "ตรวจสอบรูปแบบข้อมูลในช่องนี้" }));
      setFieldErrors(issues);
      setProblem("บันทึกร่างไม่ได้ กรุณาตรวจสอบรูปแบบของข้อมูลที่กรอก ระบบยังคงเก็บข้อความไว้ในช่อง");
      setSaving(false);
      return null;
    }
    const clean = stripStaleConfirmations(parsed.data);
    const eligibleSourceIds = clean.sources.filter((source) => source.id !== null && isSourceEligibilityConfirmationCurrent(source)).map((source) => source.id!);
    const eligibleSourceIndexes = clean.sources.flatMap((source, index) => source.id === null && isSourceEligibilityConfirmationCurrent(source) ? [index] : []);
    const confirmations = confirmation ? {
      thaiTax: isThaiTaxConfirmationCurrent(clean),
      eligibleSourceIds,
      eligibleSourceIndexes,
    } : undefined;
    const contentKey = JSON.stringify({ data: clean, confirmations });
    if (!saveRequest.current || saveRequest.current.caseId !== record.id || saveRequest.current.revision !== record.draft.revision || saveRequest.current.contentKey !== contentKey) {
      saveRequest.current = { caseId: record.id, revision: record.draft.revision, contentKey, requestId: crypto.randomUUID() };
    }
    const requestId = saveRequest.current.requestId;
    try {
      let saved: FtcCaseRecord;
      if (mode === "demo") {
        saved = saveDemoDraft(record.id, clean);
      } else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง ระบบจะคงข้อความที่กรอกไว้ในหน้านี้");
        saved = (await hostedApi.saveDraft(record.id, { expectedRevision: record.draft.revision, requestId, data: clean, confirmations }, csrfToken)).case;
      }
      setRecord(saved);
      setDraft(structuredClone(saved.draft));
      setSavedJson(JSON.stringify(saved.draft));
      setSavedMessage(`บันทึกแล้ว · รุ่นข้อมูล ${saved.draft.revision}`);
      setConflictLatest(null);
      saveRequest.current = null;
      if (mode === "hosted") sessionStorage.removeItem(hostedPendingDraftKey(saved.ownerId, saved.id));
      return saved;
    } catch (error) {
      if (mode === "hosted" && error instanceof ApiClientError && error.status === 401) {
        sessionStorage.setItem(hostedPendingDraftKey(record.ownerId, record.id), JSON.stringify({ ownerId: record.ownerId, caseId: record.id, draft }));
        setProblem("เซสชันหมดอายุ ข้อมูลที่กรอกถูกเก็บไว้ชั่วคราวในแท็บนี้และจะเรียกคืนเมื่อบัญชีเดิมเข้าสู่ระบบอีกครั้ง");
        return null;
      }
      if (mode === "hosted" && error instanceof ApiClientError && error.status === 409) {
        try {
          const latest = (await hostedApi.getCase(record.id)).case;
          setConflictLatest(latest);
          setProblem("ร่างถูกบันทึกจากอีกหน้าต่างแล้ว เลือกโหลดฉบับล่าสุดหรือยืนยันนำการแก้ไขปัจจุบันไปใช้ต่อ");
        } catch { setProblem("ข้อมูลขัดแย้งกับรุ่นล่าสุด และโหลดฉบับล่าสุดไม่ได้ กรุณาลองใหม่เมื่อเชื่อมต่อได้"); }
        return null;
      }
      if (mode === "hosted" && error instanceof ApiClientError && error.fields?.length) {
        setFieldErrors(error.fields.map((item) => ({ path: item.path, message: item.message })));
      }
      setProblem(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    const saved = await saveDraft();
    if (saved) setStep((current) => Math.min(current + 1, 4));
  };

  const toggleThaiConfirmation = (checked: boolean) => {
    if (!draft) return;
    const thaiTax = checked
      ? { ...draft.thaiTax, confirmedAt: new Date().toISOString(), confirmedInputFingerprint: taxInputFingerprint(draft) }
      : { ...draft.thaiTax, confirmedAt: null, confirmedInputFingerprint: null };
    setDraft({ ...draft, thaiTax });
    setSavedMessage(null);
  };

  const toggleEligibilityConfirmation = (index: number, checked: boolean) => {
    if (!draft) return;
    const sources = draft.sources.map((source, currentIndex) => {
      if (currentIndex !== index) return source;
      return checked
        ? { ...source, eligibilityConfirmedAt: new Date().toISOString(), eligibilityConfirmedInputFingerprint: sourceEligibilityFingerprint(source) }
        : { ...source, eligibilityConfirmedAt: null, eligibilityConfirmedInputFingerprint: null };
    });
    setDraft({ ...draft, sources });
    setSavedMessage(null);
  };

  const upload = async (sourceId: string | null, kind: EvidenceKind, file: File, sourceIndex?: number) => {
    if (!record) return;
    const typeOk = ["application/pdf", "image/jpeg", "image/png"].includes(file.type);
    if (!typeOk || file.size <= 0) { setProblem("รองรับเฉพาะไฟล์ PDF, JPEG หรือ PNG ที่ไม่ว่าง"); return; }
    if (file.size > 3 * 1024 * 1024) { setProblem("ไฟล์ต้องมีขนาดไม่เกิน 3 MiB"); return; }
    const currentFiles = attachments;
    if (sourceIndex === undefined || sourceId !== null) {
      const sameSource = currentFiles.filter((item) => item.sourceId === sourceId && item.status !== "deleted");
      if (sameSource.length >= 5) { setProblem("แนบไฟล์ต่อรายการได้ไม่เกิน 5 ไฟล์"); return; }
    }
    if (currentFiles.length >= 20 || currentFiles.reduce((sum, item) => sum + item.byteSize, 0) + file.size > 30 * 1024 * 1024) {
      setProblem("ไฟล์เกินโควตาของกรณี: สูงสุด 20 ไฟล์และรวม 30 MiB"); return;
    }
    setUploading(true);
    setProblem(null);
    let resolvedSourceId = sourceId;
    try {
      const saved = await saveDraft();
      if (!saved) return;
      // The API assigns source IDs while saving. Resolve a new row from the acknowledged draft
      // so its attachment is linked to the actual source instead of becoming case-level evidence.
      resolvedSourceId = sourceIndex === undefined ? sourceId : saved.draft.sources[sourceIndex]?.id ?? null;
      const savedFiles = mode === "demo" ? listDemoAttachments(saved.id) : (await hostedApi.getCase(saved.id)).attachments ?? [];
      const savedSameSource = savedFiles.filter((item) => item.sourceId === resolvedSourceId && item.status !== "deleted");
      if (savedSameSource.length >= 5) { setProblem("แนบไฟล์ต่อรายการได้ไม่เกิน 5 ไฟล์"); return; }
      let attachment: AttachmentMetadata;
      if (mode === "demo") attachment = addDemoAttachment(saved.id, resolvedSourceId, kind, file);
      else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        attachment = (await hostedApi.uploadEvidence(saved.id, file, { sourceId: resolvedSourceId, kind }, csrfToken)).attachment;
      }
      if (mode === "demo") {
        setAttachments((all) => [attachment, ...all]);
        const latest = findDemoCase(saved.id, "taxpayer");
        if (latest) { setRecord(latest); setDraft(structuredClone(latest.draft)); setSavedJson(JSON.stringify(latest.draft)); }
      } else {
        const detail = await hostedApi.getCase(saved.id);
        setAttachments(detail.attachments ?? [attachment]);
        setRecord(detail.case); setDraft(structuredClone(detail.case.draft)); setSavedJson(JSON.stringify(detail.case.draft));
      }
      setFailedUpload(null);
      setSavedMessage("แนบรายการไฟล์แล้ว");
    } catch (error) {
      if (mode === "hosted") {
        try {
          const detail = await hostedApi.getCase(record.id);
          const possiblySaved = (detail.attachments ?? []).filter((item) => item.sourceId === resolvedSourceId && item.kind === kind && item.displayName === file.name);
          if (possiblySaved.length > 0) {
            setAttachments(detail.attachments ?? []);
            setRecord(detail.case); setDraft(structuredClone(detail.case.draft)); setSavedJson(JSON.stringify(detail.case.draft));
            setFailedUpload(null);
            setSavedMessage(possiblySaved[0]?.status === "ready" ? "ตรวจพบไฟล์ที่บันทึกแล้วหลังการตอบกลับขัดข้อง" : "ตรวจพบรายการไฟล์ในระบบ กำลังแสดงสถานะล่าสุด");
            setProblem(null);
            return;
          }
        } catch { /* Keep the original failure and offer a deliberate retry. */ }
      }
      setFailedUpload({ sourceId, sourceIndex, kind, file });
      setProblem(error instanceof Error ? error.message : "แนบไฟล์ไม่สำเร็จ กรุณาลองใหม่");
    } finally { setUploading(false); }
  };

  const deleteAttachment = async (attachmentId: string) => {
    try {
      const saved = await saveDraft();
      if (!saved) return;
      if (mode === "demo") deleteDemoAttachment(attachmentId);
      else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        await hostedApi.removeEvidence(attachmentId, saved.draft.revision, csrfToken);
      }
      if (mode === "demo") {
        setAttachments((all) => all.filter((item) => item.id !== attachmentId));
        const latest = findDemoCase(saved.id, "taxpayer");
        if (latest) { setRecord(latest); setDraft(structuredClone(latest.draft)); setSavedJson(JSON.stringify(latest.draft)); }
      } else {
        const detail = await hostedApi.getCase(saved.id);
        setAttachments(detail.attachments ?? []);
        setRecord(detail.case); setDraft(structuredClone(detail.case.draft)); setSavedJson(JSON.stringify(detail.case.draft));
      }
      setSavedMessage("ลบรายการไฟล์แล้ว");
    } catch (error) { setProblem(error instanceof Error ? error.message : "ลบไฟล์ไม่สำเร็จ"); }
  };

  const downloadAttachment = async (attachment: AttachmentMetadata) => {
    try {
      let blob: Blob;
      let filename = attachment.displayName;
      if (mode === "demo") {
        blob = new Blob([`ไฟล์นี้เป็นรายการจำลองในระบบต้นแบบเพื่อการศึกษา\nชื่อไฟล์ต้นฉบับ: ${attachment.displayName}\nไม่มีการเก็บหรือส่งต่อเนื้อหาไฟล์จริงในโหมดสาธิต`], { type: "text/plain;charset=utf-8" });
        filename = `${attachment.displayName}.demo.txt`;
      } else blob = await hostedApi.downloadEvidence(attachment.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setProblem(error instanceof Error ? error.message : "ดาวน์โหลดไฟล์ไม่สำเร็จ"); }
  };

  const reloadLatest = async (reapply: boolean) => {
    if (!conflictLatest) return;
    const detail = mode === "hosted" ? await hostedApi.getCase(conflictLatest.id) : null;
    const latest = detail?.case ?? conflictLatest;
    setRecord(latest);
    setAttachments(detail?.attachments ?? attachments);
    if (reapply) {
      setSavedJson(JSON.stringify(latest.draft));
      setProblem("เก็บข้อความที่แก้ไขไว้เหนือฉบับล่าสุดแล้ว ตรวจทานและกดบันทึกร่างเพื่อยืนยัน");
    } else {
      setDraft(structuredClone(latest.draft));
      setSavedJson(JSON.stringify(latest.draft));
      setProblem(null);
      setSavedMessage("โหลดฉบับล่าสุดแล้ว");
    }
    setConflictLatest(null);
  };

  const calculate = async () => {
    if (!draft || !record) return;
    const saved = await saveDraft();
    if (!saved) return;
    try {
      let snapshot: CalculationSnapshot;
      if (mode === "demo") {
        const evidence: FrozenEvidenceReference[] = listDemoAttachments(record.id).filter((item) => item.status === "ready").map(({ id: evidenceId, sourceId: evidenceSourceId, kind: evidenceKind, displayName, mediaType, byteSize, sha256 }) => ({ id: evidenceId, sourceId: evidenceSourceId, kind: evidenceKind, displayName, mediaType, byteSize, sha256 }));
        snapshot = createCalculationSnapshot({ id: `demo-snapshot-${crypto.randomUUID()}`, caseId: record.id, revision: saved.draft.revision, kind: "preview", inputs: saved.draft, evidence, createdAt: new Date().toISOString(), policy: DEMO_POLICY });
        saveDemoSnapshot(snapshot);
      } else {
        if (!csrfToken) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        snapshot = (await hostedApi.calculate(record.id, saved.draft.revision, csrfToken)).snapshot;
      }
      navigate(`${mode === "demo" ? "/demo" : ""}/cases/${encodeURIComponent(record.id)}/result?preview=${encodeURIComponent(snapshot.id)}`);
    } catch (error) { setProblem(error instanceof Error ? error.message : "คำนวณตัวอย่างไม่สำเร็จ"); }
  };

  if (loading) return <div className="loading-card" role="status">กำลังโหลดร่าง…</div>;
  if (!record || !draft) return <section className="card error-page"><h1>เปิดร่างไม่ได้</h1><div className="alert alert-error" role="alert">{problem ?? "ไม่พบกรณีนี้"}</div><a className="button button-secondary" href={mode === "demo" ? "/demo/app" : "/app"}>กลับรายการกรณี</a></section>;
  if (record.status !== "draft") return <div className="card"><p>กรณีนี้ส่งแล้วและเปิดได้แบบอ่านอย่างเดียว</p><a href={`${mode === "demo" ? "/demo" : ""}/cases/${record.id}/result`}>ดูผลที่บันทึก</a></div>;

  const stepProps = { draft, onChange: updateDraft, attachments, onUpload: upload, onDeleteAttachment: deleteAttachment, onDownloadAttachment: downloadAttachment, busy: uploading };
  const taxCurrent = isThaiTaxConfirmationCurrent(draft);
  const stepContent = [
    <StepOne key="one" {...stepProps} />,
    <StepTwo key="two" {...stepProps} />,
    <StepThree key="three" {...stepProps} />,
    <StepFour key="four" {...stepProps} />,
    <StepFive key="five" {...stepProps} />,
  ][step];

  return <>
    <PageHeading eyebrow={`FTC CASE · ${record.id.slice(-8).toUpperCase()}`} title="กรอกข้อมูลกรณีเครดิตภาษี">
      บันทึกแต่ละขั้นได้ ร่างที่ข้อมูลยังไม่ครบหรืออยู่นอกขอบเขตก็เก็บไว้แก้ไขได้
    </PageHeading>
    <nav className="stepper" aria-label="ขั้นตอนแบบฟอร์ม">
      {stepLabels.map((label, index) => <div key={label} className={`stepper-item ${step === index ? "is-current" : step > index ? "is-done" : ""}`} aria-current={step === index ? "step" : undefined}><span className="step-number">{step > index ? "✓" : index + 1}</span><span>{label}</span></div>)}
    </nav>
    {problem && <div className="alert alert-error" role="alert"><span>{problem}</span>{problem.includes("เซสชันหมดอายุ") && mode === "hosted" && <a href={`/login?returnTo=${encodeURIComponent(`/app/cases/${record.id}/edit`)}`}>เข้าสู่ระบบอีกครั้งในบัญชีเดิม</a>}{failedUpload && <button className="button button-secondary button-small" onClick={() => void upload(failedUpload.sourceId, failedUpload.kind, failedUpload.file, failedUpload.sourceIndex)}>ลองแนบไฟล์เดิมอีกครั้ง</button>}{fieldErrors.length > 0 && <ul>{fieldErrors.map((item, index) => <li key={index}><a href="#step-title">{item.message}{item.path?.length ? ` · ${item.path.join(" › ")}` : ""}</a></li>)}</ul>}</div>}
    {conflictLatest && <div className="conflict-panel"><strong>ไม่บันทึกทับข้อมูลล่าสุดโดยอัตโนมัติ</strong><p>ฉบับบนเซิร์ฟเวอร์เป็นรุ่น {conflictLatest.draft.revision}; ข้อความที่คุณกำลังแก้ยังอยู่ในหน้านี้.</p><div><button className="button button-secondary button-small" onClick={() => void reloadLatest(false)}>โหลดฉบับล่าสุดและละทิ้งการแก้ไข</button><button className="button button-primary button-small" onClick={() => void reloadLatest(true)}>นำการแก้ไขปัจจุบันไปใช้ต่อ</button></div></div>}
    {savedMessage && <div className="alert alert-success" role="status">{savedMessage}</div>}
    <div className="form-workspace card">{stepContent}
      {step === 4 && <div className="confirmation-controls">
        <label className="confirm-card"><input type="checkbox" checked={taxCurrent} onChange={(event) => toggleThaiConfirmation(event.target.checked)} /><span><strong>ยืนยันจำนวนและที่มาของภาษีไทย L</strong><small>ผูกกับรายได้ แหล่งเงินได้ และอัตราแลกเปลี่ยนปัจจุบัน</small></span></label>
        {draft.sources.map((source, index) => <label className="confirm-card" key={source.id ?? `confirm-${index}`}><input type="checkbox" checked={isSourceEligibilityConfirmationCurrent(source)} onChange={(event) => toggleEligibilityConfirmation(index, event.target.checked)} /><span><strong>ยืนยัน E และเหตุผล · แหล่งเงินได้ {index + 1}</strong><small>{source.eligibilityRationale || "กรุณากรอกเหตุผลในขั้นการนำเงินเข้าและภาษี"}</small></span></label>)}
      </div>}
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || saving || uploading}>ย้อนกลับ</button>
        <div className="form-actions-right">
          <span className="save-status" aria-live="polite">{saving ? "กำลังบันทึก…" : savedMessage ?? (isDirty ? "มีการแก้ไขที่ยังไม่บันทึก" : `บันทึกล่าสุด · รุ่น ${record.draft.revision}`)}</span>
          <button type="button" className="button button-secondary" onClick={() => void saveDraft()} disabled={saving || uploading}>{saving ? "กำลังบันทึก…" : "บันทึกร่าง"}</button>
          {step < 4 ? <button type="button" className="button button-primary" onClick={() => void goNext()} disabled={saving || uploading}>บันทึกและถัดไป <span aria-hidden="true">→</span></button> : <button type="button" className="button button-primary" onClick={() => void calculate()} disabled={saving || uploading}>บันทึกและคำนวณตัวอย่าง</button>}
        </div>
      </div>
    </div>
    <div className="sticky-save mobile-only" aria-label="การบันทึก"><span>{saving ? "กำลังบันทึก…" : isDirty ? "มีการแก้ไขที่ยังไม่บันทึก" : "บันทึกแล้ว"}</span><button className="button button-primary button-small" onClick={() => step < 4 ? void goNext() : void calculate()} disabled={saving || uploading}>{step < 4 ? "ถัดไป" : "คำนวณ"}</button></div>
  </>;
}
