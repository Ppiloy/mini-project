import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
}

test("country and currency choices stay searchable and usable within the source worksheet", async ({ page }, testInfo) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("spinbutton", { name: "ปีที่เกิดเงินได้ (ค.ศ.)" }).fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก ปี พ\.ศ\. 2568/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const moneyEntryFields = [
    page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }),
    page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }),
    page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }),
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
  await expect(page.getByRole("textbox", { name: /^ภาษีต่างประเทศที่ชำระจริงทั้งหมด/ })).toHaveCount(0);

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

  const residence = page.getByRole("region", { name: "ข้อมูลวันพำนักตามปีที่เกิดเงินได้" });
  await expect(residence).toBeVisible();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  const addPeriod = residence.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" });
  await addPeriod.click();
  await residence.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await residence.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-04-30");
  await addPeriod.click();
  await residence.getByLabel("วันแรกที่พำนัก · ช่วงที่ 2").fill("2025-04-30");
  await residence.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 2").fill("2025-06-29");

  await expect(residence.getByRole("status", { name: "สรุปวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" })).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();

  const reloadedResidence = page.getByRole("region", { name: "ข้อมูลวันพำนักตามปีที่เกิดเงินได้" });
  await expect(reloadedResidence.getByLabel("วันแรกที่พำนัก · ช่วงที่ 2")).toHaveValue("2025-04-30");
  await expect(reloadedResidence.getByRole("status", { name: "สรุปวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" })).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");
});

test("editing residence periods blocks ten days, then clears affected confirmations after correction", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงเวลา" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  const lastResidenceDay = page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1");
  await lastResidenceDay.fill("2025-01-10");
  const legacyResidence = page.getByRole("region", { name: "ช่วงเวลาที่พำนักในประเทศไทย" });
  await expect(legacyResidence).toContainText("10 วัน · ต่ำกว่าเกณฑ์ 180 วันตามมาตรา 41");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "มี 10 วัน ต่ำกว่า 180 วันตามมาตรา 41" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ข้อมูลเบื้องต้น" })).toBeVisible();

  await lastResidenceDay.fill("2025-06-29");
  await expect(legacyResidence).toContainText("180 วัน · ครบเกณฑ์ 180 วันตามมาตรา 41");

  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const thaiConfirmation = page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีไทยก่อนเครดิต (L)" });
  const sourceConfirmation = page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีต่างประเทศ (E) · แหล่งเงินได้ 1" });
  await expect(thaiConfirmation).not.toBeChecked();
  await expect(sourceConfirmation).not.toBeChecked();

  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await thaiConfirmation.check();
  await sourceConfirmation.check();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.reload();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีไทยก่อนเครดิต (L)" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "ยืนยันจำนวนภาษีต่างประเทศ (E) · แหล่งเงินได้ 1" })).toBeChecked();
});

test("missing source residence days link back to the dates that calculate them", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "เพิ่มข้อมูลวันพำนักอย่างน้อยหนึ่งปีที่เกิดเงินได้" })).toBeVisible();
  const addYearInput = page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)");
  await page.getByRole("button", { name: "ไปยังข้อมูลวันพำนัก" }).click();
  await expect(addYearInput).toBeFocused();
  await addYearInput.fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "＋ เพิ่มแหล่งเงินได้", exact: true }).click();

  const country = page.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("VN");
  await page.getByRole("option", { name: /เวียดนาม \(VN\)/ }).click();
  await page.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_1");
  await page.getByLabel("วันที่เกิดเงินได้").fill("2025-01-31");
  await page.getByLabel(/รูปแบบจำนวนเงินของช่อง/).selectOption("worksheet_thb");
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await page.getByRole("button", { name: "ลบข้อมูลวันพำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await page.getByRole("button", { name: "ลบข้อมูลปีนี้" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const missingYearAlert = page.getByRole("alert").filter({ hasText: "เพิ่มข้อมูลวันพำนักสำหรับปีที่เกิดเงินได้ พ.ศ. 2568" });
  await expect(missingYearAlert).toBeVisible();
  await missingYearAlert.getByRole("button", { name: "ไปยังข้อมูลวันพำนัก" }).click();
  const addYearRecord = page.getByRole("button", { name: "เพิ่มข้อมูลปีนี้" });
  await expect(addYearRecord).toBeFocused();
  await addYearRecord.click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
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
    "ปีภาษีที่เกิดเงินได้ (A)",
    "ประเทศแหล่งเงินได้ (B)",
    "ประเภทเงินได้ (C)",
    "จำนวนเงินได้ในต่างประเทศ (D)",
    "จำนวนภาษีชำระในต่างประเทศ (E)",
    "จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ (F)",
    "จำนวนภาษีชำระไว้ในต่างประเทศสำหรับเงินได้พึงประเมินจากต่างประเทศ (G)",
    "สัดส่วนเงินได้ต่างประเทศที่นำเข้ามา (H)",
  ]) await expect(source.getByRole("columnheader", { name: label })).toBeVisible();
  await expect(source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveValue("50000.00");
  await expect(source.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ })).toHaveValue("5000.00");
  await expect(source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ })).toHaveValue("25000.00");
  await expect(source.getByRole("textbox", { name: "เหตุผลของการปรับจำนวน (E)" })).toHaveCount(0);
  await expect(source.getByText("หมายเหตุเดิมที่บันทึกไว้: ตัวอย่างระบุ (D)/(E) จากแถวข้อมูลที่ตรวจไว้ และกำหนดจำนวน (E) เป็นสมมติฐานสำหรับการคำนวณ")).toBeVisible();
  await expect(source.getByText("2,500.00 บาท", { exact: true })).toBeVisible();
  await expect(source.getByText("50.00%", { exact: true })).toBeVisible();
  for (const label of [
    "ประเทศแหล่งเงินได้ (B)",
    "ประเภทเงินได้ (C)",
    "จำนวนเงินได้ในต่างประเทศ (D)",
    "จำนวนภาษีชำระในต่างประเทศ (E)",
    "จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ (F)",
  ]) await expect(source.getByLabel(label)).toHaveCount(1);
  await page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" }).click();
  await page.evaluate("document.querySelector('.skip-link')?.blur(); document.activeElement?.blur()");
  const desktopPath = testInfo.outputPath("entry-worksheet-desktop.png");
  await page.screenshot({ path: desktopPath, fullPage: true });
  await testInfo.attach("entry-worksheet-desktop", { path: desktopPath, contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveCount(1);
  for (const label of [
    "ประเทศแหล่งเงินได้ (B)",
    "ประเภทเงินได้ (C)",
    "จำนวนเงินได้ในต่างประเทศ (D)",
    "จำนวนภาษีชำระในต่างประเทศ (E)",
    "จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ (F)",
  ]) await expect(source.getByLabel(label)).toHaveCount(1);
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" }).click();
  await page.evaluate("document.querySelector('.skip-link')?.blur(); document.activeElement?.blur()");
  const mobilePath = testInfo.outputPath("entry-worksheet-mobile.png");
  await page.screenshot({ path: mobilePath, fullPage: true });
  await testInfo.attach("entry-worksheet-mobile", { path: mobilePath, contentType: "image/png" });

  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่ต้องนำมาคำนวณเครดิตภาษี" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /ที่มาของจำนวน \(L\)/ })).toHaveCount(0);
  await expect(page.getByText(/หมายเหตุเดิมที่บันทึกไว้: ตัวอย่างการจัดสรรนี้กำหนด/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ })).toHaveCount(0);
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
  const source = page.locator(".source-card").first();
  const adjustmentDetails = source.locator("details").filter({ hasText: "รายละเอียดเพิ่มเติมของภาษีที่ชำระจริงและจำนวน (E)" });
  await expect(adjustmentDetails).not.toHaveAttribute("open", "");
  await expect(source.getByText(`หมายเหตุเดิมที่บันทึกไว้: ${sourceNote}`)).toBeVisible();
  await adjustmentDetails.locator("summary").click();
  await expect(adjustmentDetails).toHaveAttribute("open", "");
  await expect(page.getByLabel("เหตุผลของการปรับจำนวน (E)")).toHaveValue(sourceNote);
  const editedSourceNote = "บันทึกผู้ใช้: ยืนยันจากเอกสารตัวอย่างที่ตรวจแล้ว";
  await page.getByLabel("เหตุผลของการปรับจำนวน (E)").fill(editedSourceNote);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const thaiTaxNote = "ตัวอย่างการจัดสรรนี้กำหนด (L) เป็นจำนวนที่ระบุไว้เพื่อสาธิตสูตร ไม่ใช่การคำนวณภาษีเงินได้บุคคลธรรมดาไทยครบถ้วน";
  await expect(page.getByText(`หมายเหตุเดิมที่บันทึกไว้: ${thaiTaxNote}`)).toBeVisible();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const reloadedSource = page.locator(".source-card").first();
  const reloadedAdjustmentDetails = reloadedSource.locator("details").filter({ hasText: "รายละเอียดเพิ่มเติมของภาษีที่ชำระจริงและจำนวน (E)" });
  await expect(reloadedSource.getByText(`หมายเหตุเดิมที่บันทึกไว้: ${editedSourceNote}`)).toBeVisible();
  await reloadedAdjustmentDetails.locator("summary").click();
  await expect(reloadedAdjustmentDetails).toHaveAttribute("open", "");
  await expect(page.getByLabel("เหตุผลของการปรับจำนวน (E)")).toHaveValue(editedSourceNote);
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByText(`หมายเหตุเดิมที่บันทึกไว้: ${thaiTaxNote}`)).toBeVisible();
});
