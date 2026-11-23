/**
 * The `person` table and its id registries, read through Drizzle's own table metadata — the shape a migration
 * is generated from — and through the id shapes as the reconciler's own `new RegExp` reads them: each platform
 * column's accepted spelling beside its refused neighbour, the source-to-column registry, the resolvable-source
 * predicate, and the table's columns, unique indexes, shape checks and bot-readable policies.
 */
import { getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, IndexedColumn, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  isPersonResolvableSource,
  PERSON_COLUMN_BY_SOURCE,
  PERSON_ID_SHAPES,
  PERSON_RESOLVABLE_SOURCES,
  personTable,
} from "../../../../store/schema/person.js";

const config = getTableConfig(personTable);
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
 * An index column's name, refusing an expression index column.
 *
 * @returns the indexed column's name
 */
function indexColumnName({ column }: { column: unknown }): string | undefined {
  if (!is(column, IndexedColumn)) {
    throw new Error("expected an indexed column");
  }
  return column.name;
}

/**
 * Whether one candidate id matches a named platform shape, read the way `../identity/people.ts` reads it.
 *
 * @returns whether the shape accepts the candidate
 */
function fits({ shape, candidate }: { shape: keyof typeof PERSON_ID_SHAPES; candidate: string }): boolean {
  return new RegExp(PERSON_ID_SHAPES[shape]).test(candidate);
}

describe("PERSON_ID_SHAPES", () => {
  it("spells every platform id shape exactly", () => {
    expect(PERSON_ID_SHAPES).toEqual({
      email: "^[^@[:space:]]+@[^@[:space:]]+$",
      githubId: "^[0-9]+$",
      githubLogin: "^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$",
      googleId: "^[0-9]+$",
      linearDisplayName: "^[^\\s@]+$",
      linearUserId: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      notionUserId: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      slackUserId: "^[UW][A-Z0-9]{8,}$",
    });
  });

  it("accepts a Slack U or W member id of nine characters and refuses a B bot id and an eight-character one", () => {
    expect(fits({ candidate: "U0SYNABCD", shape: "slackUserId" })).toBe(true);
    expect(fits({ candidate: "W0SYNABCD", shape: "slackUserId" })).toBe(true);
    expect(fits({ candidate: "B01ABCDEF", shape: "slackUserId" })).toBe(false);
    expect(fits({ candidate: "U01ABCDE", shape: "slackUserId" })).toBe(false);
    expect(fits({ candidate: "U01abcdef", shape: "slackUserId" })).toBe(false);
  });

  it("accepts a lower-case UUID for Linear and Notion and refuses an upper-case or short one", () => {
    const uuid = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
    expect(fits({ candidate: uuid, shape: "linearUserId" })).toBe(true);
    expect(fits({ candidate: uuid, shape: "notionUserId" })).toBe(true);
    expect(fits({ candidate: uuid.toUpperCase(), shape: "linearUserId" })).toBe(false);
    expect(fits({ candidate: uuid.slice(0, -1), shape: "notionUserId" })).toBe(false);
  });

  it("accepts an all-digit GitHub and Google id and refuses one carrying a letter", () => {
    expect(fits({ candidate: "583231", shape: "githubId" })).toBe(true);
    expect(fits({ candidate: "583231a", shape: "githubId" })).toBe(false);
    expect(fits({ candidate: "104729", shape: "googleId" })).toBe(true);
    expect(fits({ candidate: "", shape: "googleId" })).toBe(false);
  });

  it("accepts a GitHub login with an inner hyphen or one character, and refuses a leading or trailing hyphen", () => {
    expect(fits({ candidate: "ada-owner", shape: "githubLogin" })).toBe(true);
    expect(fits({ candidate: "a", shape: "githubLogin" })).toBe(true);
    expect(fits({ candidate: "-ada", shape: "githubLogin" })).toBe(false);
    expect(fits({ candidate: "ada-", shape: "githubLogin" })).toBe(false);
    expect(fits({ candidate: "ada_owner", shape: "githubLogin" })).toBe(false);
  });

  it("accepts a Linear handle with no space or at-sign and refuses one with either", () => {
    expect(fits({ candidate: "ada.owner", shape: "linearDisplayName" })).toBe(true);
    expect(fits({ candidate: "ada owner", shape: "linearDisplayName" })).toBe(false);
    expect(fits({ candidate: "ada\towner", shape: "linearDisplayName" })).toBe(false);
    expect(fits({ candidate: "@ada", shape: "linearDisplayName" })).toBe(false);
  });
});

describe("PERSON_COLUMN_BY_SOURCE and PERSON_RESOLVABLE_SOURCES", () => {
  it("maps each resolvable source to its person column", () => {
    expect(PERSON_COLUMN_BY_SOURCE).toEqual({
      github: "githubLogin",
      linear: "linearUserId",
      notion: "notionUserId",
      slack: "slackUserId",
    });
  });

  it("lists every key of the column registry, and nothing else", () => {
    expect(PERSON_RESOLVABLE_SOURCES).toEqual(["github", "linear", "notion", "slack"]);
    expect(PERSON_RESOLVABLE_SOURCES.toSorted()).toEqual(Object.keys(PERSON_COLUMN_BY_SOURCE).toSorted());
  });
});

describe("isPersonResolvableSource", () => {
  it("is true for the four sources a person column carries", () => {
    expect(["github", "linear", "notion", "slack"].map((source) => isPersonResolvableSource(source))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("is false for gmail, an inherited object key and a differently cased source", () => {
    expect(["gmail", "toString", "Slack"].map((source) => isPersonResolvableSource(source))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("personTable", () => {
  it("is the person table", () => {
    expect(getTableName(personTable)).toBe("person");
  });

  it("declares every column's SQL type, nullability, key and default flag, in order", () => {
    expect(
      config.columns.map((column) => ({
        hasDefault: column.hasDefault,
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.getSQLType(),
      })),
    ).toEqual([
      { hasDefault: true, name: "id", notNull: true, primary: true, type: "uuid" },
      { hasDefault: false, name: "email", notNull: true, primary: false, type: "text" },
      { hasDefault: false, name: "display_name", notNull: true, primary: false, type: "text" },
      { hasDefault: false, name: "given_name", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "family_name", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "google_id", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "active", notNull: false, primary: false, type: "boolean" },
      { hasDefault: false, name: "org_unit_path", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "title", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "slack_user_id", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "linear_user_id", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "linear_display_name", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "github_id", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "github_login", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "notion_user_id", notNull: false, primary: false, type: "text" },
      { hasDefault: false, name: "judgement", notNull: false, primary: false, type: "jsonb" },
      { hasDefault: true, name: "created_at", notNull: true, primary: false, type: "timestamp with time zone" },
      { hasDefault: true, name: "updated_at", notNull: true, primary: false, type: "timestamp with time zone" },
    ]);
  });

  it("is unique on the email and every platform id, and indexes the display name non-uniquely", () => {
    expect(
      config.indexes.map((index) => ({
        columns: index.config.columns.map((column) => indexColumnName({ column })),
        name: index.config.name,
        unique: index.config.unique,
      })),
    ).toEqual([
      { columns: ["email"], name: "uq_person_email", unique: true },
      { columns: ["google_id"], name: "uq_person_google_id", unique: true },
      { columns: ["slack_user_id"], name: "uq_person_slack_user_id", unique: true },
      { columns: ["linear_user_id"], name: "uq_person_linear_user_id", unique: true },
      { columns: ["linear_display_name"], name: "uq_person_linear_display_name", unique: true },
      { columns: ["github_id"], name: "uq_person_github_id", unique: true },
      { columns: ["github_login"], name: "uq_person_github_login", unique: true },
      { columns: ["notion_user_id"], name: "uq_person_notion_user_id", unique: true },
      { columns: ["display_name"], name: "idx_person_display_name", unique: false },
    ]);
  });

  it("pins the email to a normalised address and every platform column to its shape or null", () => {
    expect(config.checks.map((entry) => ({ name: entry.name, value: sqlText({ value: entry.value }) }))).toEqual([
      {
        name: "person_email_shape",
        value: "email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and email = lower(btrim(email))",
      },
      { name: "person_google_id_shape", value: "google_id is null or google_id ~ '^[0-9]+$'" },
      { name: "person_slack_user_id_shape", value: "slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]{8,}$'" },
      {
        name: "person_linear_user_id_shape",
        value:
          "linear_user_id is null or linear_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
      },
      {
        name: "person_linear_display_name_shape",
        value: "linear_display_name is null or linear_display_name ~ '^[^\\s@]+$'",
      },
      { name: "person_github_id_shape", value: "github_id is null or github_id ~ '^[0-9]+$'" },
      {
        name: "person_github_login_shape",
        value: "github_login is null or github_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$'",
      },
      {
        name: "person_notion_user_id_shape",
        value:
          "notion_user_id is null or notion_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
      },
    ]);
  });

  it("carries the owner, agent and bot policies, with the bot reading every row", () => {
    expect(
      config.policies.map((policy) => ({
        for: policy.for,
        name: policy.name,
        using: sqlText({ value: policy.using }),
      })),
    ).toEqual([
      { for: "all", name: "person_owner_all", using: "true" },
      { for: "select", name: "person_agent_read", using: "true" },
      { for: "select", name: "person_bot_read", using: "true" },
    ]);
  });
});
