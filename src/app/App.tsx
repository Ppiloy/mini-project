import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { ApiUser } from "../../shared/contracts.js";
import type { AuthSession, LogoutConfirmationResult } from "../data/api.js";
import { ApiClientError, apiFailureMessages, hostedApi, logoutAndConfirm } from "../data/api.js";
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
  pendingLogoutErrors: unknown[];
  sessionLookupError: unknown | null;
  sessionLookupStatus: "unverified" | "active" | null;
  refreshHostedSession: () => Promise<void>;
  checkingHostedSession: boolean;
  setHosted: (session: AuthSession) => void;
  setDemo: (persona: DemoPersona) => Promise<LogoutConfirmationResult>;
  beginLogout: (accountId: string, expectedRole: ApiUser["role"], wrongRole?: boolean) => void;
  retryPendingLogout: (fallback?: LogoutIntent) => Promise<LogoutConfirmationResult>;
  clear: () => void;
  clearDemo: () => void;
}

const SessionContext = createContext<AppSession | null>(null);
const pendingLogoutStorageKey = "ftc.hosted.logout.pending";
const unverifiedHostedSessionStorageKey = "ftc.hosted.session.unverified";
type HostedSessionLookupStatus = "unverified" | "active" | null;
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
  const [pendingLogoutErrors, setPendingLogoutErrors] = useState<unknown[]>([]);
  const [sessionLookupError, setSessionLookupError] = useState<unknown | null>(null);
  const [sessionLookupStatus, setSessionLookupStatus] = useState<HostedSessionLookupStatus>(null);
  const [checkingHostedSession, setCheckingHostedSession] = useState(false);

  useEffect(() => {
    const persona = sessionStorage.getItem("ftc.demo.persona") as DemoPersona | null;
    if (persona === "taxpayer" || persona === "officer") {
      const storedLookupStatus = sessionStorage.getItem(unverifiedHostedSessionStorageKey);
      if (storedLookupStatus === "active") {
        setSessionLookupStatus("active");
      } else if (storedLookupStatus === "unverified" || storedLookupStatus === "1") {
        setSessionLookupStatus("unverified");
        setSessionLookupError(new Error("ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว เซสชันออนไลน์เดิมอาจยังเปิดอยู่"));
      }
      setUser(demoUser(persona));
      setIsDemo(true);
      setReady(true);
      return;
    }
    let live = true;
    const logoutIntent = readLogoutIntent();
    setPendingLogout(logoutIntent);
    hostedApi.session().then((session) => {
      if (live) {
        setSessionLookupError(null);
        setSessionLookupStatus(null);
        sessionStorage.removeItem(unverifiedHostedSessionStorageKey);
      }
      if (live && session) {
        if (logoutIntent && session.user.id !== logoutIntent.accountId) {
          persistLogoutIntent(null);
          setPendingLogout(null);
          setPendingLogoutErrors([]);
        }
        setUser(session.user);
        setCsrfToken(session.csrfToken);
      }
      if (live && !session) {
        persistLogoutIntent(null);
        setPendingLogout(null);
        setPendingLogoutErrors([]);
      }
    }).catch((error: unknown) => {
      if (live) {
        setSessionLookupError(error);
        setSessionLookupStatus("unverified");
      }
      if (live && logoutIntent) setPendingLogoutErrors([error]);
    }).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  const value = useMemo<AppSession>(() => ({
    user,
    csrfToken,
    demo,
    ready,
    pendingLogout,
    pendingLogoutErrors,
    sessionLookupError,
    sessionLookupStatus,
    checkingHostedSession,
    setHosted: (session) => {
      persistLogoutIntent(null);
      setPendingLogout(null);
      setPendingLogoutErrors([]);
      setSessionLookupError(null);
      setSessionLookupStatus(null);
      sessionStorage.removeItem(unverifiedHostedSessionStorageKey);
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts(session.user.id);
      setIsDemo(false);
      setUser(session.user);
      setCsrfToken(session.csrfToken);
    },
    setDemo: async (persona) => {
      if (!ready) {
        return { confirmed: false, errors: [new Error("กำลังตรวจสอบเซสชันออนไลน์ กรุณารอแล้วลองอีกครั้งก่อนเปิดโหมดสาธิต")] };
      }
      if (user && csrfToken && !demo) {
        const intent = { accountId: user.id, expectedRole: user.role };
        persistLogoutIntent(intent);
        setPendingLogout(intent);
        setPendingLogoutErrors([]);
        const result = await logoutAndConfirm(csrfToken);
        if (!result.confirmed) {
          setPendingLogoutErrors(result.errors);
          return result;
        }
      }
      persistLogoutIntent(null);
      setPendingLogout(null);
      setPendingLogoutErrors([]);
      if (sessionLookupStatus) sessionStorage.setItem(unverifiedHostedSessionStorageKey, sessionLookupStatus);
      else sessionStorage.removeItem(unverifiedHostedSessionStorageKey);
      clearPendingDrafts();
      sessionStorage.setItem("ftc.demo.persona", persona);
      setIsDemo(true);
      setUser(demoUser(persona));
      setCsrfToken(null);
      return { confirmed: true };
    },
    beginLogout: (accountId, expectedRole, wrongRole = false) => {
      const intent = { accountId, expectedRole, wrongRole };
      persistLogoutIntent(intent);
      setPendingLogout(intent);
      setPendingLogoutErrors([]);
    },
    retryPendingLogout: async (fallback) => {
      const storedIntent = pendingLogout ?? readLogoutIntent();
      const intent = fallback && storedIntent?.accountId === fallback.accountId ? storedIntent : fallback ?? storedIntent;
      if (!intent) return { confirmed: false, errors: [] };
      persistLogoutIntent(intent);
      setPendingLogout(intent);
      let activeSession: AuthSession | null;
      try { activeSession = await hostedApi.session(); }
      catch (error) {
        const result: LogoutConfirmationResult = { confirmed: false, errors: [error] };
        setPendingLogoutErrors(result.errors);
        return result;
      }
      if (!activeSession) {
        persistLogoutIntent(null);
        clearPendingDrafts();
        setPendingLogout(null);
        setPendingLogoutErrors([]);
        setIsDemo(false);
        setUser(null);
        setCsrfToken(null);
        return { confirmed: true };
      }
      if (activeSession.user.id !== intent.accountId) {
        persistLogoutIntent(null);
        setPendingLogout(null);
        setPendingLogoutErrors([]);
        sessionStorage.removeItem("ftc.demo.persona");
        clearPendingDrafts(activeSession.user.id);
        setIsDemo(false);
        setUser(activeSession.user);
        setCsrfToken(activeSession.csrfToken);
        return { confirmed: true };
      }
      sessionStorage.removeItem("ftc.demo.persona");
      clearPendingDrafts(activeSession.user.id);
      setIsDemo(false);
      setUser(activeSession.user);
      setCsrfToken(activeSession.csrfToken);
      const result = await logoutAndConfirm(activeSession.csrfToken);
      if (!result.confirmed) {
        setPendingLogoutErrors(result.errors);
        return result;
      }
      persistLogoutIntent(null);
      clearPendingDrafts();
      setPendingLogout(null);
      setPendingLogoutErrors([]);
      setIsDemo(false);
      setUser(null);
      setCsrfToken(null);
      return result;
    },
    clear: () => {
      persistLogoutIntent(null);
      setPendingLogout(null);
      setPendingLogoutErrors([]);
      setSessionLookupError(null);
      setSessionLookupStatus(null);
      sessionStorage.removeItem(unverifiedHostedSessionStorageKey);
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
    refreshHostedSession: async () => {
      if (checkingHostedSession) return;
      setCheckingHostedSession(true);
      try {
        const session = await hostedApi.session();
        setSessionLookupError(null);
        if (session) {
          setSessionLookupStatus("active");
          sessionStorage.setItem(unverifiedHostedSessionStorageKey, "active");
        } else {
          setSessionLookupStatus(null);
          sessionStorage.removeItem(unverifiedHostedSessionStorageKey);
        }
      } catch (error) {
        setSessionLookupError(error);
        setSessionLookupStatus("unverified");
        sessionStorage.setItem(unverifiedHostedSessionStorageKey, "unverified");
      } finally {
        setCheckingHostedSession(false);
      }
    },
  }), [user, csrfToken, demo, ready, pendingLogout, pendingLogoutErrors, sessionLookupError, sessionLookupStatus, checkingHostedSession]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function hostedSessionNotice(status: HostedSessionLookupStatus, error: unknown | null): string | null {
  if (status === "active") return "ตรวจพบว่าเซสชันออนไลน์เดิมยังเปิดอยู่ ข้อมูลที่เห็นในหน้านี้ยังเป็นข้อมูลจำลองและแยกจากบัญชีออนไลน์ หากต้องการใช้บัญชีเดิม ให้เข้าสู่ระบบออนไลน์และออกจากระบบให้เรียบร้อย";
  if (status === "unverified") return apiFailureMessages(error ? [error] : [], "ไม่สามารถยืนยันได้ว่าบัญชีออนไลน์ออกจากระบบแล้ว โหมดสาธิตยังใช้ข้อมูลในอุปกรณ์นี้ได้ แต่เซสชันออนไลน์เดิมอาจยังเปิดอยู่ โปรดตรวจสอบสถานะก่อนใช้บัญชีออนไลน์");
  return null;
}

function RequireRole({ role, mode, children }: { role: ApiUser["role"]; mode: "demo" | "hosted"; children: React.ReactNode }) {
  const { user, demo, csrfToken, clear, clearDemo, beginLogout, pendingLogout, pendingLogoutErrors, ready,
    sessionLookupError, sessionLookupStatus, refreshHostedSession, checkingHostedSession } = useAppSession();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  if (!user || user.role !== role) return <Navigate to={demo ? "/demo" : role === "officer" ? "/officer/login" : "/login"} replace />;
  if (demo !== (mode === "demo")) {
    const destination = demo
      ? (role === "officer" ? "/demo/officer" : "/demo/app")
      : (role === "officer" ? "/officer" : "/app");
    return <Navigate to={destination} replace />;
  }
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
        const result = await logoutAndConfirm(csrfToken);
        if (!result.confirmed) {
          setSignOutError(apiFailureMessages(result.errors, "เซิร์ฟเวอร์ยังยืนยันการสิ้นสุดเซสชันไม่ได้ ระบบอาจยังเปิดเซสชันนี้อยู่ กรุณาลองออกจากระบบอีกครั้งก่อนปิดแท็บ"));
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
  const pendingLogoutError = pendingLogout?.accountId === user.id
    ? apiFailureMessages(pendingLogoutErrors, "เซิร์ฟเวอร์ยังยืนยันการสิ้นสุดเซสชันไม่ได้ ระบบอาจยังเปิดเซสชันนี้อยู่ กรุณาลองออกจากระบบอีกครั้งก่อนปิดแท็บ")
    : null;
  return <SiteFrame user={user} demo={demo} onSignOut={signOut} signOutError={signOutError ?? pendingLogoutError} signingOut={signingOut}
    hostedSessionNotice={demo ? hostedSessionNotice(sessionLookupStatus, sessionLookupError) : null}
    onRefreshHostedSession={refreshHostedSession} checkingHostedSession={checkingHostedSession}>{children}</SiteFrame>;
}

function LoginRoute({ officer = false }: { officer?: boolean }) {
  const { setHosted, clear, user, csrfToken, demo, ready, pendingLogout, pendingLogoutErrors, retryPendingLogout, beginLogout } = useAppSession();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  const activeSession = user && csrfToken && !demo ? { user, csrfToken } : null;
  return <LoginPage officer={officer} onLogin={setHosted} onClearSession={clear} activeSession={activeSession} pendingLogout={pendingLogout} pendingLogoutErrors={pendingLogoutErrors} retryPendingLogout={retryPendingLogout} beginLogout={beginLogout} />;
}

function AuthorizedReportRoute({ mode }: { mode: "demo" | "hosted" }) {
  const { user, demo, ready, sessionLookupError, sessionLookupStatus, refreshHostedSession, checkingHostedSession } = useAppSession();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  if (!user) return <Navigate to={mode === "demo" ? "/demo" : "/login"} replace />;
  if (demo !== (mode === "demo")) return <Navigate to={demo ? (user.role === "officer" ? "/demo/officer" : "/demo/app") : (user.role === "officer" ? "/officer" : "/app")} replace />;
  return <SiteFrame user={user} demo={demo}
    hostedSessionNotice={demo ? hostedSessionNotice(sessionLookupStatus, sessionLookupError) : null}
    onRefreshHostedSession={refreshHostedSession} checkingHostedSession={checkingHostedSession}><ReportPage mode={mode} /></SiteFrame>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/officer/login" element={<LoginRoute officer />} />
      <Route path="/demo" element={<DemoEntryRoute />} />
      <Route path="/demo/app" element={<RequireRole role="taxpayer" mode="demo"><DashboardPage mode="demo" /></RequireRole>} />
      <Route path="/app" element={<RequireRole role="taxpayer" mode="hosted"><DashboardPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/cases/:id/edit" element={<RequireRole role="taxpayer" mode="demo"><CaseEditorPage mode="demo" /></RequireRole>} />
      <Route path="/app/cases/:id/edit" element={<RequireRole role="taxpayer" mode="hosted"><CaseEditorPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/cases/:id/result" element={<RequireRole role="taxpayer" mode="demo"><CaseResultPage mode="demo" /></RequireRole>} />
      <Route path="/app/cases/:id/result" element={<RequireRole role="taxpayer" mode="hosted"><CaseResultPage mode="hosted" /></RequireRole>} />
      <Route path="/demo/officer" element={<RequireRole role="officer" mode="demo"><OfficerQueuePage mode="demo" /></RequireRole>} />
      <Route path="/officer" element={<RequireRole role="officer" mode="hosted"><OfficerQueuePage mode="hosted" /></RequireRole>} />
      <Route path="/demo/officer/cases/:id" element={<RequireRole role="officer" mode="demo"><OfficerCasePage mode="demo" /></RequireRole>} />
      <Route path="/officer/cases/:id" element={<RequireRole role="officer" mode="hosted"><OfficerCasePage mode="hosted" /></RequireRole>} />
      <Route path="/demo/reports/:snapshotId" element={<AuthorizedReportRoute mode="demo" />} />
      <Route path="/reports/:snapshotId" element={<AuthorizedReportRoute mode="hosted" />} />
      <Route path="*" element={<main className="page-wrap"><section className="card"><h1>ไม่พบหน้านี้</h1><a href="/login">กลับหน้าเข้าสู่ระบบ</a></section></main>} />
    </Routes>
  );
}

function DemoEntryRoute() {
  const { ready, setDemo, sessionLookupError, sessionLookupStatus, refreshHostedSession, checkingHostedSession } = useAppSession();
  if (!ready) return <main className="page-wrap"><div className="loading-card" role="status">กำลังตรวจสอบเซสชัน…</div></main>;
  return <DemoEntryPage onChoose={setDemo} sessionNotice={hostedSessionNotice(sessionLookupStatus, sessionLookupError)}
    onRefreshHostedSession={refreshHostedSession} checkingHostedSession={checkingHostedSession} />;
}

export function App() {
  return <BrowserRouter><SessionProvider><AppRoutes /></SessionProvider></BrowserRouter>;
}

export function currentErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาลองอีกครั้ง";
}
