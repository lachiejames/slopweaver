/**
 * The parts of `store classify`'s statements a unit test can reach without a database: which tables have a page
 * reader, and whether the default page fits one write-back statement.
 */
import { describe, expect, it } from "vitest";

import { CLASSIFY_BATCH_ROWS, PAGE_READERS } from "../../../store/dataClassStatements.js";

/** Postgres's ceiling on bound parameters in one statement. */
const POSTGRES_MAX_BIND_PARAMETERS = 65_535;

/** A write-back binds two parameters a row: its key and its class. */
const PARAMETERS_PER_WRITTEN_ROW = 2;

describe("PAGE_READERS", () => {
  it("reads exactly the three tables that carry a data_class column", () => {
    expect(Object.keys(PAGE_READERS).toSorted()).toEqual(["content", "owner_capture", "owner_turn"]);
  });
});

describe("CLASSIFY_BATCH_ROWS", () => {
  it("keeps one default page's write-back inside Postgres's bound-parameter ceiling", () => {
    expect(CLASSIFY_BATCH_ROWS).toBe(1000);
    expect(CLASSIFY_BATCH_ROWS * PARAMETERS_PER_WRITTEN_ROW).toBeLessThan(POSTGRES_MAX_BIND_PARAMETERS);
  });
});
