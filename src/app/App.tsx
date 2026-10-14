import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { ApiUser } from "../../shared/contracts.js";
import type { AuthSession } from "../data/api.js";
import { ApiClientError, hostedApi } from "../data/api.js";
import type { DemoPersona } from "../data/demoRepository.js";
import { demoUser } from "../data/demoRepository.js";
import { DashboardPage } from "../features/cases/DashboardPage.js";
import { CaseEditorPage } from "../features/cases/CaseEditorPage.js";
import { CaseResultPage } from "../features/cases/CaseResultPage.js";
import { OfficerCasePage, OfficerQueuePage } from "../features/review/OfficerPages.js";
import { ReportPage } from "../features/reports/ReportPage.js";
import { DemoEntryPage, LoginPage } from "../features/session/EntryPages.js";
import { SiteFrame } from "../components/SiteFrame.js";

interface AppSession {
  user: ApiUser | null;
  csrfToken: string | null;
  demo: boolean;
  ready: boolean;
  setHosted: (session: AuthSession) => void;
  setDemo: (persona: DemoPersona) => void;
  clear: () => void;
}

const SessionContext = createContext<AppSession | null>(null);
export function hostedPendingDraftKey(ownerId: string, caseId: string): string {
  return `ftc.hosted.pending.${ownerId}.${caseId}`;
}

function clearPendingDrafts(keepOwnerId?: string): void {
  const prefixes = ["ftc.hosted.pending.", "ftc.submit.pending."];
  for (const key of Object.keys(sessionStorage)) {
    const prefix = prefixes.find((value) => key.startsWith(value));
    if (!prefix) continue;
    if (keepOwnerId && key.startsWith(`${prefix}${keepOwnerId}.`)) continue;
    sessionStorage.removeItem(key);
  }
}

export function useAppSession(): AppSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useAppSession must be inside the application provider");
  return value;
}

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [demo, setIsDemo] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const persona = sessionStorage.getItem("ftc.demo.persona") as DemoPersona | null;
    if (persona === "taxpayer" || persona === "officer") {
      setUser(demoUser(persona));
      setIsDemo(true);
      setReady(true);
      return;
    }
    let live = true;
    hostedApi.session().then((session) => {
      if (live && session) {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
      }
    }).catch(() => {
      // The login screen presents the connection error when the user chooses hosted access.
    }).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  const value = useMemo<AppSession>(() => ({
    user,
    csrfToken,
    demo,
    ready,
    setHosted: (session) => {
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts(session.user.id);
      setIsDemo(false);
      setUser(session.user);
      setCsrfToken(session.csrfToken);
    },
    setDemo: (persona) => {
      sessionStorage.setItem("ftc.demo.persona", persona);
      setIsDemo(true);
      setUser(demoUser(persona));
      setCsrfToken(null);
    },
    clear: () => {
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts();
      setIsDemo(false);
      setUser(null);
      setCsrfToken(null);
    },
  }), [user, csrfToken, demo, ready]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function RequireRole({ role, children }: { role: ApiUser["role"]; children: React.ReactNode }) {
  const { user, demo, csrfToken, clear, ready } = useAppSession();
  const navigate = useNavigate();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  if (!user || user.role !== role) return <Navigate to={demo ? "/demo" : role === "officer" ? "/officer/login" : "/login"} replace />;
  const signOut = async () => {
    if (!demo && csrfToken) {
      try { await hostedApi.logout(csrfToken); } catch { /* Clear local identity after network failures too. */ }
    }
    clear();
    navigate("/login", { replace: true });
  };
  return <SiteFrame user={user} demo={demo} onSignOut={signOut}>{children}</SiteFrame>;
}

function LoginRoute({ officer = false }: { officer?: boolean }) {
  const { setHosted } = useAppSession();
  return <LoginPage officer={officer} onLogin={setHosted} />;
}

function AuthorizedReportRoute({ mode }: { mode: "demo" | "hosted" }) {
  const { user, demo, ready } = useAppSession();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  if (!user) return <Navigate to={mode === "demo" ? "/demo" : "/login"} replace />;
  return <SiteFrame user={user} demo={demo}><ReportPage mode={mode} /></SiteFrame>;
}

function AppRoutes() {
  const { setDemo } = useAppSession();
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/officer/login" element={<LoginRoute officer />} />
      <Route path="/demo" element={<DemoEntryPage onChoose={setDemo} />} />
      <Route path="/demo/app" element={<RequireRole role="taxpayer"><DashboardPage mode="demo" /></RequireRole>} />
      <Route path="/app" element={<RequireRole role="taxpayer"><DashboardPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/cases/:id/edit" element={<RequireRole role="taxpayer"><CaseEditorPage mode="demo" /></RequireRole>} />
      <Route path="/app/cases/:id/edit" element={<RequireRole role="taxpayer"><CaseEditorPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/cases/:id/result" element={<RequireRole role="taxpayer"><CaseResultPage mode="demo" /></RequireRole>} />
      <Route path="/app/cases/:id/result" element={<RequireRole role="taxpayer"><CaseResultPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/officer" element={<RequireRole role="officer"><OfficerQueuePage mode="demo" /></RequireRole>} />
      <Route path="/officer" element={<RequireRole role="officer"><OfficerQueuePage mode="hosted" /></RequireRole>} />
      <Route path="/demo/officer/cases/:id" element={<RequireRole role="officer"><OfficerCasePage mode="demo" /></RequireRole>} />
      <Route path="/officer/cases/:id" element={<RequireRole role="officer"><OfficerCasePage mode="hosted" /></RequireRole>} />
      <Route path="/demo/reports/:snapshotId" element={<AuthorizedReportRoute mode="demo" />} />
      <Route path="/reports/:snapshotId" element={<AuthorizedReportRoute mode="hosted" />} />
      <Route path="*" element={<main className="page-wrap"><section className="card"><h1>ไม่พบหน้านี้</h1><a href="/login">กลับหน้าเข้าสู่ระบบ</a></section></main>} />
    </Routes>
  );
}

export function App() {
  return <BrowserRouter><SessionProvider><AppRoutes /></SessionProvider></BrowserRouter>;
}

export function currentErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาลองอีกครั้ง";
}
