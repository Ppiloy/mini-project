import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
}

test("country and currency choices stay searchable and usable within the source worksheet", async ({ page }, testInfo) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();

  const moneyEntryFields = [
    page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ }),
    page.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ }),
    page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ }),
    page.getByRole("textbox", { name: /^ภาษีต่างประเทศที่ชำระจริงทั้งหมด/ }),
  ];
  for (const field of moneyEntryFields) await expect(field).toBeDisabled();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  const usOption = page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ });
  await expect(usOption).toBeVisible();
  const countryMenuPath = testInfo.outputPath("country-search-menu-desktop.png");
  await page.screenshot({ path: countryMenuPath });
  await testInfo.attach("country-search-menu-desktop", { path: countryMenuPath, contentType: "image/png" });
  await country.fill("SG");
  await expect(page.getByRole("option", { name: /สิงคโปร์ \(SG\)/ })).toBeVisible();
  await country.fill("CN");
  await page.getByRole("option", { name: /จีน \(CN\)/ }).click();
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("original_currency");
  for (const field of moneyEntryFields) await expect(field).toBeEnabled();

  const currency = page.getByRole("combobox", { name: "สกุลเงินต้นทาง" });
  await expect(currency).toHaveValue("CNY · หยวนจีน");
  await currency.fill("USD");
  const usdOption = page.getByRole("option", { name: /USD · ดอลลาร์สหรัฐ/ });
  await expect(usdOption).toBeVisible();
  await page.evaluate("document.querySelector('#source-0-currencyCode')?.scrollIntoView({block:'center', inline:'nearest'})");
  const currencyMenuPath = testInfo.outputPath("currency-search-menu-desktop.png");
  await page.screenshot({ path: currencyMenuPath });
  await testInfo.attach("currency-search-menu-desktop", { path: currencyMenuPath, contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await currency.fill("USD");
  await expect(usdOption).toBeVisible();
  await page.evaluate("document.querySelector('#source-0-currencyCode')?.scrollIntoView({block:'center', inline:'nearest'})");
  const mobileCurrencyMenuPath = testInfo.outputPath("currency-search-menu-mobile.png");
  await page.screenshot({ path: mobileCurrencyMenuPath });
  await testInfo.attach("currency-search-menu-mobile", { path: mobileCurrencyMenuPath, contentType: "image/png" });
  await usdOption.click();
  await expect(country).toHaveValue("จีน (CN)");
  await expect(currency).toHaveValue("USD · ดอลลาร์สหรัฐ");
});

test("taxpayer can save overlapping residence periods and sees the inclusive deduplicated total", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();

  const residence = page.getByRole("region", { name: "ช่วงเวลาที่พำนักในประเทศไทย" });
  await expect(residence).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-04-30");
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 2").fill("2025-04-30");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 2").fill("2025-06-29");

  await expect(residence).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();

  await expect(page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 2")).toHaveValue("2025-04-30");
  await expect(page.getByRole("region", { name: "ช่วงเวลาที่พำนักในประเทศไทย" })).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
});

test("editing residence periods refreshes the counted days and clears affected confirmations", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-06-29");
  await expect(page.getByRole("region", { name: "ช่วงเวลาที่พำนักในประเทศไทย" })).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");

  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const thaiConfirmation = page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย (L)" });
  const sourceConfirmation = page.getByRole("checkbox", { name: "ยืนยันจำนวน (E) และเหตุผล · แหล่งเงินได้ 1" });
  await expect(thaiConfirmation).not.toBeChecked();
  await expect(sourceConfirmation).not.toBeChecked();

  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await thaiConfirmation.check();
  await sourceConfirmation.check();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.reload();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวนและที่มาของภาษีไทย (L)" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวน (E) และเหตุผล · แหล่งเงินได้ 1" })).toBeChecked();
});

test("missing source residence days link back to the dates that calculate them", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("VN");
  await page.getByRole("option", { name: /เวียดนาม \(VN\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-31");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("worksheet_thb");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await expect(page.getByText(/เพิ่มช่วงวันที่พำนักในขั้นข้อมูลเบื้องต้น.*ปีที่เกิดเงินได้/)).toBeVisible();
  await page.getByRole("button", { name: "ไปยังช่วงเวลาที่พำนักของแหล่งเงินได้ 1" }).click();
  const addStay = page.getByRole("button", { name: "เพิ่มช่วงเวลา" });
  await expect(addStay).toBeFocused();
  await addStay.click();
  await page.getByLabel(/วันแรกที่พำนัก · ช่วงที่ 1/).fill("2025-01-01");
  await page.getByLabel(/วันสุดท้ายที่พำนัก · ช่วงที่ 1/).fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByLabel("วันพำนักในปีที่เกิดเงินได้")).toHaveValue("200");
});

test("one source card contains A–H and the next section does not repeat D/E/F", async ({ page }, testInfo) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  const source = page.locator(".source-card").filter({ hasText: "แหล่งเงินได้ 1" });
  for (const label of [
    "(A) - ปีภาษีที่เกิดเงินได้",
    "(B) - ประเทศแหล่งเงินได้",
    "(C) - ประเภทเงินได้",
    "(D) - จำนวนเงินได้ในต่างประเทศ",
    "(E) - จำนวนภาษีชำระในต่างประเทศ",
    "(F) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ",
    "(G) - จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ",
    "(H) - สัดส่วนเงินได้ต่างประเทศที่นำเข้ามา",
  ]) await expect(source.getByRole("columnheader", { name: label })).toBeVisible();
  await expect(source.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toHaveValue("50000.00");
  await expect(source.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ })).toHaveValue("5000.00");
  await expect(source.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ })).toHaveValue("25000.00");
  await expect(source.getByLabel("เหตุผลของจำนวน (E)")).toHaveValue("ตัวอย่างระบุ (D)/(E) จากแถวข้อมูลที่ตรวจไว้ และกำหนดจำนวน (E) เป็นสมมติฐานสำหรับการคำนวณ");
  await expect(source.getByText("2,500.00 บาท", { exact: true })).toBeVisible();
  await expect(source.getByText("50.00%", { exact: true })).toBeVisible();
  for (const label of [
    "(B) - ประเทศแหล่งเงินได้",
    "(C) - ประเภทเงินได้",
    "(D) - จำนวนเงินได้ในต่างประเทศ",
    "(E) - จำนวนภาษีชำระในต่างประเทศ",
    "(F) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ",
  ]) await expect(source.getByLabel(label)).toHaveCount(1);
  await page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" }).click();
  await page.evaluate("document.querySelector('.skip-link')?.blur(); document.activeElement?.blur()");
  const desktopPath = testInfo.outputPath("entry-worksheet-desktop.png");
  await page.screenshot({ path: desktopPath, fullPage: true });
  await testInfo.attach("entry-worksheet-desktop", { path: desktopPath, contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(source.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toHaveCount(1);
  for (const label of [
    "(B) - ประเทศแหล่งเงินได้",
    "(C) - ประเภทเงินได้",
    "(D) - จำนวนเงินได้ในต่างประเทศ",
    "(E) - จำนวนภาษีชำระในต่างประเทศ",
    "(F) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ",
  ]) await expect(source.getByLabel(label)).toHaveCount(1);
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" }).click();
  await page.evaluate("document.querySelector('.skip-link')?.blur(); document.activeElement?.blur()");
  const mobilePath = testInfo.outputPath("entry-worksheet-mobile.png");
  await page.screenshot({ path: mobilePath, fullPage: true });
  await testInfo.attach("entry-worksheet-mobile", { path: mobilePath, contentType: "image/png" });

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" })).toBeVisible();
  await expect(page.getByLabel("ที่มาของจำนวน (L)")).toHaveValue("ตัวอย่างการจัดสรรนี้กำหนด (L) เป็นจำนวนที่ระบุไว้เพื่อสาธิตสูตร ไม่ใช่การคำนวณภาษีเงินได้บุคคลธรรมดาไทยครบถ้วน");
  await expect(page.getByRole("textbox", { name: /^\(D\) - จำนวนเงินได้ในต่างประเทศ/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^\(E\) - จำนวนภาษีชำระในต่างประเทศ/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^\(F\) - จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ/ })).toHaveCount(0);
});

test("known English worksheet notes from an older saved draft display in Thai without rewriting it", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  const legacyEligibility = "Manual-derived D/E row; eligible tax is still an explicit educational assumption.";
  const legacyProvenance = "Prepared allocation example; L is supplied.";
  const stored = `(() => { const key = "ftc.prototype.fixture.v1"; const data = JSON.parse(localStorage.getItem(key) || "null"); const record = data.cases.find((item) => item.id === ${JSON.stringify(caseId)}); record.draft.sources[0].eligibilityRationale = ${JSON.stringify(legacyEligibility)}; record.draft.thaiTax.provenance = ${JSON.stringify(legacyProvenance)}; localStorage.setItem(key, JSON.stringify(data)); })()`;
  await page.evaluate(stored);
  await page.reload();

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const sourceNote = "ตัวอย่างระบุ (D)/(E) จากแถวข้อมูลที่ตรวจไว้ และกำหนดจำนวน (E) เป็นสมมติฐานสำหรับการคำนวณ";
  await expect(page.getByLabel("เหตุผลของจำนวน (E)")).toHaveValue(sourceNote);
  const editedSourceNote = "บันทึกผู้ใช้: ยืนยันจากเอกสารตัวอย่างที่ตรวจแล้ว";
  await page.getByLabel("เหตุผลของจำนวน (E)").fill(editedSourceNote);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const thaiTaxNote = "ตัวอย่างการจัดสรรนี้กำหนด (L) เป็นจำนวนที่ระบุไว้เพื่อสาธิตสูตร ไม่ใช่การคำนวณภาษีเงินได้บุคคลธรรมดาไทยครบถ้วน";
  await expect(page.getByLabel("ที่มาของจำนวน (L)")).toHaveValue(thaiTaxNote);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByLabel("เหตุผลของจำนวน (E)")).toHaveValue(editedSourceNote);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByLabel("ที่มาของจำนวน (L)")).toHaveValue(thaiTaxNote);
});
