import { expect, test } from "@playwright/test";

test("taxpayer can enter the isolated fixture demo and start a draft", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "สาธิตระบบต้นแบบ" })).toBeVisible();
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();

  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "ปีภาษีและขอบเขตกรณี" })).toBeVisible();
  await expect(page.getByText("ระบบต้นแบบเพื่อการศึกษา")).toBeVisible();
});
