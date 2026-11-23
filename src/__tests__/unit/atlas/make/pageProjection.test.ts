/**
 * Unit: the Make scenario table drawn from read-view rows — schedule and state in words, provenance with its
 * fallbacks, the newest kept run, and an unreadable scenario keeping its row.
 */
import { describe, expect, it } from "vitest";

import type { AtlasEntityView, AtlasKindView } from "../../../../atlas/kit/read.js";
import { scenarioTable } from "../../../../atlas/make/pageProjection.js";

/** One stored entity of a kind, carrying this detail. */
function entity({ kind, providerId, detail }: { kind: string; providerId: string; detail: unknown }): AtlasEntityView {
  return { detail, id: `${kind}-${providerId}`, kind, observations: [], providerId, scope: "org 1" };
}

/** A kind view holding these entities and nothing else. */
function view({ kind, entities }: { kind: string; entities: readonly AtlasEntityView[] }): AtlasKindView {
  return {
    coverage: [],
    entities,
    gaps: [],
    kind,
    lastSuccessAt: null,
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: entities.length,
  };
}

/** A stored scenario detail with these fields over a plain default. */
function scenario({ over }: { over: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  return {
    blueprintOutline: { appPrefixes: ["slack"], moduleCount: 1, modules: ["slack:CreateMessage"] },
    created: "2026-01-01T00:00:00.000Z",
    description: null,
    folderId: null,
    id: 1,
    isActive: true,
    isPaused: false,
    isinvalid: false,
    lastEdit: "2026-01-01T00:00:00.000Z",
    name: "Post",
    scheduling: { type: "on-demand" },
    teamId: 10,
    usedPackages: ["slack"],
    ...over,
  };
}

/** The table over these scenarios, one team, and these runs. */
function rowsFor({
  scenarios,
  runs = [],
}: {
  scenarios: readonly Record<string, unknown>[];
  runs?: readonly Record<string, unknown>[];
}): readonly (readonly string[])[] {
  const kinds = [
    view({
      entities: scenarios.map((detail, index) => entity({ detail, kind: "scenario", providerId: String(index + 1) })),
      kind: "scenario",
    }),
    view({
      entities: [entity({ detail: { id: 10, name: "Ops", organizationId: 1 }, kind: "team", providerId: "10" })],
      kind: "team",
    }),
    view({
      entities: runs.map((detail, index) => entity({ detail, kind: "execution", providerId: `run-${String(index)}` })),
      kind: "execution",
    }),
  ];
  return scenarioTable({ kinds }).rows;
}

describe("scenarioTable", () => {
  it("heads the table for what Make records, and says it records no owner", () => {
    const table = scenarioTable({ kinds: [] });
    expect([table.id, table.title, table.rows.length]).toStrictEqual(["make-scenarios", "Scenarios", 0]);
    expect(table.columns[4]).toBe("made by / last edited by (team)");
    expect(table.note).toContain("Make records no scenario owner");
  });

  it("words each schedule type, and prints one it does not know as Make named it", () => {
    const schedules = [
      { type: "indefinitely", interval: 900 },
      { type: "indefinitely" },
      { date: "2026-11-01", type: "once" },
      { type: "on-demand" },
      { days: [1, 3], time: "09:00", type: "weekly" },
      { days: [1], type: "monthly" },
      { time: "06:00", type: "yearly" },
    ];
    const rows = rowsFor({
      scenarios: schedules.map((scheduling, index) =>
        scenario({ over: { id: index, name: `s${String(index)}`, scheduling } }),
      ),
    });
    expect(rows.map((row) => row[2])).toStrictEqual([
      "every 15 min",
      "at regular intervals",
      "once, 2026-11-01",
      "on demand only",
      "weekly on days 1,3 at 09:00",
      "monthly on dates 1",
      "yearly at 06:00",
    ]);
  });

  it("qualifies the state with paused, invalid and incomplete runs", () => {
    const rows = rowsFor({
      scenarios: [scenario({ over: { dlqCount: 2, isActive: false, isPaused: true, isinvalid: true } })],
    });
    expect(rows[0]![3]).toBe("off, paused, invalid, 2 incomplete");
  });

  it("names a person by name, then email, then id, and an unknown team by its id", () => {
    const rows = rowsFor({
      scenarios: [
        scenario({
          over: { createdByUser: { email: "a@example.test", id: 7, name: "" }, teamId: 99, updatedByUser: { id: 8 } },
        }),
        scenario({ over: { name: "Unattributed" } }),
      ],
    });
    expect(rows.map((row) => row[4])).toStrictEqual(["unknown / unknown (Ops)", "a@example.test / user #8 (team #99)"]);
  });

  it("prints the newest kept run, a status it does not know by number, and says when none is kept", () => {
    const rows = rowsFor({
      runs: [
        { duration: 1, id: "a", operations: 1, scenarioId: 1, status: 1, timestamp: "2026-10-01T00:00:00.000Z" },
        { duration: 1, id: "b", operations: 1, scenarioId: 1, status: 4, timestamp: "2026-10-02T00:00:00.000Z" },
      ],
      scenarios: [scenario({ over: { id: 1, name: "A" } }), scenario({ over: { id: 2, name: "B" } })],
    });
    expect(rows.map((row) => row[5])).toStrictEqual([
      "2026-10-02T00:00:00.000Z · status 4",
      "no run among the newest kept",
    ]);
  });

  it("keeps a row for a scenario whose stored detail no longer parses, after the readable ones", () => {
    const rows = rowsFor({ scenarios: [{ id: 5 }, scenario({ over: { description: "  Posts  " } })] });
    expect(rows[0]![1]).toBe("Posts — slack (1 modules)");
    expect(rows[1]![0]).toBe("#1");
    expect(rows[1]![1]).toContain("stored detail unreadable: ");
    expect(rows[1]!.slice(2)).toStrictEqual(["—", "—", "—", "—"]);
  });
});
