import { expect, test } from "@playwright/test";

test("a pending quote reset stays bound to its source if another source is removed", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี", exact: true }).click();
  await page.locator(".dashboard-heading").getByRole("button", { name: /เริ่มคำนวณใหม่/ }).click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก ปี พ\.ศ\. 2568/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  for (let index = 0; index < 3; index += 1) {
    await page.locator(".step-section-head").getByRole("button", { name: /เพิ่มแหล่งเงินได้/ }).click();
  }
  for (const [index, quote, remittanceDate] of [[1, "36.25", "2025-01-01"], [2, "37.75", "2025-02-01"]] as const) {
    await page.locator(`#source-${index}-countryCode`).fill("US");
    await page.getByRole("option", { name: /สหรัฐอเมริกา \(US\)/ }).click();
    await page.locator(`#source-${index}-incomeType`).selectOption("40_1");
    await page.locator(`#source-${index}-earnedDate`).fill("2025-01-01");
    await page.locator(`#source-${index}-inputMode`).selectOption("original_currency");
    await page.locator(`#source-${index}-grossIncomeAmount`).fill(index === 1 ? "100" : "200");
    await page.locator(`#source-${index}-actualForeignTaxPaid`).fill(index === 1 ? "20" : "30");
    await page.locator(`#source-${index}-remittedIncomeAmount`).fill(index === 1 ? "50" : "40");
    await page.locator(`#source-${index}-remittance-remittanceDate`).fill(remittanceDate);
    await page.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true }).nth(index - 1).fill(quote);
  }

  const originalSecond = page.locator(".source-card").nth(1);
  const originalThird = page.locator(".source-card").nth(2);
  await originalSecond.getByLabel(/^วันที่นำเงินเข้าไทย/).fill("2025-01-02");
  await expect(originalSecond.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" })).toBeVisible();

  const first = page.locator(".source-card").nth(0);
  await first.getByRole("button", { name: "ลบแหล่งเงินได้ 1", exact: true }).click();
  await first.getByRole("alertdialog").getByRole("button", { name: "ยืนยันลบรายการ", exact: true }).click();

  const shiftedSecond = page.locator(".source-card").nth(0);
  const shiftedThird = page.locator(".source-card").nth(1);
  const resetPrompt = shiftedSecond.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" });
  await expect(resetPrompt).toHaveCount(0);
  await expect(shiftedThird.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" })).toHaveCount(0);

  await expect(shiftedSecond.getByLabel(/^วันที่นำเงินเข้าไทย/)).toHaveValue("2025-01-01");
  await expect(shiftedSecond.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toHaveValue("36.25");
  await expect(shiftedThird.getByLabel(/^วันที่นำเงินเข้าไทย/)).toHaveValue("2025-02-01");
  await expect(shiftedThird.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toHaveValue("37.75");

  await shiftedSecond.getByLabel(/^วันที่นำเงินเข้าไทย/).fill("2025-01-02");
  const freshPrompt = shiftedSecond.getByRole("alertdialog", { name: "อัตราเดิมใช้กับวันที่นำเงินเข้าไทยที่เปลี่ยนไปไม่ได้" });
  await expect(freshPrompt).toBeVisible();
  await freshPrompt.getByRole("button", { name: "เปลี่ยนและล้างข้อมูล", exact: true }).click();

  await expect(shiftedSecond.getByLabel(/^วันที่นำเงินเข้าไทย/)).toHaveValue("2025-01-02");
  await expect(shiftedSecond.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toHaveValue("");
  await expect(shiftedSecond.locator("#source-0-grossIncomeAmount")).toHaveValue("100");
  await expect(shiftedSecond.locator("#source-0-actualForeignTaxPaid")).toHaveValue("20");
  await expect(shiftedSecond.locator("#source-0-remittedIncomeAmount")).toHaveValue("50");
  await expect(shiftedThird.getByLabel(/^วันที่นำเงินเข้าไทย/)).toHaveValue("2025-02-01");
  await expect(shiftedThird.getByRole("textbox", { name: "อัตราแลกเปลี่ยน (บาทต่อ 1 USD)", exact: true })).toHaveValue("37.75");
  await expect(shiftedThird.locator("#source-1-grossIncomeAmount")).toHaveValue("200");
  await expect(originalThird).toHaveCount(0);
});
