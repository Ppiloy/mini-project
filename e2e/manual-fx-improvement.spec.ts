import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
}

async function addResidencePeriod(page: import("@playwright/test").Page) {
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก ปี พ\.ศ\. 2568/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
}

test("new original-currency entry uses a readable manual quote and optional BOT reference", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await addResidencePeriod(page);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  await page.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-01-01");

  const quote = page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true });
  await expect(quote).toBeVisible();
  await expect(quote).toHaveValue("");
  await expect(page.getByRole("link", { name: "แนะนำอัตราอ้างอิง ธปท.", exact: true }))
    .toHaveAttribute("href", "https://www.bot.or.th/th/statistics/exchange-rate.html");
  await expect(page.getByLabel("วิธีอ้างอิงอัตราแลกเปลี่ยน")).toHaveValue("bot_average_buying");
  await expect(page.getByLabel(/หน่วยของอัตร/)).toHaveCount(0);
  await expect(page.getByLabel("วันที่อ้างอิงอัตราแลกเปลี่ยน")).toBeVisible();

  const reference = page.getByLabel("ลิงก์แหล่งอ้างอิงที่ผู้ใช้ระบุ (ไม่บังคับ)", { exact: true });
  await reference.fill("https://example.test/fx");
  await quote.fill("36.15");
  await quote.fill("");
  await quote.fill("36.25");
  await expect(reference).toHaveValue("https://example.test/fx");
  await expect(quote).toHaveValue("36.25");
  await expect(page.getByRole("button", { name: "แทนอัตราเดิมด้วยอัตราที่ผู้ใช้กรอกเอง" })).toHaveCount(0);
});

test("changing the remittance date can clear only the old quote and converted values", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await addResidencePeriod(page);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");

  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }).fill("100");
  await page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }).fill("20");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("50");
  const remittanceDate = page.getByLabel(/^วันที่นำเงินเข้าไทย/);
  await remittanceDate.fill("2025-01-01");
  const quote = page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true });
  await quote.fill("36.25");

  await remittanceDate.fill("2025-01-02");
  const resetPrompt = page.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" });
  await expect(resetPrompt).toBeVisible();
  await expect(remittanceDate).toHaveValue("2025-01-01");
  await resetPrompt.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(resetPrompt).toHaveCount(0);
  await expect(remittanceDate).toHaveValue("2025-01-01");
  await expect(quote).toHaveValue("36.25");

  await remittanceDate.fill("2025-01-02");
  const confirmedPrompt = page.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" });
  await confirmedPrompt.getByRole("button", { name: "เปลี่ยนและล้างข้อมูล", exact: true }).click();
  await expect(remittanceDate).toHaveValue("2025-01-02");
  await expect(quote).toHaveValue("");
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveValue("100");
  await expect(page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ })).toHaveValue("20");
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ })).toHaveValue("50");
  const sourceTable = page.getByRole("table", { name: /แหล่งเงินได้ 1/ });
  await expect(sourceTable.getByLabel(/^จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ \(G\)/)).toHaveText("—");
});

test("changing a source country preserves an explicitly selected currency and its amounts", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await addResidencePeriod(page);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }).fill("100");
  await page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }).fill("20");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("50");
  await page.getByLabel(/^วันที่นำเงินเข้าไทย/).fill("2025-01-01");
  const quote = page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true });
  await quote.fill("36.25");

  let resetPrompted = false;
  page.on("dialog", async (dialog) => { resetPrompted = true; await dialog.dismiss(); });
  await country.fill("CN");
  await page.getByRole("option", { name: /จีน \(CN\)/ }).click();

  await expect(country).toHaveValue(/จีน \(CN\)/);
  await expect(page.getByRole("combobox", { name: "สกุลเงินต้นทาง" })).toHaveValue("USD · ดอลลาร์สหรัฐ");
  await expect(quote).toHaveValue("36.25");
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveValue("100");
  await expect(page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ })).toHaveValue("20");
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ })).toHaveValue("50");
  expect(resetPrompted).toBe(false);
});

test("a saved draft missing its manual quote links to the real rate field", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await addResidencePeriod(page);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }).fill("100");
  await page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }).fill("20");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("50");
  await page.getByLabel(/^วันที่นำเงินเข้าไทย/).fill("2025-01-01");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByText(/แหล่งเงินได้ 1.*กรุณากรอกอัตราแลกเปลี่ยนให้ครบก่อนดำเนินการต่อ/)).toBeVisible();
  const correctionLink = page.getByRole("button", { name: "ไปยังอัตราแลกเปลี่ยนของแหล่งเงินได้ 1" });
  await correctionLink.click();
  await expect(page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toBeFocused();
});

test("yen and dong use clear per-unit manual quotes with correct conversion and explicit currency reset", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await addResidencePeriod(page);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("VN");
  await page.getByRole("option", { name: /เวียดนาม \(VN\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-01");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }).fill("100");
  await page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }).fill("30");
  await page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("50");
  await page.getByLabel(/^วันที่นำเงินเข้าไทย/).fill("2025-01-01");

  const ratePerUnitVnd = page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 VND)", exact: true });
  await expect(ratePerUnitVnd).toBeVisible();
  await page.getByLabel("วิธีอ้างอิงอัตราแลกเปลี่ยน").selectOption("bank_buying");
  await page.getByLabel("วันที่อ้างอิงอัตราแลกเปลี่ยน").fill("2025-01-01");
  await page.getByLabel("แหล่งอัตราที่ผู้ใช้ระบุ").fill("ธนาคารตัวอย่าง");
  await ratePerUnitVnd.fill("35");
  const sourceTable = page.getByRole("table", { name: /แหล่งเงินได้ 1/ });
  await expect(sourceTable.getByLabel(/^จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ \(G\)/)).toHaveText("525.00 บาท");

  const currency = page.getByRole("combobox", { name: "สกุลเงินต้นทาง" });
  await currency.fill("JPY");
  await page.getByRole("option", { name: /JPY · เยนญี่ปุ่น/ }).click();
  const resetPrompt = page.getByRole("alertdialog", { name: "ยืนยันการเปลี่ยนสกุลเงิน" });
  await expect(resetPrompt).toBeVisible();
  await resetPrompt.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(currency).toHaveValue("VND · ด่งเวียดนาม");
  await expect(ratePerUnitVnd).toHaveValue("35");

  await currency.fill("JPY");
  await page.getByRole("option", { name: /JPY · เยนญี่ปุ่น/ }).click();
  await page.getByRole("alertdialog", { name: "ยืนยันการเปลี่ยนสกุลเงิน" })
    .getByRole("button", { name: "เปลี่ยนและล้างข้อมูล", exact: true }).click();
  await expect(currency).toHaveValue("JPY · เยนญี่ปุ่น");
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 JPY)", exact: true })).toHaveValue("");
});
