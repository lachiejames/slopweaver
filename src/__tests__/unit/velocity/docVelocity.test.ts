import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { docLandings, landingsByDay, landingsInSpan } from "../../../velocity/docVelocity.js";
import { trailingDayWindows } from "../../../velocity/windows.js";

describe("docLandings", () => {
  it("reports a clean finished cycle, with its started->finished latency in hours", () => {
    const events: RunEvent[] = [
      { atIso: "2026-08-30T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-08-30T16:00:00.000Z", kind: "finished", residue: [] },
    ];

    expect(docLandings({ journals: [{ events, slug: "doc-a" }] })).toEqual([
      { finishedIso: "2026-08-30T16:00:00.000Z", latencyHours: 6, slug: "doc-a" },
    ]);
  });

  it("skips a finished cycle that carries residue — a probe was forced through, not a clean landing", () => {
    const events: RunEvent[] = [
      { atIso: "2026-08-30T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-08-30T16:00:00.000Z", kind: "finished", residue: ["one probe unmet"] },
    ];

    expect(docLandings({ journals: [{ events, slug: "doc-a" }] })).toEqual([]);
  });

  it("skips a cycle with no finished event at all", () => {
    const events: RunEvent[] = [{ atIso: "2026-08-30T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" }];

    expect(docLandings({ journals: [{ events, slug: "doc-a" }] })).toEqual([]);
  });

  it("reports every cycle in a journal run more than once", () => {
    const events: RunEvent[] = [
      { atIso: "2026-08-28T00:00:00.000Z", branch: "b", docHash: "h1", kind: "started" },
      { atIso: "2026-08-28T02:00:00.000Z", kind: "finished", residue: [] },
      { atIso: "2026-08-30T00:00:00.000Z", branch: "b", docHash: "h2", kind: "started" },
      { atIso: "2026-08-30T05:00:00.000Z", kind: "finished", residue: [] },
    ];

    const landings = docLandings({ journals: [{ events, slug: "doc-a" }] });

    expect(landings.map((l) => l.latencyHours)).toEqual([2, 5]);
  });
});

describe("landingsByDay", () => {
  it("buckets landings into the window their finished event falls in", () => {
    const windows = trailingDayWindows({ days: 2, nowIso: "2026-08-31T00:00:00.000Z" });
    const landings = [
      { finishedIso: "2026-08-30T12:00:00.000Z", latencyHours: 1, slug: "a" },
      { finishedIso: "2026-08-31T01:00:00.000Z", latencyHours: 1, slug: "b" },
      { finishedIso: "2026-08-31T02:00:00.000Z", latencyHours: 1, slug: "c" },
    ];

    expect(landingsByDay({ landings, windows })).toEqual([
      { dayKey: "2026-08-30", landed: 1 },
      { dayKey: "2026-08-31", landed: 2 },
    ]);
  });
});

describe("landingsInSpan", () => {
  const landings = [
    { finishedIso: "2026-08-29T23:59:00.000Z", latencyHours: 1, slug: "before" },
    { finishedIso: "2026-08-30T00:00:00.000Z", latencyHours: 1, slug: "in" },
    { finishedIso: "2026-08-31T00:00:00.000Z", latencyHours: 1, slug: "after" },
  ];

  it("keeps only landings inside [sinceIso, untilIso)", () => {
    const kept = landingsInSpan({
      landings,
      sinceIso: "2026-08-30T00:00:00.000Z",
      untilIso: "2026-08-31T00:00:00.000Z",
    });

    expect(kept.map((l) => l.slug)).toEqual(["in"]);
  });
});
