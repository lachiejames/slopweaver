import { describe, expect, it } from "vitest";

import { DATADOG_COMPILED_CHANNEL } from "../../../../atlas/datadog/catalogue.js";
import { datadogCatalogueCoverage } from "../../../../atlas/datadog/catalogueCoverage.js";
import type { DatadogCoverageCell } from "../../../../atlas/datadog/documents.js";

const AT = "2026-09-06T01:00:00.000Z";
const EARLIER = "2026-09-01T01:00:00.000Z";

/** A stored cell on one surface, with the fields this module reads set explicitly. */
const storedCell = ({
  surface,
  lastSuccessAt,
}: {
  surface: string;
  lastSuccessAt: string | null;
}): DatadogCoverageCell => ({
  channel: "api",
  lastSuccessAt,
  latestAttemptFailed: false,
  reason: "a cell an earlier pass wrote",
  role: "authoritative",
  scope: "monitor",
  state: "synced",
  surface,
  unblockedBy: null,
});

describe("datadogCatalogueCoverage", () => {
  it("writes the compiled, api and console cells, in that order, on a kind's first sync", () => {
    const cells = datadogCatalogueCoverage({ at: AT, kind: "monitor", projections: [], rows: [], stored: [] });

    expect(cells.map((cell) => cell.surface)).toStrictEqual([DATADOG_COMPILED_CHANNEL, "api", "console"]);
    expect(cells.map((cell) => cell.lastSuccessAt)).toStrictEqual([AT, null, null]);
    expect(cells.map((cell) => cell.state)).toStrictEqual(["synced", "deferred", "deferred"]);
  });

  it("carries an earlier api success forward rather than claiming none", () => {
    const cells = datadogCatalogueCoverage({
      at: AT,
      kind: "monitor",
      projections: [],
      rows: [],
      stored: [storedCell({ lastSuccessAt: EARLIER, surface: "api" })],
    });

    expect(cells[1]!.surface).toBe("api");
    expect(cells[1]!.lastSuccessAt).toBe(EARLIER);
    expect(cells[1]!.state).toBe("deferred");
  });

  it("keeps a console cell a walk wrote exactly as it is", () => {
    const walked = storedCell({ lastSuccessAt: EARLIER, surface: "console" });

    const cells = datadogCatalogueCoverage({ at: AT, kind: "monitor", projections: [], rows: [], stored: [walked] });

    expect(cells[2]).toBe(walked);
  });

  it("replaces a console cell no walk has succeeded on with the honest floor", () => {
    const cells = datadogCatalogueCoverage({
      at: AT,
      kind: "monitor",
      projections: [],
      rows: [],
      stored: [storedCell({ lastSuccessAt: null, surface: "console" })],
    });

    expect(cells[2]!.unblockedBy).toBe("slopweaver atlas datadog walk");
  });

  it("keeps every cell another pass owns ahead of its own three", () => {
    const other = storedCell({ lastSuccessAt: EARLIER, surface: "some-other-surface" });

    const cells = datadogCatalogueCoverage({ at: AT, kind: "monitor", projections: [], rows: [], stored: [other] });

    expect(cells.length).toBe(4);
    expect(cells[0]).toBe(other);
  });
});
