import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
}

test("taxpayer can save and reload a Cambodia Section 40(2) source entry", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();

  const source = page.locator(".source-card").first();
  const country = source.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("KH");
  await page.getByRole("option", { name: /กัมพูชา \(KH\)/ }).click();
  await source.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_2");
  await source.getByLabel("วันที่เกิดเงินได้").fill("2025-01-15");
  await source.getByLabel("รูปแบบจำนวนเงินของช่อง (D), (E) และ (F)").selectOption("worksheet_thb");
  await source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ }).fill("100000");
  await source.getByRole("textbox", { name: /^จำนวนภาษีชำระในต่างประเทศ \(E\)/ }).fill("5000");
  await source.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศที่นำเข้ามาในประเทศ \(F\)/ }).fill("50000");
  await source.getByLabel("วันที่นำเงินเข้าไทย").fill("2025-07-01");
  await page.screenshot({ path: "tmp/country-coverage/ui-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("status").filter({ hasText: "บันทึกแล้ว" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const reloadedSource = page.locator(".source-card").first();
  await expect(reloadedSource.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ })).toHaveValue("กัมพูชา (KH)");
  await expect(reloadedSource.getByRole("combobox", { name: /ประเภทเงินได้/ })).toHaveValue("40_2");
  await expect(reloadedSource.getByRole("textbox", { name: /^จำนวนเงินได้ในต่างประเทศ \(D\)/ })).toHaveValue("100000");
});

test("source entry shows RD criteria links and the selected country's DTA reference", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2568 (ค.ศ. 2025)" }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();

  const source = page.locator(".source-card").first();
  const country = source.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ });
  await country.fill("US");
  await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();

  await expect(page.getByRole("link", { name: "ข้อมูลอนุสัญญาภาษีซ้อนของสหรัฐอเมริกา" }))
    .toHaveAttribute("href", "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/usa_en_dta.pdf");
  await expect(page.getByRole("link", { name: "คู่มือกรมสรรพากรสำหรับการคำนวณเครดิตภาษีต่างประเทศ" }))
    .toHaveAttribute("href", "https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf");
  await expect(page.getByRole("link", { name: "ประมวลรัษฎากร มาตรา 40 และมาตรา 41" }))
    .toHaveAttribute("href", "https://www.rd.go.th/5937.html");
  const guidance = page.getByRole("region", { name: "หลักเกณฑ์กรมสรรพากรสำหรับข้อมูลแหล่งเงินได้" });
  await expect(guidance.getByText("คำนวณจากภาษีเงินได้ที่ชำระจริงเท่านั้น ไม่รวมเบี้ยปรับ เงินเพิ่ม หรือภาษีที่ไม่ใช่ภาษีเงินได้")).toBeVisible();
  await expect(guidance.getByText("จำแนกตามลักษณะเงินจริงและประเภทที่รายงานใน ภ.ง.ด.90/91")).toBeVisible();
  await expect(guidance.getByText("อนุสัญญาภาษีซ้อนอาจกำหนดเงื่อนไขสิทธิและข้อจำกัด แต่วิธีคำนวณในตารางใช้สูตรเดียวกันทุกประเทศ")).toBeVisible();
});

test("tax-year choices cover 2024 through the current year without 2025-only warnings", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  const taxYear = page.getByLabel("ปีภาษี (พ.ศ.)");
  const optionValues = await taxYear.locator("option").evaluateAll((options) => options.map((option) => option.getAttribute("value")));
  const currentYear = new Date().getFullYear();
  for (let year = 2024; year <= currentYear; year += 1) expect(optionValues).toContain(String(year + 543));

  await taxYear.selectOption("2567");
  await expect(taxYear).toHaveValue("2567");
  await expect(page.getByRole("status").filter({ hasText: "กรณีนี้อยู่นอกขอบเขตตัวอย่าง" })).toHaveCount(0);
  const scope = page.getByRole("region", { name: "ขอบเขตการคำนวณตามคู่มือกรมสรรพากร" });
  await expect(scope).toContainText("ตั้งแต่ปี 2024");
  await expect(scope).not.toContainText("ปี 2025");
  await expect(scope).not.toContainText("ในปีเดียวกัน");
});

test("dashboard summarizes the current RD year and country and income coverage", async ({ page }) => {
  await enterTaxpayerDemo(page);
  const currentYear = new Date().getFullYear();
  const account = page.getByRole("region", { name: "ข้อมูลบัญชี" });
  await expect(account).toContainText(`2024–${currentYear}`);
  await expect(account).toContainText("61 ประเทศที่มีอนุสัญญาภาษีซ้อนกับไทย");
  await expect(account).toContainText("มาตรา 40(1)–40(8)");
});

test("review step explains the actual foreign income tax confirmation", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  const confirmationGuidance = page.getByRole("region", { name: "หลักเกณฑ์ยืนยันภาษีต่างประเทศ" });
  await expect(confirmationGuidance).toContainText("ภาษีเงินได้ที่ชำระจริงเท่านั้น");
  await expect(confirmationGuidance).toContainText("ไม่รวมเบี้ยปรับ เงินเพิ่ม หรือภาษีที่ไม่ใช่ภาษีเงินได้");
  await expect(confirmationGuidance).toContainText("ใช้สูตรเดียวกันทุกประเทศ");
  await expect(confirmationGuidance.getByRole("link", { name: "คู่มือกรมสรรพากรสำหรับการคำนวณเครดิตภาษีต่างประเทศ" }))
    .toHaveAttribute("href", "https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf");
});

test("a saved Section 40 type without subtype stays labeled and editable", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  const setSavedSourceType = (typeIdentifier: string) => page.evaluate(({ id, type }) => {
    const key = "ftc.prototype.fixture.v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { cases?: Array<{ id: string; draft: { sources: Array<{ incomeType: string | null; subtype: string | null }> } }> } | null;
    const record = stored?.cases?.find((item) => item.id === id);
    if (!record?.draft.sources[0]) throw new Error("The demo case did not include a source to edit.");
    record.draft.sources[0].incomeType = type;
    record.draft.sources[0].subtype = null;
    localStorage.setItem(key, JSON.stringify(stored));
  }, { id: caseId, type: typeIdentifier });

  await setSavedSourceType("service_40_2");
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const source = page.locator(".source-card").first();
  const incomeType = source.getByRole("combobox", { name: /ประเภทเงินได้/ });
  await expect(incomeType).toHaveValue("40_2");
  await expect(incomeType.locator("option:checked")).toHaveText("40(2) เงินได้เนื่องจากหน้าที่หรือตำแหน่งงาน หรือรับทำงานให้");

  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: /แหล่งเงินได้ 1 · จีน · 40\(2\) เงินได้เนื่องจากหน้าที่หรือตำแหน่งงาน หรือรับทำงานให้/ })).toBeVisible();

  await setSavedSourceType("salary_40_1");
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const reloadedSalary = page.locator(".source-card").first().getByRole("combobox", { name: /ประเภทเงินได้/ });
  await expect(reloadedSalary).toHaveValue("40_1");
  await expect(reloadedSalary.locator("option:checked")).toHaveText("40(1) เงินได้จากการจ้างแรงงาน");
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: /แหล่งเงินได้ 1 · จีน · 40\(1\) เงินได้จากการจ้างแรงงาน/ })).toBeVisible();
});

test("a legacy unknown country and unclassified type stay readable without becoming eligible choices", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  await page.evaluate((id) => {
    const key = "ftc.prototype.fixture.v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { cases?: Array<{ id: string; draft: { sources: Array<{ countryCode: string | null; countryName: string | null; incomeType: string | null; subtype: string | null }> } }> } | null;
    const record = stored?.cases?.find((item) => item.id === id);
    if (!record?.draft.sources[0]) throw new Error("The demo case did not include a source to edit.");
    Object.assign(record.draft.sources[0], { countryCode: "XX", countryName: "ประเทศอื่น", incomeType: "other", subtype: "other_unclassified" });
    localStorage.setItem(key, JSON.stringify(stored));
  }, caseId);

  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const source = page.locator(".source-card").first();
  await expect(source.getByRole("combobox", { name: /ประเทศแหล่งเงินได้/ }))
    .toHaveValue("ประเทศอื่น (XX) · ไม่พบในรายชื่อ DTA ที่รองรับ");
  const incomeType = source.getByRole("combobox", { name: /ประเภทเงินได้/ });
  await expect(incomeType).toHaveValue("other_unclassified");
  await expect(incomeType.locator("option:checked")).toHaveText("รายการเดิมที่ยังไม่จำแนกตามมาตรา 40");
});

test("selecting a Section 40 type clears only the obsolete unsupported-income flag", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  const caseId = new URL(page.url()).pathname.split("/")[3]!;
  const setSavedClassification = (classification: string, explanation: string) => page.evaluate(({ id, value, note }) => {
    const key = "ftc.prototype.fixture.v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { cases?: Array<{ id: string; draft: { sources: Array<{ unsupportedClassification: string | null; unsupportedExplanation: string | null }> } }> } | null;
    const record = stored?.cases?.find((item) => item.id === id);
    if (!record?.draft.sources[0]) throw new Error("The demo case did not include a source to edit.");
    record.draft.sources[0].unsupportedClassification = value;
    record.draft.sources[0].unsupportedExplanation = note;
    localStorage.setItem(key, JSON.stringify(stored));
  }, { id: caseId, value: classification, note: explanation });

  await setSavedClassification("unsupported_income_type", "เก็บเหตุผลเดิมไว้");
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const source = page.locator(".source-card").first();
  const unsupportedDetails = source.locator("details").last();
  await unsupportedDetails.locator("summary").click();
  const classification = source.getByLabel("สถานะตรวจสอบ");
  await expect(classification).toHaveValue("unsupported_income_type");
  await source.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_2");
  await expect(classification).toHaveValue("");
  await expect(source.getByLabel("คำอธิบายเพิ่มเติม")).toHaveValue("เก็บเหตุผลเดิมไว้");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const reloadedSource = page.locator(".source-card").first();
  await reloadedSource.locator("details").last().locator("summary").click();
  await expect(reloadedSource.getByLabel("สถานะตรวจสอบ")).toHaveValue("");
  await expect(reloadedSource.getByLabel("คำอธิบายเพิ่มเติม")).toHaveValue("เก็บเหตุผลเดิมไว้");

  await setSavedClassification("unknown_treaty_treatment", "คงการตรวจสอบ DTA ไว้");
  await page.reload();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const treatySource = page.locator(".source-card").first();
  await treatySource.locator("details").last().locator("summary").click();
  await treatySource.getByRole("combobox", { name: /ประเภทเงินได้/ }).selectOption("40_4_interest");
  await expect(treatySource.getByLabel("สถานะตรวจสอบ")).toHaveValue("unknown_treaty_treatment");
  await expect(treatySource.getByLabel("คำอธิบายเพิ่มเติม")).toHaveValue("คงการตรวจสอบ DTA ไว้");
});
