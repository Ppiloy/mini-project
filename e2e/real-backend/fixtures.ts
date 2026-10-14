import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { apiSuccessSchemas } from "../../shared/contracts.js";

export type DemoLoginName = "taxpayer-demo-a" | "taxpayer-demo-b" | "officer-demo";
export interface DemoCredential { loginName: DemoLoginName; password: string }
export interface OperatorSeed {
  credentials: DemoCredential[];
  FTC_OFFICER_USER_ID: string;
}

export async function operatorSeed(): Promise<OperatorSeed> {
  const filename = process.env.FTC_REAL_BROWSER_CREDENTIALS_FILE;
  if (!filename) throw new Error("Playwright did not receive the private per-run account file path.");
  return JSON.parse(await readFile(filename, "utf8")) as OperatorSeed;
}

export async function login(page: Page, credential: DemoCredential, officer = false) {
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
  await page.goto(officer ? "/officer/login" : "/login");
  await page.getByLabel("ชื่อผู้ใช้").fill(credential.loginName);
  await page.getByLabel("รหัสผ่าน").fill(credential.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const envelope = await response.json() as { data?: { csrfToken?: string; user?: { id?: string } } };
  expect(apiSuccessSchemas.session.safeParse(envelope).success).toBe(true);
  expect(envelope.data?.csrfToken).toBeTruthy();
  expect(envelope.data?.user?.id).toBeTruthy();
  if (officer) await expect(page).toHaveURL(/\/officer$/);
  else await expect(page).toHaveURL(/\/app$/);
  return { csrfToken: envelope.data!.csrfToken!, userId: envelope.data!.user!.id! };
}

export async function createCase(page: Page): Promise<string> {
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/cases") && response.request().method() === "POST");
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const envelope = await response.json() as { data?: { case?: { id?: string } } };
  expect(apiSuccessSchemas.case.safeParse(envelope).success).toBe(true);
  const id = envelope.data?.case?.id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page).toHaveURL(new RegExp(`/app/cases/${id}/edit$`));
  return id!;
}

export async function advance(page: Page) {
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
}

export async function browserApi(page: Page, path: string, init?: { method?: string; csrfToken?: string; body?: unknown }) {
  return page.evaluate(async ({ path, method, csrfToken, body }) => {
    const headers: Record<string, string> = {};
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { method: method ?? "GET", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let json: unknown = null;
    try { json = await response.json(); } catch { /* response may intentionally be empty */ }
    return { status: response.status, json };
  }, { path, method: init?.method, csrfToken: init?.csrfToken, body: init?.body });
}
