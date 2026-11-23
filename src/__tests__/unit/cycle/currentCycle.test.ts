import { describe, expect, it } from "vitest";

import {
  currentCycles,
  cycleWindowOf,
  earliestCycleStart,
  teamsWithCurrentCycle,
} from "../../../cycle/currentCycle.js";

const cycleLine = ({
  id,
  team,
  startsAt,
  endsAt,
}: {
  id: string;
  team: string;
  startsAt: string;
  endsAt: string;
}): string =>
  JSON.stringify({
    attrs: { endsAt, number: 1, startsAt },
    identity: { name: "Cycle 1", nativeId: id },
    kind: "cycle",
    relations: [{ targetId: team, targetKind: "team", targetSource: "linear", type: "cycle_for" }],
    source: "linear",
    sourceId: id,
  });

describe("cycleWindowOf", () => {
  it("reads the dates and the team binding off a cycle row", () => {
    const window = cycleWindowOf({
      line: cycleLine({
        endsAt: "2026-09-08T00:00:00.000Z",
        id: "c1",
        startsAt: "2026-08-25T00:00:00.000Z",
        team: "t1",
      }),
    });
    expect(window).toEqual({
      endsAt: "2026-09-08T00:00:00.000Z",
      id: "c1",
      name: "Cycle 1",
      startsAt: "2026-08-25T00:00:00.000Z",
      teamId: "t1",
    });
  });

  it("answers undefined for a row that is not a cycle", () => {
    expect(cycleWindowOf({ line: JSON.stringify({ kind: "team", sourceId: "t1" }) })).toBe(undefined);
  });

  it("answers undefined for a cycle row missing its dates", () => {
    const line = JSON.stringify({ attrs: { number: 1 }, identity: { name: "x" }, kind: "cycle", sourceId: "c1" });
    expect(cycleWindowOf({ line })).toBe(undefined);
  });

  it("answers undefined rather than throwing on an unparseable line", () => {
    expect(cycleWindowOf({ line: "{not json" })).toBe(undefined);
  });

  it("carries no team when the row declares no cycle_for relation", () => {
    const line = JSON.stringify({
      attrs: { endsAt: "2026-09-08T00:00:00.000Z", startsAt: "2026-08-25T00:00:00.000Z" },
      identity: { name: "Cycle 1" },
      kind: "cycle",
      relations: [],
      sourceId: "c1",
    });
    expect(cycleWindowOf({ line })!.teamId).toBe(undefined);
  });
});

describe("currentCycles", () => {
  const past = {
    endsAt: "2026-08-25T00:00:00.000Z",
    id: "past",
    name: "0",
    startsAt: "2026-08-11T00:00:00.000Z",
    teamId: "t1",
  };
  const live = {
    endsAt: "2026-09-08T00:00:00.000Z",
    id: "live",
    name: "1",
    startsAt: "2026-08-25T00:00:00.000Z",
    teamId: "t1",
  };
  const future = {
    endsAt: "2026-09-22T00:00:00.000Z",
    id: "future",
    name: "2",
    startsAt: "2026-09-08T00:00:00.000Z",
    teamId: "t2",
  };

  it("keeps only the cycle spanning the instant", () => {
    const current = currentCycles({ nowIso: "2026-09-01T00:00:00.000Z", windows: [past, live, future] });
    expect([...current.keys()]).toEqual(["live"]);
  });

  it("treats the start as inclusive and the end as exclusive", () => {
    expect([...currentCycles({ nowIso: "2026-08-25T00:00:00.000Z", windows: [past, live] }).keys()]).toEqual(["live"]);
    expect([...currentCycles({ nowIso: "2026-09-08T00:00:00.000Z", windows: [live, future] }).keys()]).toEqual([
      "future",
    ]);
  });

  it("dedupes repeated generations of one cycle, keeping the last row seen", () => {
    const stale = { ...live, endsAt: "2026-08-26T00:00:00.000Z" };
    const current = currentCycles({ nowIso: "2026-09-01T00:00:00.000Z", windows: [stale, live] });
    expect(current.get("live")!.endsAt).toBe("2026-09-08T00:00:00.000Z");
  });

  it("is empty when nothing spans the instant", () => {
    expect(currentCycles({ nowIso: "2027-01-01T00:00:00.000Z", windows: [past, live, future] }).size).toBe(0);
  });

  it("counts distinct teams, not cycles", () => {
    const current = currentCycles({ nowIso: "2026-09-01T00:00:00.000Z", windows: [live, { ...live, id: "live2" }] });
    expect(teamsWithCurrentCycle({ cycles: current })).toBe(1);
  });

  it("takes the earliest start across every current cycle as the staleness boundary", () => {
    const other = { ...live, id: "other", startsAt: "2026-08-20T00:00:00.000Z", teamId: "t2" };
    const current = currentCycles({ nowIso: "2026-09-01T00:00:00.000Z", windows: [live, other] });
    expect(earliestCycleStart({ cycles: current })).toBe("2026-08-20T00:00:00.000Z");
  });

  it("answers no boundary at all when no cycle is current, rather than an empty string", () => {
    expect(earliestCycleStart({ cycles: new Map() })).toBe(undefined);
  });
});
