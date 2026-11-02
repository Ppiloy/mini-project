import { expect, test } from "@playwright/test";

test("taxpayer can enter the isolated fixture demo and start a draft", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "ทดลองใช้ด้วยข้อมูลตัวอย่าง" })).toBeVisible();
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();

  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.getByRole("heading", { name: "รายการคำนวณเครดิตภาษี" })).toBeVisible();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.getByText("ระบบต้นแบบเพื่อการศึกษา")).toBeVisible();
});
