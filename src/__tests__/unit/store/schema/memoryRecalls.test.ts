/**
 * The recall ledger's Drizzle declaration, read through Drizzle's own table config — the metadata a migration
 * is generated from — rather than through a database or the source text: the outcome enum, every column's
 * SQL type, nullability and default, the two newest-first indexes, and the three row-level-security policies
 * with the Slack-facing bot denied outright.
 */
import { is, SQL } from "drizzle-orm";
import { getTableConfig, IndexedColumn, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { memoryRecallsTable, recallOutcomeEnum } from "../../../../store/schema/memoryRecalls.js";

const config = getTableConfig(memoryRecallsTable);
const dialect = new PgDialect();

/**
 * The SQL text a Drizzle value renders to, refusing anything that is not a SQL fragment.
 *
 * @returns the rendered SQL
 */
function sqlText({ value }: { value: unknown }): string {
  if (!is(value, SQL)) {
    throw new Error("expected a SQL fragment");
  }
  return dialect.sqlToQuery(value).sql;
}

/**
 * One index entry's column name and sort order, refusing an expression index entry.
 *
 * @returns the name and order
 */
function indexEntry({ column }: { column: unknown }): { name: string | undefined; order: string | undefined } {
  if (!is(column, IndexedColumn)) {
    throw new Error("expected an indexed column");
  }
  return { name: column.name, order: column.indexConfig.order };
}

describe("recallOutcomeEnum", () => {
  it("is the recall_outcome enum with held, broke and unchecked in that order", () => {
    expect(recallOutcomeEnum.enumName).toBe("recall_outcome");
    expect(recallOutcomeEnum.enumValues).toEqual(["held", "broke", "unchecked"]);
  });
});

describe("memoryRecallsTable", () => {
  it("is named memory_recalls", () => {
    expect(config.name).toBe("memory_recalls");
  });

  it("declares every column with its exact SQL type, nullability, key and default flag, in order", () => {
    expect(
      config.columns.map((column) => ({
        hasDefault: column.hasDefault,
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.getSQLType(),
      })),
    ).toEqual([
      { hasDefault: true, name: "recall_id", notNull: true, primary: true, type: "uuid" },
      { hasDefault: true, name: "seq", notNull: true, primary: false, type: "bigserial" },
      { hasDefault: false, name: "memory_id", notNull: true, primary: false, type: "text" },
      { hasDefault: false, name: "recording_id", notNull: true, primary: false, type: "uuid" },
      { hasDefault: false, name: "outcome", notNull: true, primary: false, type: "recall_outcome" },
      { hasDefault: false, name: "evidence", notNull: true, primary: false, type: "text" },
      { hasDefault: false, name: "run", notNull: true, primary: false, type: "text" },
      { hasDefault: false, name: "recorded_at", notNull: true, primary: false, type: "timestamp (3) with time zone" },
      { hasDefault: true, name: "created_at", notNull: true, primary: false, type: "timestamp (3) with time zone" },
    ]);
  });

  it("defaults recall_id to a random uuid and created_at to now()", () => {
    const defaults = Object.fromEntries(
      config.columns
        .filter((column) => column.name === "recall_id" || column.name === "created_at")
        .map((column) => [column.name, sqlText({ value: column.default })]),
    );

    expect(defaults).toEqual({ created_at: "now()", recall_id: "gen_random_uuid()" });
  });

  it("indexes each claim's and each run's recalls newest first", () => {
    expect(
      config.indexes.map((index) => ({
        columns: index.config.columns.map((column) => indexEntry({ column })),
        name: index.config.name,
      })),
    ).toEqual([
      {
        columns: [
          { name: "memory_id", order: "asc" },
          { name: "recorded_at", order: "desc" },
        ],
        name: "idx_memory_recalls_memory_time",
      },
      {
        columns: [
          { name: "run", order: "asc" },
          { name: "recorded_at", order: "desc" },
        ],
        name: "idx_memory_recalls_run_time",
      },
    ]);
  });

  it("carries the owner, agent and bot policies, with the bot's read predicate false", () => {
    expect(
      config.policies.map((policy) => ({
        for: policy.for,
        name: policy.name,
        using: sqlText({ value: policy.using }),
      })),
    ).toEqual([
      { for: "all", name: "memory_recalls_owner_all", using: "true" },
      { for: "select", name: "memory_recalls_agent_read", using: "true" },
      { for: "select", name: "memory_recalls_bot_read", using: "false" },
    ]);
  });
});
