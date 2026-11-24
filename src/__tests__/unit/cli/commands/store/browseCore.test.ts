import { describe, expect, it } from "vitest";

import {
  parseStoreRowArgs,
  parseStoreRowsArgs,
  parseStoreTablesArgs,
} from "../../../../../cli/commands/store/browseCore.js";
import { storeCommandErrorLines } from "../../../../../cli/commands/store/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { tokenOfName } from "../../../../../store/browse/catalog.js";

const TABLE = tokenOfName({ name: "acme_note" });
const ID = tokenOfName({ name: "id" });

/** The refusal lines a rows parse came to. */
const refused = (...rest: readonly string[]): readonly string[] =>
  storeCommandErrorLines({ error: unwrapErr(parseStoreRowsArgs({ rest })) });

describe("parseStoreTablesArgs", () => {
  it("reads the home and the JSON switch", () => {
    expect(unwrap(parseStoreTablesArgs({ rest: ["--home", "/tmp/acme", "--json"] }))).toEqual({
      home: "/tmp/acme",
      json: true,
    });
  });
});

describe("parseStoreRowsArgs", () => {
  it("defaults to page 1 of 50, no sort, no filter", () => {
    expect(unwrap(parseStoreRowsArgs({ rest: ["--table-hex", TABLE] }))).toEqual({
      json: false,
      request: { filter: null, page: 1, pageSize: 50, sort: null, table: "acme_note" },
    });
  });

  it("decodes a sort and a filter value that would read as a flag in plain argv", () => {
    const args = unwrap(
      parseStoreRowsArgs({
        rest: [
          "--table-hex",
          TABLE,
          "--sort-hex",
          ID,
          "--direction",
          "desc",
          "--filter-column-hex",
          ID,
          "--filter-op",
          "contains",
          "--filter-value-hex",
          tokenOfName({ name: "--home /etc" }),
          "--page",
          "3",
          "--page-size",
          "100",
        ],
      }),
    );
    expect(args.request).toEqual({
      filter: { column: "id", operator: "contains", value: "--home /etc" },
      page: 3,
      pageSize: 100,
      sort: { column: "id", direction: "desc" },
      table: "acme_note",
    });
  });

  it("takes a null check with no value", () => {
    expect(
      unwrap(parseStoreRowsArgs({ rest: ["--table-hex", TABLE, "--filter-column-hex", ID, "--filter-op", "is-null"] }))
        .request.filter,
    ).toEqual({ column: "id", operator: "is-null" });
  });

  it("refuses a missing table, a page size past 100, half a filter and a value on a null check", () => {
    expect(refused()).toEqual(["--table-hex names the table to read"]);
    expect(refused("--table-hex", TABLE, "--page-size", "101")).toEqual([
      '--page-size takes a whole number from 1 to 100, not "101"',
    ]);
    expect(refused("--table-hex", TABLE, "--page", "0")).toEqual([
      `--page takes a whole number from 1 to ${String(Number.MAX_SAFE_INTEGER)}, not "0"`,
    ]);
    expect(refused("--table-hex", TABLE, "--filter-op", "eq")).toEqual([
      "a filter needs both --filter-column-hex and --filter-op",
    ]);
    expect(
      refused("--table-hex", TABLE, "--filter-column-hex", ID, "--filter-op", "not-null", "--filter-value-hex", "61"),
    ).toEqual(["--filter-op not-null takes no --filter-value-hex"]);
    expect(refused("--table-hex", TABLE, "--filter-column-hex", ID, "--filter-op", "eq")).toEqual([
      "--filter-op eq needs --filter-value-hex",
    ]);
    expect(refused("--table-hex", "ACME")).toEqual(["--table-hex is not lowercase hex of whole bytes"]);
    expect(refused("--table-hex", TABLE, "--direction", "desc")).toEqual([
      "--direction needs --sort-hex naming the column to sort by",
    ]);
  });
});

describe("parseStoreRowArgs", () => {
  it("takes a lowercase hex locator and refuses anything else", () => {
    expect(unwrap(parseStoreRowArgs({ rest: ["--locator-hex", "7b7d", "--json"] }))).toEqual({
      json: true,
      locatorHex: "7b7d",
    });
    expect(storeCommandErrorLines({ error: unwrapErr(parseStoreRowArgs({ rest: [] })) })).toEqual([
      "--locator-hex names the row to read",
    ]);
    expect(unwrapErr(parseStoreRowArgs({ rest: ["--locator-hex", "7B7D"] })).code).toBe("ARGUMENTS_REFUSED");
  });
});
