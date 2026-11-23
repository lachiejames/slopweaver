/**
 * The data-class census is TOTAL and bound to the schema.
 *
 * Totality is the load-bearing case: every declared table must sit in exactly one of the census's closed lists, so a
 * table added to the drizzle barrel with no decision fails here rather than reading as classified. The binding is the
 * other: a table the census calls row-classified must carry the `data_class` column, and a table carrying that column
 * must be one the census calls row-classified.
 */
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  censusTableNames,
  dataClassCensus,
  homePathDataClass,
  ROW_CLASSIFIED_TABLES,
  registerDataClass,
  tableDataClass,
} from "../../../store/dataClassCensus.js";
import { declaredTableNames, declaredTables } from "../../../store/declared.js";
import { HOME_DIRECTORY_CLASSIFICATION } from "../../../store/fleet/authoredDirectories.js";
import { HOME_REGISTERS } from "../../../store/homeRegisters.js";

describe("the data-class census", () => {
  it("declares every table the barrel declares, and names no table the barrel does not", () => {
    const declared = declaredTableNames();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((table) => tableDataClass({ table }) === undefined)).toEqual([]);
    expect(censusTableNames().filter((table) => !declared.includes(table))).toEqual([]);
  });

  it("names each table exactly once across its lists", () => {
    const names = censusTableNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((table, index) => names.indexOf(table) !== index)).toEqual([]);
  });

  it("calls a table row-classified exactly when the schema gives it a data_class column", () => {
    const withColumn = declaredTables()
      .filter((table) => getTableConfig(table).columns.some((column) => column.name === "data_class"))
      .map((table) => getTableName(table))
      .toSorted();
    expect(withColumn).toEqual(["content", "owner_capture", "owner_turn"]);
    expect([...ROW_CLASSIFIED_TABLES].toSorted()).toEqual(withColumn);
    expect(tableDataClass({ table: "content" })).toEqual({ column: "data_class", kind: "row-classified" });
  });

  it("gives every unclassified table a reason, and answers undefined for a name in no list", () => {
    const reasons = declaredTableNames()
      .map((table) => tableDataClass({ table })!)
      .filter((entry) => entry.kind === "unclassified")
      .map((entry) => entry.reason.trim());
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.filter((reason) => reason.length === 0)).toEqual([]);
    expect(tableDataClass({ table: "owner_turn_location" })).toEqual({
      kind: "unclassified",
      reason: "operational state (a cursor, counter, cap, marker or config row), not a record a person wrote",
    });
    expect(tableDataClass({ table: "no_such_table" })).toBeUndefined();
  });

  it("never classifies a register, and names the row-classified table its records reach", () => {
    expect(registerDataClass({ register: { table: "owner_turn" } })).toEqual({
      kind: "unclassified",
      reason: "its files carry no class; their copies in owner_turn are classified one row at a time",
    });
    expect(registerDataClass({ register: { table: "run" } })).toEqual({
      kind: "unclassified",
      reason: "a register is a place, never a record, and no table it reaches has a class",
    });
    expect(registerDataClass({ register: { table: undefined } })).toEqual({
      kind: "unclassified",
      reason: "a register is a place, never a record, and no table it reaches has a class",
    });
  });

  it("never classifies a home path, and gives a credential directory its own reason", () => {
    const secrets = HOME_DIRECTORY_CLASSIFICATION.find((row) => row.name === "secrets")!;
    expect(homePathDataClass({ row: secrets })).toEqual({
      kind: "unclassified",
      reason: "token material: never imported and never read as data",
    });
  });

  it("takes one row for every table, register and classified home path, with no undeclared table", () => {
    const census = dataClassCensus({ declaredTables: declaredTableNames(), registers: HOME_REGISTERS });
    expect(census.tables.map((row) => row.name)).toEqual(declaredTableNames());
    expect(census.registers.map((row) => row.name)).toEqual(HOME_REGISTERS.map((register) => register.kind));
    expect(census.homePaths).toHaveLength(HOME_DIRECTORY_CLASSIFICATION.length);
    expect(census.homePaths.length).toBeGreaterThan(0);
    expect(census.homePaths.filter((row) => row.entry?.kind !== "unclassified")).toEqual([]);
    expect(census.undeclaredTables).toEqual([]);
  });

  it("reports a table no list names as undeclared rather than unclassified", () => {
    const census = dataClassCensus({ declaredTables: ["content", "orphan_rows"], registers: [] });
    expect(census.tables).toEqual([
      { entry: { column: "data_class", kind: "row-classified" }, name: "content" },
      { entry: undefined, name: "orphan_rows" },
    ]);
    expect(census.undeclaredTables).toEqual(["orphan_rows"]);
  });
});
