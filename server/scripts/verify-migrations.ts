import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

interface MigrationLock {
  files: Array<{ name: string; sha256: string }>;
}

export async function verifyMigrations(root = process.cwd()): Promise<number> {
  const directory = resolve(root, "netlify/database/migrations");
  const lockPath = resolve(root, "netlify/database/migrations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as MigrationLock;
  const actualNames = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const lockedNames = lock.files.map((file) => file.name);

  if (actualNames.length === 0 || JSON.stringify(actualNames) !== JSON.stringify(lockedNames)) {
    throw new Error("Migration files differ from the ordered migration lock; review and update the lock with the schema change.");
  }

  const database = new PGlite();
  try {
    for (const name of actualNames) {
      if (!/^\d{14}_[a-z0-9_-]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
      const sql = await readFile(resolve(directory, name), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      const expected = lock.files.find((file) => file.name === name)?.sha256;
      if (digest !== expected) throw new Error(`Migration checksum changed: ${name}`);
      await database.exec(sql);
    }
  } finally {
    await database.close();
  }
  return actualNames.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const count = await verifyMigrations();
    process.stdout.write(`Verified ${count} ordered PostgreSQL migrations and applied them to a blank PostgreSQL-compatible database.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Migration verification failed."}\n`);
    process.exitCode = 1;
  }
}
