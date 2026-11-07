import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "../../shared/contracts.js";
import { getDemoAttachmentFile } from "../data/demoRepository.js";
import { ApiClientError, hostedApi } from "../data/api.js";

type Mode = "demo" | "hosted";
type Availability = "checking" | "available" | "unavailable";

export function EvidenceFileActions({
  file,
  mode,
  onDelete,
  busy = false,
}: {
  file: AttachmentMetadata;
  mode: Mode;
  onDelete?: (id: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [availability, setAvailability] = useState<Availability>(mode === "demo" ? "checking" : "available");
  const [problem, setProblem] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    setProblem(null);
    if (file.status !== "ready") {
      setAvailability("unavailable");
    } else if (mode === "hosted") {
      setAvailability("available");
    } else {
      setAvailability("checking");
      void getDemoAttachmentFile(file.id).then((blob) => {
        if (active) setAvailability(blob ? "available" : "unavailable");
      }).catch(() => {
        if (active) setAvailability("unavailable");
      });
    }
    return () => { active = false; };
  }, [file.id, file.status, mode]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewUrl && !dialog.open) dialog.showModal();
    else if (!previewUrl && dialog.open) dialog.close();
  }, [previewUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const readFile = async (): Promise<Blob | null> => {
    if (mode === "demo") return getDemoAttachmentFile(file.id);
    return hostedApi.downloadEvidence(file.id);
  };

  const unavailable = () => {
    setAvailability("unavailable");
    setProblem("ไฟล์ต้นฉบับไม่พร้อมใช้งานในอุปกรณ์นี้");
  };

  const loadFile = async (): Promise<Blob | null> => {
    try {
      const blob = await readFile();
      if (!blob) {
        unavailable();
        return null;
      }
      setAvailability("available");
      setProblem(null);
      return blob.type === file.mediaType ? blob : blob.slice(0, blob.size, file.mediaType);
    } catch (error) {
      if (mode === "hosted" && error instanceof ApiClientError && error.status === 404) unavailable();
      else setProblem("เปิดไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง");
      return null;
    }
  };

  const download = async () => {
    const blob = await loadFile();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.displayName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const preview = async () => {
    const isPdf = file.mediaType.toLowerCase() === "application/pdf";
    const isImage = file.mediaType.toLowerCase() === "image/jpeg" || file.mediaType.toLowerCase() === "image/png";
    if (!isPdf && !isImage) {
      setProblem("ยังไม่รองรับการแสดงตัวอย่างไฟล์ชนิดนี้");
      return;
    }
    const blob = await loadFile();
    if (!blob) return;
    setPreviewIsPdf(isPdf);
    setPreviewUrl(URL.createObjectURL(blob));
  };

  const closePreview = () => setPreviewUrl(null);
  const actionsDisabled = busy || availability !== "available";

  return <>
    <button className="button button-quiet button-small" disabled={actionsDisabled} onClick={() => void preview()}>ดูตัวอย่าง</button>
    <button className="button button-quiet button-small" disabled={actionsDisabled} onClick={() => void download()}>ดาวน์โหลด</button>
    {onDelete && <button className="button button-danger-quiet button-small" disabled={busy} onClick={() => void onDelete(file.id)}>ลบ</button>}
    {availability === "unavailable" && <small className="field-hint" role="status">ไฟล์ต้นฉบับไม่พร้อมใช้งาน</small>}
    {problem && <small className="field-hint" role="alert">{problem}</small>}
    <dialog className="evidence-preview-dialog" ref={dialogRef} aria-labelledby={`evidence-preview-title-${file.id}`} onCancel={(event) => { event.preventDefault(); closePreview(); }} onClose={() => setPreviewUrl(null)}>
      <div className="evidence-preview-content">
        <h2 id={`evidence-preview-title-${file.id}`}>ตัวอย่าง: {file.displayName}</h2>
        {previewUrl && (previewIsPdf
          ? <iframe title={`ตัวอย่างไฟล์: ${file.displayName}`} src={previewUrl} style={{ width: "min(86vw, 920px)", height: "72vh", border: 0 }} />
          : <img alt={`ตัวอย่างไฟล์: ${file.displayName}`} src={previewUrl} style={{ display: "block", maxWidth: "86vw", maxHeight: "72vh", objectFit: "contain" }} />)}
        <button className="button button-secondary" onClick={closePreview}>ปิดตัวอย่าง</button>
      </div>
    </dialog>
  </>;
}
