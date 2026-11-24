import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type CatalogTable, catalogFromRows } from "../../../../store/browse/catalog.js";
import { statementTimeoutSql } from "../../../../store/browse/read.js";
import { quoteIdentifier, rowSqlPlan, rowsSqlPlan } from "../../../../store/browse/sql.js";
import type { StoreRowsRequest } from "../../../../store/browse/types.js";

/** A synthetic catalog: `acme_note` keyed on `id`, with a quote in one column name, and keyless `acme_log`. */
function catalog(): readonly CatalogTable[] {
  const base = {
    formatted_type: "text",
    generated: false,
    identity: false,
    live_tuples: 1,
    nullable: true,
    pk_position: null,
    reltuples: 1,
    type_category: "S",
    type_name: "text",
  };
  return unwrap(
    catalogFromRows({
      rows: [
        {
          ...base,
          column_name: "id",
          formatted_type: "bigint",
          nullable: false,
          ordinal: 1,
          pk_position: 1,
          table_name: "acme_note",
          type_category: "N",
          type_name: "int8",
        },
        { ...base, column_name: 'say "hi"', ordinal: 2, table_name: "acme_note" },
        {
          ...base,
          column_name: "blob",
          formatted_type: "bytea",
          ordinal: 3,
          table_name: "acme_note",
          type_category: "U",
          type_name: "bytea",
        },
        { ...base, column_name: "line", ordinal: 1, table_name: "acme_log" },
      ],
    }),
  );
}

const note = (): CatalogTable => catalog().find((table) => table.definition.name === "acme_note")!;
const log = (): CatalogTable => catalog().find((table) => table.definition.name === "acme_log")!;

const request = (over: Partial<StoreRowsRequest> = {}): StoreRowsRequest => ({
  filter: null,
  page: 1,
  pageSize: 50,
  sort: null,
  table: "acme_note",
  ...over,
});

describe("quoteIdentifier", () => {
  it("doubles an embedded double quote", () => {
    expect(quoteIdentifier({ name: 'say "hi"' })).toBe('"say ""hi"""');
  });
});

describe("rowsSqlPlan", () => {
  it("orders by the key by default and binds a limit one row past the page", () => {
    const plan = unwrap(rowsSqlPlan({ request: request({ page: 3, pageSize: 10 }), table: note() }));
    expect(plan.text).toBe(
      "select tableoid::text as k_tableoid, ctid::text as k_ctid, xmin::text as k_xmin, " +
        'left("id"::text, 4096) as v0, length("id"::text) as n0, ' +
        'left("say ""hi"""::text, 4096) as v1, length("say ""hi"""::text) as n1, ' +
        "left(encode(\"blob\", 'base64'), 4096) as v2, length(encode(\"blob\", 'base64')) as n2 " +
        'from public."acme_note" order by "id" asc limit $1::int8 offset $2::int8',
    );
    expect(plan.params).toEqual(["11", "20"]);
  });

  it("reads a keyed row's locator from its position, never selecting a key value outside the masked cells", () => {
    const plan = unwrap(rowsSqlPlan({ request: request(), table: note() }));
    expect(plan.text.includes('"id"::text as k')).toBe(false);
    expect(
      plan.text.startsWith("select tableoid::text as k_tableoid, ctid::text as k_ctid, xmin::text as k_xmin, "),
    ).toBe(true);
  });

  it("spells only its own keyword for a direction, whatever the request carried", () => {
    const hostile = "asc; drop table acme_note; --" as "asc";
    const plan = unwrap(
      rowsSqlPlan({ request: request({ sort: { column: "id", direction: hostile } }), table: note() }),
    );
    expect(plan.text.includes("drop table")).toBe(false);
    expect(plan.text).toContain('order by "id" asc limit $1::int8');
  });

  it("puts the chosen sort first, then the rest of the key, and binds a contains value with LIKE characters escaped", () => {
    const plan = unwrap(
      rowsSqlPlan({
        request: request({
          filter: { column: 'say "hi"', operator: "contains", value: "50%_off\\" },
          sort: { column: 'say "hi"', direction: "desc" },
        }),
        table: note(),
      }),
    );
    expect(plan.text).toContain(
      ' where "say ""hi"""::text ilike $1 order by "say ""hi""" desc, "id" asc limit $2::int8 offset $3::int8',
    );
    expect(plan.params).toEqual(["%50\\%\\_off\\\\%", "51", "0"]);
  });

  it("never puts a filter value in the statement text", () => {
    const plan = unwrap(
      rowsSqlPlan({
        request: request({ filter: { column: "id", operator: "eq", value: "1'; drop table x;--" } }),
        table: note(),
      }),
    );
    expect(plan.text).toContain('where "id"::text = $1');
    expect(plan.text.includes("drop table")).toBe(false);
    expect(plan.params).toEqual(["1'; drop table x;--", "51", "0"]);
  });

  it("takes null checks with no parameter, and orders a keyless table by partition then ctid", () => {
    const plan = unwrap(
      rowsSqlPlan({
        request: request({ filter: { column: "line", operator: "is-null" }, table: "acme_log" }),
        table: log(),
      }),
    );
    expect(plan.text).toContain('where "line" is null order by tableoid asc, ctid asc limit $1::int8 offset $2::int8');
    expect(plan.params).toEqual(["51", "0"]);
  });

  it("refuses a column the table does not have, and a value filter on binary", () => {
    expect(
      unwrapErr(rowsSqlPlan({ request: request({ sort: { column: "nope", direction: "asc" } }), table: note() })).code,
    ).toBe("COLUMN_UNKNOWN");
    expect(
      unwrapErr(
        rowsSqlPlan({ request: request({ filter: { column: "blob", operator: "eq", value: "x" } }), table: note() }),
      ).code,
    ).toBe("FILTER_UNSUPPORTED");
  });
});

describe("rowSqlPlan", () => {
  it("finds a row, keyed or not, by partition, ctid and xmin together, every one bound", () => {
    const locator = { ctid: "(0,1)", kind: "ctid-xmin" as const, tableoid: "16384", xmin: "900" };
    const keyed = rowSqlPlan({ locator: { ...locator, table: "acme_note" }, table: note() });
    expect(keyed.text).toContain("where tableoid = $1::oid and ctid = $2::tid and xmin::text = $3 limit 2");
    expect(keyed.text).toContain('left("id"::text, 1048576) as v0');
    expect(keyed.params).toEqual(["16384", "(0,1)", "900"]);
    const keyless = rowSqlPlan({ locator: { ...locator, table: "acme_log" }, table: log() });
    expect(keyless.text).toBe(
      'select left("line"::text, 1048576) as v0, length("line"::text) as n0 from public."acme_log" ' +
        "where tableoid = $1::oid and ctid = $2::tid and xmin::text = $3 limit 2",
    );
  });
});

describe("statementTimeoutSql", () => {
  it("spells a whole number of milliseconds, never zero", () => {
    expect(statementTimeoutSql({ budgetMs: 5000 })).toBe("set local statement_timeout = 5000");
    expect(statementTimeoutSql({ budgetMs: 2.9 })).toBe("set local statement_timeout = 2");
    expect(statementTimeoutSql({ budgetMs: 0 })).toBe("set local statement_timeout = 1");
  });
});
