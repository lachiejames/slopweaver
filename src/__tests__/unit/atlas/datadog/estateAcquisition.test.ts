import { describe, expect, it } from "vitest";

import {
  DATADOG_ESTATE_ROWS,
  type DatadogEstateRow,
  datadogEstateRecords,
  datadogEstateRowFor,
} from "../../../../atlas/datadog/estateAcquisition.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The row for one kind, resolved by name so an assertion never depends on declaration order. */
function rowFor({ kind }: { kind: string }): DatadogEstateRow {
  return DATADOG_ESTATE_ROWS.find((one) => one.kind === kind)!;
}

describe("DATADOG_ESTATE_ROWS — every row names an operation this build can issue", () => {
  it("declares at least one row, so the guards below are not true of an empty list", () => {
    expect(DATADOG_ESTATE_ROWS.length).toBeGreaterThan(0);
  });

  it("names a surface the committed registry carries, under the row's own kind", () => {
    const wrong = DATADOG_ESTATE_ROWS.filter(
      (row) => !DATADOG_SURFACES.some((one) => one.name === row.surface && one.kind === row.kind),
    ).map((row) => `${row.kind}/${row.surface}`);
    expect(wrong).toEqual([]);
  });

  it("names only operations the registry dispositions as entity and that take no identifier", () => {
    const wrong = DATADOG_ESTATE_ROWS.filter((row) =>
      DATADOG_SURFACES.some(
        (one) => one.name === row.surface && (one.disposition !== "entity" || one.path.includes("{")),
      ),
    ).map((row) => row.surface);
    expect(wrong).toEqual([]);
  });

  it("holds one row per kind, so two extractors can never race for the same kind file", () => {
    expect(DATADOG_ESTATE_ROWS.map((row) => row.kind).toSorted()).toEqual(
      [...new Set(DATADOG_ESTATE_ROWS.map((row) => row.kind))].toSorted(),
    );
  });
});

describe("datadogEstateRowFor", () => {
  it("answers the monitor row for the monitor kind", () => {
    expect(datadogEstateRowFor({ kind: "monitor" })!.surface).toBe("v1-monitors-list-monitors");
  });

  it("answers null for a kind this atlas holds no estate for", () => {
    expect(datadogEstateRowFor({ kind: "hosts" })).toBe(null);
  });
});

describe("datadogEstateRecords — the three envelopes disagree, and each row knows its own", () => {
  it("reads monitors out of a BARE array body", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [[{ id: 12345, name: "staging pool exhausted" }]],
        row: rowFor({ kind: "monitor" }),
      }),
    );
    expect(extracted.records).toEqual([{ providerId: "12345", record: { id: 12345, name: "staging pool exhausted" } }]);
  });

  it("reads dashboards out of the `dashboards` field, with a slug id", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [{ dashboards: [{ id: "abc-def-ghi", title: "fleet" }] }],
        row: rowFor({ kind: "dashboard" }),
      }),
    );
    expect(extracted.records.map((one) => one.providerId)).toEqual(["abc-def-ghi"]);
  });

  it("reads notebooks out of the `data` field", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [{ data: [{ id: 77, type: "notebooks" }] }],
        row: rowFor({ kind: "notebooks" }),
      }),
    );
    expect(extracted.records.map((one) => one.providerId)).toEqual(["77"]);
  });

  it("answers zero — never a guess — when a body arrives in another row's envelope", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [{ dashboards: [{ id: "abc-def-ghi" }] }],
        row: rowFor({ kind: "monitor" }),
      }),
    );
    expect(extracted).toEqual({ records: [], unidentified: 0 });
  });

  it("accumulates every page the pass kept", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [[{ id: 1 }], [{ id: 2 }, { id: 3 }]],
        row: rowFor({ kind: "monitor" }),
      }),
    );
    expect(extracted.records.map((one) => one.providerId)).toEqual(["1", "2", "3"]);
  });
});

describe("datadogEstateRecords — what it refuses to call an identifier", () => {
  it("counts an entry with no id as unidentified rather than dropping it silently", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [[{ id: 1 }, { name: "no id here" }, "not an object", { id: "" }, { id: true }]],
        row: rowFor({ kind: "monitor" }),
      }),
    );
    expect(extracted).toEqual({ records: [{ providerId: "1", record: { id: 1 } }], unidentified: 4 });
  });
});

describe("datadogEstateRecords — the collision it refuses to publish", () => {
  it("refuses a record whose id is an operation name in the same kind", () => {
    const refused = datadogEstateRecords({
      bodies: [[{ id: "v1-monitors-list-monitors" }]],
      row: rowFor({ kind: "monitor" }),
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNEXPECTED_SHAPE");
    expect(unwrapErr(refused).message).toContain("overwrite its compiled channel");
  });

  it("publishes a record whose id is an operation name in ANOTHER kind, which is not a collision", () => {
    const extracted = unwrap(
      datadogEstateRecords({
        bodies: [{ dashboards: [{ id: "v1-monitors-list-monitors" }] }],
        row: rowFor({ kind: "dashboard" }),
      }),
    );
    expect(extracted.records.map((one) => one.providerId)).toEqual(["v1-monitors-list-monitors"]);
  });
});
