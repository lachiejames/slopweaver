import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { catalogFromRows, tokenOfName } from "../../../../store/browse/catalog.js";
import { decodeStoreRowLocator, encodeStoreRowLocator, MAX_LOCATOR_HEX } from "../../../../store/browse/locator.js";
import { cellsOf } from "../../../../store/browse/read.js";
import { rowsSqlPlan } from "../../../../store/browse/sql.js";
import { catalogWithSafeIdentifiers, maskedQueryFailure, storeCellOf } from "../../../../store/browse/values.js";

/** A synthetic GitHub token's shape, assembled so no committed line holds one whole. 40 characters. */
const TOKEN = `${["gh", "p_"].join("")}${"A1".repeat(18)}`;

describe("storeCellOf", () => {
  it("masks a credential shape with an empty denylist", () => {
    expect(unwrap(storeCellOf({ denylist: [], length: 45, showCharacters: 200, value: `note ${TOKEN}` }))).toEqual({
      characters: 45,
      kind: "value",
      text: "note [redacted:github-token]",
      truncated: false,
    });
  });

  it("withholds the whole cell when a secret survives the mask", () => {
    // A denylist word inside the mask's own marker survives masking, so the rescan still finds it.
    expect(unwrap(storeCellOf({ denylist: ["redacted"], length: 8, showCharacters: 200, value: "redacted" }))).toEqual({
      kind: "withheld",
      why: "withheld: it holds a credential the mask could not remove (denylist)",
    });
  });

  it("keeps SQL NULL distinct from an empty string", () => {
    expect(unwrap(storeCellOf({ denylist: [], length: null, showCharacters: 5, value: null }))).toEqual({
      kind: "null",
    });
    expect(unwrap(storeCellOf({ denylist: [], length: 0, showCharacters: 5, value: "" }))).toEqual({
      characters: 0,
      kind: "value",
      text: "",
      truncated: false,
    });
  });

  it("masks a string on the private denylist before the value leaves the verb", () => {
    const cell = unwrap(
      storeCellOf({
        denylist: ["acme-private-word"],
        length: 30,
        showCharacters: 100,
        value: "note: acme-private-word here",
      }),
    );
    expect(cell.kind).toBe("value");
    expect(JSON.stringify(cell).includes("acme-private-word")).toBe(false);
  });

  it("cuts by code point and says so, keeping the stored length", () => {
    expect(unwrap(storeCellOf({ denylist: [], length: 4, showCharacters: 2, value: "a😀bc" }))).toEqual({
      characters: 4,
      kind: "value",
      text: "a😀",
      truncated: true,
    });
  });

  it("marks a value Postgres cut at the fetch window as truncated even when it fits the display", () => {
    expect(unwrap(storeCellOf({ denylist: [], length: 9000, showCharacters: 512, value: "abc" }))).toEqual({
      characters: 9000,
      kind: "value",
      text: "abc",
      truncated: true,
    });
  });

  it("refuses a driver value that is not text with a length", () => {
    expect(unwrapErr(storeCellOf({ denylist: [], length: 1, showCharacters: 5, value: 7 })).code).toBe("QUERY_FAILED");
  });
});

describe("cellsOf", () => {
  it("masks by content on every catalog column, the primary key included, and shows plain text in the clear", () => {
    const base = {
      formatted_type: "text",
      generated: false,
      identity: false,
      live_tuples: 1,
      nullable: true,
      pk_position: null,
      reltuples: 1,
      table_name: "acme_secret",
      type_category: "S",
      type_name: "text",
    };
    const [table] = unwrap(
      catalogFromRows({
        rows: [
          { ...base, column_name: "id", nullable: false, ordinal: 1, pk_position: 1 },
          { ...base, column_name: "body", ordinal: 2 },
          { ...base, column_name: "added_later", ordinal: 3 },
        ],
      }),
    );
    const request = { filter: null, page: 1, pageSize: 50, sort: null, table: "acme_secret" };
    const plan = unwrap(rowsSqlPlan({ request, table: table! }));
    const row = { n0: 40, n1: 15, n2: 45, v0: TOKEN, v1: "plain acme text", v2: `note ${TOKEN}` };
    const cells = unwrap(cellsOf({ denylist: [], plan, row, showCharacters: 512 }));
    expect(Object.keys(cells)).toEqual(table!.definition.columns.map((column) => column.name));
    expect(cells).toEqual({
      added_later: { characters: 45, kind: "value", text: "note [redacted:github-token]", truncated: false },
      body: { characters: 15, kind: "value", text: "plain acme text", truncated: false },
      id: { characters: 40, kind: "value", text: "[redacted:github-token]", truncated: false },
    });
  });
});

describe("catalogWithSafeIdentifiers", () => {
  /** One catalog-query row for a synthetic `acme` column; a key column passes its key position. */
  const column = ({
    table,
    name,
    ordinal,
    key = null,
    type = "text",
  }: {
    table: string;
    name: string;
    ordinal: number;
    key?: number | null;
    type?: string;
  }): Record<string, unknown> => ({
    column_name: name,
    formatted_type: type,
    generated: false,
    identity: false,
    live_tuples: 1,
    nullable: key === null,
    ordinal,
    pk_position: key,
    reltuples: 1,
    table_name: table,
    type_category: "S",
    type_name: "text",
  });
  const clean = [
    column({ key: 1, name: "id", ordinal: 1, table: "acme_clean" }),
    column({ name: "body", ordinal: 2, table: "acme_clean" }),
  ];
  const denylist = ["acme-private-word"];

  it("withholds a table whole when its name, a column name, a key column or a column type would be masked", () => {
    const catalog = unwrap(
      catalogFromRows({
        rows: [
          ...clean,
          column({ key: 1, name: "id", ordinal: 1, table: TOKEN }),
          column({ key: 1, name: "id", ordinal: 1, table: "acme_column_hit" }),
          column({ name: "acme-private-word", ordinal: 2, table: "acme_column_hit" }),
          column({ key: 1, name: TOKEN, ordinal: 1, table: "acme_key_hit" }),
          column({ key: 1, name: "id", ordinal: 1, table: "acme_type_hit" }),
          column({ name: "parent", ordinal: 2, table: "acme_type_hit", type: TOKEN }),
        ],
      }),
    );
    expect(catalog.length).toBe(5);
    const safe = catalogWithSafeIdentifiers({ catalog, denylist });
    expect(safe.withheldTables).toBe(4);
    expect(safe.catalog.map((table) => table.definition.name)).toEqual(["acme_clean"]);
    expect(safe.catalog[0]).toBe(catalog[0]);
    expect(JSON.stringify(safe.catalog).includes("acme-private-word")).toBe(false);
    expect(JSON.stringify(safe.catalog).includes(TOKEN)).toBe(false);
  });

  it("withholds a table whose token, or a column's, prints a denylisted string, never a 16-byte name's hex", () => {
    const catalog = unwrap(
      catalogFromRows({
        rows: [
          ...clean,
          column({ key: 1, name: "id", ordinal: 1, table: "hexed" }),
          column({ key: 1, name: "id", ordinal: 1, table: "acme_column_hex" }),
          column({ name: "hexed", ordinal: 2, table: "acme_column_hex" }),
          column({ key: 1, name: "id", ordinal: 1, table: "acme_sixteen_ab1" }),
        ],
      }),
    );
    const safe = catalogWithSafeIdentifiers({ catalog, denylist: [tokenOfName({ name: "hexed" })] });
    expect(tokenOfName({ name: "acme_sixteen_ab1" }).length).toBe(32);
    expect(safe.withheldTables).toBe(2);
    expect(safe.catalog.map((table) => table.definition.name)).toEqual(["acme_clean", "acme_sixteen_ab1"]);
  });

  it("passes a clean catalog through as the same objects, withholding none", () => {
    const catalog = unwrap(
      catalogFromRows({ rows: [...clean, column({ name: "note", ordinal: 1, table: "acme_other" })] }),
    );
    const safe = catalogWithSafeIdentifiers({ catalog, denylist });
    expect(safe.withheldTables).toBe(0);
    expect(safe.catalog).toEqual(catalog);
    expect(safe.catalog[0]).toBe(catalog[0]);
    expect(safe.catalog[1]).toBe(catalog[1]);
  });
});

describe("maskedQueryFailure", () => {
  it("masks a denylisted word a database error quoted", () => {
    const failure = maskedQueryFailure({
      cause: new Error("cannot render acme-private-word"),
      denylist: ["acme-private-word"],
    });
    expect(failure.code).toBe("QUERY_FAILED");
    expect(failure.message.includes("acme-private-word")).toBe(false);
    expect(failure.message).toContain("the store read failed: cannot render ");
  });

  it("keeps a message that quotes nothing private", () => {
    expect(maskedQueryFailure({ cause: new Error("connection refused"), denylist: [] }).message).toBe(
      "the store read failed: connection refused",
    );
  });
});

describe("row locators", () => {
  it("round-trip a position, and carry exactly the table, partition, ctid and xmin — never a row value", () => {
    const locator = { ctid: "(3,14)", kind: "ctid-xmin" as const, table: "acme_log", tableoid: "16384", xmin: "900" };
    const encoded = encodeStoreRowLocator({ locator });
    expect(unwrap(decodeStoreRowLocator({ encoded }))).toEqual(locator);
    const decodedJson = Buffer.from(encoded, "hex").toString("utf8");
    expect(decodedJson).toBe(
      '{"ctid":"(3,14)","kind":"ctid-xmin","table":"acme_log","tableoid":"16384","xmin":"900","v":1}',
    );
  });

  it("refuses non-hex, a wrong version, a malformed position, a key-value form and an oversized token", () => {
    const code = ({ encoded }: { encoded: string }): string => unwrapErr(decodeStoreRowLocator({ encoded })).code;
    const codeOfName = ({ name }: { name: string }): string => code({ encoded: tokenOfName({ name }) });
    const position = '"kind":"ctid-xmin","tableoid":"16384","ctid":"(0,1)","xmin":"1"';
    expect(code({ encoded: "zz" })).toBe("LOCATOR_INVALID");
    expect(codeOfName({ name: `{"v":2,"table":"acme_log",${position}}` })).toBe("LOCATOR_INVALID");
    expect(
      codeOfName({
        name: '{"v":1,"table":"acme_log","kind":"ctid-xmin","tableoid":"16384","ctid":"0,1); --","xmin":"1"}',
      }),
    ).toBe("LOCATOR_INVALID");
    expect(
      codeOfName({ name: '{"v":1,"table":"acme_log","kind":"ctid-xmin","tableoid":"x","ctid":"(0,1)","xmin":"1"}' }),
    ).toBe("LOCATOR_INVALID");
    expect(
      codeOfName({ name: '{"v":1,"table":"acme_note","kind":"primary-key","key":[{"column":"id","value":"7"}]}' }),
    ).toBe("LOCATOR_INVALID");
    expect(code({ encoded: "ab".repeat(MAX_LOCATOR_HEX) })).toBe("LOCATOR_INVALID");
  });
});
