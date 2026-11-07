import { useState } from "react";
import type { CalculationSnapshot } from "../../../shared/contracts.js";
import { createSnapshotWorkbook, snapshotWorkbookFilename } from "./snapshotWorkbook.js";

export function ExcelExportButton({ snapshot }: { snapshot: CalculationSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const exportWorkbook = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const blob = await createSnapshotWorkbook(snapshot);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = snapshotWorkbookFilename(snapshot);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setProblem("ส่งออกไฟล์ Excel ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button className="button button-secondary" disabled={busy} onClick={() => void exportWorkbook()}>{busy ? "กำลังจัดทำไฟล์…" : "ส่งออก Excel"}</button>
    {problem && <span className="alert alert-error" role="alert">{problem}</span>}
  </>;
}
