import { expect, test } from "@playwright/test";

const educationalNotice = "ระบบต้นแบบเพื่อการศึกษา ไม่ใช่ระบบของกรมสรรพากร ผลคำนวณใช้ประกอบการกรอก ภ.ง.ด.90/91 เท่านั้น";

test("login and demo entry use concise Thai names and one shared educational notice", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "เข้าสู่ระบบผู้เสียภาษี" })).toBeVisible();
  await expect(page.getByText(educationalNotice, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "ร่างโดยไม่เข้าสู่ระบบ" })).toBeVisible();
  await expect(page.getByText("rd-ftc-demo-2568-v1", { exact: false })).toHaveCount(0);

  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "ร่างโดยไม่เข้าสู่ระบบ" })).toBeVisible();
  await expect(page.getByText(educationalNotice, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "เจ้าหน้าที่" })).toHaveCount(0);
  await expect(page.getByText("FIXTURE DEMONSTRATION", { exact: true })).toHaveCount(0);
});

test("dashboard uses descriptive examples and removes internal version and revision terms", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/demo\/app$/);
  await expect(page.getByRole("heading", { name: "รายการคำนวณเครดิตภาษี" })).toBeVisible();
  await expect(page.getByText(educationalNotice, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "เริ่มคำนวณใหม่" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" })).toBeVisible();
  await expect(page.getByText("rd-ftc-demo-2568-v1", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/ผลคำนวณรุ่น\s+\d+/)).toHaveCount(0);
  await expect(page.getByText("WORKED EXAMPLES", { exact: true })).toHaveCount(0);
});
