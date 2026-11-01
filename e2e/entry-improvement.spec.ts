import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เข้าสู่สาธิตในฐานะผู้เสียภาษี" }).click();
}

test("taxpayer can choose a country and currency independently with a country suggestion", async ({ page }) => {
  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "สร้างกรณีใหม่" }).click();
  await page.getByRole("button", { name: "บันทึกและถัดไป" }).click();
  await expect(page.getByRole("heading", { name: "แหล่งเงินได้จากต่างประเทศ" })).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();

  const country = page.getByLabel("ประเทศที่เกิดเงินได้");
  await expect(country.locator('option[value="US"]')).toContainText("สหรัฐอเมริกา");
  await expect(country.locator('option[value="SG"]')).toContainText("สิงคโปร์");
  await expect(country.locator('option[value="CN"]')).toContainText("จีน");
  await expect(country.locator('option[value="VN"]')).toContainText("เวียดนาม");
  await country.selectOption("CN");
  await page.getByLabel("รูปแบบการกรอก").selectOption("original_currency");

  const currency = page.getByRole("combobox", { name: "สกุลเงินต้นทาง" });
  await expect(currency).toHaveValue("CNY");
  await currency.selectOption("USD");
  await expect(country).toHaveValue("CN");
  await expect(currency).toHaveValue("USD");
});
