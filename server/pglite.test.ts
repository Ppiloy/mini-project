import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("local PostgreSQL-compatible test database", () => {
  it("round-trips a parameterized NUMERIC decimal as text", async () => {
    const database = new PGlite();

    try {
      await database.exec("CREATE TABLE amounts (value NUMERIC(30, 12) NOT NULL)");
      await database.query("INSERT INTO amounts (value) VALUES ($1::numeric)", ["123456.780000000001"]);
      const result = await database.query<{ value: string }>("SELECT value::text AS value FROM amounts");

      expect(result.rows).toEqual([{ value: "123456.780000000001" }]);
    } finally {
      await database.close();
    }
  });
});
