/**
 * The store's newest-row clock. `newestStoredInstant` is driven through drizzle's REAL postgres-js query
 * builder and result mapping, over a fake transport standing in for the `postgres` client — so the SQL,
 * its bound parameter and the timestamp decoding are the shipped ones, and no database is reached.
 * `readStoreNewest` opens its own connection and is not exercised here.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreReader } from "../../../store/client.js";
import { StoreErrors } from "../../../store/errors.js";
import { newestStoredInstant, STORE_CLOCK_BUDGET_MS } from "../../../store/newest.js";
import * as storeSchema from "../../../store/schema.js";

/** One statement the fake transport was asked to run. */
interface Issued {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * A store reader whose transport answers every statement with `rows`, or rejects with `failure`.
 *
 * @param rows what the transport answers, one array per row in postgres.js's `values()` shape
 * @param failure when present, every statement rejects with it instead
 * @returns the reader, and the statements it was asked to run
 */
function fakeReader({ failure, rows }: { failure?: Error; rows: unknown[][] }): {
  readonly issued: Issued[];
  readonly reader: StoreReader;
} {
  const issued: Issued[] = [];
  const client = {
    options: { parsers: {}, serializers: {} },
    // named-object-params-exempt: drizzle's postgres-js session calls the client's unsafe(query, params) positionally
    unsafe: (query: string, params: unknown[]) => ({
      values: async (): Promise<unknown[][]> => {
        issued.push({ params, query });
        if (failure !== undefined) {
          throw failure;
        }
        return rows;
      },
    }),
  };
  // The fake implements only the two members drizzle's session touches, so it is cast to the client type.
  const db = drizzle({ client: client as unknown as postgres.Sql, schema: storeSchema });
  return { issued, reader: { db } };
}

const EXPECTED_SQL = 'select max("occurred_at") from "content" where "content"."source" = $1';

describe("STORE_CLOCK_BUDGET_MS", () => {
  it("is 2000", () => {
    expect(STORE_CLOCK_BUDGET_MS).toBe(2000);
  });
});

describe("newestStoredInstant", () => {
  it("dates the source's newest row as ISO, querying max(occurred_at) for that source alone", async () => {
    const { issued, reader } = fakeReader({ rows: [["2026-09-12 04:47:00+00"]] });

    const result = await newestStoredInstant({ reader, source: "linear" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("2026-09-12T04:47:00.000Z");
    expect(issued).toEqual([{ params: ["linear"], query: EXPECTED_SQL }]);
  });

  it("reads null when the aggregate is null, as it is over a source with no rows", async () => {
    const { reader } = fakeReader({ rows: [[null]] });

    const result = await newestStoredInstant({ reader, source: "slack" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(null);
  });

  it("reads null when the statement returns no row at all", async () => {
    const { reader } = fakeReader({ rows: [] });

    const result = await newestStoredInstant({ reader, source: "github" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(null);
  });

  it("a failed query is STORE_QUERY_FAILED naming the source, with the driver's reason and not the statement", async () => {
    const thrown = new Error("permission denied");
    const { reader } = fakeReader({ failure: thrown, rows: [] });

    const result = await newestStoredInstant({ reader, source: "slack" });

    expect(result.isErr()).toBe(true);
    const error = unwrapErr(result);
    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe("newest slack row failed: permission denied");
    expect(error.message).toBe(StoreErrors.queryFailed({ cause: thrown, what: "newest slack row" }).message);
    expect(error).toMatchObject({ cause: { cause: thrown } });
  });
});
