import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function enterTaxpayerDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "เริ่มร่างโดยไม่เข้าสู่ระบบ" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(page.getByRole("heading", { name: "หลักฐานและตรวจทาน" })).toBeVisible();
}

async function verifyJpegDownload(
  page: import("@playwright/test").Page,
  row: import("@playwright/test").Locator,
  bytes: Buffer,
  targetPath: string,
) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "ดาวน์โหลด", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("ตัวอย่างภาพ.jpg");
  await download.saveAs(targetPath);
  expect(await readFile(targetPath)).toEqual(bytes);
}

test("JPEG evidence previews as an image and downloads the exact original bytes after reload", async ({ page }, testInfo) => {
  await page.goto("about:blank");
  const imageData = await page.evaluate<string | null>(`(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#2255aa";
    context.fillRect(0, 0, 2, 2);
    return await new Promise(resolve => canvas.toBlob(blob => {
      if (!blob) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result.split(",")[1] ?? null : null);
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.92));
  })()`);
  if (!imageData) throw new Error("Browser could not create the JPEG fixture.");
  const imageBytes = Buffer.from(imageData, "base64");

  await enterTaxpayerDemo(page);
  await page.getByRole("button", { name: "ตัวอย่าง: นำเงินได้เข้าไทยบางส่วน" }).click();
  await advanceToReview(page);
  const name = "ตัวอย่างภาพ.jpg";
  await page.getByLabel("แนบ: หลักฐานเงินได้").setInputFiles({ name, mimeType: "image/jpeg", buffer: imageBytes });
  const row = page.locator(".file-list li").filter({ hasText: name });

  await row.getByRole("button", { name: "ดูตัวอย่าง", exact: true }).click();
  const preview = page.getByRole("dialog", { name: `ตัวอย่าง: ${name}` });
  const image = preview.getByRole("img", { name: `ตัวอย่างไฟล์: ${name}` });
  await expect(preview).toBeVisible();
  await expect(image).toBeVisible();
  await expect.poll(() => page.evaluate<number>("document.querySelector('dialog img')?.naturalWidth ?? 0")).toBe(2);
  await preview.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  await verifyJpegDownload(page, row, imageBytes, testInfo.outputPath("jpeg-before-reload.jpg"));

  await page.reload();
  await advanceToReview(page);
  const restoredRow = page.locator(".file-list li").filter({ hasText: name });
  await expect(restoredRow).toBeVisible();
  await restoredRow.getByRole("button", { name: "ดูตัวอย่าง", exact: true }).click();
  const restoredPreview = page.getByRole("dialog", { name: `ตัวอย่าง: ${name}` });
  await expect(restoredPreview.getByRole("img", { name: `ตัวอย่างไฟล์: ${name}` })).toBeVisible();
  await restoredPreview.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  await verifyJpegDownload(page, restoredRow, imageBytes, testInfo.outputPath("jpeg-after-reload.jpg"));
});
