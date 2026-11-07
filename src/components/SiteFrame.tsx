import type { ApiUser } from "../../shared/contracts.js";
import { EDUCATIONAL_NOTICE, PRODUCT_NAME } from "../../shared/labels.js";
import { Link } from "react-router-dom";
import { GuestLimits } from "./GuestLimits.js";

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
        <Link className="brand" to={user.role === "officer" ? (demo ? "/demo/officer" : "/officer") : (demo ? "/demo/app" : "/app")} aria-label={`หน้าหลัก${PRODUCT_NAME}`}>
          <span className="brand-mark" aria-hidden="true">FTC</span>
          <span><strong>{PRODUCT_NAME}</strong></span>
        </Link>
        <div className="topbar-actions">
          {demo && <span className="mode-tag">ร่างโดยไม่เข้าสู่ระบบ · เก็บในเบราว์เซอร์นี้</span>}
          {demo && <Link className="button button-secondary button-small" to="/">เข้าสู่ระบบ</Link>}
          <span className="user-name">{user.displayName}</span>
          {onSignOut && <button className="button button-quiet button-small" disabled={signingOut} onClick={() => void onSignOut()}>{signingOut ? "กำลังออกจากระบบ…" : signOutError ? "ลองออกจากระบบอีกครั้ง" : "ออกจากระบบ"}</button>}
        </div>
      </header>
      <main id="main-content" className="page-wrap">
        {demo && <div className="no-print"><GuestLimits /></div>}
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
      <footer className="site-footer">{EDUCATIONAL_NOTICE}</footer>
    </div>
  );
}

export function PageHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return <div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <div className="page-heading-copy">{children}</div>}</div>;
}
