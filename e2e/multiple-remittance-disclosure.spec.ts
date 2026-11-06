import { expect, test } from "@playwright/test";

test("explains the single-transfer limit before entry", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่", exact: true }).click();

  const scope = page.getByRole("region", { name: "ขอบเขตการคำนวณตามคู่มือกรมสรรพากร" });
  await expect(scope).toContainText("ในแอปนี้ แหล่งเงินได้หนึ่งรายการบันทึกการนำเข้าไทยได้ครั้งเดียว");
  await expect(scope).toContainText("หลายครั้งยังคำนวณและส่งไม่ได้");
});

test("links the remittance-date guidance to the field and directs multiple transfers to review", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่", exact: true }).click();
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้", exact: true }).click();
  await page.getByLabel("รูปแบบข้อมูลวันพำนัก").selectOption("declared");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก", exact: true }).click();

  const remittanceDate = page.getByLabel("วันที่นำเงินเข้าไทย");
  await expect(remittanceDate).toHaveAccessibleName("วันที่นำเงินเข้าไทย");
  await expect(remittanceDate).toHaveAccessibleDescription(
    /หนึ่งรายการแทนการนำเข้าไทยหนึ่งครั้ง[\s\S]*มีการนำเข้าเงินหลายครั้ง[\s\S]*มีข้อเท็จจริงที่ต้องตรวจสอบเพิ่มเติมหรือไม่\?[\s\S]*บันทึกร่างไว้ทบทวนภายหลัง[\s\S]*ไม่ต้องคัดลอกรายการเงินได้ซ้ำ/,
  );
});
