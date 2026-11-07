import { expect, type Page } from "@playwright/test";

export async function assertFocusedSkipLinkIsScreenOnly(page: Page, pdfPath: string): Promise<void> {
  const skipLink = page.locator(".skip-link");
  await page.evaluate('document.body.setAttribute("tabindex", "-1"); document.body.focus()');
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(skipLink).toBeHidden();
  await expect.poll(() => page.evaluate('getComputedStyle(document.querySelector(".skip-link")).display')).toBe("none");
  const pdf = await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(5_000);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate('document.body.removeAttribute("tabindex")');
}
