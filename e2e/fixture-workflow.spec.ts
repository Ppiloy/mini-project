import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
    await expect(page.getByRole("heading", { name: ["แหล่งเงินได้จากต่างประเทศ", "การนำเงินเข้าและภาษีต่างประเทศ", "เงินได้ในประเทศและภาษีไทย", "หลักฐานและตรวจทาน"][step] })).toBeVisible();
  }
}

async function openPartialRemittance(page: import("@playwright/test").Page) {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
}

test("fixture partial-remittance example calculates, saves evidence, submits once, and reaches the officer report", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await expect(page.getByRole("heading", { name: "กรณีของผู้เสียภาษีตัวอย่าง" })).toBeVisible();
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await advanceToReview(page);

  const pdf = { name: "ตัวอย่างหลักฐาน.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture evidence preview") };
  for (const name of [
    "แนบหลักฐานภาษีไทย",
    "แนบ: หลักฐานเงินได้ต่างประเทศ",
    "แนบ: หลักฐานภาษีที่ชำระในต่างประเทศ",
    "แนบ: หลักฐานการนำเงินเข้าไทย",
  ]) {
    await page.getByLabel(name).setInputFiles(pdf);
    await expect(page.getByText("พร้อมใช้งาน").first()).toBeVisible();
  }
  await expect(page.getByText("ตัวอย่างหลักฐาน.pdf", { exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const previewId = previewUrl.searchParams.get("preview")!;
  const dashboardCard = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(dashboardCard).toContainText("2,500.00");
  await expect(dashboardCard.getByRole("link", { name: "ดูรายงาน" })).toBeVisible();
  await page.reload();
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "ดูรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/${previewId}$`));
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  await page.goto(`/demo/cases/${caseId}/result?preview=${previewId}`);
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  await page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(dashboardCard).toContainText("ส่งแล้ว · คิวจำลอง");
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "ดูรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/[^/]+$`));
  await expect(page.getByText("รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  await page.reload();
  await expect(page.getByText("รายงานจากผลที่ส่งแล้ว · แสดงแบบอ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");

  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะเจ้าหน้าที่" }).click();
  await expect(page.getByRole("heading", { name: "คิวกรณีที่ส่งเข้าตรวจสอบ" })).toBeVisible();
  await page.getByRole("link", { name: "ตรวจทานแบบอ่านอย่างเดียว" }).click();
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
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByRole("region", { name: "รวมเครดิตภาษีที่สามารถใช้ได้ตามกฎหมายไทย" })).toContainText("2,500.00 บาท");
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const card = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });

  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(card).toContainText("2,500.00");
  await card.getByRole("link", { name: "แก้ไขต่อ" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: /บันทึกแล้ว/ })).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(card).toContainText("ยังไม่มีผลคำนวณสำหรับร่างรุ่นปัจจุบัน");
  await expect(card).not.toContainText("2,500.00");
  await expect(card.getByRole("link", { name: "ดูรายงาน" })).toHaveCount(0);

  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  const incompleteCaseId = new URL(page.url()).pathname.split("/")[3]!;
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "แหล่งเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ")).toBeVisible();
  await expect(page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" })).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  const incompleteCard = page.locator(".case-card").filter({ hasText: incompleteCaseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(incompleteCard).toBeVisible();
  await expect(incompleteCard).not.toContainText(/\d+,\d{3}\.\d{2}/);
  await expect(incompleteCard.getByRole("link", { name: "ดูรายงาน" })).toHaveCount(0);
});

test("editing Thai tax invalidates its confirmation and prevents a ready preview", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByLabel("L · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ").fill("100000.01");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย L" })).not.toBeChecked();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();

  await expect(page.getByText("ข้อมูลรายได้ อัตราแลกเปลี่ยน หรือที่มาของภาษีไทยเปลี่ยนแล้ว กรุณายืนยันภาษีไทยอีกครั้ง")).toBeVisible();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "ยังสร้างผลคำนวณไม่ได้" })).toBeVisible();
  await expect(page.getByTestId("canonical-worksheet")).toHaveCount(0);
});

test("each review confirmation is one keyboard-operable control that persists after reload", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);

  const thaiTaxConfirmation = page.getByRole("checkbox", { name: /ยืนยัน.*ภาษีไทย L/ });
  const sourceConfirmation = page.getByRole("checkbox", { name: /ยืนยัน E.*แหล่งเงินได้ 1/ });
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
  await expect(page.getByRole("checkbox", { name: /ยืนยัน.*ภาษีไทย L/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /ยืนยัน E.*แหล่งเงินได้ 1/ })).toBeChecked();
});

test("form actions have no disabled first Back, duplicate mobile actions, or revision status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await expect(page.getByRole("button", { name: "ย้อนกลับ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "บันทึกและถัดไป" })).toBeVisible();
  await expect(page.getByRole("button", { name: "บันทึกและถัดไป" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" })).toHaveCount(0);
  await expect(page.locator(".sticky-save")).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.locator(".form-actions")).toContainText("บันทึกแล้ว");
  await expect(page.locator(".form-actions")).not.toContainText("รุ่น");
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);
  await expect(page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" })).toBeVisible();
  await expect(page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "บันทึกและถัดไป" })).toHaveCount(0);
});

test("only previously validated steps are keyboard-navigable", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);
  const yearStep = page.getByRole("button", { name: "ปีภาษี", exact: true });
  await expect(yearStep).toBeEnabled();
  await yearStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "ปีภาษีและขอบเขตกรณี" })).toBeVisible();
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2568");
  const reviewStep = page.getByRole("button", { name: "หลักฐานและทบทวน", exact: true });
  await expect(reviewStep).toBeEnabled();
  await reviewStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.reload();
  const reloadedReviewStep = page.getByRole("button", { name: "หลักฐานและทบทวน", exact: true });
  await expect(reloadedReviewStep).toBeEnabled();
  await reloadedReviewStep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
});

test("source deletion keeps linked evidence reachable and asks before deleting an empty source", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างนำเข้า 50% · G = 2,500" }).click();
  await advanceToReview(page);
  await page.getByLabel("แนบ: หลักฐานเงินได้ต่างประเทศ").setInputFiles({ name: "หลักฐานเงินได้.pdf", mimeType: "application/pdf", buffer: Buffer.from("source evidence") });
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "เงินได้", exact: true }).click();
  const sourceCard = page.locator(".source-card").filter({ has: page.getByRole("heading", { name: "แหล่งเงินได้ 1" }) });
  await page.getByRole("button", { name: "ลบแหล่งเงินได้ 1" }).click();
  await expect(sourceCard).toBeVisible();
  await expect(page.getByText(/ยังมีไฟล์แนบ.*ลบไฟล์ในขั้นหลักฐานก่อน/)).toBeVisible();
  await page.getByRole("button", { name: "ไปยังหลักฐานแหล่งเงินได้ 1" }).click();
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(page.getByText("หลักฐานเงินได้.pdf", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "เงินได้", exact: true }).click();
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
  await page.getByLabel("E · ภาษีที่สมมติว่าเข้าเกณฑ์").fill("0.00");
  await page.getByLabel("เหตุผลของสมมติฐาน E").fill("ในตัวอย่างนี้ไม่ได้ขอใช้เครดิตภาษีต่างประเทศ");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย L" }).check();
  await page.getByRole("checkbox", { name: "ยืนยัน E และเหตุผล · แหล่งเงินได้ 1" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานเงินได้ต่างประเทศ" }).check();
  await page.getByRole("checkbox", { name: "หลักฐานการนำเงินเข้าไทย" }).check();
  await expect(page.getByRole("checkbox", { name: "หลักฐานภาษีที่ชำระในต่างประเทศ" })).toHaveCount(0);

  await page.getByLabel("แนบ: หลักฐานรวม / เอกสารอื่น").setInputFiles({ name: "รายงานรวม.pdf", mimeType: "application/pdf", buffer: Buffer.from("combined source evidence") });
  await expect(page.getByText("รายงานรวม.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
});

test("zero remittance needs no source evidence checklist", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย").fill("0");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByText("F = 0: ระบบไม่กำหนดให้แนบหลักฐานแหล่งเงินได้สำหรับยอดที่ไม่ได้นำเข้าไทย")).toBeVisible();
  await expect(page.locator(".evidence-checklist")).toHaveCount(0);
});

test("retired transfer-total and classification controls are absent", async ({ page }) => {
  await openPartialRemittance(page);
  await expect(page.getByLabel("ยอดโอนทั้งหมด (ข้อมูลประกอบ)")).toHaveCount(0);
  await expect(page.getByLabel("ลักษณะการโอน")).toHaveCount(0);
  await expect(page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย")).toHaveValue("25000.00");
});

test("unsupported tax year stays visible and does not produce an ordinary credit result", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่างเวียดนามและจีน · 143,544.30" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "ปีภาษีและขอบเขตกรณี" })).toBeVisible();
  await expect(page.getByRole("region", { name: "ปีภาษีและขอบเขตกรณี" }).getByRole("alert").filter({ hasText: "ต้นแบบรองรับเฉพาะปีภาษี 2568 (ค.ศ. 2025)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งให้เจ้าหน้าที่ตรวจ" })).toHaveCount(0);
});

test("zero D and F greater than D are blocked with source-specific messages", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("-1");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByText(/แหล่งเงินได้ 1.*ตรวจสอบรูปแบบหรือค่าของจำนวนเงินได้ต้นทาง \(D\)/)).toBeVisible();
  const negativeDLink = page.getByRole("button", { name: /ไปยังจำนวนเงินได้ต้นทาง \(D\).*แหล่งเงินได้ 1/ });
  await expect(negativeDLink).toBeVisible();
  await negativeDLink.click();
  await expect(page.getByLabel("D · เงินได้พึงประเมินต้นทาง")).toBeFocused();

  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("0");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*เงินได้ต้นทางต้องมากกว่าศูนย์เพื่อใช้เป็นตัวหาร/)).toBeVisible();
  const zeroDLink = page.getByRole("button", { name: /ไปยังจำนวนเงินได้ต้นทาง \(D\).*แหล่งเงินได้ 1/ });
  await zeroDLink.click();
  await expect(page.getByLabel("D · เงินได้พึงประเมินต้นทาง")).toBeFocused();

  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("50000");
  await page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย").fill("50000.01");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();
  await expect(page.getByText(/แหล่งเงินได้ 1.*เงินได้ที่นำเข้าต้องไม่เกินเงินได้ต้นทาง/)).toBeVisible();
  const fLink = page.getByRole("button", { name: /ไปยังเงินได้ที่นำเข้าไทย \(F\).*แหล่งเงินได้ 1/ });
  await fLink.click();
  await expect(page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย")).toBeFocused();
});

test("missing original-currency FX is linked to its source and remains saveable", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();
  await page.getByRole("combobox", { name: /ประเทศที่เกิดเงินได้/ }).selectOption("US");
  await page.getByRole("combobox", { name: "ประเภทเงินได้", exact: true }).selectOption("salary_40_1");
  await page.getByRole("textbox", { name: "วันที่เกิดเงินได้", exact: true }).fill("2025-01-01");
  await page.getByRole("textbox", { name: /วันพำนักในประเทศไทยในปีที่เกิดเงินได้/ }).fill("200");
  await page.getByRole("combobox", { name: "รูปแบบการกรอก", exact: true }).selectOption("original_currency");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("100");
  await page.getByLabel("ภาษีต่างประเทศที่ชำระจริง").fill("20");
  await page.getByLabel("E · ภาษีที่สมมติว่าเข้าเกณฑ์").fill("10");
  await page.getByLabel("เหตุผลของสมมติฐาน E").fill("สมมติฐานเพื่อทดสอบช่องอัตราแลกเปลี่ยนที่จำเป็น");
  await page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย").fill("50");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-01-01");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();

  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();
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
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await expect(page.locator(".save-status")).not.toContainText("รุ่น");
  await page.reload();
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2567");

  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  await expect(page.getByLabel("ปีภาษี (พ.ศ.)")).toHaveValue("2568");
});

test("the fixture entry and form work by keyboard at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  const taxpayerEntry = page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" });
  await taxpayerEntry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\/app$/);
  const create = page.getByRole("button", { name: "สร้างกรณีใหม่" });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/edit$/);
  const width = await page.evaluate("document.documentElement.scrollWidth");
  expect(width).toBeLessThanOrEqual(390);
});

test("Next explains the missing source while an incomplete draft can still be saved", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "แหล่งเงินได้จากต่างประเทศ" })).toBeVisible();

  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();

  await expect(page.getByRole("heading", { name: "แหล่งเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("เพิ่มแหล่งเงินได้อย่างน้อยหนึ่งรายการก่อนดำเนินการต่อ")).toBeVisible();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "แหล่งเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("แหล่งเงินได้ 1: เลือกประเทศที่เกิดเงินได้ก่อนดำเนินการต่อ")).toBeVisible();
  const countryLink = page.getByRole("button", { name: "ไปยังประเทศที่เกิดเงินได้ของแหล่งเงินได้ 1" });
  await countryLink.click();
  await expect(page.getByRole("combobox", { name: /ประเทศที่เกิดเงินได้/ })).toBeFocused();
  await page.getByRole("combobox", { name: /ประเทศที่เกิดเงินได้/ }).selectOption("VN");
  await page.getByRole("combobox", { name: "ประเภทเงินได้", exact: true }).selectOption("salary_40_1");
  await page.getByRole("textbox", { name: "วันที่เกิดเงินได้", exact: true }).fill("2025-01-31");
  await page.getByRole("textbox", { name: /วันพำนักในประเทศไทยในปีที่เกิดเงินได้/ }).fill("200");
  await page.getByRole("combobox", { name: "รูปแบบการกรอก", exact: true }).selectOption("worksheet_thb");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "การนำเงินเข้าและภาษีต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("แหล่งเงินได้ 1 (เวียดนาม · 40(1) เงินเดือนหรือค่าจ้าง): กรุณากรอกจำนวนเงินได้ต้นทาง (D) ให้ครบก่อนดำเนินการต่อ")).toBeVisible();
  const grossIncomeLink = page.getByRole("button", { name: /ไปยังจำนวนเงินได้ต้นทาง \(D\).*แหล่งเงินได้ 1/ });
  await grossIncomeLink.click();
  await expect(page.getByLabel("D · เงินได้พึงประเมินต้นทาง")).toBeFocused();
  await page.getByLabel("D · เงินได้พึงประเมินต้นทาง").fill("50000");
  await page.getByLabel("ภาษีต่างประเทศที่ชำระจริง").fill("5000");
  await page.getByLabel("E · ภาษีที่สมมติว่าเข้าเกณฑ์").fill("4000");
  await page.getByLabel("เหตุผลของสมมติฐาน E").fill("ระบุสมมติฐานภาษีที่เข้าเกณฑ์สำหรับตัวอย่างนี้");
  await page.getByLabel("F · ส่วนเงินได้ที่นำเข้าไทย").fill("25000");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-02-15");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "เงินได้ในประเทศและภาษีไทย" })).toBeVisible();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "เงินได้ในประเทศและภาษีไทย" })).toBeVisible();
  await expect(page.getByText("กรุณากรอกเงินได้ในประเทศ (J) ให้ครบก่อนดำเนินการต่อ")).toBeVisible();
  const jLink = page.getByRole("button", { name: "ไปยังเงินได้ในประเทศ (J)" });
  await jLink.click();
  await expect(page.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ")).toBeFocused();
  await page.getByLabel("J · เงินได้พึงประเมินในประเทศก่อนหักรายการ").fill("100000");
  await page.getByLabel("L · ภาษีไทยก่อนเครดิตภาษีต่างประเทศ").fill("10000");
  await page.getByLabel("ที่มาของจำนวน L").fill("ตัวเลขตัวอย่างที่ผู้ใช้จัดเตรียมไว้");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
});
