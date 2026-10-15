import { lstat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

export default async function globalTeardown() {
  const directory = process.env.FTC_REAL_BROWSER_RUN_DIRECTORY;
  const runToken = process.env.FTC_REAL_BROWSER_RUN_TOKEN;
  const root = resolve(tmpdir()) + sep;
  if (!directory || !isAbsolute(directory) || !resolve(directory).startsWith(root) ||
      !/^ftc-real-backend-browser-\d+$/.test(basename(directory)) ||
      !runToken || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runToken)) return;
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) return;
    const ownerFile = join(directory, ".ftc-run-owner");
    const owner = await lstat(ownerFile);
    if (owner.isSymbolicLink() || !owner.isFile() || await readFile(ownerFile, "utf8") !== runToken) return;
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}
