import { expect, test } from "@playwright/test";

test("a new case cannot leave the first step without an explicit income-earned-year residence record", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.locator(".dashboard-heading .button-primary").click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  const scope = page.locator(".info-callout");
  await expect(scope).toContainText("ปี 2025");
  await expect(scope).toContainText("หนึ่งรายการนำเข้าต่อแหล่งเงินได้");
  await expect(scope).toContainText("เวียดนามหรือจีน");
  await expect(scope).toContainText("40(1)");
  await expect(scope).toContainText("40(4)");

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "เพิ่มข้อมูลวันพำนักอย่างน้อยหนึ่งปีที่เกิดเงินได้" })).toBeVisible();
});

test("a 179-day record cannot be switched to a declaration, while an explicit 180-day period can proceed", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.locator(".dashboard-heading .button-primary").click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-06-28");
  const mode = page.getByLabel("รูปแบบข้อมูลวันพำนัก");
  await expect(page.getByRole("status", { name: "สรุปวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" })).toContainText("179 วัน");
  await expect(mode.locator('option[value="declared"]')).toHaveAttribute("disabled", "");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();

  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-06-29");
  await expect(page.getByRole("status", { name: "สรุปวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" })).toContainText("180 วัน");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
});

test("a declaration-only record stays visibly unverified and does not invent an exact day total", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.locator(".dashboard-heading .button-primary").click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByLabel("รูปแบบข้อมูลวันพำนัก").selectOption("declared");
  const status = page.getByRole("status", { name: "สถานะคำยืนยันวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" });
  await expect(status).toContainText("ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน");
  await expect(status).toContainText("ยังไม่ผ่านการตรวจสอบ");
  await expect(status).toContainText("ไม่มีการระบุจำนวนวันแน่นอน");
  await page.getByRole("button", { name: "ลบข้อมูลวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await expect(page.getByRole("alertdialog", { name: "ยืนยันการลบข้อมูลวันพำนัก" })).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(status).toContainText("ยังไม่ผ่านการตรวจสอบ");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
});

test("the income worksheet labels a declaration as unverified and links back to its earned-year record", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.locator(".dashboard-heading .button-primary").click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByLabel("รูปแบบข้อมูลวันพำนัก").selectOption("declared");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");

  const declaration = page.getByText("ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน · ยังไม่ผ่านการตรวจสอบ");
  await expect(declaration).toBeVisible();
  await expect(page.locator("#source-0-residenceDaysInEarnedYear")).toHaveCount(1);
  await expect(page.locator("label.field:has(#source-0-residenceDaysInEarnedYear)")).toContainText("ไม่มีจำนวนวันแน่นอน");
  await page.getByRole("button", { name: "ดูข้อมูลวันพำนักปี พ.ศ. 2568" }).click();

  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.locator("#residence-year-2025-mode")).toBeFocused();
});

test("an empty residence-year record directs the user to its add-period control", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.locator(".dashboard-heading .button-primary").click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "เพิ่มช่วงวันที่พำนัก" })).toBeVisible();

  await page.getByRole("button", { name: "ไปยังข้อมูลวันพำนัก" }).click();

  await expect(page.locator("#residence-year-2025-add")).toBeFocused();
});

test("a legacy fixture with 179 earned-year residence days cannot leave the first step", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-06-28");

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "ต่ำกว่า 180 วัน" })).toBeVisible();
});
