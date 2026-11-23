/**
 * The measured voice register, read through Drizzle's own table config — the shape a migration is generated
 * from — rather than a database round-trip: every column with its type, nullability and default, the
 * `(owner_id, surface, cohort)` key, the cascade from the owner's profile, the non-negative CHECK over the
 * five nullable measurements, and the three row-level-security policies with the bot reading everything.
 */
import { getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ownerVoiceRegisterTable } from "../../../../store/schema/ownerVoice.js";

const config = getTableConfig(ownerVoiceRegisterTable);
const dialect = new PgDialect();

/** A column's default rendered as the SQL a migration would carry, or the literal value, or null for none. */
function defaultOf({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return null;
  }
  return is(value, SQL) ? dialect.sqlToQuery(value).sql : value;
}

/** A policy predicate rendered as SQL, or null when the policy declares none. */
function predicateOf({ value }: { value: SQL | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return dialect.sqlToQuery(value).sql;
}

describe("ownerVoiceRegisterTable", () => {
  it("is the owner_voice_register table", () => {
    expect(getTableName(ownerVoiceRegisterTable)).toBe("owner_voice_register");
  });

  it("declares each column's SQL type, nullability, primary key and default, in order", () => {
    expect(
      config.columns.map((column) => ({
        default: defaultOf({ value: column.default }),
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.getSQLType(),
      })),
    ).toEqual([
      { default: null, name: "owner_id", notNull: true, primary: false, type: "text" },
      { default: null, name: "surface", notNull: true, primary: false, type: "text" },
      { default: null, name: "cohort", notNull: true, primary: false, type: "text" },
      { default: null, name: "median_words", notNull: false, primary: false, type: "integer" },
      { default: null, name: "p75_words", notNull: false, primary: false, type: "integer" },
      { default: null, name: "p90_words", notNull: false, primary: false, type: "integer" },
      { default: null, name: "ceiling_words", notNull: false, primary: false, type: "integer" },
      { default: null, name: "sample_count", notNull: false, primary: false, type: "integer" },
      { default: null, name: "measured_at", notNull: true, primary: false, type: "timestamp with time zone" },
      { default: null, name: "source", notNull: true, primary: false, type: "text" },
      { default: "", name: "qualification", notNull: true, primary: false, type: "text" },
      { default: "now()", name: "updated_at", notNull: true, primary: false, type: "timestamp with time zone" },
    ]);
  });

  it("is keyed on (owner_id, surface, cohort) under the name owner_voice_register_pk", () => {
    expect(
      config.primaryKeys.map((key) => ({
        columns: key.columns.map((column) => column.name),
        name: key.getName(),
      })),
    ).toEqual([{ columns: ["owner_id", "surface", "cohort"], name: "owner_voice_register_pk" }]);
  });

  it("references owner_profile.id from owner_id, cascading the profile's delete to its cohorts", () => {
    expect(
      config.foreignKeys.map((key) => {
        const reference = key.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          foreignTable: getTableName(reference.foreignTable),
          onDelete: key.onDelete,
        };
      }),
    ).toEqual([{ columns: ["owner_id"], foreignColumns: ["id"], foreignTable: "owner_profile", onDelete: "cascade" }]);
  });

  it("checks that all five measurements are null or non-negative, in one named constraint", () => {
    expect(
      config.checks.map((check) => ({
        name: check.name,
        sql: dialect.sqlToQuery(check.value).sql.replace(/\s+/g, " "),
      })),
    ).toEqual([
      {
        name: "owner_voice_register_non_negative",
        sql:
          "(median_words is null or median_words >= 0) and (p75_words is null or p75_words >= 0) " +
          "and (p90_words is null or p90_words >= 0) and (ceiling_words is null or ceiling_words >= 0) " +
          "and (sample_count is null or sample_count >= 0)",
      },
    ]);
  });

  it("carries the owner, agent and bot policies, the bot reading every row", () => {
    expect(
      config.policies.map((policy) => ({
        for: policy.for,
        name: policy.name,
        using: predicateOf({ value: policy.using }),
        withCheck: predicateOf({ value: policy.withCheck }),
      })),
    ).toEqual([
      { for: "all", name: "owner_voice_register_owner_all", using: "true", withCheck: "true" },
      { for: "select", name: "owner_voice_register_agent_read", using: "true", withCheck: null },
      { for: "select", name: "owner_voice_register_bot_read", using: "true", withCheck: null },
    ]);
  });
});
