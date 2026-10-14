import type { ApiUser } from "../../shared/contracts.js";

export function SiteFrame({ children, user, demo, onSignOut }: {
  children: React.ReactNode;
  user: ApiUser;
  demo: boolean;
  onSignOut?: () => void;
}) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <header className="topbar">
        <a className="brand" href={user.role === "officer" ? (demo ? "/demo/officer" : "/officer") : (demo ? "/demo/app" : "/app")} aria-label="หน้าหลักระบบต้นแบบ">
          <span className="brand-mark" aria-hidden="true">FTC</span>
          <span><strong>เครดิตภาษีต่างประเทศ</strong><small>Foreign Tax Credit prototype</small></span>
        </a>
        <div className="topbar-actions">
          {demo && <span className="mode-tag">โหมดสาธิตข้อมูลจำลอง</span>}
          <span className="user-name">{user.displayName}</span>
          {onSignOut && <button className="button button-quiet button-small" onClick={onSignOut}>ออกจากระบบ</button>}
        </div>
      </header>
      <main id="main-content" className="page-wrap">{children}</main>
      <footer className="site-footer"><span>ระบบต้นแบบเพื่อการศึกษา</span><span>ข้อมูลตัวอย่างสำหรับปีภาษี 2568</span></footer>
    </div>
  );
}

export function PageHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return <div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <div className="page-heading-copy">{children}</div>}</div>;
}
