import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { ApiUser } from "../../shared/contracts.js";
import type { AuthSession } from "../data/api.js";
import { ApiClientError, hostedApi, logoutAndConfirm } from "../data/api.js";
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
  pendingLogout: LogoutIntent | null;
  setHosted: (session: AuthSession) => void;
  setDemo: (persona: DemoPersona) => void;
  beginLogout: (accountId: string, expectedRole: ApiUser["role"], wrongRole?: boolean) => void;
  retryPendingLogout: (fallback?: LogoutIntent) => Promise<boolean>;
  clear: () => void;
  clearDemo: () => void;
}

const SessionContext = createContext<AppSession | null>(null);
const pendingLogoutStorageKey = "ftc.hosted.logout.pending";
export interface LogoutIntent { accountId: string; expectedRole: ApiUser["role"]; wrongRole?: boolean }

function readLogoutIntent(): LogoutIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingLogoutStorageKey) ?? "null") as Partial<LogoutIntent> | null;
    if (!value || typeof value.accountId !== "string" || !value.accountId || (value.expectedRole !== "taxpayer" && value.expectedRole !== "officer")) return null;
    return { accountId: value.accountId, expectedRole: value.expectedRole, wrongRole: value.wrongRole === true };
  } catch { return null; }
}

function persistLogoutIntent(intent: LogoutIntent | null): void {
  if (intent) sessionStorage.setItem(pendingLogoutStorageKey, JSON.stringify(intent));
  else sessionStorage.removeItem(pendingLogoutStorageKey);
}

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
  const [pendingLogout, setPendingLogout] = useState<LogoutIntent | null>(readLogoutIntent);

  useEffect(() => {
    const persona = sessionStorage.getItem("ftc.demo.persona") as DemoPersona | null;
    if (persona === "taxpayer" || persona === "officer") {
      setUser(demoUser(persona));
      setIsDemo(true);
      setReady(true);
      return;
    }
    let live = true;
    const logoutIntent = readLogoutIntent();
    setPendingLogout(logoutIntent);
    hostedApi.session().then((session) => {
      if (live && session) {
        if (logoutIntent && session.user.id !== logoutIntent.accountId) {
          persistLogoutIntent(null);
          setPendingLogout(null);
        }
        setUser(session.user);
        setCsrfToken(session.csrfToken);
      }
      if (live && !session) {
        persistLogoutIntent(null);
        setPendingLogout(null);
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
    pendingLogout,
    setHosted: (session) => {
      persistLogoutIntent(null);
      setPendingLogout(null);
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
    beginLogout: (accountId, expectedRole, wrongRole = false) => {
      const intent = { accountId, expectedRole, wrongRole };
      persistLogoutIntent(intent);
      setPendingLogout(intent);
    },
    retryPendingLogout: async (fallback) => {
      const storedIntent = pendingLogout ?? readLogoutIntent();
      const intent = fallback && storedIntent?.accountId === fallback.accountId ? storedIntent : fallback ?? storedIntent;
      if (!intent) return false;
      persistLogoutIntent(intent);
      setPendingLogout(intent);
      let activeSession: AuthSession | null;
      try { activeSession = await hostedApi.session(); }
      catch { return false; }
      if (!activeSession) {
        persistLogoutIntent(null);
        clearPendingDrafts();
        setPendingLogout(null);
        setIsDemo(false);
        setUser(null);
        setCsrfToken(null);
        return true;
      }
      if (activeSession.user.id !== intent.accountId) {
        persistLogoutIntent(null);
        setPendingLogout(null);
        sessionStorage.removeItem("ftc.demo.persona");
        clearPendingDrafts(activeSession.user.id);
        setIsDemo(false);
        setUser(activeSession.user);
        setCsrfToken(activeSession.csrfToken);
        return true;
      }
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts(activeSession.user.id);
      setIsDemo(false);
      setUser(activeSession.user);
      setCsrfToken(activeSession.csrfToken);
      if (!await logoutAndConfirm(activeSession.csrfToken)) return false;
      persistLogoutIntent(null);
      clearPendingDrafts();
      setPendingLogout(null);
      setIsDemo(false);
      setUser(null);
      setCsrfToken(null);
      return true;
    },
    clear: () => {
      persistLogoutIntent(null);
      setPendingLogout(null);
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts();
      setIsDemo(false);
      setUser(null);
      setCsrfToken(null);
    },
    clearDemo: () => {
      sessionStorage.removeItem("ftc.demo.persona");
      setIsDemo(false);
      setUser(null);
      setCsrfToken(null);
    },
  }), [user, csrfToken, demo, ready, pendingLogout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function RequireRole({ role, children }: { role: ApiUser["role"]; children: React.ReactNode }) {
  const { user, demo, csrfToken, clear, clearDemo, beginLogout, pendingLogout, ready } = useAppSession();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  if (!user || user.role !== role) return <Navigate to={demo ? "/demo" : role === "officer" ? "/officer/login" : "/login"} replace />;
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      if (!demo) {
        beginLogout(user.id, role);
        if (!csrfToken) {
          setSignOutError("ไม่พบโทเค็นสำหรับออกจากระบบ เซิร์ฟเวอร์อาจยังเปิดเซสชันนี้อยู่ กรุณาลองโหลดหน้าใหม่หรือเข้าสู่ระบบอีกครั้ง");
          return;
        }
        if (!await logoutAndConfirm(csrfToken)) {
          setSignOutError("เซิร์ฟเวอร์ยังยืนยันการสิ้นสุดเซสชันไม่ได้ ระบบอาจยังเปิดเซสชันนี้อยู่ กรุณาลองออกจากระบบอีกครั้งก่อนปิดแท็บ");
          return;
        }
      }
      if (demo) clearDemo();
      else clear();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };
  const pendingLogoutError = pendingLogout?.accountId === user.id ? "เซิร์ฟเวอร์ยังยืนยันการสิ้นสุดเซสชันไม่ได้ ระบบอาจยังเปิดเซสชันนี้อยู่ กรุณาลองออกจากระบบอีกครั้งก่อนปิดแท็บ" : null;
  return <SiteFrame user={user} demo={demo} onSignOut={signOut} signOutError={signOutError ?? pendingLogoutError} signingOut={signingOut}>{children}</SiteFrame>;
}

function LoginRoute({ officer = false }: { officer?: boolean }) {
  const { setHosted, clear, user, csrfToken, demo, ready, pendingLogout, retryPendingLogout, beginLogout } = useAppSession();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  const activeSession = user && csrfToken && !demo ? { user, csrfToken } : null;
  return <LoginPage officer={officer} onLogin={setHosted} onClearSession={clear} activeSession={activeSession} pendingLogout={pendingLogout} retryPendingLogout={retryPendingLogout} beginLogout={beginLogout} />;
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
