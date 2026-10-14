import { lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, resolve, sep } from "node:path";

export default async function globalTeardown() {
  const directory = process.env.FTC_REAL_BROWSER_RUN_DIRECTORY;
  const root = resolve(tmpdir()) + sep;
  if (!directory || !isAbsolute(directory) || !resolve(directory).startsWith(root) ||
      !/^ftc-real-backend-browser-\d+$/.test(basename(directory))) return;
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) return;
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
