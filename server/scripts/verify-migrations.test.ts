import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyMigrations } from "./verify-migrations";

const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoots: string[] = [];

async function freshCheckoutFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ftc-migration-checkout-"));
  fixtureRoots.push(root);
  const migrationsDirectory = join(root, "netlify/database/migrations");
  await mkdir(migrationsDirectory, { recursive: true });

  await writeFile(join(root, ".gitattributes"), await readFile(join(repoRoot, ".gitattributes")));
  const lock = await readFile(join(repoRoot, "netlify/database/migrations.lock.json"));
  await writeFile(join(root, "netlify/database/migrations.lock.json"), lock);
  const names = JSON.parse(lock.toString("utf8")).files.map((file: { name: string }) => file.name) as string[];
  for (const name of names) {
    const committedBytes = execFileSync("git", ["show", `HEAD:netlify/database/migrations/${name}`], { cwd: repoRoot });
    await writeFile(join(migrationsDirectory, name), committedBytes);
  }

  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Migration fixture"], { cwd: root });
  execFileSync("git", ["config", "user.email", "migration-fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "migration fixture"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: root });
  execFileSync("git", ["config", "core.eol", "crlf"], { cwd: root });
  execFileSync("git", ["checkout-index", "--force", "--all"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("the ordered migration release gate", () => {
  it("accepts exact committed bytes from a fresh checkout on Windows or Unix", async () => {
    const root = await freshCheckoutFixture();

    await expect(verifyMigrations(root)).resolves.toBe(4);
  });

  it.each([
    "20261014000100_hosted_foundation.sql",
    "20261014000200_login_attempt_reservations.sql",
    "20261014000300_workflow_environment.sql",
    "20261014000400_operator_credential_rotations.sql",
  ])("rejects CRLF conversion of the committed %s bytes", async (name) => {
    const root = await freshCheckoutFixture();
    const path = join(root, "netlify/database/migrations", name);
    const canonical = await readFile(path, "utf8");
    await writeFile(path, canonical.replace(/\r?\n/g, "\r\n"));

    await expect(verifyMigrations(root)).rejects.toThrow(`Migration checksum changed: ${name}`);
  });
});
