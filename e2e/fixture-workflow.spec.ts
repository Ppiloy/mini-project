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
  await expect(page.getByText("ตัวอย่างหลักฐาน.pdf")).toHaveCount(4);
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();

  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByText("เครดิตที่ใช้ได้ตามสมมติฐาน")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const previewId = previewUrl.searchParams.get("preview")!;
  const dashboardCard = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(dashboardCard).toContainText("2,500.00");
  await expect(dashboardCard.getByRole("link", { name: "เปิดรายงาน" })).toBeVisible();
  await page.reload();
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "เปิดรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/${previewId}$`));
  await expect(page.getByText("ร่าง — ยังไม่ได้ส่ง")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  await page.goto(`/demo/cases/${caseId}/result?preview=${previewId}`);
  await expect(page.getByText("เครดิตที่ใช้ได้ตามสมมติฐาน")).toBeVisible();
  await page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" }).click();
  await expect(page.getByText("ส่งเข้าคิวจำลองแล้ว")).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(dashboardCard).toContainText("ส่งแล้ว · คิวจำลอง");
  await expect(dashboardCard).toContainText("2,500.00");
  await dashboardCard.getByRole("link", { name: "เปิดรายงาน" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/reports/[^/]+$`));
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();

  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะเจ้าหน้าที่" }).click();
  await expect(page.getByRole("heading", { name: "คิวกรณีที่ส่งเข้าตรวจสอบ" })).toBeVisible();
  await page.getByRole("link", { name: "ตรวจทานแบบอ่านอย่างเดียว" }).click();
  await expect(page.getByText("ส่งแล้ว · อ่านอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("heading", { name: "ประวัติการเข้าถึง" })).toBeVisible();
  await page.getByRole("link", { name: "ดูรายงานที่พิมพ์ได้" }).click();
  await expect(page.getByRole("heading", { name: "รายงานคำนวณเครดิตภาษีเงินได้จากต่างประเทศ" })).toBeVisible();
  await expect(page.getByText("รายงานจาก snapshot ที่ส่งแล้ว")).toBeVisible();
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
  await expect(page.getByText("2,500.00", { exact: true }).first()).toBeVisible();
  const previewUrl = new URL(page.url());
  const caseId = previewUrl.pathname.split("/")[3]!;
  const card = page.locator(".case-card").filter({ hasText: caseId.slice(-8).toUpperCase() });

  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(card).toContainText("2,500.00");
  await card.getByRole("link", { name: "ทำร่างต่อ" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: /บันทึกแล้ว/ })).toBeVisible();
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(card).toContainText("ยังไม่มีผลคำนวณสำหรับร่างรุ่นปัจจุบัน");
  await expect(card).not.toContainText("2,500.00");
  await expect(card.getByRole("link", { name: "เปิดรายงาน" })).toHaveCount(0);

  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  const incompleteCaseId = new URL(page.url()).pathname.split("/")[3]!;
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/cases/${incompleteCaseId}/result\\?preview=`));
  await expect(page.getByRole("status").getByText("ข้อมูลยังไม่ครบสำหรับคำนวณ")).toBeVisible();
  const incompleteCard = page.locator(".case-card").filter({ hasText: incompleteCaseId.slice(-8).toUpperCase() });
  await page.getByRole("link", { name: "หน้าหลักระบบต้นแบบ" }).click();
  await expect(incompleteCard).toContainText("ข้อมูลยังไม่ครบ");
  await expect(incompleteCard).not.toContainText(/\d+,\d{3}\.\d{2}/);
  await expect(incompleteCard.getByRole("link", { name: "เปิดรายงาน" })).toBeVisible();
  await incompleteCard.getByRole("link", { name: "เปิดรายงาน" }).click();
  await expect(page).toHaveURL(/\/demo\/reports\/demo-snapshot-/);
  await expect(page.getByText("สถานะ: ข้อมูลยังไม่ครบ")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" })).toBeDisabled();
  await expect(page.getByText("เครดิตที่ใช้ได้ตามสมมติฐาน")).toHaveCount(0);
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
  await expect(page.getByText("รายงานรวม.pdf")).toBeVisible();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" }).click();
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

test("a transfer total that conflicts with F is presented for review, not as a ready credit", async ({ page }) => {
  await openPartialRemittance(page);
  await page.getByLabel("ยอดโอนทั้งหมด (ข้อมูลประกอบ)").fill("20000");
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await page.getByRole("button", { name: "บันทึกและคำนวณตัวอย่าง" }).click();
  await expect(page).toHaveURL(/\/demo\/cases\/[^/]+\/result\?preview=/);
  await expect(page.getByText("ยอดโอนรวมไม่ตรงกับเงินได้ที่ระบุว่าเป็นรายได้ล้วน จึงอาจมีเงินต้นหรือรายการอื่นปะปน")).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" })).toBeDisabled();
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
  await expect(page.getByText("ต้นแบบรองรับเฉพาะปีภาษี 2568 (ค.ศ. 2025)")).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งเข้าคิวตรวจสอบในระบบต้นแบบ" })).toBeDisabled();
});

test("an unsupported but well-formed draft saves, reloads, and warns before leaving unsaved edits", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2567");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: /บันทึกแล้ว · รุ่นข้อมูล/ })).toBeVisible();
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
