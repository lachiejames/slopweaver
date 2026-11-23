import { describe, expect, it } from "vitest";

import { type HeldWork, heldWorkLine, heldWorkOf } from "../../../supervisor/heldWork.js";

/** `count` held entries of one standing. */
const heldOf = ({ count, standing }: { count: number; standing: string }): readonly { standing: string }[] =>
  Array.from({ length: count }, () => ({ standing }));

/** A tick reading's shape: 116 ranked, 2 ready, 113 held, 84 of them repoless. */
const INCIDENT = {
  held: [
    ...heldOf({ count: 87, standing: "blocked" }),
    ...heldOf({ count: 18, standing: "waiting-on-owner" }),
    ...heldOf({ count: 4, standing: "paused" }),
    ...heldOf({ count: 4, standing: "in-flight" }),
  ],
  rankedCount: 116,
  ready: [{ id: "a" }, { id: "b" }],
  repolessRows: Array.from({ length: 84 }, (_, index) => `land-acme-${String(index)}`),
  trunkMovedRows: [],
};

describe("heldWorkOf", () => {
  it("counts the incident reading: ranked, ready, held by standing, repoless and trunk-moved", () => {
    const read = heldWorkOf({ reconciliation: INCIDENT });

    expect(read.kind).toBe("read");
    const held = (read as { kind: "read"; value: HeldWork }).value;
    expect([held.ranked, held.ready, held.repoless, held.trunkMoved]).toEqual([116, 2, 84, 0]);
    expect([...held.heldByStanding]).toEqual([
      ["blocked", 87],
      ["waiting-on-owner", 18],
      ["paused", 4],
      ["in-flight", 4],
    ]);
  });

  it("does not assume ranked is ready plus held — seated rows sit in neither list", () => {
    const read = heldWorkOf({ reconciliation: { ...INCIDENT, rankedCount: 130 } });

    expect(read).toEqual({
      kind: "read",
      value: expect.objectContaining({ ranked: 130, ready: 2 }) as unknown,
    });
  });

  it.each([
    ["a non-object", "nope", "the reconciliation is not a JSON object"],
    ["no rankedCount", { ...INCIDENT, rankedCount: undefined }, "the reconciliation carries no `rankedCount`"],
    [
      "no repolessRows",
      { ...INCIDENT, repolessRows: undefined },
      "the reconciliation is missing one of `ready`, `held`, `repolessRows` or `trunkMovedRows`",
    ],
    [
      "no trunkMovedRows",
      { ...INCIDENT, trunkMovedRows: undefined },
      "the reconciliation is missing one of `ready`, `held`, `repolessRows` or `trunkMovedRows`",
    ],
    [
      "a held entry with no standing",
      { ...INCIDENT, held: [{ id: "x" }] },
      "a `held` entry in the reconciliation carries no `standing`",
    ],
  ])("is unreadable, never zero, on %s", (_name, reconciliation, why) => {
    expect(heldWorkOf({ reconciliation })).toEqual({ kind: "unreadable", why });
  });
});

describe("heldWorkLine", () => {
  it("renders the incident: the fleet-liftable hold first, the remainder of blocked last", () => {
    const read = heldWorkOf({ reconciliation: INCIDENT });

    expect(heldWorkLine({ held: (read as { kind: "read"; value: HeldWork }).value })).toBe(
      "116 open: 2 ready, 84 held only for naming no repo: (handover set-repo <slug> --repo <dir>), 18 waiting on " +
        "the owner, 4 paused on a person, 4 in flight, 3 otherwise blocked",
    );
  });

  it("names a trunk-moved hold, and a standing it has no words for by its own name", () => {
    const held: HeldWork = {
      disconnected: 0,
      heldByStanding: new Map([
        ["blocked", 1],
        ["parked-elsewhere", 2],
      ]),
      ranked: 3,
      ready: 0,
      repoless: 0,
      trunkMoved: 1,
    };

    expect(heldWorkLine({ held })).toBe(
      "3 open: 0 ready, 1 held because the trunk moved under their evidence (a session re-reads), 2 parked-elsewhere",
    );
  });

  it("says only the count and zero ready over an empty board", () => {
    const held: HeldWork = {
      disconnected: 0,
      heldByStanding: new Map(),
      ranked: 0,
      ready: 0,
      repoless: 0,
      trunkMoved: 0,
    };

    expect(heldWorkLine({ held })).toBe("0 open: 0 ready");
  });

  it("names the disconnected-integration hold and takes it out of the otherwise-blocked remainder", () => {
    const read = heldWorkOf({
      reconciliation: {
        ...INCIDENT,
        disconnectedRows: [{ needs: ["fathom"], path: "/h/a.md", slug: "a" }],
        disconnectedUnread: null,
        held: [{ id: "a", standing: "blocked" }, ...INCIDENT.held.slice(1)],
      },
    });

    expect(heldWorkLine({ held: (read as { kind: "read"; value: HeldWork }).value })).toBe(
      "116 open: 2 ready, 84 held only for naming no repo: (handover set-repo <slug> --repo <dir>), 1 held for an " +
        "integration this install is not connected to (not to pick up), 18 waiting on the owner, 4 paused on a person, " +
        "4 in flight, 2 otherwise blocked",
    );
  });
});

describe("heldWorkOf — the disconnected-integration hold", () => {
  it("reads a reading from before the hold as none held, which is what that build measured", () => {
    const read = heldWorkOf({ reconciliation: INCIDENT });
    expect((read as { kind: "read"; value: HeldWork }).value.disconnected).toBe(0);
  });

  it("refuses a disconnectedRows that is not a list", () => {
    expect(heldWorkOf({ reconciliation: { ...INCIDENT, disconnectedRows: "x" } })).toEqual({
      kind: "unreadable",
      why: "the reconciliation's `disconnectedRows` is not a list of `{ needs, path, slug }` rows",
    });
  });

  it("refuses a disconnectedRows entry that is not a held row", () => {
    expect(heldWorkOf({ reconciliation: { ...INCIDENT, disconnectedRows: [{}], disconnectedUnread: null } })).toEqual({
      kind: "unreadable",
      why: "the reconciliation's `disconnectedRows` is not a list of `{ needs, path, slug }` rows",
    });
  });

  // A counterexample: an unlistable store holds nothing, so a row named beside one is no reading.
  it("refuses a held row named beside a secrets store that did not list", () => {
    const reconciliation = {
      ...INCIDENT,
      disconnectedRows: [{ needs: ["fathom"], path: "/h/a.md", slug: "a" }],
      disconnectedUnread: "EACCES",
    };
    expect(heldWorkOf({ reconciliation })).toEqual({
      kind: "unreadable",
      why: "the reconciliation holds rows for a disconnected integration while saying the secrets store did not list",
    });
  });

  // A counterexample: the hold names a row the same reading lists as ready, with nothing held.
  it("refuses a held row the same reading does not list as held blocked", () => {
    const reconciliation = {
      ...INCIDENT,
      disconnectedRows: [{ needs: ["fathom"], path: "/h/x.md", slug: "recipe-failing-x" }],
      disconnectedUnread: null,
      held: [],
      ready: [{ id: "recipe-failing-x", standing: "ready" }],
    };
    expect(heldWorkOf({ reconciliation })).toEqual({
      kind: "unreadable",
      why: "the reconciliation holds recipe-failing-x for a disconnected integration but does not list it as held blocked",
    });
  });

  it("reads an unlistable store holding nothing as none held", () => {
    const read = heldWorkOf({ reconciliation: { ...INCIDENT, disconnectedRows: [], disconnectedUnread: "EACCES" } });
    expect((read as { kind: "read"; value: HeldWork }).value.disconnected).toBe(0);
  });
});
