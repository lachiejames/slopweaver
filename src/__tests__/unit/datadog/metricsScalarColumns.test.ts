/*
 * The column-narrowing module's own exports, directly. `metricsScalar.test.ts` is the behavioural suite for the
 * whole reader, every malformed response shape included, and these cases pin what each helper hands that reader.
 */
import { describe, expect, it } from "vitest";

import {
  columnKey,
  describeUnexpectedValue,
  partitionColumns,
  safeString,
} from "../../../datadog/metricsScalarColumns.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("describeUnexpectedValue", () => {
  it("names null, an array's length and any other value's typeof, never the contents", () => {
    expect(describeUnexpectedValue({ value: null })).toBe("null");
    expect(describeUnexpectedValue({ value: [[1], [2]] })).toBe("an array of length 2");
    expect(describeUnexpectedValue({ value: { deep: { deeper: true } } })).toBe("object");
  });
});

describe("safeString", () => {
  it("passes a primitive through String", () => {
    expect(safeString({ value: "env" })).toBe("env");
    expect(safeString({ value: 7 })).toBe("7");
    expect(safeString({ value: false })).toBe("false");
    expect(safeString({ value: undefined })).toBe("undefined");
  });

  it("describes an array or object rather than coercing it", () => {
    expect(safeString({ value: [["nested"]] })).toBe("an array of length 1");
    expect(safeString({ value: { toString: "poisoned" } })).toBe("object");
  });
});

describe("columnKey", () => {
  it("answers the name, or an empty string when it is absent", () => {
    expect(columnKey({ name: "service" })).toBe("service");
    expect(columnKey({ name: undefined })).toBe("");
  });
});

describe("partitionColumns", () => {
  const group = { name: "service", type: "group", values: [["api"]] };
  const number = { name: "q1", type: "number", values: [3] };

  it("splits group columns from the one number column", () => {
    expect(unwrap(partitionColumns({ columns: [group, number] }))).toEqual({
      groupColumns: [group],
      numberColumn: number,
    });
  });

  it("refuses a response with no number column", () => {
    expect(unwrapErr(partitionColumns({ columns: [group] })).code).toBe("NUMBER_COLUMN_MISSING");
  });

  it("refuses a second number column, naming both", () => {
    const failure = unwrapErr(partitionColumns({ columns: [number, { ...number, name: "q2" }] }));
    expect(failure).toMatchObject({ code: "NUMBER_COLUMNS_MULTIPLE", firstName: "q1", secondName: "q2" });
  });

  it("refuses an unrecognised column type", () => {
    const failure = unwrapErr(partitionColumns({ columns: [{ name: "x", type: "mystery" }] }));
    expect(failure).toMatchObject({ code: "COLUMN_TYPE_UNRECOGNISED", columnType: "mystery" });
  });

  it("refuses a column whose values are not an array", () => {
    const failure = unwrapErr(partitionColumns({ columns: [{ name: "q1", type: "number", values: "3" }] }));
    expect(failure).toMatchObject({ actual: "string", code: "COLUMN_VALUES_NOT_ARRAY", columnName: "q1" });
  });
});
