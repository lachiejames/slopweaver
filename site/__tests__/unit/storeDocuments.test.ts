/*
 * The Store page's three documents decode strictly: every field the CLI promises, of its type, or one sentence naming
 * the first wrong one — never a stand-in zero, an empty cell or a shorter list. The fixtures are typed as the CLI's
 * own wire types (`src/store/browse/types.ts`) and assigned to the page's in both directions, so a field changed on
 * one side and missed on the other fails the typecheck here. Synthetic `acme` data only.
 */
import { describe, expect, it } from "vitest";

import type {
  StoreRowDocument as CliRowDocument,
  StoreRowsDocument as CliRowsDocument,
  StoreTablesDocument as CliTablesDocument,
} from "../../../src/store/browse/types";
import { utf8Hex } from "../../lib/slots";
import {
  decodeStoreReadResponse,
  decodeStoreRow,
  decodeStoreRows,
  decodeStoreTables,
  type StoreColumnDefinition,
  type StoreRowDocument,
  type StoreRowsDocument,
  type StoreTablesDocument,
} from "../../lib/storeDocuments";

const ID: StoreColumnDefinition = {
  displayKind: "number",
  formattedType: "bigint",
  generated: false,
  identity: true,
  name: "id",
  nullable: false,
  ordinal: 1,
  primaryKeyPosition: 1,
  token: utf8Hex({ text: "id" }),
};

const NOTE: StoreColumnDefinition = {
  displayKind: "text",
  formattedType: "text",
  generated: false,
  identity: false,
  name: "note",
  nullable: true,
  ordinal: 2,
  primaryKeyPosition: null,
  token: utf8Hex({ text: "note" }),
};

const TABLES: CliTablesDocument = {
  observedAtIso: "2026-11-18T10:00:00.000Z",
  schema: "public",
  tables: [
    {
      columns: [ID, NOTE],
      estimatedRows: 1200,
      name: "acme_orders",
      primaryKey: ["id"],
      token: utf8Hex({ text: "acme_orders" }),
    },
    {
      columns: [NOTE],
      estimatedRows: null,
      name: "acme_notes",
      primaryKey: [],
      token: utf8Hex({ text: "acme_notes" }),
    },
  ],
  withheldTables: 2,
};

const ROWS: CliRowsDocument = {
  columns: [ID, NOTE],
  filter: { column: "note", operator: "contains", value: "acme" },
  hasNext: true,
  hasPrevious: false,
  locatorStability: "ctid-xmin",
  observedAtIso: "2026-11-18T10:00:01.000Z",
  page: 1,
  pageSize: 50,
  rows: [
    {
      cells: { id: { characters: 1, kind: "value", text: "7", truncated: false }, note: { kind: "null" } },
      locator: "7b7d",
    },
    {
      cells: {
        id: { characters: 1, kind: "value", text: "8", truncated: false },
        note: { kind: "withheld", why: "a credential survived the mask" },
      },
      locator: "7b2031207d",
    },
  ],
  sort: { column: null, direction: "asc" },
  table: "acme_orders",
};

const ROW: CliRowDocument = {
  cells: {
    id: { characters: 1, kind: "value", text: "7", truncated: false },
    note: { characters: 9000, kind: "value", text: "acme ".repeat(10), truncated: true },
  },
  columns: [ID, NOTE],
  locator: "7b7d",
  locatorStability: "ctid-xmin",
  observedAtIso: "2026-11-18T10:00:02.000Z",
  table: "acme_orders",
};

/** A copy of a document with one field replaced, the way a drifted verb would print it. */
function withField({ doc, key, value }: { doc: object; key: string; value: unknown }): Record<string, unknown> {
  return { ...doc, [key]: value };
}

describe("the wire shapes", () => {
  it("are the CLI's own, in both directions", () => {
    const tables: StoreTablesDocument = TABLES;
    const rows: StoreRowsDocument = ROWS;
    const row: StoreRowDocument = ROW;
    const back: [CliTablesDocument, CliRowsDocument, CliRowDocument] = [tables, rows, row];
    expect(back).toEqual([TABLES, ROWS, ROW]);
  });
});

describe("decodeStoreTables", () => {
  it("decodes the document whole, an unanalysed table's estimate kept as null rather than zero", () => {
    const decoded = decodeStoreTables({ value: TABLES })._unsafeUnwrap();
    expect(decoded).toEqual(TABLES);
    expect(decoded.tables[1].estimatedRows).toBeNull();
    expect(decoded.withheldTables).toBe(2);
  });

  it("refuses a withheld count that is missing, negative, fractional or not a number, rather than reading zero", () => {
    const refusal = "the tables document.withheldTables is not a whole number from 0";
    const missing = Object.fromEntries(Object.entries(TABLES).filter(([key]) => key !== "withheldTables"));
    expect(decodeStoreTables({ value: missing })._unsafeUnwrapErr()).toBe(refusal);
    const withCount = ({ value }: { value: unknown }): string =>
      decodeStoreTables({ value: withField({ doc: TABLES, key: "withheldTables", value }) })._unsafeUnwrapErr();
    expect(withCount({ value: -1 })).toBe(refusal);
    expect(withCount({ value: 0.5 })).toBe(refusal);
    expect(withCount({ value: "2" })).toBe(refusal);
  });

  it("tolerates a field the page does not draw yet", () => {
    expect(decodeStoreTables({ value: withField({ doc: TABLES, key: "extra", value: 1 }) })._unsafeUnwrap()).toEqual(
      TABLES,
    );
  });

  it("names the first wrong field, deep in a column", () => {
    const broken = withField({
      doc: TABLES,
      key: "tables",
      value: [{ ...TABLES.tables[0], columns: [{ ...ID, nullable: "no" }] }],
    });
    expect(decodeStoreTables({ value: broken })._unsafeUnwrapErr()).toBe(
      "the tables document.tables[0].columns[0].nullable is not a boolean",
    );
  });

  it("refuses a negative estimate, a non-token, a missing list and a non-object", () => {
    const table = TABLES.tables[0];
    expect(
      decodeStoreTables({
        value: withField({ doc: TABLES, key: "tables", value: [{ ...table, estimatedRows: -1 }] }),
      })._unsafeUnwrapErr(),
    ).toBe("the tables document.tables[0].estimatedRows is not null or a count from 0");
    expect(
      decodeStoreTables({
        value: withField({ doc: TABLES, key: "tables", value: [{ ...table, token: "acme_orders" }] }),
      })._unsafeUnwrapErr(),
    ).toBe("the tables document.tables[0].token is not a catalog token");
    expect(
      decodeStoreTables({ value: withField({ doc: TABLES, key: "tables", value: null }) })._unsafeUnwrapErr(),
    ).toBe("the tables document.tables is not a list");
    expect(decodeStoreTables({ value: [] })._unsafeUnwrapErr()).toBe("the tables document is not an object");
  });

  it("refuses an observed time that is not an instant the verb printed", () => {
    expect(
      decodeStoreTables({ value: withField({ doc: TABLES, key: "observedAtIso", value: "today" }) })._unsafeUnwrapErr(),
    ).toBe("the tables document.observedAtIso is not an ISO instant");
  });
});

describe("decodeStoreRows", () => {
  it("decodes the document whole: null, withheld and value cells kept apart", () => {
    expect(decodeStoreRows({ value: ROWS })._unsafeUnwrap()).toEqual(ROWS);
  });

  it("refuses a row missing a column's cell, rather than drawing it blank", () => {
    const rows = [{ cells: { id: ROWS.rows[0].cells["id"] }, locator: "7b7d" }];
    expect(decodeStoreRows({ value: withField({ doc: ROWS, key: "rows", value: rows }) })._unsafeUnwrapErr()).toBe(
      "the rows document.rows[0].cells has no cell for column note",
    );
  });

  it("refuses a cell for a column the document does not list, which would never be drawn", () => {
    const rows = [{ cells: { ...ROWS.rows[0].cells, secret: { kind: "null" } }, locator: "7b7d" }];
    expect(decodeStoreRows({ value: withField({ doc: ROWS, key: "rows", value: rows }) })._unsafeUnwrapErr()).toBe(
      "the rows document.rows[0].cells carries secret, which is not one of the document's columns",
    );
  });

  it("refuses an unknown cell kind and a cell with no text", () => {
    const kind = [{ cells: { ...ROWS.rows[0].cells, note: { kind: "empty" } }, locator: "7b7d" }];
    expect(decodeStoreRows({ value: withField({ doc: ROWS, key: "rows", value: kind }) })._unsafeUnwrapErr()).toBe(
      'the rows document.rows[0].cells["note"].kind is not one of null, withheld, value',
    );
    const textless = [{ cells: { ...ROWS.rows[0].cells, note: { characters: 0, kind: "value", truncated: false } } }];
    expect(
      decodeStoreRows({
        value: withField({ doc: ROWS, key: "rows", value: [{ ...textless[0], locator: "7b7d" }] }),
      })._unsafeUnwrapErr(),
    ).toBe('the rows document.rows[0].cells["note"].text is not a string');
  });

  it("holds the filter's value to its operator: a string for contains, null for is-null", () => {
    expect(
      decodeStoreRows({
        value: withField({ doc: ROWS, key: "filter", value: { column: "note", operator: "is-null", value: null } }),
      })._unsafeUnwrap().filter,
    ).toEqual({ column: "note", operator: "is-null", value: null });
    expect(
      decodeStoreRows({
        value: withField({ doc: ROWS, key: "filter", value: { column: "note", operator: "contains", value: null } }),
      })._unsafeUnwrapErr(),
    ).toBe("the rows document.filter.value is not a string, as contains carries one");
    expect(
      decodeStoreRows({
        value: withField({ doc: ROWS, key: "filter", value: { column: "note", operator: "is-null", value: "x" } }),
      })._unsafeUnwrapErr(),
    ).toBe("the rows document.filter.value is not null, as is-null carries none");
  });

  it("refuses an unknown stability, a page of zero and a locator that is not hex", () => {
    expect(
      decodeStoreRows({
        value: withField({ doc: ROWS, key: "locatorStability", value: "ephemeral" }),
      })._unsafeUnwrapErr(),
    ).toBe("the rows document.locatorStability is not one of ctid-xmin");
    expect(decodeStoreRows({ value: withField({ doc: ROWS, key: "page", value: 0 }) })._unsafeUnwrapErr()).toBe(
      "the rows document.page is not a whole number from 1",
    );
    const rows = [{ ...ROWS.rows[0], locator: "{}" }];
    expect(decodeStoreRows({ value: withField({ doc: ROWS, key: "rows", value: rows }) })._unsafeUnwrapErr()).toBe(
      "the rows document.rows[0].locator is not a row locator",
    );
  });
});

describe("decodeStoreRow", () => {
  it("decodes the document whole, a cut value keeping its full length", () => {
    const decoded = decodeStoreRow({ value: ROW })._unsafeUnwrap();
    expect(decoded).toEqual(ROW);
    expect(decoded.cells["note"]).toEqual({
      characters: 9000,
      kind: "value",
      text: "acme ".repeat(10),
      truncated: true,
    });
  });

  it("refuses a row with no cells object", () => {
    expect(decodeStoreRow({ value: withField({ doc: ROW, key: "cells", value: [] }) })._unsafeUnwrapErr()).toBe(
      "the row document.cells is not an object of cells by column name",
    );
  });
});

describe("decodeStoreReadResponse", () => {
  it("passes a read's document through undecoded", () => {
    expect(decodeStoreReadResponse({ body: { document: TABLES, outcome: "read", tookMs: 30 }, status: 200 })).toEqual({
      document: TABLES,
      outcome: "read",
      tookMs: 30,
    });
  });

  it("keeps a refusal's sentence and code, and a 404's error", () => {
    expect(
      decodeStoreReadResponse({ body: { code: "STORE_UNSELECTED", outcome: "refused", why: "no store" }, status: 422 }),
    ).toEqual({ code: "STORE_UNSELECTED", outcome: "refused", why: "no store" });
    expect(decodeStoreReadResponse({ body: { error: "no store read named query" }, status: 404 })).toEqual({
      code: null,
      outcome: "refused",
      why: "no store read named query",
    });
  });

  it("names a body of any other shape by its status, never an empty table", () => {
    expect(decodeStoreReadResponse({ body: "<html>", status: 500 })).toEqual({
      code: null,
      outcome: "refused",
      why: "the store route answered 500 with no reading in it",
    });
  });
});
