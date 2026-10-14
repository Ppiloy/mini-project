import { expect, test } from "@playwright/test";

const user = { id: "taxpayer-logout", loginName: "taxpayer", displayName: "ผู้เสียภาษีทดสอบ", role: "taxpayer", maskedReference: null };
const session = { user, csrfToken: "csrf-logout-test" };

async function installHostedDashboard(page: import("@playwright/test").Page, isAuthenticated: () => boolean, onLogout: () => { status: number; body: object }) {
  await page.route("**/api/auth/session", (route) => {
    if (isAuthenticated()) return route.fulfill({ json: { data: session, requestId: "session-active" } });
    return route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Session ended", requestId: "session-anonymous" } } });
  });
  await page.route("**/api/cases", (route) => route.fulfill({ json: { data: { cases: [] }, requestId: "cases" } }));
  await page.route("**/api/auth/logout", async (route) => {
    const result = onLogout();
    await route.fulfill({ status: result.status, json: result.body });
  });
}

test("a failed logout stays visible and an authenticated session remains private", async ({ page }) => {
  let authenticated = true;
  let logoutCalls = 0;
  await installHostedDashboard(page, () => authenticated, () => {
    logoutCalls += 1;
    return { status: 503, body: { error: { code: "service_unavailable", message: "Logout service unavailable", requestId: "logout-503" } } };
  });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ออกจากระบบยังไม่สำเร็จ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ลองออกจากระบบอีกครั้ง" })).toBeEnabled();
  expect(logoutCalls).toBe(1);

  await page.reload();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
});

test("a failed response followed by anonymous session confirmation completes logout", async ({ page }) => {
  let authenticated = true;
  let sessionCalls = 0;
  await page.route("**/api/auth/session", (route) => {
    sessionCalls += 1;
    if (authenticated) return route.fulfill({ json: { data: session, requestId: "session-active" } });
    return route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Session ended", requestId: "session-anonymous" } } });
  });
  await page.route("**/api/cases", (route) => route.fulfill({ json: { data: { cases: [] }, requestId: "cases" } }));
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    await route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Response was lost", requestId: "logout-lost" } } });
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(sessionCalls).toBe(2);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeVisible();
});

test("an unavailable session check keeps logout visibly unresolved", async ({ page }) => {
  let sessionCalls = 0;
  await page.route("**/api/auth/session", (route) => {
    sessionCalls += 1;
    if (sessionCalls === 1) return route.fulfill({ json: { data: session, requestId: "session-active" } });
    return route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Status unavailable", requestId: "session-503" } } });
  });
  await page.route("**/api/cases", (route) => route.fulfill({ json: { data: { cases: [] }, requestId: "cases" } }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Logout unavailable", requestId: "logout-503" } } }));

  await page.goto("/app");
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("alert").filter({ hasText: "ระบบอาจยังเปิดเซสชันนี้อยู่" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ลองออกจากระบบอีกครั้ง" })).toBeEnabled();
});

test("retry confirms logout, clears pending browser state, and denies private access after reload", async ({ page }) => {
  let authenticated = true;
  let logoutCalls = 0;
  await installHostedDashboard(page, () => authenticated, () => {
    logoutCalls += 1;
    if (logoutCalls === 1) return { status: 503, body: { error: { code: "service_unavailable", message: "Try again", requestId: "logout-retry" } } };
    authenticated = false;
    return { status: 200, body: { data: { loggedOut: true }, requestId: "logout-success" } };
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("ftc.hosted.pending.taxpayer-logout.case-a", "draft");
    sessionStorage.setItem("ftc.submit.pending.taxpayer-logout.case-a.snapshot-a", "request");
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ออกจากระบบยังไม่สำเร็จ" })).toBeVisible();
  await page.getByRole("button", { name: "ลองออกจากระบบอีกครั้ง" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logoutCalls).toBe(2);
  expect(await page.evaluate("Object.keys(sessionStorage).filter((key) => key.startsWith('ftc.hosted.pending.') || key.startsWith('ftc.submit.pending.')).length")).toBe(0);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toHaveCount(0);
});

test("fixture sign-out clears the local demo identity without a hosted logout call", async ({ page }) => {
  let logoutCalls = 0;
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "No hosted session", requestId: "anonymous" } } }));
  await page.route("**/api/auth/logout", (route) => { logoutCalls += 1; return route.fulfill({ status: 500 }); });
  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
  await expect(page).toHaveURL(/\/demo\/app$/);
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logoutCalls).toBe(0);
  expect(await page.evaluate("sessionStorage.getItem('ftc.demo.persona')")).toBe(null);
});

test("wrong-role login replaces the old account, clears its cache, and keeps cleanup retry available", async ({ page }) => {
  const wrongRoleCsrf = "wrong-role-csrf";
  const taxpayer = { id: "owner-a", loginName: "user-a", displayName: "ผู้เสียภาษี A", role: "taxpayer", maskedReference: null };
  const officer = { id: "officer-a", loginName: "officer-a", displayName: "เจ้าหน้าที่ A", role: "officer", maskedReference: null };
  let activeUser: typeof taxpayer | typeof officer | null = taxpayer;
  let logoutCalls = 0;
  await page.addInitScript(() => {
    if (sessionStorage.getItem("ftc.test.wrong-role-seeded")) return;
    sessionStorage.setItem("ftc.test.wrong-role-seeded", "1");
    sessionStorage.setItem("ftc.hosted.pending.owner-a.case-1", JSON.stringify({ ownerId: "owner-a", caseId: "case-1", draft: { id: "case-1", secret: "typed draft" } }));
    sessionStorage.setItem("ftc.submit.pending.owner-a.case-1.snapshot-1", "request-id");
  });
  await page.route("**/api/auth/session", (route) => activeUser
    ? route.fulfill({ json: { data: { user: activeUser, csrfToken: wrongRoleCsrf }, requestId: "session" } })
    : route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "Session ended", requestId: "anonymous" } } }));
  await page.route("**/api/auth/login", async (route) => {
    activeUser = officer;
    await route.fulfill({ json: { data: { user: officer, csrfToken: wrongRoleCsrf }, requestId: "login-officer" } });
  });
  await page.route("**/api/auth/logout", async (route) => {
    logoutCalls += 1;
    if (logoutCalls === 1) {
      await route.fulfill({ status: 503, json: { error: { code: "service_unavailable", message: "Cleanup unavailable", requestId: "cleanup-503" } } });
    } else {
      activeUser = null;
      await route.fulfill({ json: { data: { loggedOut: true }, requestId: "cleanup-retried" } });
    }
  });
  await page.route("**/api/cases", (route) => activeUser?.role === "taxpayer"
    ? route.fulfill({ json: { data: { cases: [] }, requestId: "cases-taxpayer" } })
    : route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "Taxpayer role required", requestId: "cases-forbidden" } } }));

  await page.goto("/app");
  await expect(page.getByRole("banner").getByText("ผู้เสียภาษี A")).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้").fill("officer-a");
  await page.getByLabel("รหัสผ่าน").fill("password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "ยังออกจากระบบไม่สำเร็จ" })).toBeVisible();
  expect(await page.evaluate("Object.keys(sessionStorage).filter((key) => key.includes('owner-a')).length")).toBe(0);

  await page.evaluate("{ history.pushState({}, '', '/app'); window.dispatchEvent(new PopStateEvent('popstate')); }");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("ผู้เสียภาษี A")).toHaveCount(0);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("alert").filter({ hasText: "กรุณาใช้บัญชีผู้เสียภาษีที่กำหนดไว้" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ลองปิดเซสชันอีกครั้ง" })).toBeVisible();
  expect(await page.evaluate("Object.keys(sessionStorage).filter((key) => key.includes('owner-a')).length")).toBe(0);

  await page.getByRole("button", { name: "ลองปิดเซสชันอีกครั้ง" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logoutCalls).toBe(2);
  expect(activeUser).toBe(null);
});
