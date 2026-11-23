/**
 * The identity-link review queue, read through Drizzle's own table and enum metadata — the shape a migration
 * is generated from — rather than a database round-trip: the three statuses, every column with its type,
 * nullability and default, the cascade from a person, the three-part uniqueness and the review index.
 */
import { getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, IndexedColumn, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { linkStatusEnum, personLinkCandidateTable } from "../../../../store/schema/personLink.js";

const config = getTableConfig(personLinkCandidateTable);

/** A column's default rendered as the SQL a migration would carry, or the literal value, or null for none. */
function defaultOf({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return null;
  }
  return is(value, SQL) ? new PgDialect().sqlToQuery(value).sql : value;
}

/** An index column as `name order`, or a marker for an expression index column. */
function indexColumn({ column }: { column: Partial<IndexedColumn | SQL> }): string {
  if (!is(column, IndexedColumn)) {
    return "<expression>";
  }
  return `${String(column.name)} ${String(column.indexConfig.order)}`;
}

describe("linkStatusEnum", () => {
  it("is person_link_status over pending, accepted and rejected, in that order", () => {
    expect(linkStatusEnum.enumName).toBe("person_link_status");
    expect(linkStatusEnum.enumValues).toEqual(["pending", "accepted", "rejected"]);
  });
});

describe("personLinkCandidateTable", () => {
  it("is the person_link_candidate table", () => {
    expect(getTableName(personLinkCandidateTable)).toBe("person_link_candidate");
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
      { default: null, name: "person_id", notNull: true, primary: false, type: "uuid" },
      { default: null, name: "source", notNull: true, primary: false, type: "content_source" },
      { default: null, name: "native_id", notNull: true, primary: false, type: "text" },
      { default: null, name: "handle", notNull: false, primary: false, type: "text" },
      { default: null, name: "confidence", notNull: true, primary: false, type: "numeric(4, 3)" },
      { default: [], name: "signals", notNull: true, primary: false, type: "jsonb" },
      { default: "pending", name: "status", notNull: true, primary: false, type: "person_link_status" },
      { default: "now()", name: "created_at", notNull: true, primary: false, type: "timestamp with time zone" },
      { default: null, name: "reviewed_at", notNull: false, primary: false, type: "timestamp with time zone" },
    ]);
  });

  it("is unique on (person_id, source, native_id) and indexed on status then confidence descending", () => {
    expect(
      config.indexes.map((index) => ({
        columns: index.config.columns.map((column) => indexColumn({ column })),
        name: index.config.name,
        unique: index.config.unique,
      })),
    ).toEqual([
      {
        columns: ["person_id asc", "source asc", "native_id asc"],
        name: "uq_link_candidate",
        unique: true,
      },
      { columns: ["status asc", "confidence desc"], name: "idx_link_candidate_status", unique: false },
    ]);
  });

  it("references person.id from person_id, cascading a person's delete to their candidates", () => {
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
    ).toEqual([{ columns: ["person_id"], foreignColumns: ["id"], foreignTable: "person", onDelete: "cascade" }]);
  });
});
