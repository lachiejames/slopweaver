/**
 * Table counts over a plain-function database adapter: one ordered event log of every connect, list, count
 * and close, so each case pins the order the counts come back in (recall probe first, then the database's
 * own order), that the recall probe runs only when `public.content` exists, that a missing `count(*)` row
 * fails the count instead of reading as zero, and that the connection is closed on every path — with a
 * failed close reported inside the `Result` rather than escaping it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type TableCountDatabase, tableCounts } from "../../../../store/backup/counts.js";
import { BackupErrors } from "../../../../store/backup/errors.js";

const URL_LIVE = "postgres://localhost:54322/postgres";

/** Edges over the given tables, each counted from `rows` (absent key = no row), logging every call. */
function database({
  tables,
  rows,
  recall = "41",
  failOn,
  closeFails = false,
}: {
  tables: readonly { schema: string; table: string }[];
  rows: Readonly<Record<string, string>>;
  recall?: string | null;
  failOn?: string;
  closeFails?: boolean;
}): { connect: (args: { url: string }) => TableCountDatabase; events: string[] } {
  const events: string[] = [];
  return {
    connect: ({ url }) => {
      events.push(`connect ${url}`);
      return {
        close: async () => {
          events.push("close");
          if (closeFails) {
            throw new Error("terminating connection due to administrator command");
          }
        },
        countRecallRows: async ({ term }) => {
          events.push(`recall ${term}`);
          if (recall === null) {
            return undefined;
          }
          return recall;
        },
        countRows: async ({ schema, table }) => {
          const name = `${schema}.${table}`;
          events.push(`count ${name}`);
          if (name === failOn) {
            throw new Error(`permission denied for table ${table}`);
          }
          return rows[name];
        },
        listTables: async () => {
          events.push("list");
          return tables;
        },
      };
    },
    events,
  };
}

const TABLES = [
  { schema: "drizzle", table: "__drizzle_migrations" },
  { schema: "public", table: "content" },
  { schema: "public", table: "person" },
  { schema: "storage", table: "objects" },
];

const ROWS = {
  "drizzle.__drizzle_migrations": "37",
  "public.content": "159033",
  "public.person": "0",
  "storage.objects": "12",
};

describe("tableCounts", () => {
  it("returns no counts and still closes for a database with no tables", async () => {
    const { connect, events } = database({ rows: {}, tables: [] });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
    expect(events).toEqual([`connect ${URL_LIVE}`, "list", "close"]);
  });

  it("counts the recall probe first, then every table in the database's order, as numbers", async () => {
    const { connect, events } = database({ rows: ROWS, tables: TABLES });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([
      { rows: 41, table: "recall:content.searchable(supabase)" },
      { rows: 37, table: "drizzle.__drizzle_migrations" },
      { rows: 159033, table: "public.content" },
      { rows: 0, table: "public.person" },
      { rows: 12, table: "storage.objects" },
    ]);
    expect(events).toEqual([
      `connect ${URL_LIVE}`,
      "list",
      "recall supabase",
      "count drizzle.__drizzle_migrations",
      "count public.content",
      "count public.person",
      "count storage.objects",
      "close",
    ]);
  });

  it("runs no recall probe when there is no public.content table, even with a content table elsewhere", async () => {
    const { connect, events } = database({
      rows: { "storage.content": "3" },
      tables: [{ schema: "storage", table: "content" }],
    });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(unwrap(result)).toEqual([{ rows: 3, table: "storage.content" }]);
    expect(events).toEqual([`connect ${URL_LIVE}`, "list", "count storage.content", "close"]);
  });

  it("fails as TABLE_COUNT_FAILED, stopping there and closing, when a count query throws", async () => {
    const { connect, events } = database({ failOn: "public.content", rows: ROWS, tables: TABLES });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("TABLE_COUNT_FAILED");
    expect(failure.message).toBe("could not count tables: permission denied for table content");
    expect(failure).toEqual(BackupErrors.tableCountFailed({ cause: new Error("permission denied for table content") }));
    expect(events.slice(-2)).toEqual(["count public.content", "close"]);
  });

  it("fails as TABLE_COUNT_FAILED, rather than counting zero, when a table's count returns no row", async () => {
    const { connect, events } = database({
      rows: { "public.person": "4" },
      tables: [
        { schema: "public", table: "audit" },
        { schema: "public", table: "person" },
      ],
    });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("TABLE_COUNT_FAILED");
    expect(failure.message).toBe("could not count tables: count(*) returned no row for public.audit");
    expect(failure).toEqual(
      BackupErrors.tableCountFailed({ cause: new Error("count(*) returned no row for public.audit") }),
    );
    expect(events).toEqual([`connect ${URL_LIVE}`, "list", "count public.audit", "close"]);
  });

  it("fails as TABLE_COUNT_FAILED, rather than counting zero, when the recall probe returns no row", async () => {
    const { connect } = database({ recall: null, rows: ROWS, tables: TABLES });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("TABLE_COUNT_FAILED");
    expect(failure.message).toBe(
      "could not count tables: count(*) returned no row for recall:content.searchable(supabase)",
    );
  });

  it("reports a close that rejects after a good count as TABLE_COUNT_FAILED, inside the Result", async () => {
    const { connect, events } = database({ closeFails: true, rows: ROWS, tables: TABLES });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("TABLE_COUNT_FAILED");
    expect(failure.message).toBe("could not count tables: terminating connection due to administrator command");
    expect(failure).toEqual(
      BackupErrors.tableCountFailed({ cause: new Error("terminating connection due to administrator command") }),
    );
    expect(events.at(-1)).toBe("close");
  });

  it("keeps the count's own earlier reason when both a count and the close fail", async () => {
    const { connect } = database({ closeFails: true, failOn: "public.content", rows: ROWS, tables: TABLES });

    const result = await tableCounts({ connect, url: URL_LIVE });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("could not count tables: permission denied for table content");
  });
});
