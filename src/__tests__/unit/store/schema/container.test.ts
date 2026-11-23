/**
 * The `container` table, read through Drizzle's own table config — the shape a migration is generated from —
 * rather than a database round-trip: its columns, the source-plus-native-id identity, its two lookup indexes,
 * and the self-reference whose delete is RESTRICTed rather than cascaded.
 */
import { getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, IndexedColumn, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { containerTable } from "../../../../store/schema/container.js";

const config = getTableConfig(containerTable);

/** A column's default rendered as the SQL a migration would carry, or the literal value, or null for none. */
function defaultOf({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return null;
  }
  return is(value, SQL) ? new PgDialect().sqlToQuery(value).sql : value;
}

/** An index column's name, or a marker for an expression index column. */
function indexColumnName({ column }: { column: Partial<IndexedColumn | SQL> }): string {
  return is(column, IndexedColumn) ? String(column.name) : "<expression>";
}

describe("containerTable", () => {
  it("is the container table", () => {
    expect(getTableName(containerTable)).toBe("container");
  });

  it("declares each column's SQL type, nullability, primary key and default", () => {
    expect(
      config.columns.map((column) => ({
        default: defaultOf({ value: column.default }),
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.getSQLType(),
      })),
    ).toEqual([
      { default: "gen_random_uuid()", name: "id", notNull: true, primary: true, type: "uuid" },
      { default: null, name: "source", notNull: true, primary: false, type: "content_source" },
      { default: null, name: "native_id", notNull: true, primary: false, type: "text" },
      { default: null, name: "kind", notNull: true, primary: false, type: "container_kind" },
      { default: null, name: "name", notNull: true, primary: false, type: "text" },
      { default: null, name: "parent_id", notNull: false, primary: false, type: "uuid" },
      { default: "now()", name: "created_at", notNull: true, primary: false, type: "timestamp with time zone" },
    ]);
  });

  it("is unique on (source, native_id) and indexed on parent and on (source, kind)", () => {
    expect(
      config.indexes.map((index) => ({
        columns: index.config.columns.map((column) => indexColumnName({ column })),
        name: index.config.name,
        unique: index.config.unique,
      })),
    ).toEqual([
      { columns: ["source", "native_id"], name: "uq_container_source_native", unique: true },
      { columns: ["parent_id"], name: "idx_container_parent", unique: false },
      { columns: ["source", "kind"], name: "idx_container_source_kind", unique: false },
    ]);
  });

  it("references its own id from parent_id, restricting a delete rather than cascading it", () => {
    expect(
      config.foreignKeys.map((key) => {
        const reference = key.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          foreignTable: getTableName(reference.foreignTable),
          onDelete: key.onDelete,
        };
      }),
    ).toEqual([{ columns: ["parent_id"], foreignColumns: ["id"], foreignTable: "container", onDelete: "restrict" }]);
  });
});
