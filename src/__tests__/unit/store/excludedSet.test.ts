import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { excludedFor } from "../../../store/excludedSet.js";

/** Drizzle's own pure renderer — it holds no connection, so this asserts the SQL with no database. */
const dialect = new PgDialect();

describe("excludedFor — the side-table upsert's refresh set", () => {
  it("refreshes every column but the key, each from its snake_case excluded column", () => {
    const set = excludedFor({ row: { authorIsBot: true, botId: "B1", contentId: "c-1", threadTs: "1.2" } });
    expect(Object.keys(set)).toEqual(["authorIsBot", "botId", "threadTs"]);
    expect(dialect.sqlToQuery(set["authorIsBot"]!).sql).toBe("excluded.author_is_bot");
    expect(dialect.sqlToQuery(set["threadTs"]!).sql).toBe("excluded.thread_ts");
  });

  it("is empty for a row that carries only its key", () => {
    expect(excludedFor({ row: { contentId: "c-1" } })).toEqual({});
  });
});
