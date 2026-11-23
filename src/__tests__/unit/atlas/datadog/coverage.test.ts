import { describe, expect, it } from "vitest";

import { datadogCoverageCell, storedDatadogCoverageCell } from "../../../../atlas/datadog/coverage.js";
import { DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";
import { projectDatadogValue } from "../../../../atlas/datadog/projection.js";

const AT = "2026-09-05T01:00:00.000Z";

const clean = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_unused, index) => projectDatadogValue({ kind: "monitor", value: { id: index } }));

describe("datadogCoverageCell", () => {
  it("grades a completed read of a plain family synced", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: clean({ count: 3 }),
      role: "authoritative",
    });

    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.reason).toBe("3 record(s) from api");
  });

  // The whole point of this module: a withheld field must reach the reader, or the atlas looks as though
  // Datadog never returned one.
  it("states what was withheld, naming the field", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "integrations",
      outcome: { status: "complete" },
      projections: [projectDatadogValue({ kind: "integrations", value: { credentials: { apiKey: "x" } } })],
      role: "authoritative",
    });

    expect(cell.reason).toContain("withheld 1 secret-material position(s)");
    expect(cell.reason).toContain("credentials");
  });

  // Without this sentence a reader sees a synced cell over a handful of shape entities and concludes the
  // organisation barely logs, which is the most wrong answer this atlas could give.
  it("says a shape-indexed family is shape-indexed, every time", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "shape-index",
      kind: "logs",
      outcome: { status: "complete" },
      projections: clean({ count: 2 }),
      role: "discovery",
    });

    expect(cell.reason).toContain("logs is SHAPE-INDEXED by design");
    expect(cell.reason).toContain("never of what this organisation holds");
  });

  it("adds no such sentence to a plain family", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: clean({ count: 1 }),
      role: "authoritative",
    });

    expect(cell.reason).toBe("1 record(s) from api");
  });

  // FAILS CLOSED: a caller cannot get `synced` by omitting the bad news, because the outcome is required.
  it("refuses synced when the read did not finish, and carries the failure's own message", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "incomplete", error: DatadogAtlasErrors.forbidden({ surface: "v2-monitors-list" }) },
      projections: clean({ count: 10 }),
      role: "authoritative",
    });

    expect(cell.state).toBe("unavailable");
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.reason).toContain("answered 403");
  });

  it("maps each failure kind to its own coverage state", () => {
    const cellFor = (
      error: ReturnType<typeof DatadogAtlasErrors.forbidden> | ReturnType<typeof DatadogAtlasErrors.unauthorised>,
    ) =>
      datadogCoverageCell({
        at: AT,
        channel: "api",
        disposition: "entity",
        kind: "monitor",
        outcome: { status: "incomplete", error },
        projections: [],
        role: "authoritative",
      });

    expect(cellFor(DatadogAtlasErrors.unauthorised({ surface: "s" })).state).toBe("not-configured");
    expect(cellFor(DatadogAtlasErrors.forbidden({ surface: "s" })).state).toBe("unavailable");
  });

  it("defers a rate-limited family and says when its budget refills", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "incomplete", error: DatadogAtlasErrors.rateLimited({ resetSeconds: 42, surface: "s" }) },
      projections: [],
      role: "authoritative",
    });

    expect(cell.state).toBe("deferred");
    expect(cell.unblockedBy).toContain("in 42s");
  });

  // A truncated document is a DEFECT, and it is the one thing that can deny a completed read the word
  // `synced`. The projection is what says so, and it cannot be separated from the records it truncated.
  it("denies synced to a COMPLETED read whose projection truncated a document", () => {
    let deep: unknown = { leaf: true };
    for (let level = 0; level < 30; level += 1) {
      deep = { down: deep };
    }
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: [projectDatadogValue({ kind: "monitor", value: deep })],
      role: "authoritative",
    });

    expect(cell.state).toBe("unreadable");
    expect(cell.reason).toContain("TRUNCATED");
  });

  it("carries a prior success forward on a failure rather than erasing it", () => {
    const previous = datadogCoverageCell({
      at: "2026-09-01T00:00:00.000Z",
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: clean({ count: 1 }),
      role: "authoritative",
    });
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "incomplete", error: DatadogAtlasErrors.transportFailed({ cause: "boom", surface: "s" }) },
      previous,
      projections: [],
      role: "authoritative",
    });

    expect(cell.lastSuccessAt).toBe("2026-09-01T00:00:00.000Z");
    expect(cell.latestAttemptFailed).toBe(true);
  });
});

describe("a cell's surface and scope", () => {
  // `coverageCore.ts`'s `atlasSurfaceHasFilledCell` decides whether a DECLARED surface is filled by
  // matching a stored cell's `surface` against the surface's own name, and `descriptor.ts` fixes those
  // names to be the three channels. A cell carrying the kind there matches no declared surface at all, so
  // every surface reads declared-unfilled however much the store holds.
  it("names the CHANNEL as the surface, so a declared surface can be matched", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "compiled-catalogue",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: clean({ count: 1 }),
      role: "discovery",
    });

    expect(cell.surface).toBe("compiled-catalogue");
    expect(cell.scope).toBe("monitor");
  });

  it("keeps the surface as the channel on a FAILED cell too, so a failure replaces its own cell", () => {
    const cell = datadogCoverageCell({
      at: AT,
      channel: "api",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "incomplete", error: DatadogAtlasErrors.forbidden({ surface: "v2-monitors-list" }) },
      projections: [],
      role: "authoritative",
    });

    expect(cell.surface).toBe("api");
    expect(cell.scope).toBe("monitor");
  });
});

describe("storedDatadogCoverageCell", () => {
  const kitCell = () =>
    datadogCoverageCell({
      at: AT,
      channel: "compiled-catalogue",
      disposition: "entity",
      kind: "monitor",
      outcome: { status: "complete" },
      projections: clean({ count: 2 }),
      role: "discovery",
    });

  it("stamps the channel typed, beside the surface the kit cell already carries", () => {
    const stored = storedDatadogCoverageCell({ cell: kitCell(), channel: "compiled-catalogue" });

    expect(stored.channel).toBe("compiled-catalogue");
    expect(stored.surface).toBe("compiled-catalogue");
    expect(stored.scope).toBe("monitor");
  });

  it("carries every judgement the kit cell made, unchanged", () => {
    const stored = storedDatadogCoverageCell({ cell: kitCell(), channel: "compiled-catalogue" });

    expect(stored.state).toBe("synced");
    expect(stored.role).toBe("discovery");
    expect(stored.lastSuccessAt).toBe(AT);
    expect(stored.latestAttemptFailed).toBe(false);
    expect(stored.reason).toBe("2 record(s) from compiled-catalogue");
    expect(stored.unblockedBy).toBe(null);
  });

  // The stored schema has no home for either, and both omissions are stated in the converter's own
  // documentation rather than silent. A console walk must widen the schema before it publishes an artifact.
  it("drops exactly the two fields the stored schema has no home for", () => {
    const stored = storedDatadogCoverageCell({ cell: kitCell(), channel: "compiled-catalogue" });

    expect(Object.keys(stored).toSorted()).toStrictEqual([
      "channel",
      "lastSuccessAt",
      "latestAttemptFailed",
      "reason",
      "role",
      "scope",
      "state",
      "surface",
      "unblockedBy",
    ]);
  });
});
