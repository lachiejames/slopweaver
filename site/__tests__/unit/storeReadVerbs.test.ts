/*
 * The Store page's closed list of reads: exact argv per slug, request fields filling declared data flags only, every
 * value (a typed filter value included) in a spelling no parser reads as a flag, and the route's answer read off a
 * finished child. Synthetic `acme` names only.
 */
import { describe, expect, it } from "vitest";

import { type BuiltArgv, utf8Hex } from "../../lib/slots";
import type { SpawnOutcome } from "../../lib/spawnVerb";
import {
  isStoreToken,
  LOCATOR_MAX,
  STORE_FILTER_VALUE_MAX,
  STORE_READ_TIMEOUT_MS,
  STORE_READ_VERBS,
  storeErrorOf,
  storeReadOutcomeOf,
  storeReadVerbFor,
} from "../../lib/storeReadVerbs";

/** `acme_orders`, as `store tables` prints its token. */
const TABLE = utf8Hex({ text: "acme_orders" });

/** `customer_name`, as a column token. */
const COLUMN = utf8Hex({ text: "customer_name" });

/**
 * Build one slug's argv from a request.
 *
 * @returns what the row built
 */
function build({ slug, request }: { slug: string; request: Record<string, unknown> }): BuiltArgv {
  return storeReadVerbFor({ slug })!.build({ request });
}

/**
 * The argv a request builds, throwing on a refusal the way `unwrap` does, so no assertion branches on the kind.
 *
 * @returns the argv
 */
function argvOf({ slug, request }: { slug: string; request: Record<string, unknown> }): readonly string[] {
  const built = build({ request, slug });
  if (built.kind === "refused") {
    throw new Error(built.why);
  }
  return built.argv;
}

describe("STORE_READ_VERBS", () => {
  it("holds exactly the three reads, each bounded at fifteen seconds and titled without a value", () => {
    expect(STORE_READ_VERBS.length).toBeGreaterThan(0);
    expect(STORE_READ_VERBS.map((row) => [row.slug, row.title, row.timeoutMs])).toEqual([
      ["tables", "slopweaver store tables", STORE_READ_TIMEOUT_MS],
      ["rows", "slopweaver store rows", STORE_READ_TIMEOUT_MS],
      ["row", "slopweaver store row", STORE_READ_TIMEOUT_MS],
    ]);
    expect(STORE_READ_TIMEOUT_MS).toBe(15_000);
  });

  it("knows no slug outside the list", () => {
    expect(storeReadVerbFor({ slug: "query" })).toBeUndefined();
    expect(storeReadVerbFor({ slug: "tables" })!.slug).toBe("tables");
  });
});

describe("tables", () => {
  it("builds store tables --json from an empty body", () => {
    expect(build({ request: {}, slug: "tables" })).toEqual({ argv: ["store", "tables", "--json"], kind: "argv" });
  });

  it("refuses any field at all", () => {
    expect(build({ request: { table: TABLE }, slug: "tables" })).toEqual({
      kind: "refused",
      why: "store tables takes no field named table",
    });
  });
});

describe("rows", () => {
  it("builds the bare read: the table's token and the page", () => {
    expect(build({ request: { page: 1, table: TABLE }, slug: "rows" })).toEqual({
      argv: ["store", "rows", "--table-hex", TABLE, "--page", "1", "--json"],
      kind: "argv",
    });
  });

  it("builds every flag in a fixed order: sort, filter, page, page size", () => {
    const request = {
      direction: "desc",
      filterColumn: COLUMN,
      filterOp: "not-null",
      page: 3,
      pageSize: 50,
      sortColumn: COLUMN,
      table: TABLE,
    };
    expect(build({ request, slug: "rows" })).toEqual({
      argv: [
        "store",
        "rows",
        "--table-hex",
        TABLE,
        "--sort-hex",
        COLUMN,
        "--direction",
        "desc",
        "--filter-column-hex",
        COLUMN,
        "--filter-op",
        "not-null",
        "--page",
        "3",
        "--page-size",
        "50",
        "--json",
      ],
      kind: "argv",
    });
  });

  it("refuses a value on an operator that takes none, an empty one included, rather than dropping it", () => {
    expect(
      [
        ["is-null", "--json"],
        ["is-null", ""],
        ["not-null", "acme"],
      ].map(([filterOp, filterValue]) =>
        build({
          request: { filterColumn: COLUMN, filterOp, filterValue, page: 1, table: TABLE },
          slug: "rows",
        }),
      ),
    ).toEqual([
      { kind: "refused", why: "filterOp is-null takes no filterValue" },
      { kind: "refused", why: "filterOp is-null takes no filterValue" },
      { kind: "refused", why: "filterOp not-null takes no filterValue" },
    ]);
    expect(build({ request: { filterValue: "acme", page: 1, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "a filter names both filterColumn and filterOp",
    });
  });

  it("carries an eq or contains value only as its UTF-8 hex after --filter-value-hex", () => {
    expect(
      ["eq", "contains"].map((filterOp) =>
        build({
          request: { filterColumn: COLUMN, filterOp, filterValue: "Acme Pty", page: 1, table: TABLE },
          slug: "rows",
        }),
      ),
    ).toEqual(
      ["eq", "contains"].map((filterOp) => ({
        argv: [
          "store",
          "rows",
          "--table-hex",
          TABLE,
          "--filter-column-hex",
          COLUMN,
          "--filter-op",
          filterOp,
          "--filter-value-hex",
          "41636d6520507479",
          "--page",
          "1",
          "--json",
        ],
        kind: "argv",
      })),
    );
  });

  it("spells a multi-byte character as its UTF-8 bytes", () => {
    const filterValue = `caf${String.fromCodePoint(0xe9)}`;
    const argv = argvOf({
      request: { filterColumn: COLUMN, filterOp: "contains", filterValue, page: 1, table: TABLE },
      slug: "rows",
    });
    expect(argv[argv.indexOf("--filter-value-hex") + 1]).toBe("636166c3a9");
  });

  it("never lets a value shaped like a flag reach the argv as one", () => {
    const argv = argvOf({
      request: { filterColumn: COLUMN, filterOp: "eq", filterValue: "--home /etc", page: 1, table: TABLE },
      slug: "rows",
    });
    expect(argv.includes("--home /etc")).toBe(false);
    expect(argv.includes("--home")).toBe(false);
    expect(Buffer.from(argv[argv.indexOf("--filter-value-hex") + 1], "hex").toString("utf8")).toBe("--home /etc");
  });

  it("keeps a value's surrounding spaces and accepts exactly the console's 2,000 characters", () => {
    expect(STORE_FILTER_VALUE_MAX).toBe(2000);
    const spaced = argvOf({
      request: { filterColumn: COLUMN, filterOp: "contains", filterValue: " acme ", page: 1, table: TABLE },
      slug: "rows",
    });
    expect(spaced[spaced.indexOf("--filter-value-hex") + 1]).toBe("2061636d6520");
    const longest = argvOf({
      request: { filterColumn: COLUMN, filterOp: "eq", filterValue: "a".repeat(2000), page: 1, table: TABLE },
      slug: "rows",
    });
    expect(longest[longest.indexOf("--filter-value-hex") + 1]).toBe("61".repeat(2000));
  });

  it("refuses an eq or contains value that is missing, not text, blank, too long, half a character or a control", () => {
    const refusals = [undefined, 7, "", "   ", "a".repeat(2001), "acme\uD800", "acme\u0007"].map((filterValue) =>
      build({ request: { filterColumn: COLUMN, filterOp: "eq", filterValue, page: 1, table: TABLE }, slug: "rows" }),
    );
    expect(refusals).toEqual([
      { kind: "refused", why: "filterOp eq needs a filterValue: the value is not text" },
      { kind: "refused", why: "filterOp eq needs a filterValue: the value is not text" },
      {
        kind: "refused",
        why: "filterOp eq needs a filterValue: type a value to filter on; to stop filtering, use Clear",
      },
      {
        kind: "refused",
        why: "filterOp eq needs a filterValue: type a value to filter on; to stop filtering, use Clear",
      },
      {
        kind: "refused",
        why: "filterOp eq needs a filterValue: the value is 2001 characters; the console carries up to 2000",
      },
      {
        kind: "refused",
        why: "filterOp eq needs a filterValue: the value carries half of a character, which no file can contain",
      },
      { kind: "refused", why: "filterOp eq needs a filterValue: the value carries a control character" },
    ]);
  });

  it("carries no value for is-null and not-null", () => {
    expect(
      build({ request: { filterColumn: COLUMN, filterOp: "is-null", page: 1, table: TABLE }, slug: "rows" }),
    ).toEqual({
      argv: [
        "store",
        "rows",
        "--table-hex",
        TABLE,
        "--filter-column-hex",
        COLUMN,
        "--filter-op",
        "is-null",
        "--page",
        "1",
        "--json",
      ],
      kind: "argv",
    });
    expect(
      argvOf({ request: { filterColumn: COLUMN, filterOp: "not-null", page: 1, table: TABLE }, slug: "rows" })[7],
    ).toBe("not-null");
  });

  it("refuses a field it does not declare, a flag smuggled as a field name included", () => {
    expect(build({ request: { "--home": "/tmp", page: 1, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "store rows takes no field named --home",
    });
  });

  it("refuses a table that is not a token: a name, uppercase hex, odd length, a leading hyphen, too long", () => {
    const why = "table is not a catalog token: lowercase hex as `store tables` prints one, up to 512 characters";
    for (const table of ["acme_orders", "41434D45", "abc", "-61", "61".repeat(257), 61]) {
      expect(build({ request: { page: 1, table }, slug: "rows" })).toEqual({ kind: "refused", why });
    }
  });

  it("refuses half a sort, an unknown direction and an unknown operator", () => {
    expect(build({ request: { page: 1, sortColumn: COLUMN, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "a sort names both sortColumn and direction, or neither",
    });
    expect(build({ request: { direction: "up", page: 1, sortColumn: COLUMN, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "direction is asc or desc",
    });
    expect(
      build({ request: { filterColumn: COLUMN, filterOp: "ilike", page: 1, table: TABLE }, slug: "rows" }),
    ).toEqual({ kind: "refused", why: "filterOp is eq, contains, is-null or not-null" });
  });

  it("refuses a page below one, a fractional page, and a page size outside 1 to 100", () => {
    expect(build({ request: { page: 0, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "page is not a whole number from 1 to 1000000000",
    });
    expect(build({ request: { page: 1.5, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "page is not a whole number from 1 to 1000000000",
    });
    expect(build({ request: { page: 1, pageSize: 101, table: TABLE }, slug: "rows" })).toEqual({
      kind: "refused",
      why: "pageSize is not a whole number from 1 to 100",
    });
    expect(build({ request: { page: 1, pageSize: 100, table: TABLE }, slug: "rows" })).toEqual({
      argv: ["store", "rows", "--table-hex", TABLE, "--page", "1", "--page-size", "100", "--json"],
      kind: "argv",
    });
  });
});

describe("row", () => {
  it("passes a locator through unchanged", () => {
    expect(build({ request: { locator: "7b7d" }, slug: "row" })).toEqual({
      argv: ["store", "row", "--locator-hex", "7b7d", "--json"],
      kind: "argv",
    });
  });

  it("refuses a locator that is not lowercase hex of whole bytes, or is past 8 KiB", () => {
    const why = `locator is not a row locator: lowercase hex as \`store rows\` prints one, up to ${String(LOCATOR_MAX)} characters`;
    for (const locator of ["", "7B7D", "7b7", "-7b", "ab".repeat(LOCATOR_MAX / 2 + 1)]) {
      expect(build({ request: { locator }, slug: "row" })).toEqual({ kind: "refused", why });
    }
    expect(argvOf({ request: { locator: "ab".repeat(LOCATOR_MAX / 2) }, slug: "row" })[3]).toBe(
      "ab".repeat(LOCATOR_MAX / 2),
    );
  });
});

describe("isStoreToken", () => {
  it("accepts a token and refuses everything else", () => {
    expect([TABLE, "", "0", "zz", null].map((value) => isStoreToken(value))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("storeReadOutcomeOf", () => {
  const failed = ({ out, exitCode }: { out: string; exitCode: number | undefined }): SpawnOutcome => ({
    err: "",
    exitCode,
    notMeasured: "slopweaver store rows exited 1: no store selected",
    ok: false,
    out,
    tookMs: 12,
  });

  it("parses one document on exit 0", () => {
    const ran: SpawnOutcome = { err: "", ok: true, out: '{"schema":"public"}\n', tookMs: 40 };
    expect(storeReadOutcomeOf({ ran, title: "slopweaver store tables" })).toEqual({
      document: { schema: "public" },
      outcome: "read",
      tookMs: 40,
    });
  });

  it("names a clean exit that printed no JSON rather than drawing an empty table", () => {
    const ran: SpawnOutcome = { err: "", ok: true, out: "acme\n", tookMs: 40 };
    expect(storeReadOutcomeOf({ ran, title: "slopweaver store tables" })).toEqual({
      code: null,
      outcome: "refused",
      why: "slopweaver store tables exited 0 but did not print one JSON document",
    });
  });

  it("surfaces the verb's own refusal sentence and code off a non-zero exit's stdout", () => {
    const out = '{"error":{"code":"TABLE_UNKNOWN","message":"no table acme_orders in the public schema"}}';
    expect(storeReadOutcomeOf({ ran: failed({ exitCode: 1, out }), title: "slopweaver store rows" })).toEqual({
      code: "TABLE_UNKNOWN",
      outcome: "refused",
      why: "no table acme_orders in the public schema",
    });
  });

  it("falls to how the run ended when stdout is not the error document", () => {
    expect(
      storeReadOutcomeOf({ ran: failed({ exitCode: undefined, out: "" }), title: "slopweaver store rows" }),
    ).toEqual({ code: null, outcome: "refused", why: "slopweaver store rows exited 1: no store selected" });
  });
});

describe("storeErrorOf", () => {
  it("reads only the exact error document, with a message that says something", () => {
    expect(storeErrorOf({ out: '{"error":{"code":"X","message":"m"}}' })).toEqual({ code: "X", message: "m" });
    expect(storeErrorOf({ out: '{"error":{"code":"X","message":"  "}}' })).toBeUndefined();
    expect(storeErrorOf({ out: '{"error":"m"}' })).toBeUndefined();
    expect(storeErrorOf({ out: "[]" })).toBeUndefined();
    expect(storeErrorOf({ out: "not json" })).toBeUndefined();
  });
});
