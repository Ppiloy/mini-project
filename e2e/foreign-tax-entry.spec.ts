import { expect, test } from "@playwright/test";

test("ordinary foreign tax entry uses one E amount without a reason or equality declaration", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("spinbutton", { name: "ปีที่เกิดเงินได้ (ค.ศ.)" }).fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก.*2025/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  await page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ }).fill("VN");
  await page.getByRole("option", { name: /เวียดนาม \(VN\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-15");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("worksheet_thb");

  const eAmount = page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ });
  await expect(eAmount).toBeVisible();
  await eAmount.fill("250.00");
  await expect(page.getByRole("textbox", { name: /เหตุผลของจำนวน \(E\)/ })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /ภาษีต่างประเทศที่จ่ายจริงเท่ากับ/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /ภาษีต่างประเทศที่ชำระจริงทั้งหมด/ })).toHaveCount(0);
});

test("opening ordinary E details exposes one validation target and no duplicate E controls", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const source = page.locator(".source-card").first();
  const adjustmentDetails = source.locator("details").filter({ hasText: "รายละเอียดเพิ่มเติมของภาษีที่ชำระจริงและจำนวน (E)" });
  const ordinaryE = source.locator("#source-0-actualForeignTaxPaid");
  await expect(adjustmentDetails).not.toHaveAttribute("open", "");
  await expect(ordinaryE).toHaveCount(1);
  await expect(source.locator('td[data-label^="จำนวนภาษีชำระในต่างประเทศ (E)"] input')).toHaveCount(1);
  await expect(source.getByRole("textbox", { name: /เหตุผลของการปรับจำนวน \(E\)/ })).toHaveCount(0);
  await page.getByRole("heading", { name: "กรอกข้อมูลกรณีเครดิตภาษี" }).click();
  await page.screenshot({ path: "tmp/new-review/ordinary-e-entry.png", fullPage: true });

  await adjustmentDetails.locator("summary").click();
  await expect(adjustmentDetails).toHaveAttribute("open", "");

  const actualPaid = source.locator("#source-0-actualForeignTaxPaid");
  const adjustedE = source.locator("#source-0-eligibleForeignTax");
  await expect(actualPaid).toHaveCount(1);
  await expect(adjustedE).toHaveCount(1);
  await expect(source.locator('td[data-label^="จำนวนภาษีชำระในต่างประเทศ (E)"] input')).toHaveCount(0);
  await expect(source.locator('td[data-label^="จำนวนภาษีชำระในต่างประเทศ (E)"] output')).toContainText("5,000.00");

  await actualPaid.fill("");
  await adjustedE.fill("");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const taxError = source.getByRole("alert");
  const followValidation = taxError.getByRole("button", { name: /ไปยังภาษีต่างประเทศที่ชำระจริงทั้งหมดของแหล่งเงินได้ 1/ });
  await expect(followValidation).toBeVisible();
  await followValidation.click();
  await expect(actualPaid).toBeFocused();
});

test("L entry requests the amount and guidance without a free-text provenance field", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByRole("textbox", { name: /ที่มาของจำนวน \(L\)/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^ภาษีที่ต้องชำระในประเทศไทย \(L\)/ })).toBeVisible();
  await expect(page.getByText(/หลังหักค่าใช้จ่ายและค่าลดหย่อนที่เกี่ยวข้อง แต่ก่อนใช้เครดิต/)).toBeVisible();
});

test("an exceptional E adjustment keeps actual tax and used E distinct after save and reload", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const source = page.locator(".source-card").first();
  const actualPaid = source.getByRole("textbox", { name: /ภาษีต่างประเทศที่ชำระจริงทั้งหมด/ });
  const adjustedE = source.getByRole("textbox", { name: /จำนวน \(E\) ที่ใช้คำนวณ/ });
  const adjustmentDetails = source.locator("details").filter({ hasText: "รายละเอียดเพิ่มเติมของภาษีที่ชำระจริงและจำนวน (E)" });
  await adjustmentDetails.locator("summary").click();
  await expect(adjustmentDetails).toHaveAttribute("open", "");
  await expect(actualPaid).toHaveValue("5000.00");
  await adjustedE.fill("3000.00");
  await expect(source.locator('td[data-label^="จำนวนภาษีชำระในต่างประเทศ (E)"] output')).toContainText("3,000.00");
  await expect(actualPaid).toHaveValue("5000.00");
  await page.getByRole("heading", { name: "กรอกข้อมูลกรณีเครดิตภาษี" }).click();
  await page.screenshot({ path: "tmp/new-review/adjusted-e-details.png", fullPage: true });

  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const reloadedSource = page.locator(".source-card").first();
  await expect(reloadedSource.locator('td[data-label^="จำนวนภาษีชำระในต่างประเทศ (E)"] output')).toContainText("3,000.00");
  await expect(reloadedSource.getByRole("textbox", { name: /ภาษีต่างประเทศที่ชำระจริงทั้งหมด/ })).toHaveValue("5000.00");
});

test("I and K follow edited source amounts and remain visible after save and reload", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const source = page.locator(".source-card").first();
  await source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("10000.00");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const iValue = page.getByLabel("เงินได้พึงประเมินในต่างประเทศที่นำเข้ามา");
  const jValue = page.locator("#case-domesticAssessableIncome");
  const kValue = page.getByLabel("เงินได้พึงประเมินรวมจากทุกแหล่งเงินได้");
  await expect(iValue).toContainText("10,000.00");
  await jValue.fill("1000000.00");
  await expect(kValue).toContainText("1,010,000.00");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(iValue).toContainText("10,000.00");
  await expect(jValue).toHaveValue("1000000.00");
  await expect(page.getByText("1,000,000.00", { exact: true })).toBeVisible();
  await expect(kValue).toContainText("1,010,000.00");
});
