import { expect, test } from "@playwright/test";

test("guest can create and resume a local draft without choosing an account role", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "ร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ร่างโดยไม่เข้าสู่ระบบ" })).toBeVisible();
  await expect(page.getByText("ข้อมูลอาจสูญหายเมื่อล้างข้อมูลเว็บไซต์หรือใช้โหมดไม่ระบุตัวตน")).toBeVisible();
  await expect(page.getByRole("button", { name: "เจ้าหน้าที่", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่", exact: true }).click();
  await page.getByRole("button", { name: "บันทึกร่าง", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  const editorUrl = page.url();
  await page.goto("/");
  await page.getByRole("link", { name: "ร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("link", { name: "แก้ไขต่อ", exact: true }).click();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.getByRole("region", { name: "ข้อจำกัดการใช้งานโดยไม่เข้าสู่ระบบ" })).toContainText("ไม่ย้ายเข้าบัญชีให้อัตโนมัติ");
});

test("guest calculation stays a draft and can be exported without officer submission", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน", exact: true }).click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  }
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page.getByRole("region", { name: "สรุปเครดิตภาษี", exact: true })).toContainText("2,500.00 บาท");
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "ทบทวนเอกสารก่อนส่ง", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "ดูรายงาน", exact: true }).click();
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Excel", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(page.getByRole("button", { name: "พิมพ์ / บันทึกเป็น PDF", exact: true })).toBeVisible();
});
