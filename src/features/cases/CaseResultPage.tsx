import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AttachmentMetadata, CalculationSnapshot, FtcCaseRecord } from "../../../shared/contracts.js";
import { validateSubmission } from "../../../shared/calculator.js";
import { formatDate, formatMoney } from "../../components/money.js";
import { PageHeading } from "../../components/SiteFrame.js";
import { ApiClientError, apiFailureContext, apiFailureMessage, hostedApi } from "../../data/api.js";
import { findDemoCase, findDemoSnapshot, listDemoAttachments, latestDemoPreview, saveDemoSnapshot, submitDemoCase } from "../../data/demoRepository.js";
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
          if (!savedSnapshot) throw new Error("ยังไม่มีตัวอย่างคำนวณที่บันทึกไว้ กรุณาคำนวณจากแบบฟอร์มก่อน");
          if (active) { setRecord(loaded); setSnapshot(savedSnapshot); setAttachments(listDemoAttachments(id)); }
        } else {
          const detail = await hostedApi.getCase(id);
          const loaded = detail.case;
          const targetId = requestedSnapshotId ?? loaded.submittedSnapshotId;
          if (!targetId) throw new Error("ยังไม่มีตัวอย่างคำนวณที่บันทึกไว้ กรุณาบันทึกร่างและคำนวณก่อน");
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
        const frozenSnapshot = saveDemoSnapshot({ ...snapshot, id: `demo-submitted-${crypto.randomUUID()}`, kind: "submitted", createdAt: new Date().toISOString() });
        const submitted = submitDemoCase(record.id, frozenSnapshot);
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
              setProblem(`ข้อมูลร่างเปลี่ยนเป็นรุ่น ${latest.draft.revision} แล้ว ผลคำนวณรุ่น ${snapshot.revision} เก่าอยู่ กรุณาบันทึกและคำนวณใหม่ก่อนส่ง${apiFailureContext(error)}`);
            } else throw error;
          }
        }
      }
    } catch (error) {
      setProblem(apiFailureMessage(error, "ส่งเข้าคิวไม่สำเร็จ ตรวจสอบสถานะกรณีก่อนลองซ้ำ"));
      if (error instanceof ApiClientError && error.fields?.length) {
        setSubmitFieldProblems(error.fields.map((item) => `${item.message}${item.path?.length ? ` · ${item.path.join(" › ")}` : ""}`));
      }
    } finally { setBusy(false); }
  };

  if (loading) return <div className="loading-card" role="status">กำลังโหลดผลคำนวณที่บันทึกไว้…</div>;
  if (problem && (!record || !snapshot)) return <section className="card"><h1>แสดงผลคำนวณไม่ได้</h1><div className="alert alert-error" role="alert">{problem}</div><a className="button button-secondary" href={mode === "demo" ? "/demo/app" : "/app"}>กลับรายการกรณี</a></section>;
  if (!record || !snapshot) return null;

  const reportRoot = mode === "demo" ? "/demo" : "";
  const reportHref = `${reportRoot}/reports/${encodeURIComponent(snapshot.id)}`;
  const stale = !isCurrent && !isSubmitted;
  const outcomeText = snapshot.result.outcome === "ready" ? "คำนวณได้ภายใต้สมมติฐานที่ระบุ" : snapshot.result.outcome === "incomplete" ? "ข้อมูลยังไม่ครบสำหรับคำนวณ" : "มีข้อเท็จจริงที่อยู่นอกขอบเขตตัวอย่าง";
  const sourceRows = snapshot.result.lines.filter((line) => line.sourceId !== null);

  return <>
    <PageHeading eyebrow={`CALCULATION · ${snapshot.policy.id}`} title="ผลคำนวณเครดิตภาษีต่างประเทศ">
      ผลนี้ใช้ได้เฉพาะข้อมูลและสมมติฐานที่แสดงด้านล่าง และไม่ใช่การวินิจฉัยสิทธิภาษี
    </PageHeading>
    {confirmedSubmitted && <div className="alert alert-success" role="status"><strong>ส่งเข้าคิวจำลองแล้ว</strong><span>ระบบต้นแบบบันทึกผลสำเร็จและไม่สร้างรายการซ้ำเมื่อยืนยันสถานะ</span></div>}
    {problem && <div className="alert alert-error" role="alert">{problem}{mode === "hosted" && problem.includes("เซสชันหมดอายุ") && <a href="/login">เข้าสู่ระบบอีกครั้ง</a>}</div>}
    {stale && <div className="alert alert-warning" role="status"><strong>ผลนี้เป็นข้อมูลของรุ่นก่อนหน้า</strong><span>ร่างปัจจุบันเป็นรุ่น {record.draft.revision} แต่ผลคำนวณเป็นรุ่น {snapshot.revision} กรุณาบันทึกและคำนวณใหม่ก่อนส่งเข้าคิว</span></div>}
    {snapshot.result.outcome !== "ready" && <div className={`alert ${snapshot.result.outcome === "needs_review" ? "alert-warning" : "alert-info"}`} role="status"><strong>{outcomeText}</strong><ul>{snapshot.result.validationMessages.map((message, index) => <li key={`${message.code}-${index}`}>{message.message}</li>)}</ul></div>}
    {snapshot.result.outcome === "ready" && <div className="result-total card"><div><p className="eyebrow">ALLOWABLE FOREIGN TAX CREDIT</p><h2>เครดิตที่ใช้ได้ตามสมมติฐาน</h2><p>ผลรวมเครดิตรายประเทศหลังปัดเศษตามนโยบาย {snapshot.result.roundingPolicy}</p></div><strong className="total-amount">{formatMoney(snapshot.result.allowableCredit)} <small>บาท</small></strong></div>}
    <div className="result-facts">
      <div className="fact-card"><span>I · เงินได้ต่างประเทศที่นำเข้า</span><strong>{formatMoney(snapshot.result.totalRemittedIncome)} บาท</strong></div>
      <div className="fact-card"><span>K · เงินได้พึงประเมินรวม</span><strong>{formatMoney(snapshot.result.totalAssessableIncome)} บาท</strong></div>
      <div className="fact-card"><span>L · ภาษีไทยก่อน FTC</span><strong>{formatMoney(snapshot.result.thaiTaxBeforeFtc)} บาท</strong></div>
      <div className="fact-card"><span>สถานะผลคำนวณ</span><strong className={`status-badge ${snapshot.result.outcome === "ready" ? "status-ready" : "status-draft"}`}>{outcomeText}</strong></div>
    </div>
    <section className="content-section card breakdown-section">
      <div className="section-heading"><div><p className="eyebrow">COUNTRY BREAKDOWN</p><h2>สรุปตามประเทศ</h2></div><span className="policy-pill">{snapshot.result.policyVersion}</span></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>ประเทศ</th><th>เงินได้ที่นำเข้า N</th><th>ภาษีที่จัดสรร O</th><th>เพดานภาษีไทย P</th><th>เครดิต Q</th></tr></thead><tbody>{snapshot.result.countries.map((country) => <tr key={country.countryCode}><th scope="row">{country.countryName}</th><td>{formatMoney(country.remittedIncome)}</td><td>{formatMoney(country.attributableForeignTax)}</td><td>{formatMoney(country.thaiTaxLimit)}</td><td><strong>{formatMoney(country.displayedAllowableCredit)}</strong></td></tr>)}{snapshot.result.countries.length === 0 && <tr><td colSpan={5} className="empty-cell">ยังไม่มีผลรายประเทศที่คำนวณได้</td></tr>}</tbody></table></div>
      <p className="table-note">คำนวณเพดานและเครดิตแยกตามประเทศ ไม่มีการนำภาษีส่วนเกินของประเทศหนึ่งไปเพิ่มเครดิตของอีกประเทศ</p>
    </section>
    <section className="content-section card breakdown-section">
      <div className="section-heading"><div><p className="eyebrow">SOURCE DETAIL</p><h2>รายละเอียดแหล่งเงินได้และขั้นคำนวณ</h2></div></div>
      <div className="source-result-list">{snapshot.inputs.sources.map((source, index) => <article className="result-source" key={source.id ?? `source-${index}`}>
        <div className="result-source-title"><div><h3>{source.countryName ?? "ยังไม่เลือกประเทศ"} · {source.incomeType ?? "ไม่ระบุประเภท"}</h3><p>{source.subtype ?? "—"} · วันที่เกิดเงินได้ {formatDate(source.earnedDate)} · วันที่นำเข้า {formatDate(source.remittance?.remittanceDate)}</p></div><span className="status-badge status-ready">แหล่งที่มาคงเดิม</span></div>
        <dl className="amount-grid"><div><dt>D · เงินได้ต้นทาง</dt><dd>{formatMoney(source.grossIncomeAmount)} {source.currencyCode ?? ""}</dd></div><div><dt>ภาษีต่างประเทศจ่ายจริง</dt><dd>{formatMoney(source.actualForeignTaxPaid)} {source.currencyCode ?? ""}</dd></div><div><dt>E · ภาษีที่สมมติว่าเข้าเกณฑ์</dt><dd>{formatMoney(source.eligibleForeignTax)} {source.currencyCode ?? ""}</dd></div><div><dt>F · ส่วนเงินได้ที่นำเข้า</dt><dd>{formatMoney(source.remittedIncomeAmount)} {source.currencyCode ?? ""}</dd></div><div><dt>D แปลงเป็น THB</dt><dd>{formatMoney(source.grossIncomeThb)} บาท</dd></div><div><dt>E แปลงเป็น THB</dt><dd>{formatMoney(source.eligibleForeignTaxThb)} บาท</dd></div><div><dt>F แปลงเป็น THB</dt><dd>{formatMoney(source.remittedIncomeThb)} บาท</dd></div></dl>
        {source.fxReference && <p className="fx-provenance">อัตรา {source.fxReference.thbRate ?? "—"} THB ต่อ {source.fxReference.baseUnits ?? "—"} {source.fxReference.currencyCode ?? ""} · วันที่ {formatDate(source.fxReference.effectiveDate)} · {source.fxReference.rateType ?? "—"} · {source.fxReference.sourceLabel ?? "ไม่ระบุแหล่ง"}</p>}
        <div className="calculation-lines">{sourceRows.filter((line) => line.sourceId === source.id).map((line) => <div key={line.code}><span><strong>{line.label}</strong><small>{line.explanation}</small></span><b>{line.value === null ? "—" : formatMoney(line.value)}</b></div>)}</div>
        <p className="assumption-note">สมมติฐาน E: {source.eligibilityRationale ?? "ไม่มีข้อมูล"}</p>
      </article>)}</div>
    </section>
    <section className="content-section card breakdown-section">
      <div className="section-heading"><div><p className="eyebrow">CALCULATION STEPS</p><h2>วิธีคำนวณที่แสดง</h2></div></div>
      <div className="calculation-lines case-lines">{snapshot.result.lines.filter((line) => line.sourceId === null).map((line) => <div key={line.code}><span><strong>{line.label}</strong><small>{line.explanation}</small></span><b>{line.value === null ? "—" : formatMoney(line.value)}</b></div>)}</div>
      {snapshot.result.displayRoundingReconciliation !== null && snapshot.result.displayRoundingReconciliation !== "0" && <div className="alert alert-info compact-alert">การปรับการปัดเศษเพื่อให้ตารางตรงกับยอดรวม: {formatMoney(snapshot.result.displayRoundingReconciliation)} บาท</div>}
    </section>
    <section className="review-assumptions result-assumptions"><h2>สมมติฐานและแหล่งข้อมูล</h2><ul>{snapshot.policy.assumptions.map((item) => <li key={item}>{item}</li>)}</ul><p>นโยบาย {snapshot.policy.id} · เครื่องคำนวณ {snapshot.result.engineVersion} · สร้างผลเมื่อ {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt))}</p>{snapshot.policy.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">เอกสารอ้างอิง ↗</a>)}</section>
    <div className="result-actions">
      <a className="button button-secondary" href={reportHref}>เปิดรายงาน / พิมพ์</a>
      {!isSubmitted && <><button className="button button-quiet" onClick={calculateCurrent}>กลับไปแก้ไข</button><button className="button button-primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "กำลังตรวจสอบสถานะ…" : "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ"}</button></>}
      {isSubmitted && <div className="alert alert-success"><strong>ส่งแล้วเมื่อ {formatDate(record.submittedAt)}</strong><span>เลขอ้างอิงตัวอย่าง {record.id.slice(-8).toUpperCase()} · แสดงผลที่บันทึกแบบอ่านอย่างเดียว</span></div>}
    </div>
    {submitProblems.length > 0 && <div className="alert alert-warning" role="alert"><strong>ยังส่งกรณีไม่ได้</strong><ul>{submitProblems.map((message, index) => <li key={index}>{message}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
    {submitFieldProblems.length > 0 && <div className="alert alert-warning" role="alert"><strong>รายละเอียดช่องที่ต้องตรวจ</strong><ul>{submitFieldProblems.map((message, index) => <li key={index}>{message}</li>)}</ul><button className="button button-secondary button-small" onClick={calculateCurrent}>กลับไปแก้ข้อมูลและหลักฐาน</button></div>}
  </>;
}
