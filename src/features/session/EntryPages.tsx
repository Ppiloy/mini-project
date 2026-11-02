import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import type { AuthSession, LogoutConfirmationResult } from "../../data/api.js";
import { apiFailureMessage, apiFailureMessages, hostedApi, logoutAndConfirm } from "../../data/api.js";
import type { LogoutIntent } from "../../app/App.js";
import type { DemoPersona } from "../../data/demoRepository.js";
import { DEMO_ENTRY_LABEL, EDUCATIONAL_NOTICE, PRODUCT_NAME } from "../../../shared/labels.js";

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
  const roleMismatchGuidance = officer ? "บัญชีนี้ยังไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีเพื่อเข้าสู่ระบบ";
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
        setProblem(roleMismatchGuidance);
        setCleanupSession(session);
        setCleanupError(null);
        beginLogout(session.user.id, expectedRole, true);
        const result = await logoutAndConfirm(session.csrfToken);
        if (!result.confirmed) {
        setCleanupError(apiFailureMessages(result.errors, "ยังยืนยันการออกจากระบบไม่ได้ กรุณาลองอีกครั้ง"));
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
        setCleanupError(apiFailureMessages(result.errors.length ? result.errors : pendingLogoutErrors, "ยังยืนยันการออกจากระบบไม่ได้ กรุณาลองอีกครั้ง"));
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
        <a className="entry-brand" href="/login" aria-label={PRODUCT_NAME}><span className="brand-mark" aria-hidden="true">FTC</span><span>{PRODUCT_NAME}</span></a>
        <h1>{officer ? "เข้าสู่ระบบเจ้าหน้าที่" : "เข้าสู่ระบบผู้เสียภาษี"}</h1>
        <p className="muted">เข้าสู่ระบบเพื่อดูและจัดการกรณีคำนวณเครดิตภาษีที่บันทึกไว้</p>
        {problem && <div className="alert alert-error" role="alert">{problem}</div>}
        {pendingCleanupSession && <section className="stack-form" aria-label="ตรวจสอบการเข้าสู่ระบบ">
          {!problem && <div className="alert alert-error" role="alert">{roleMismatchGuidance}</div>}
          <div className="alert alert-error" role="alert">{cleanupError ?? apiFailureMessages(pendingLogoutErrors, "บัญชีที่กำลังใช้อยู่ไม่ตรงกับบทบาทของหน้านี้ การเข้าสู่ระบบก่อนหน้าอาจยังเปิดอยู่")}</div>
          <button className="button button-secondary button-wide" onClick={retryCleanup} disabled={cleanupBusy}>{cleanupBusy ? "กำลังตรวจสอบ…" : "ตรวจสอบและออกจากระบบอีกครั้ง"}</button>
        </section>}
        {!pendingCleanupSession && pendingLogout && <section className="stack-form" aria-label="ตรวจสอบการเข้าสู่ระบบ">
          {pendingLogout.wrongRole && <div className="alert alert-error" role="alert">{pendingLogout.expectedRole === "officer" ? "บัญชีนี้ยังไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีเพื่อเข้าสู่ระบบ"}</div>}
          <div className="alert alert-error" role="alert">{cleanupError ?? apiFailureMessages(pendingLogoutErrors, "ระบบยังยืนยันการออกจากบัญชีก่อนหน้าไม่ได้ กรุณาตรวจสอบอีกครั้ง")}</div>
          <button className="button button-secondary button-wide" onClick={retryCleanup} disabled={cleanupBusy}>{cleanupBusy ? "กำลังตรวจสอบ…" : "ตรวจสอบและออกจากระบบอีกครั้ง"}</button>
        </section>}
        <form className="stack-form" onSubmit={submit} noValidate>
          <label className="field"><span>ชื่อผู้ใช้</span><input autoComplete="username" {...register("loginName")} aria-invalid={Boolean(errors.loginName)} aria-describedby={errors.loginName ? "login-name-error" : undefined} />{errors.loginName && <small id="login-name-error" className="field-error">{errors.loginName.message}</small>}</label>
          <label className="field"><span>รหัสผ่าน</span><input type="password" autoComplete="current-password" {...register("password")} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "login-password-error" : undefined} />{errors.password && <small id="login-password-error" className="field-error">{errors.password.message}</small>}</label>
          <button className="button button-primary button-wide" disabled={busy}>{busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}</button>
        </form>
        <div className="entry-divider"><span>หรือ</span></div>
        <a className="button button-secondary button-wide" href="/demo">{DEMO_ENTRY_LABEL}</a>
      </section>
      <footer className="entry-footer">{EDUCATIONAL_NOTICE}</footer>
    </main>
  );
}

export function DemoEntryPage({ onChoose, sessionNotice, onRefreshHostedSession, checkingHostedSession }: {
  onChoose: (persona: DemoPersona) => Promise<LogoutConfirmationResult>;
  sessionNotice: string | null;
  onRefreshHostedSession: () => Promise<void>;
  checkingHostedSession: boolean;
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
        <a className="entry-brand" href="/login" aria-label={PRODUCT_NAME}><span className="brand-mark" aria-hidden="true">FTC</span><span>{PRODUCT_NAME}</span></a>
        <h1>{DEMO_ENTRY_LABEL}</h1>
        <p className="muted">เลือกบทบาทเพื่อเริ่มใช้ข้อมูลตัวอย่าง</p>
        <div className="alert alert-info"><strong>ข้อมูลตัวอย่างแยกจากบัญชีออนไลน์</strong><span>ข้อมูลเก็บไว้ในเบราว์เซอร์นี้เท่านั้น ผู้เสียภาษีและเจ้าหน้าที่ในโหมดตัวอย่างใช้ข้อมูลชุดเดียวกัน</span></div>
        {sessionNotice && <div className="alert alert-error" role="alert">
          <span>{sessionNotice}</span>
          <div className="form-actions-right">
            <button className="button button-secondary button-small" onClick={() => void onRefreshHostedSession()} disabled={checkingHostedSession}>{checkingHostedSession ? "กำลังตรวจสอบ…" : "ตรวจสอบสถานะออนไลน์"}</button>
            <a className="button button-quiet button-small" href="/login">เข้าสู่ระบบออนไลน์</a>
          </div>
        </div>}
        {problem && <div className="alert alert-error" role="alert">{problem}</div>}
        <div className="demo-role-list">
          <button className="role-card" aria-label="ผู้เสียภาษี" onClick={() => void select("taxpayer")} disabled={busy}>
            <span className="role-icon" aria-hidden="true">ผ</span><span><strong>ผู้เสียภาษี</strong><small>สร้างและแก้ไขกรณีตัวอย่าง ส่งให้เจ้าหน้าที่ผู้สอบทาน</small></span><span aria-hidden="true">→</span>
          </button>
          <button className="role-card" aria-label="เจ้าหน้าที่" onClick={() => void select("officer")} disabled={busy}>
            <span className="role-icon role-icon-officer" aria-hidden="true">จ</span><span><strong>เจ้าหน้าที่</strong><small>ดูกรณีตัวอย่างที่ส่งเข้าตรวจทาน</small></span><span aria-hidden="true">→</span>
          </button>
        </div>
        <a className="text-link" href="/login">เข้าสู่ระบบออนไลน์</a>
      </section>
      <footer className="entry-footer">{EDUCATIONAL_NOTICE}</footer>
    </main>
  );
}
