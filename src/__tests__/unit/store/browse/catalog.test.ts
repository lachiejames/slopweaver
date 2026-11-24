import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  catalogFromRows,
  columnFromTable,
  displayKindOf,
  estimatedRowsOf,
  nameOfToken,
  tableFromCatalog,
  tokenOfName,
} from "../../../../store/browse/catalog.js";

/** One catalog row as the catalog query returns it, for a synthetic `acme` table. */
const row = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  column_name: "id",
  formatted_type: "uuid",
  generated: false,
  identity: false,
  live_tuples: 12,
  nullable: false,
  ordinal: 1,
  pk_position: 1,
  reltuples: -1,
  table_name: "acme_note",
  type_category: "U",
  type_name: "uuid",
  ...over,
});

describe("tokenOfName / nameOfToken", () => {
  it("round-trips a name holding a quote, a space and a leading dash", () => {
    const name = '-acme "odd" name';
    expect(unwrap(nameOfToken({ token: tokenOfName({ name }) }))).toBe(name);
  });

  it("refuses uppercase hex, odd length, empty and invalid UTF-8", () => {
    expect(unwrapErr(nameOfToken({ token: "6D" }))).toBe("not lowercase hex of whole bytes");
    expect(unwrapErr(nameOfToken({ token: "6" }))).toBe("not lowercase hex of whole bytes");
    expect(unwrapErr(nameOfToken({ token: "" }))).toBe("not lowercase hex of whole bytes");
    expect(unwrapErr(nameOfToken({ token: "ff" }))).toBe("not valid UTF-8");
  });
});

describe("displayKindOf", () => {
  it("picks json, binary, number, boolean, temporal and text from the catalog type", () => {
    expect(displayKindOf({ typeCategory: "U", typeName: "jsonb" })).toBe("json");
    expect(displayKindOf({ typeCategory: "U", typeName: "bytea" })).toBe("binary");
    expect(displayKindOf({ typeCategory: "N", typeName: "int8" })).toBe("number");
    expect(displayKindOf({ typeCategory: "B", typeName: "bool" })).toBe("boolean");
    expect(displayKindOf({ typeCategory: "D", typeName: "timestamptz" })).toBe("temporal");
    expect(displayKindOf({ typeCategory: "T", typeName: "interval" })).toBe("temporal");
    expect(displayKindOf({ typeCategory: "A", typeName: "_text" })).toBe("text");
  });
});

describe("estimatedRowsOf", () => {
  it("takes the larger known estimate, so a never-analysed table still reads its live count", () => {
    expect(estimatedRowsOf({ liveTuples: 12, reltuples: -1 })).toBe(12);
    expect(estimatedRowsOf({ liveTuples: 0, reltuples: 40.4 })).toBe(40);
  });

  it("is null, never zero, when neither estimate exists", () => {
    expect(estimatedRowsOf({ liveTuples: null, reltuples: -1 })).toBe(null);
  });
});

describe("catalogFromRows", () => {
  const rows = [
    row({
      column_name: "body",
      formatted_type: "text",
      nullable: true,
      ordinal: 3,
      pk_position: null,
      type_category: "S",
      type_name: "text",
    }),
    row({
      column_name: "tenant",
      formatted_type: "text",
      ordinal: 2,
      pk_position: 2,
      type_category: "S",
      type_name: "text",
    }),
    row(),
    row({
      column_name: "at",
      live_tuples: null,
      ordinal: 1,
      pk_position: null,
      reltuples: 3,
      table_name: "acme_audit",
      type_category: "D",
      type_name: "timestamptz",
      formatted_type: "timestamp with time zone",
    }),
  ];

  it("groups by table in name order, columns in table order, key in key order", () => {
    const catalog = unwrap(catalogFromRows({ rows }));
    expect(catalog.map((table) => table.definition.name)).toEqual(["acme_audit", "acme_note"]);
    const note = catalog[1]!.definition;
    expect(note.columns.map((column) => column.name)).toEqual(["id", "tenant", "body"]);
    expect(note.primaryKey).toEqual(["id", "tenant"]);
    expect(note.estimatedRows).toBe(12);
    expect(note.token).toBe(tokenOfName({ name: "acme_note" }));
    expect(catalog[0]!.definition.primaryKey).toEqual([]);
    expect(catalog[0]!.definition.columns[0]!.displayKind).toBe("temporal");
  });

  it("refuses a row missing a field rather than guessing it", () => {
    expect(unwrapErr(catalogFromRows({ rows: [row({ nullable: "yes" })] })).code).toBe("CATALOG_MALFORMED");
  });

  it("confirms a table and a column by name, and refuses one the catalog lacks", () => {
    const catalog = unwrap(catalogFromRows({ rows }));
    const note = unwrap(tableFromCatalog({ catalog, table: "acme_note" }));
    expect(unwrap(columnFromTable({ column: "body", table: note })).nullable).toBe(true);
    expect(unwrapErr(tableFromCatalog({ catalog, table: "acme_missing" })).code).toBe("TABLE_UNKNOWN");
    expect(unwrapErr(columnFromTable({ column: "nope", table: note })).code).toBe("COLUMN_UNKNOWN");
  });
});
