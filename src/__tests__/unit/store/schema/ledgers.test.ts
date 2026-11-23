/**
 * The three append-only ledgers' Drizzle declarations — the door's audit trail, the autonomy register and the
 * journalled grants — read through Drizzle's own table and enum metadata, the shape a migration is generated
 * from, rather than a database round-trip: both enums, every column with its type, nullability and default,
 * every index, every check, the door's import marker, and the three row-level-security policies with the bot denied.
 */
import { getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig, IndexedColumn, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  autonomyEntryEnum,
  autonomyEventTable,
  doorEventTable,
  doorProvenanceEnum,
  doorRegisterTable,
  grantRowTable,
} from "../../../../store/schema/ledgers.js";

const dialect = new PgDialect();

/**
 * The SQL text a Drizzle value renders to, with runs of whitespace folded to one space, refusing anything that
 * is not a SQL fragment.
 *
 * @returns the rendered, whitespace-folded SQL
 */
function sqlText({ value }: { value: unknown }): string {
  if (!is(value, SQL)) {
    throw new Error("expected a SQL fragment");
  }
  return dialect.sqlToQuery(value).sql.replace(/\s+/g, " ").trim();
}

/**
 * A column's default rendered as the SQL a migration would carry, or the literal value, or null for none.
 *
 * @returns the rendered default
 */
function defaultOf({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return null;
  }
  return is(value, SQL) ? sqlText({ value }) : value;
}

/**
 * An index column as `name order`, refusing an expression index column.
 *
 * @returns the column name and its sort order
 */
function indexColumn({ column }: { column: unknown }): string {
  if (!is(column, IndexedColumn)) {
    throw new Error("expected an indexed column");
  }
  return `${String(column.name)} ${String(column.indexConfig.order)}`;
}

/**
 * Every column of a table as its name, SQL type, nullability, key flag and rendered default, in order.
 *
 * @returns one summary per column
 */
function columnsOf({ table }: { table: PgTable }): readonly Record<string, unknown>[] {
  return getTableConfig(table).columns.map((column) => ({
    default: defaultOf({ value: column.default }),
    name: column.name,
    notNull: column.notNull,
    primary: column.primary,
    type: column.getSQLType(),
  }));
}

/**
 * Every index of a table as its name, uniqueness and ordered columns.
 *
 * @returns one summary per index
 */
function indexesOf({ table }: { table: PgTable }): readonly Record<string, unknown>[] {
  return getTableConfig(table).indexes.map((index) => ({
    columns: index.config.columns.map((column) => indexColumn({ column })),
    name: index.config.name,
    unique: index.config.unique,
  }));
}

/**
 * Every row-level-security policy of a table as its name, mode, operation and rendered predicates.
 *
 * @returns one summary per policy
 */
function policiesOf({ table }: { table: PgTable }): readonly Record<string, unknown>[] {
  return getTableConfig(table).policies.map((policy) => ({
    as: policy.as,
    for: policy.for,
    name: policy.name,
    using: sqlText({ value: policy.using }),
    withCheck: defaultOf({ value: policy.withCheck }),
  }));
}

/**
 * The three policies every ledger carries for a named table, the bot's read predicate `false`.
 *
 * @returns the expected policy summaries, owner then agent then bot
 */
function ledgerPolicies({ table }: { table: string }): readonly Record<string, unknown>[] {
  return [
    { as: "permissive", for: "all", name: `${table}_owner_all`, using: "true", withCheck: "true" },
    { as: "permissive", for: "select", name: `${table}_agent_read`, using: "true", withCheck: null },
    { as: "permissive", for: "select", name: `${table}_bot_read`, using: "false", withCheck: null },
  ];
}

describe("the ledger enums", () => {
  it("is door_provenance over attributed then unattributable, and nothing else", () => {
    expect(doorProvenanceEnum.enumName).toBe("door_provenance");
    expect(doorProvenanceEnum.enumValues).toEqual(["attributed", "unattributable"]);
  });

  it("is autonomy_entry over action then steer, and nothing else", () => {
    expect(autonomyEntryEnum.enumName).toBe("autonomy_entry");
    expect(autonomyEntryEnum.enumValues).toEqual(["action", "steer"]);
  });
});

describe("doorEventTable", () => {
  it("is the door_event table", () => {
    expect(getTableName(doorEventTable)).toBe("door_event");
  });

  it("declares every column's SQL type, nullability, key and default, in order", () => {
    expect(columnsOf({ table: doorEventTable })).toEqual([
      { default: "gen_random_uuid()", name: "id", notNull: true, primary: true, type: "uuid" },
      { default: null, name: "seq", notNull: true, primary: false, type: "bigserial" },
      { default: null, name: "action", notNull: true, primary: false, type: "text" },
      { default: null, name: "effect", notNull: true, primary: false, type: "text" },
      { default: null, name: "status", notNull: true, primary: false, type: "text" },
      { default: [], name: "findings", notNull: true, primary: false, type: "jsonb" },
      { default: [], name: "overridden", notNull: true, primary: false, type: "jsonb" },
      { default: null, name: "door_run_id", notNull: false, primary: false, type: "text" },
      { default: null, name: "duplicate_key", notNull: false, primary: false, type: "text" },
      { default: null, name: "acknowledgement", notNull: false, primary: false, type: "jsonb" },
      { default: null, name: "occurred_at", notNull: true, primary: false, type: "timestamp (3) with time zone" },
      { default: null, name: "provenance", notNull: true, primary: false, type: "door_provenance" },
      { default: null, name: "record", notNull: false, primary: false, type: "jsonb" },
      { default: null, name: "import_key", notNull: true, primary: false, type: "text" },
    ]);
  });

  it("is unique on the import key and the seq, and leads its time index with provenance", () => {
    expect(indexesOf({ table: doorEventTable })).toEqual([
      { columns: ["import_key asc"], name: "uq_door_event_import_key", unique: true },
      { columns: ["seq asc"], name: "uq_door_event_seq", unique: true },
      { columns: ["provenance asc", "occurred_at desc"], name: "idx_door_event_provenance_time", unique: false },
      { columns: ["action asc", "occurred_at desc"], name: "idx_door_event_action_time", unique: false },
      { columns: ["status asc"], name: "idx_door_event_status", unique: false },
      { columns: ["duplicate_key asc"], name: "idx_door_event_duplicate_key", unique: false },
    ]);
  });

  it("checks the record is an object and the seq a safe integer, and denies the bot every row", () => {
    expect(
      getTableConfig(doorEventTable).checks.map((entry) => ({
        name: entry.name,
        value: sqlText({ value: entry.value }),
      })),
    ).toEqual([
      { name: "door_event_record_is_object", value: "record is null or jsonb_typeof(record) = 'object'" },
      { name: "door_event_seq_is_safe", value: "seq between 1 and 9007199254740991" },
    ]);
    expect(policiesOf({ table: doorEventTable })).toEqual(ledgerPolicies({ table: "door_event" }));
  });
});

describe("doorRegisterTable", () => {
  it("is the door_register singleton, keyed on the one id its check allows, and denies the bot", () => {
    expect(getTableName(doorRegisterTable)).toBe("door_register");
    expect(columnsOf({ table: doorRegisterTable })).toEqual([
      { default: null, name: "id", notNull: true, primary: true, type: "text" },
      { default: "now()", name: "imported_at", notNull: true, primary: false, type: "timestamp with time zone" },
    ]);
    expect(
      getTableConfig(doorRegisterTable).checks.map((entry) => ({
        name: entry.name,
        value: sqlText({ value: entry.value }),
      })),
    ).toEqual([{ name: "door_register_is_singleton", value: "id = 'door'" }]);
    expect(policiesOf({ table: doorRegisterTable })).toEqual(ledgerPolicies({ table: "door_register" }));
  });
});

describe("autonomyEventTable", () => {
  it("is the autonomy_event table", () => {
    expect(getTableName(autonomyEventTable)).toBe("autonomy_event");
  });

  it("declares every column's SQL type, nullability, key and default, in order", () => {
    expect(columnsOf({ table: autonomyEventTable })).toEqual([
      { default: "gen_random_uuid()", name: "id", notNull: true, primary: true, type: "uuid" },
      { default: null, name: "seq", notNull: true, primary: false, type: "bigserial" },
      { default: null, name: "action_id", notNull: true, primary: false, type: "text" },
      { default: null, name: "entry_kind", notNull: true, primary: false, type: "autonomy_entry" },
      { default: null, name: "kind", notNull: false, primary: false, type: "text" },
      { default: null, name: "subject", notNull: false, primary: false, type: "text" },
      { default: null, name: "why", notNull: false, primary: false, type: "text" },
      { default: null, name: "witness", notNull: false, primary: false, type: "text" },
      { default: null, name: "steer", notNull: false, primary: false, type: "text" },
      { default: null, name: "run", notNull: false, primary: false, type: "text" },
      { default: null, name: "by_session", notNull: false, primary: false, type: "text" },
      { default: null, name: "occurred_at", notNull: true, primary: false, type: "timestamp (3) with time zone" },
      { default: null, name: "record", notNull: false, primary: false, type: "jsonb" },
      { default: null, name: "import_key", notNull: true, primary: false, type: "text" },
    ]);
  });

  it("is unique on the import key, the insert order and one act per id, indexed newest first, and joins a steer to its action", () => {
    expect(indexesOf({ table: autonomyEventTable })).toEqual([
      { columns: ["import_key asc"], name: "uq_autonomy_event_import_key", unique: true },
      { columns: ["seq asc"], name: "uq_autonomy_event_seq", unique: true },
      { columns: ["action_id asc"], name: "uq_autonomy_event_one_action", unique: true },
      { columns: ["occurred_at desc"], name: "idx_autonomy_event_time", unique: false },
      { columns: ["kind asc", "occurred_at desc"], name: "idx_autonomy_event_kind_time", unique: false },
      { columns: ["subject asc"], name: "idx_autonomy_event_subject", unique: false },
      { columns: ["action_id asc", "entry_kind asc"], name: "idx_autonomy_event_action", unique: false },
    ]);
  });

  it("checks an action carries kind, subject, why and witness, and a steer carries a steer and neither proof field", () => {
    expect(
      getTableConfig(autonomyEventTable).checks.map((entry) => ({
        name: entry.name,
        value: sqlText({ value: entry.value }),
      })),
    ).toEqual([
      { name: "autonomy_event_record_is_object", value: "record is null or jsonb_typeof(record) = 'object'" },
      {
        name: "autonomy_event_entry_fields",
        value:
          "(entry_kind = 'action' and kind is not null and subject is not null and why is not null and witness is not null) or (entry_kind = 'steer' and steer is not null and why is null and witness is null)",
      },
    ]);
  });

  it("denies the bot every row", () => {
    expect(policiesOf({ table: autonomyEventTable })).toEqual(ledgerPolicies({ table: "autonomy_event" }));
  });
});

describe("grantRowTable", () => {
  it("is the grant_row table, never the reserved word grant", () => {
    expect(getTableName(grantRowTable)).toBe("grant_row");
  });

  it("declares every column's SQL type, nullability, key and default, in order", () => {
    expect(columnsOf({ table: grantRowTable })).toEqual([
      { default: "gen_random_uuid()", name: "id", notNull: true, primary: true, type: "uuid" },
      { default: null, name: "seq", notNull: true, primary: false, type: "bigserial" },
      { default: null, name: "grant_id", notNull: true, primary: false, type: "text" },
      { default: null, name: "entry_kind", notNull: true, primary: false, type: "text" },
      { default: null, name: "target_file", notNull: false, primary: false, type: "text" },
      { default: null, name: "change_kind", notNull: false, primary: false, type: "text" },
      { default: null, name: "change", notNull: false, primary: false, type: "text" },
      { default: null, name: "anchor", notNull: false, primary: false, type: "text" },
      { default: null, name: "refusal_code", notNull: false, primary: false, type: "text" },
      { default: null, name: "detail", notNull: false, primary: false, type: "text" },
      { default: null, name: "by_session", notNull: false, primary: false, type: "text" },
      { default: null, name: "recorded_at", notNull: true, primary: false, type: "timestamp (3) with time zone" },
      { default: null, name: "entry", notNull: true, primary: false, type: "jsonb" },
      { default: null, name: "import_key", notNull: true, primary: false, type: "text" },
    ]);
  });

  it("is unique on the import key and the sequence, holds one grant and one performance per id, and indexes a grant's history", () => {
    expect(indexesOf({ table: grantRowTable })).toEqual([
      { columns: ["import_key asc"], name: "uq_grant_row_import_key", unique: true },
      { columns: ["seq asc"], name: "uq_grant_row_seq", unique: true },
      { columns: ["grant_id asc"], name: "uq_grant_row_one_grant", unique: true },
      { columns: ["grant_id asc"], name: "uq_grant_row_one_performance", unique: true },
      { columns: ["grant_id asc", "recorded_at asc"], name: "idx_grant_row_grant_time", unique: false },
      { columns: ["entry_kind asc", "recorded_at desc"], name: "idx_grant_row_kind_time", unique: false },
    ]);
  });

  it("declares no check and denies the bot every row", () => {
    expect(getTableConfig(grantRowTable).checks).toEqual([]);
    expect(policiesOf({ table: grantRowTable })).toEqual(ledgerPolicies({ table: "grant_row" }));
  });
});
