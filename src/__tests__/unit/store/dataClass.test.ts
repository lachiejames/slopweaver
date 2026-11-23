/**
 * The data-class vocabulary and its one read rule: a record with no stored class is `unknown`, and only `public`
 * may be surfaced beyond the owner, so an absent or unclassified record fails closed.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { DATA_CLASSES, effectiveDataClass, reachesBeyondOwner } from "../../../store/dataClass.js";
import { contentTable, dataClassEnum, ownerCaptureTable, ownerTurnTable } from "../../../store/schema.js";

const LABELS = ["public", "internal", "personal", "restricted", "unknown"];

describe("the data classes", () => {
  it("are four classes and unknown, widest reach first, and the store enum carries the same labels in order", () => {
    expect(DATA_CLASSES).toEqual(LABELS);
    expect(dataClassEnum.enumName).toBe("data_class");
    expect(dataClassEnum.enumValues).toEqual(LABELS);
  });

  it("reads a stored class unchanged", () => {
    expect(DATA_CLASSES.map((stored) => effectiveDataClass({ stored }))).toEqual(LABELS);
  });

  it("reads a record with no stored class as unknown, never as public", () => {
    expect(effectiveDataClass({ stored: null })).toBe("unknown");
    expect(effectiveDataClass({ stored: undefined })).toBe("unknown");
  });

  it("lets only public reach beyond the owner: every other class and an absent class fail closed", () => {
    expect(DATA_CLASSES.map((stored) => reachesBeyondOwner({ stored }))).toEqual([true, false, false, false, false]);
    expect(reachesBeyondOwner({ stored: null })).toBe(false);
    expect(reachesBeyondOwner({ stored: undefined })).toBe(false);
  });

  it("is a nullable column with no default on each intake table, so the migration backfills nothing", () => {
    const columns = [contentTable, ownerCaptureTable, ownerTurnTable].map((table) => {
      const column = getTableConfig(table).columns.find((one) => one.name === "data_class")!;
      return { hasDefault: column.hasDefault, notNull: column.notNull, type: column.getSQLType() };
    });
    expect(columns).toEqual([
      { hasDefault: false, notNull: false, type: "data_class" },
      { hasDefault: false, notNull: false, type: "data_class" },
      { hasDefault: false, notNull: false, type: "data_class" },
    ]);
  });
});
