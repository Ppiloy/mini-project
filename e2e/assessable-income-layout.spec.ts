import { expect, test } from "@playwright/test";

test("I J K L use a balanced desktop grid and a readable phone stack without changing amounts", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ตัวอย่าง: เงินได้จากเวียดนามและจีน" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const i = page.getByLabel("เงินได้พึงประเมินในต่างประเทศที่นำเข้ามา");
  const k = page.getByLabel("เงินได้พึงประเมินรวมจากทุกแหล่งเงินได้");
  const j = page.locator("#case-domesticAssessableIncome");
  const l = page.locator("#case-thaiTax-amountBeforeFtc");
  await expect(i).toContainText("975,000.00");
  await expect(k).toContainText("1,975,000.00");
  await expect(j).toBeEditable();
  await expect(l).toBeEditable();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const [ib, jb, kb, lb] = await Promise.all([i.boundingBox(), j.boundingBox(), k.boundingBox(), l.boundingBox()] as const);
    if (!ib || !jb || !kb || !lb) throw new Error("All four amounts must be visible for layout verification.");
    const main = (await page.locator(".form-workspace").boundingBox())!;
    expect(Math.abs(ib.height - jb.height)).toBeLessThan(1);
    expect(Math.abs(kb.height - lb.height)).toBeLessThan(1);
    if (width === 1280) {
      expect(Math.abs(ib.y - jb.y)).toBeLessThan(12);
      expect(Math.abs(kb.y - lb.y)).toBeLessThan(12);
      expect(jb.x).toBeGreaterThan(ib.x + ib.width);
      expect(main.x + main.width - (jb.x + jb.width)).toBeLessThan(60);
    } else {
      expect(jb.y).toBeGreaterThan(ib.y + ib.height);
      expect(kb.y).toBeGreaterThan(jb.y + jb.height);
      expect(lb.y).toBeGreaterThan(kb.y + kb.height);
    }
    expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(width);
    await page.evaluate("window.scrollTo(0, 0)");
    await page.screenshot({ path: `tmp/report-date-fx/assessable-${width}.png`, fullPage: true });
  }
  await j.fill("2000000");
  await expect(k).toContainText("2,975,000.00");
  await l.focus();
  await expect(l).toHaveValue("318750.00");
  await expect(j).toHaveValue("2000000");
  await expect(page.getByText("2,000,000.00", { exact: true })).toBeVisible();
  await l.blur();
  await expect(l).toHaveValue("318750.00");
  await expect(page.getByText("318,750.00", { exact: true })).toBeVisible();
  await j.focus();
  await expect(j).toHaveValue("2000000");
});

test("basic residence information keeps gutters and readable day totals at desktop and phone widths", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "เริ่มคำนวณใหม่" }).click();
  await page.getByLabel("ปีภาษี (พ.ศ.)").selectOption("2568");
  await page.getByLabel("ปีที่เกิดเงินได้ (ค.ศ.)").fill("2025");
  await page.getByRole("button", { name: "เพิ่มปีที่เกิดเงินได้" }).click();
  await page.getByRole("button", { name: /เพิ่มช่วงวันที่พำนัก ปี พ\.ศ\. 2568/ }).click();
  await page.getByLabel("วันแรกที่พำนัก · ช่วงที่ 1").fill("2025-01-01");
  await page.getByLabel("วันสุดท้ายที่พำนัก · ช่วงที่ 1").fill("2025-07-19");
  const residence = page.getByRole("region", { name: "ข้อมูลวันพำนักตามปีที่เกิดเงินได้", exact: true });
  const heading = residence.getByRole("heading", { level: 2 });
  const total = residence.getByRole("status", { name: /สรุปวันพำนัก/ });
  await expect(total).toContainText("200 วัน");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const card = (await residence.boundingBox())!;
    const title = (await heading.boundingBox())!;
    const result = (await total.boundingBox())!;
    expect(title.x - card.x).toBeGreaterThanOrEqual(16);
    expect(card.x).toBeGreaterThanOrEqual(16);
    expect(result.x + result.width).toBeLessThanOrEqual(card.x + card.width - 16);
    expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(width);
    await page.evaluate("window.scrollTo(0, 0)");
    await page.screenshot({ path: `tmp/report-date-fx/basic-${width}.png`, fullPage: true });
  }
});
