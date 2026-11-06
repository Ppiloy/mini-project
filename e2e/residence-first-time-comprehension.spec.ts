import { expect, test } from "@playwright/test";

test("explains why residence is checked in the income-earned year before asking for dates", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่", exact: true }).click();

  const firstStep = page.getByRole("region", { name: "ข้อมูลเบื้องต้น" });
  const residence = page.getByRole("region", { name: "ข้อมูลวันพำนักตามปีที่เกิดเงินได้" });
  await expect(firstStep).toContainText("ปีภาษีที่เลือกด้านล่างใช้กับปีที่นำเงินเข้าไทยเพื่อขอเครดิต");
  await expect(firstStep).toContainText("สถานะผู้มีถิ่นที่อยู่ทางภาษีตรวจวันพำนักในปีที่เกิดเงินได้");
  await expect(residence).toContainText("เพิ่มปีเกิดเงินได้ไว้ก่อน");
  await expect(residence).toContainText("ไม่ต้องเลือกปีซ้ำ");

  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2024");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มช่วงวันที่พำนัก ปี พ.ศ. 2567 (ค.ศ. 2024)", exact: true }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2024-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2024-06-28");
  const renderedText = await firstStep.innerText();
  expect(renderedText.indexOf("สถานะผู้มีถิ่นที่อยู่ทางภาษีตรวจวันพำนักในปีที่เกิดเงินได้"))
    .toBeLessThan(renderedText.indexOf("วันแรกที่พำนัก · ช่วงที่ 1"));
  await expect(page.getByRole("status", { name: "สรุปวันพำนัก ปี พ.ศ. 2567 (ค.ศ. 2024)" })).toContainText("180 วัน");

  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ข้อมูลเงินได้พึงประเมินที่นำเข้ามาจากต่างประเทศ" })).toBeVisible();
});

test("uses the source earned date to link residence without asking for the same year again", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "ผู้เสียภาษี" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่", exact: true }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2024");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้", exact: true }).click();
  await page.getByLabel("รูปแบบข้อมูลวันพำนัก").selectOption("declared");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();

  await page.getByRole("button", { name: "เพิ่มแหล่งเงินได้แรก" }).click();
  const source = page.locator(".source-card").first();
  await source.getByLabel("วันที่เกิดเงินได้").fill("2024-02-01");
  await expect(source.getByLabel(/ปีภาษีที่เกิดเงินได้/)).toContainText("ค.ศ. 2024");
  await expect(source.getByRole("button", { name: "ดูข้อมูลวันพำนักปี พ.ศ. 2567" })).toBeVisible();

  await page.getByRole("button", { name: "ข้อมูลเบื้องต้น", exact: true }).click();
  await expect(page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)")).toHaveCount(0);
  const residence = page.getByRole("article", { name: "ปี พ.ศ. 2567 (ค.ศ. 2024)" });
  await expect(residence).toContainText("ผู้ใช้ยืนยันว่าพำนักอย่างน้อย 180 วัน");
  await expect(residence).toContainText("ปีนี้อ่านจากวันที่เกิดเงินได้ในรายการ");
});
