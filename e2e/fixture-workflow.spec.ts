import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
    await expect(page.getByRole("heading", { name: ["ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ", "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี", "เครดิตภาษีที่คำนวณได้ตามประเทศ", "หลักฐานและตรวจทาน"][step] })).toBeVisible();
  }
}

async function openPartialRemittance(page: import("@playwright/test").Page) {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
}

test("fixture partial-remittance example calculates, saves evidence, submits once, and reaches the officer report", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await expect(page.getByRole("heading", { name: "รายการคำนวณเครดิตภาษี" })).toBeVisible();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await advanceToReview(page);

  const pdf = { name: "ตัวอย่างหลักฐาน.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture evidence preview") };
  for (const name of [
    "แนบหลักฐานภาษีไทย",
    "แนบ: หลักฐานเงินได้",
    "แนบ: หลักฐานภาษีต่างประเทศ",
    "แนบ: หลักฐานการนำเงินเข้าไทย",
  ]) {
    await page.getByLabel(name).setInputFiles(pdf);
    await expect(page.getByText("พร้อมใช้งาน").first()).toBeVisible();
  }
  await expect(page.getByText("ตัวอย่างหลักฐาน.pdf", { exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("region", { name: "สรุปเครดิตภาษี" })).toContainText("2,500.00 บาท");
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const previewId = previewUrl.searchParams.get("preview")!;
  const dashboardCard = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(dashboardCard).toContainText("2,500.00");
  await expect(dashboardCard.getByRole("link", { name: "ดูรายงาน" })).toBeVisible();
  await page.reload();
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "ดูรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/${previewId}$`));
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  await page.goto(`/demo/cases/${caseId}/result?preview=${previewId}`);
  await expect(page.getByRole("region", { name: "สรุปเครดิตภาษี" })).toContainText("2,500.00 บาท");
  await page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(dashboardCard).toContainText("ส่งแล้ว · ข้อมูลตัวอย่าง");
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "ดูรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/[^/]+$`));
  await expect(page.getByText("รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  await page.reload();
  await expect(page.getByText("รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");

  await page.goto("/demo");
  await page.getByRole("button", { name: "เจ้าหน้าที่" }).click();
  await expect(page.getByRole("heading", { name: "คิวกรณีที่ส่งเข้าตรวจสอบ" })).toBeVisible();
  await page.getByRole("link", { name: "ตรวจทาน" }).click();
  await expect(page.getByText("ส่งแล้ว · อ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("heading", { name: "ประวัติการเข้าถึง" })).toBeVisible();
  await page.getByRole("link", { name: "ดูรายงาน" }).click();
  await expect(page.getByRole("heading", { name: "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "พิมพ์ / บันทึกเป็น PDF" })).toBeHidden();
  await expect(page.locator(".print-report")).toBeVisible();
});

test("taxpayer dashboard never presents a stale draft preview or a ready amount for an incomplete calculation", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("region", { name: "สรุปเครดิตภาษี" })).toContainText("2,500.00 บาท");
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const card = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });

  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(card).toContainText("2,500.00");
  await card.getByRole("link", { name: "แก้ไขต่อ" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: /บันทึกแล้ว/ })).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(card).toContainText("ยังไม่มีผลคำนวณที่บันทึกไว้สำหรับร่างนี้");
  await expect(card).not.toContainText("2,500.00");
  await expect(card.getByRole("link", { name: "ดูรายงาน" })).toHaveCount(0);

  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  const incompleteCaseId = new URL(page.url()).pathname.split("/")[3]!;
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ")).toBeVisible();
  await expect(page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  const incompleteCard = page.locator(".case-card").filter({ hasText: incompleteCaseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(incompleteCard).toBeVisible();
  await expect(incompleteCard).not.toContainText(/\d+,\d{3}\.\d{2}/);
  await expect(incompleteCard.getByRole("link", { name: "ดูรายงาน" })).toHaveCount(0);
});

test("editing Thai tax invalidates its confirmation and prevents a ready preview", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("textbox", { name: /^\(L\) - ภาษีที่ต้องชำระในประเทศไทย/ }).fill("100000.01");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีไทยก่อนเครดิต (L)" })).not.toBeChecked();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();

  await expect(page.getByText("จำนวนภาษีไทยก่อนเครดิตหรือข้อมูลรายได้เปลี่ยนแล้ว กรุณายืนยันอีกครั้ง")).toBeVisible();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "ยังสร้างผลคำนวณไม่ได้" })).toBeVisible();
  await expect(page.getByTestId("canonical-worksheet")).toHaveCount(0);
});

test("each review confirmation is one keyboard-operable control that persists after reload", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);

  const thaiTaxConfirmation = page.getByRole("checkbox", { name: /ยืนยันจำนวนภาษีไทยก่อนเครดิต \(L\)/ });
  const sourceConfirmation = page.getByRole("checkbox", { name: /ยืนยันจำนวนภาษีต่างประเทศ \(E\).*แหล่งเงินได้ 1/ });
  await expect(thaiTaxConfirmation).toHaveCount(1);
  await expect(sourceConfirmation).toHaveCount(1);
  await thaiTaxConfirmation.focus();
  await page.keyboard.press("Space");
  await expect(thaiTaxConfirmation).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(thaiTaxConfirmation).toBeChecked();
  await sourceConfirmation.focus();
  await page.keyboard.press("Space");
  await expect(sourceConfirmation).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(sourceConfirmation).toBeChecked();

  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();
  await advanceToReview(page);
  await expect(page.getByRole("checkbox", { name: /ยืนยันจำนวนภาษีไทยก่อนเครดิต \(L\)/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /ยืนยันจำนวนภาษีต่างประเทศ \(E\).*แหล่งเงินได้ 1/ })).toBeChecked();
});

test("form actions have no disabled first Back, duplicate mobile actions, or revision status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await expect(page.getByRole("button", { name: "ย้อนกลับ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ถัดไป", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ถัดไป", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true })).toHaveCount(0);
  await expect(page.locator(".sticky-save")).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.locator(".form-actions")).toContainText("บันทึกแล้ว");
  await expect(page.locator(".form-actions")).not.toContainText("รุ่น");
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  await expect(page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "ถัดไป", exact: true })).toHaveCount(0);
});

test("only previously validated steps are keyboard-navigable", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  const yearStep = page.getByRole("button", { name: "ข้อมูลเบื้องต้น", exact: true });
  await expect(yearStep).toBeEnabled();
  await yearStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2568");
  const reviewStep = page.getByRole("button", { name: "หลักฐานและตรวจทาน", exact: true });
  await expect(reviewStep).toBeEnabled();
  await reviewStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.reload();
  const reloadedReviewStep = page.getByRole("button", { name: "หลักฐานและตรวจทาน", exact: true });
  await expect(reloadedReviewStep).toBeEnabled();
  await reloadedReviewStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
});

test("source deletion keeps linked evidence reachable and asks before deleting an empty source", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  await page.getByLabel("แนบ: หลักฐานเงินได้").setInputFiles({ name: "หลักฐานเงินได้.pdf", mimeType: "application/pdf", buffer: Buffer.from("source evidence") });
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ", exact: true }).click();
  const sourceCard = page.locator(".source-card").filter({ has: page.getByRole("heading", { name: "แหล่งเงินได้ 1" }) });
  await page.getByRole("button", { name: "ลบแหล่งเงินได้ 1" }).click();
  await expect(sourceCard).toBeVisible();
  await expect(page.getByText(/ยังมีไฟล์แนบ.*ลบไฟล์ในขั้นหลักฐานก่อน/)).toBeVisible();
  await page.getByRole("button", { name: "ไปยังหลักฐานแหล่งเงินได้ 1" }).click();
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ", exact: true }).click();
  await page.getByRole("button", { name: "ลบแหล่งเงินได้ 1" }).click();
  const deletionPrompt = page.getByRole("alertdialog", { name: "ยืนยันการลบแหล่งเงินได้ 1" });
  await expect(deletionPrompt).toBeVisible();
  await expect(sourceCard).toBeVisible();
  await deletionPrompt.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(sourceCard).toBeVisible();
  await page.getByRole("button", { name: "ลบแหล่งเงินได้ 1" }).click();
  await page.getByRole("alertdialog", { name: "ยืนยันการลบแหล่งเงินได้ 1" }).getByRole("button", { name: "ยืนยันลบรายการ" }).click();
  await expect(sourceCard).toHaveCount(0);
});

test("zero eligible tax permits one combined source file with income and remittance checklist only", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ }).fill("0.00");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีไทยก่อนเครดิต (L)" }).check();
  await page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีต่างประเทศ (E) · แหล่งเงินได้ 1" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานเงินได้" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานการนำเงินเข้าไทย" }).check();
  await expect(page.getByRole("checkbox", { name: "หลักฐานภาษีต่างประเทศ" })).toHaveCount(0);

  await page.getByLabel("แนบ: เอกสารอื่น").setInputFiles({ name: "รายงานรวม.pdf", mimeType: "application/pdf", buffer: Buffer.from("combined source evidence") });
  await expect(page.getByText("รายงานรวม.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
});

test("zero remittance needs no source evidence checklist", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ }).fill("0");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByText("(F) = 0: ระบบไม่กำหนดให้แนบหลักฐานแหล่งเงินได้สำหรับยอดที่ไม่ได้นำเข้าไทย")).toBeVisible();
  await expect(page.locator(".evidence-checklist")).toHaveCount(0);
});

test("retired transfer-total and classification controls are absent", async ({ page }) => {
  await openPartialRemittance(page);
  await expect(page.getByLabel("ยอดโอนทั้งหมด (ข้อมูลประกอบ)")).toHaveCount(0);
  await expect(page.getByLabel("ลักษณะการโอน")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ })).toHaveValue("25000.00");
});

test("unsupported tax year stays visible and does not produce an ordinary credit result", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "คำนวณเครดิตภาษี", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();
  await expect(page.getByRole("region", { name: "ข้อมูลเบื้องต้น" }).getByRole("alert").filter({ hasText: "ต้นแบบรองรับเฉพาะปีภาษี 2568 (ค.ศ. 2025)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);
});

test("zero D and F greater than D are blocked with source-specific messages", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }).fill("-1");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByText(/แหล่งเงินได้ 1.*ตรวจสอบรูปแบบหรือค่าของ\(D\) - จำนวนเงินได้ในต่างประเทศ/)).toBeVisible();
  const negativeDLink = page.getByRole("button", { name: /ไปยัง\(D\) - จำนวนเงินได้ในต่างประเทศ.*แหล่งเงินได้ 1/ });
  await expect(negativeDLink).toBeVisible();
  await negativeDLink.click();
  await expect(page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toBeFocused();

  await page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }).fill("0");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*เงินได้ต้นทางต้องมากกว่าศูนย์เพื่อใช้เป็นตัวหาร/)).toBeVisible();
  const zeroDLink = page.getByRole("button", { name: /ไปยัง\(D\) - จำนวนเงินได้ในต่างประเทศ.*แหล่งเงินได้ 1/ });
  await zeroDLink.click();
  await expect(page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toBeFocused();

  await page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }).fill("50000");
  await page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ }).fill("50000.01");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*เงินได้ที่นำเข้าต้องไม่เกินเงินได้ต้นทาง/)).toBeVisible();
  const fLink = page.getByRole("button", { name: /ไปยัง\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ.*แหล่งเงินได้ 1/ });
  await fLink.click();
  await expect(page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ })).toBeFocused();
});

test("missing original-currency FX is linked to its source and remains saveable", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();
  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  await page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }).fill("100");
  await page.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ }).fill("20");
  await page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ }).fill("50");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-01-01");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*กรุณากรอกอัตราแลกเปลี่ยนให้ครบก่อนดำเนินการต่อ/)).toBeVisible();
  const fxErrorLink = page.getByRole("button", { name: "ไปยังอัตราแลกเปลี่ยนของแหล่งเงินได้ 1" });
  await expect(fxErrorLink).toBeVisible();
  await fxErrorLink.click();
  await expect(page.getByLabel("อัตรา THB ต่อหน่วยฐาน")).toBeFocused();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
});

test("an unsupported but well-formed draft saves, reloads, and warns before leaving unsaved edits", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await expect(page.locator(".save-status")).not.toContainText("รุ่น");
  await page.reload();
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2567");

  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "หน้าหลักเครดิตภาษีต่างประเทศ" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2568");
});

test("the fixture entry and form work by keyboard at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  const taxpayerEntry = page.getByRole("button", { name: "ผู้เสียภาษี" });
  await taxpayerEntry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\/app$/);
  const create = page.getByRole("button", { name: "เริ่มคำนวณใหม่" });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  const width = await page.evaluate("document.documentElement.scrollWidth");
  expect(width).toBeLessThanOrEqual(390);
});

test("Next explains the missing source while an incomplete draft can still be saved", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ")).toBeVisible();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*กรุณากรอก\(B\) - ประเทศแหล่งเงินได้/)).toBeVisible();
  await page.getByRole("button", { name: "บันทึกร่าง", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByText(/แหล่งเงินได้ 1.*กรุณากรอก\(B\) - ประเทศแหล่งเงินได้/)).toBeVisible();

  const countryLink = page.getByRole("button", { name: "ไปยัง(B) - ประเทศแหล่งเงินได้ของแหล่งเงินได้ 1" });
  await countryLink.click();
  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await expect(country).toBeFocused();
  await country.fill("VN");
  await page.getByRole("option", { name: /เวียดนาม \(VN\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-31");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("worksheet_thb");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("แหล่งเงินได้ 1 (เวียดนาม · 40(1) เงินเดือนหรือค่าจ้าง): กรุณากรอก(D) - จำนวนเงินได้ในต่างประเทศให้ครบก่อนดำเนินการต่อ")).toBeVisible();
  const grossIncomeLink = page.getByRole("button", { name: /ไปยัง\(D\) - จำนวนเงินได้ในต่างประเทศ.*แหล่งเงินได้ 1/ });
  await grossIncomeLink.click();
  await expect(page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toBeFocused();
  await page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }).fill("50000");
  await page.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ }).fill("4000");
  await page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ }).fill("25000");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-02-15");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" })).toBeVisible();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" })).toBeVisible();
  await expect(page.getByText("กรุณากรอก(J) - เงินได้พึงประเมินในประเทศไทยให้ครบก่อนดำเนินการต่อ")).toBeVisible();
  const jLink = page.getByRole("button", { name: "ไปยัง(J) - เงินได้พึงประเมินในประเทศไทย" });
  await jLink.click();
  await expect(page.getByRole("textbox", { name: /^\(J\) - เงินได้พึงประเมินในประเทศไทย/ })).toBeFocused();
  await page.getByRole("textbox", { name: /^\(J\) - เงินได้พึงประเมินในประเทศไทย/ }).fill("100000");
  await page.getByRole("textbox", { name: /^\(L\) - ภาษีที่ต้องชำระในประเทศไทย/ }).fill("10000");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "เครดิตภาษีที่คำนวณได้ตามประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
});
