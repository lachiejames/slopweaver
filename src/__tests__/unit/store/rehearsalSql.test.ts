/**
 * The rehearsal's statement text and table shapes, pure: every identifier quoted, the sample picked newest-first
 * with the key as tie-breaker, the live lookup bound by key and — only when the table has a timestamp — by the
 * dump's instant after it.
 */
import { describe, expect, it } from "vitest";

import {
  countStatement,
  frontierStatements,
  sampleStatements,
  type TableShape,
  tableShapesOf,
} from "../../../store/backup/rehearsalSql.js";

const REVIEWS: TableShape = {
  columns: [
    { name: "repo", type: "text" },
    { name: "number", type: "integer" },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "updated_at", type: "timestamp with time zone" },
  ],
  primaryKey: ["repo", "number"],
  schema: "public",
  table: "reviews",
};

const CONTENT: TableShape = {
  columns: [
    { name: "id", type: "uuid" },
    { name: "body", type: "text" },
  ],
  primaryKey: ["id"],
  schema: "public",
  table: 'odd"name',
};

describe("tableShapesOf", () => {
  it("folds column rows into sorted tables, each primary key in key order rather than column order", () => {
    const shapes = tableShapesOf({
      rows: [
        { column: "repo", pk: 2, schema: "public", table: "reviews", type: "text" },
        { column: "number", pk: 1, schema: "public", table: "reviews", type: "integer" },
        { column: "body", pk: null, schema: "public", table: "reviews", type: "text" },
        { column: "id", pk: null, schema: "drizzle", table: "log", type: "integer" },
      ],
    });
    expect(shapes).toEqual([
      { columns: [{ name: "id", type: "integer" }], primaryKey: [], schema: "drizzle", table: "log" },
      {
        columns: [
          { name: "repo", type: "text" },
          { name: "number", type: "integer" },
          { name: "body", type: "text" },
        ],
        primaryKey: ["number", "repo"],
        schema: "public",
        table: "reviews",
      },
    ]);
  });

  it("answers no tables for no rows", () => {
    expect(tableShapesOf({ rows: [] })).toEqual([]);
  });
});

describe("countStatement and frontierStatements", () => {
  it("quotes the schema, the table and an embedded quote", () => {
    expect(countStatement({ shape: CONTENT })).toBe('select count(*)::text as rows from "public"."odd""name"');
  });

  it("reads the copy's max and counts live up to it, NULLs included", () => {
    expect(frontierStatements({ column: "created_at", shape: REVIEWS })).toEqual({
      copyMax: 'select max("created_at")::text as max from "public"."reviews"',
      liveUpTo:
        'select count(*)::text as rows from "public"."reviews" where "created_at" <= $1 or "created_at" is null',
    });
  });
});

describe("sampleStatements", () => {
  it("picks newest by insertion column then key, and binds the dump instant after the key", () => {
    expect(sampleStatements({ shape: REVIEWS, size: 5 })).toEqual({
      lookup:
        'select t::text as body, coalesce(greatest(t."created_at"::timestamptz, t."updated_at"::timestamptz) > $3::timestamptz, false) as touched ' +
        'from "public"."reviews" t where t."repo" = $1::text and t."number" = $2::integer',
      pick:
        'select array[t."repo"::text, t."number"::text] as key, t::text as body from "public"."reviews" t ' +
        'order by t."created_at" desc nulls last, t."repo" desc, t."number" desc limit 5',
      tableRecordsChanges: true,
      takesDumpInstant: true,
    });
  });

  it("orders by key alone and never binds the instant for a table with no timestamp", () => {
    expect(sampleStatements({ shape: CONTENT, size: 1 })).toEqual({
      lookup: 'select t::text as body, false as touched from "public"."odd""name" t where t."id" = $1::uuid',
      pick: 'select array[t."id"::text] as key, t::text as body from "public"."odd""name" t order by t."id" desc limit 1',
      tableRecordsChanges: false,
      takesDumpInstant: false,
    });
  });
});
