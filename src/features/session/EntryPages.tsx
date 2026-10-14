import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import type { AuthSession } from "../../data/api.js";
import { ApiClientError, hostedApi } from "../../data/api.js";
import type { DemoPersona } from "../../data/demoRepository.js";

const loginSchema = z.object({
  loginName: z.string().trim().min(1, "กรุณากรอกชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage({ officer, onLogin }: { officer: boolean; onLogin: (session: AuthSession) => void }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
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
      if (session.user.role !== (officer ? "officer" : "taxpayer")) {
        setProblem(officer ? "บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่" : "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้");
        try { await hostedApi.logout(session.csrfToken); } catch { /* Wrong-role login is cleared in the browser either way. */ }
        return;
      }
      onLogin(session);
      const returnTo = search.get("returnTo");
      const allowedReturn = returnTo && returnTo.startsWith("/app/cases/") && returnTo.endsWith("/edit") && !returnTo.includes("//") ? returnTo : null;
      navigate(allowedReturn ?? (session.user.role === "officer" ? "/officer" : "/app"), { replace: true });
    } catch (error) {
      setProblem(error instanceof ApiClientError ? error.message : "เข้าสู่ระบบไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  });

  return (
    <main className="entry-page">
      <section className="entry-card card">
        <a className="entry-brand" href="/login"><span className="brand-mark" aria-hidden="true">FTC</span><span>ระบบต้นแบบเครดิตภาษีต่างประเทศ</span></a>
        <p className="prototype-banner">ระบบต้นแบบเพื่อการศึกษา</p>
        <p className="eyebrow">{officer ? "REVIEWER ACCESS" : "TAXPAYER ACCESS"}</p>
        <h1>{officer ? "เข้าสู่ระบบเจ้าหน้าที่" : "เข้าสู่ระบบผู้เสียภาษี"}</h1>
        <p className="muted">ใช้บัญชีตัวอย่างที่ผู้ดูแลระบบจัดเตรียมให้ ระบบนี้จำลองการคำนวณเพื่อการศึกษาและไม่ใช่บริการยื่นภาษี</p>
        {problem && <div className="alert alert-error" role="alert">{problem}</div>}
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

export function DemoEntryPage({ onChoose }: { onChoose: (persona: DemoPersona) => void }) {
  const navigate = useNavigate();
  const select = (persona: DemoPersona) => {
    onChoose(persona);
    navigate(persona === "officer" ? "/demo/officer" : "/demo/app", { replace: true });
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
        <div className="demo-role-list">
          <button className="role-card" onClick={() => select("taxpayer")}>
            <span className="role-icon" aria-hidden="true">ผ</span><span><strong>เข้าสู่สาธิตในฐานะผู้เสียภาษี</strong><small>สร้างและแก้ไขกรณีตัวอย่าง ส่งเข้าคิวจำลอง</small></span><span aria-hidden="true">→</span>
          </button>
          <button className="role-card" onClick={() => select("officer")}>
            <span className="role-icon role-icon-officer" aria-hidden="true">จ</span><span><strong>เข้าสู่สาธิตในฐานะเจ้าหน้าที่</strong><small>ดูรายการที่ส่งแล้วในคิวจำลอง</small></span><span aria-hidden="true">→</span>
          </button>
        </div>
        <a className="text-link" href="/login">กลับไปเข้าสู่ระบบออนไลน์</a>
      </section>
    </main>
  );
}
