/**
 * The `tsvector` custom type must declare the Postgres type `tsvector` — a `text` column typechecks and
 * generates a migration, then fails the GIN index when applied. Read through Drizzle's own table config, so
 * what is asserted is the type a migration would be generated from.
 */
import { getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tsvector } from "../../../../store/schema/tsvector.js";

describe("tsvector", () => {
  it("builds a column whose SQL type is exactly tsvector, under the name it was given", () => {
    const table = pgTable("searchable_things", { searchable: tsvector("searchable") });
    const columns = getTableConfig(table).columns.map((column) => [column.name, column.getSQLType()]);

    expect(columns).toEqual([["searchable", "tsvector"]]);
  });
});
