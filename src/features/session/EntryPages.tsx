import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import type { AuthSession, LogoutConfirmationResult } from "../../data/api.js";
import { apiFailureMessage, apiFailureMessages, hostedApi, logoutAndConfirm } from "../../data/api.js";
import type { LogoutIntent } from "../../app/App.js";
import type { DemoPersona } from "../../data/demoRepository.js";

const loginSchema = z.object({
  loginName: z.string().trim().min(1, "กรุณากรอกชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage({ officer, onLogin, onClearSession, activeSession, pendingLogout, pendingLogoutErrors, retryPendingLogout, beginLogout }: {
  officer: boolean;
  onLogin: (session: AuthSession) => void;
  onClearSession: () => void;
  activeSession: AuthSession | null;
  pendingLogout: LogoutIntent | null;
  pendingLogoutErrors: unknown[];
  retryPendingLogout: (fallback?: LogoutIntent) => Promise<LogoutConfirmationResult>;
  beginLogout: (accountId: string, expectedRole: "taxpayer" | "officer", wrongRole?: boolean) => void;
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupSession, setCleanupSession] = useState<AuthSession | null>(null);
  const expectedRole: "officer" | "taxpayer" = officer ? "officer" : "taxpayer";
  const activeWrongRoleSession = activeSession?.user.role !== expectedRole ? activeSession : null;
  const pendingCleanupSession = cleanupSession ?? activeWrongRoleSession;
  const roleMismatchGuidance = officer ? "บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้";
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { loginName: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    setBusy(true);
    setProblem(null);
    try {
      const session = await hostedApi.login(values.loginName, values.password);
      // A successful login switches the server cookie immediately, even if this
      // route rejects the account's role. Replace the previous browser identity first.
      onLogin(session);
      if (session.user.role !== expectedRole) {
        setProblem(officer ? "บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้");
        setCleanupSession(session);
        setCleanupError(null);
        beginLogout(session.user.id, expectedRole, true);
        const result = await logoutAndConfirm(session.csrfToken);
        if (!result.confirmed) {
          setCleanupError(apiFailureMessages(result.errors, "ยังออกจากระบบไม่สำเร็จ เซิร์ฟเวอร์อาจยังเปิดเซสชันนี้อยู่ กรุณาลองปิดเซสชันอีกครั้ง"));
        } else {
          onClearSession();
          setCleanupSession(null);
        }
        return;
      }
      const returnTo = search.get("returnTo");
      const allowedReturn = returnTo && returnTo.startsWith("/app/cases/") && returnTo.endsWith("/edit") && !returnTo.includes("//") ? returnTo : null;
      navigate(allowedReturn ?? (session.user.role === "officer" ? "/officer" : "/app"), { replace: true });
    } catch (error) {
      setProblem(apiFailureMessage(error, "เข้าสู่ระบบไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง"));
    } finally {
      setBusy(false);
    }
  });

  const retryCleanup = async () => {
    if ((!pendingCleanupSession && !pendingLogout) || cleanupBusy) return;
    setCleanupBusy(true);
    setCleanupError(null);
    try {
      const fallback = pendingCleanupSession ? { accountId: pendingCleanupSession.user.id, expectedRole } : undefined;
      const result = await retryPendingLogout(fallback);
      if (!result.confirmed) {
        setCleanupError(apiFailureMessages(result.errors.length ? result.errors : pendingLogoutErrors, "ยังออกจากระบบไม่สำเร็จ เซิร์ฟเวอร์อาจยังเปิดเซสชันนี้อยู่ กรุณาลองปิดเซสชันอีกครั้ง"));
        return;
      }
      onClearSession();
      setCleanupSession(null);
      setCleanupError(null);
    } finally {
      setCleanupBusy(false);
    }
  };

  return (
    <main className="entry-page">
      <section className="entry-card card">
        <a className="entry-brand" href="/login"><span className="brand-mark" aria-hidden="true">FTC</span><span>ระบบต้นแบบเครดิตภาษีต่างประเทศ</span></a>
        <p className="prototype-banner">ระบบต้นแบบเพื่อการศึกษา</p>
        <p className="fine-print">รุ่นนโยบายอ้างอิง: rd-ftc-demo-2568-v1</p>
        <p className="eyebrow">{officer ? "REVIEWER ACCESS" : "TAXPAYER ACCESS"}</p>
        <h1>{officer ? "เข้าสู่ระบบเจ้าหน้าที่" : "เข้าสู่ระบบผู้เสียภาษี"}</h1>
        <p className="muted">ใช้บัญชีตัวอย่างที่ผู้ดูแลระบบจัดเตรียมให้ ระบบนี้จำลองการคำนวณเพื่อการศึกษาและไม่ใช่บริการยื่นภาษี</p>
        {problem && <div className="alert alert-error" role="alert">{problem}</div>}
        {pendingCleanupSession && <section className="stack-form" aria-label="การกู้คืนเซสชัน">
          {!problem && <div className="alert alert-error" role="alert">{roleMismatchGuidance}</div>}
          <div className="alert alert-error" role="alert">{cleanupError ?? apiFailureMessages(pendingLogoutErrors, "บัญชีที่กำลังใช้อยู่ไม่ตรงกับบทบาทของหน้านี้ เซสชันอาจยังเปิดอยู่")}</div>
          <button className="button button-secondary button-wide" onClick={retryCleanup} disabled={cleanupBusy}>{cleanupBusy ? "กำลังยืนยัน…" : "ลองปิดเซสชันอีกครั้ง"}</button>
        </section>}
        {!pendingCleanupSession && pendingLogout && <section className="stack-form" aria-label="การกู้คืนเซสชัน">
          {pendingLogout.wrongRole && <div className="alert alert-error" role="alert">{pendingLogout.expectedRole === "officer" ? "บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้"}</div>}
          <div className="alert alert-error" role="alert">{cleanupError ?? apiFailureMessages(pendingLogoutErrors, "เซิร์ฟเวอร์ยังยืนยันการสิ้นสุดเซสชันไม่ได้ กรุณาตรวจสอบเซสชันก่อนลองออกจากระบบอีกครั้ง")}</div>
          <button className="button button-secondary button-wide" onClick={retryCleanup} disabled={cleanupBusy}>{cleanupBusy ? "กำลังตรวจสอบ…" : "ตรวจสอบเซสชันและลองออกจากระบบอีกครั้ง"}</button>
        </section>}
        <form className="stack-form" onSubmit={submit} noValidate>
          <label className="field"><span>ชื่อผู้ใช้</span><input autoComplete="username" {...register("loginName")} aria-invalid={Boolean(errors.loginName)} aria-describedby={errors.loginName ? "login-name-error" : undefined} />{errors.loginName && <small id="login-name-error" className="field-error">{errors.loginName.message}</small>}</label>
          <label className="field"><span>รหัสผ่าน</span><input type="password" autoComplete="current-password" {...register("password")} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "login-password-error" : undefined} />{errors.password && <small id="login-password-error" className="field-error">{errors.password.message}</small>}</label>
          <button className="button button-primary button-wide" disabled={busy}>{busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}</button>
        </form>
        <div className="entry-divider"><span>หรือ</span></div>
        <a className="button button-secondary button-wide" href="/demo">เปิดโหมดสาธิตแบบออฟไลน์</a>
        <p className="fine-print">โหมดสาธิตใช้ข้อมูลสมมติที่เก็บแยกในเบราว์เซอร์นี้ ไม่มีการเชื่อมข้อมูลกับบัญชีจริงหรือคิวเจ้าหน้าที่จริง</p>
      </section>
    </main>
  );
}

export function DemoEntryPage({ onChoose, sessionLookupError }: {
  onChoose: (persona: DemoPersona) => Promise<LogoutConfirmationResult>;
  sessionLookupError: unknown | null;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const select = async (persona: DemoPersona) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await onChoose(persona);
      if (!result.confirmed) {
        setProblem(apiFailureMessages(result.errors, "ยังสลับไปโหมดสาธิตไม่ได้ เพราะเซิร์ฟเวอร์ยังยืนยันการออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง"));
        return;
      }
      navigate(persona === "officer" ? "/demo/officer" : "/demo/app", { replace: true });
    } catch (error) {
      setProblem(apiFailureMessage(error, "เปิดโหมดสาธิตไม่ได้ กรุณาลองอีกครั้ง"));
    } finally { setBusy(false); }
  };
  return (
    <main className="entry-page">
      <section className="entry-card card demo-card">
        <a className="entry-brand" href="/login"><span className="brand-mark" aria-hidden="true">FTC</span><span>ระบบต้นแบบเครดิตภาษีต่างประเทศ</span></a>
        <p className="prototype-banner">ระบบต้นแบบเพื่อการศึกษา</p>
        <p className="eyebrow">FIXTURE DEMONSTRATION</p>
        <h1>สาธิตระบบต้นแบบ</h1>
        <p className="muted">เลือกบทบาทสำหรับข้อมูลสมมติ โหมดนี้ใช้เครื่องคำนวณเดียวกับแอปและจำลองการบันทึกกับเอกสารในอุปกรณ์นี้</p>
        <div className="alert alert-info"><strong>ข้อมูลในโหมดสาธิตแยกจากระบบออนไลน์</strong><span>ไม่มีการใช้รหัสผ่าน และไม่เชื่อมต่อกับบัญชีหรือคิวที่บันทึกไว้บนเซิร์ฟเวอร์</span></div>
        {Boolean(sessionLookupError) && <div className="alert alert-error" role="alert">{apiFailureMessages([sessionLookupError], "ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว โหมดสาธิตยังใช้ข้อมูลในอุปกรณ์นี้ได้ แต่เซสชันออนไลน์เดิมอาจยังเปิดอยู่ โปรดกลับมาเชื่อมต่อและตรวจสอบเซสชันก่อนใช้บัญชีออนไลน์")}</div>}
        {problem && <div className="alert alert-error" role="alert">{problem}</div>}
        <div className="demo-role-list">
          <button className="role-card" onClick={() => void select("taxpayer")} disabled={busy}>
            <span className="role-icon" aria-hidden="true">ผ</span><span><strong>เข้าสู่สาธิตในฐานะผู้เสียภาษี</strong><small>สร้างและแก้ไขกรณีตัวอย่าง ส่งเข้าคิวจำลอง</small></span><span aria-hidden="true">→</span>
          </button>
          <button className="role-card" onClick={() => void select("officer")} disabled={busy}>
            <span className="role-icon role-icon-officer" aria-hidden="true">จ</span><span><strong>เข้าสู่สาธิตในฐานะเจ้าหน้าที่</strong><small>ดูรายการที่ส่งแล้วในคิวจำลอง</small></span><span aria-hidden="true">→</span>
          </button>
        </div>
        <a className="text-link" href="/login">กลับไปเข้าสู่ระบบออนไลน์</a>
      </section>
    </main>
  );
}
