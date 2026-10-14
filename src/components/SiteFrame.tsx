import type { ApiUser } from "../../shared/contracts.js";
import { Link } from "react-router-dom";

export function SiteFrame({ children, user, demo, onSignOut, signOutError, signingOut,
  hostedSessionNotice, onRefreshHostedSession, checkingHostedSession }: {
  children: React.ReactNode;
  user: ApiUser;
  demo: boolean;
  onSignOut?: () => void;
  signOutError?: string | null;
  signingOut?: boolean;
  hostedSessionNotice?: string | null;
  onRefreshHostedSession?: () => void;
  checkingHostedSession?: boolean;
}) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <header className="topbar">
        <Link className="brand" to={user.role === "officer" ? (demo ? "/demo/officer" : "/officer") : (demo ? "/demo/app" : "/app")} aria-label="หน้าหลักระบบต้นแบบ">
          <span className="brand-mark" aria-hidden="true">FTC</span>
          <span><strong>เครดิตภาษีต่างประเทศ</strong><small>Foreign Tax Credit prototype</small></span>
        </Link>
        <div className="topbar-actions">
          {demo && <span className="mode-tag">โหมดสาธิตข้อมูลจำลอง</span>}
          <span className="user-name">{user.displayName}</span>
          {onSignOut && <button className="button button-quiet button-small" disabled={signingOut} onClick={() => void onSignOut()}>{signingOut ? "กำลังออกจากระบบ…" : signOutError ? "ลองออกจากระบบอีกครั้ง" : "ออกจากระบบ"}</button>}
        </div>
      </header>
      <main id="main-content" className="page-wrap">
        {demo && hostedSessionNotice && <div className="alert alert-error" role="alert">
          <strong>สถานะบัญชีออนไลน์</strong>
          <span>{hostedSessionNotice}</span>
          <div className="form-actions-right">
            {onRefreshHostedSession && <button className="button button-secondary button-small" onClick={() => void onRefreshHostedSession()} disabled={checkingHostedSession}>{checkingHostedSession ? "กำลังตรวจสอบ…" : "ตรวจสอบสถานะออนไลน์"}</button>}
            <Link className="button button-quiet button-small" to="/login">เข้าสู่ระบบออนไลน์</Link>
          </div>
        </div>}
        {signOutError && <div className="alert alert-error" role="alert"><strong>ออกจากระบบยังไม่สำเร็จ</strong><span>{signOutError}</span></div>}
        {children}
      </main>
      <footer className="site-footer"><span>ระบบต้นแบบเพื่อการศึกษา</span><span>ข้อมูลตัวอย่างสำหรับปีภาษี 2568</span></footer>
    </div>
  );
}

export function PageHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return <div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <div className="page-heading-copy">{children}</div>}</div>;
}
