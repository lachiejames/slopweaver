import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AssignmentEvent,
  appendLedger,
  foldLedger,
  ledgerPath,
  parseAssignmentEvent,
  readLedger,
} from "../../../footprint/ledger.js";
import { unwrap } from "../../../lib/result.js";

const homes: string[] = [];

const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-footprint-ledger-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

const assigned = ({ nodeId, workstreamId }: { nodeId: string; workstreamId: string }): AssignmentEvent => ({
  atIso: "2026-09-04T04:00:00.000Z",
  by: "proposed",
  kind: "assigned",
  nodeId,
  workstreamId,
});

const unassigned = ({ nodeId, workstreamId }: { nodeId: string; workstreamId: string }): AssignmentEvent => ({
  atIso: "2026-09-04T06:00:00.000Z",
  kind: "unassigned",
  nodeId,
  workstreamId,
});

describe("foldLedger", () => {
  it("is empty for no events", () => {
    const state = foldLedger({ events: [] });

    expect(state.assignments.size).toBe(0);
    expect(state.titles.size).toBe(0);
  });

  it("lets a later assignment of the same node win, so a correction needs no rewrite", () => {
    const state = foldLedger({
      events: [assigned({ nodeId: "n1", workstreamId: "w1" }), assigned({ nodeId: "n1", workstreamId: "w2" })],
    });

    expect(state.assignments.get("n1")).toBe("w2");
  });

  it("follows a merge so an assignment to a retired id resolves to the survivor", () => {
    const state = foldLedger({
      events: [
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        { atIso: "2026-09-04T05:00:00.000Z", intoId: "w2", kind: "merged", workstreamId: "w1" },
      ],
    });

    expect(state.assignments.get("n1")).toBe("w2");
  });

  it("follows a chain of merges to the end", () => {
    const state = foldLedger({
      events: [
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        { atIso: "2026-09-04T05:00:00.000Z", intoId: "w2", kind: "merged", workstreamId: "w1" },
        { atIso: "2026-09-04T06:00:00.000Z", intoId: "w3", kind: "merged", workstreamId: "w2" },
      ],
    });

    expect(state.assignments.get("n1")).toBe("w3");
  });

  it("terminates on a merge cycle rather than looping forever", () => {
    const state = foldLedger({
      events: [
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        { atIso: "2026-09-04T05:00:00.000Z", intoId: "w2", kind: "merged", workstreamId: "w1" },
        { atIso: "2026-09-04T06:00:00.000Z", intoId: "w1", kind: "merged", workstreamId: "w2" },
      ],
    });

    expect(state.assignments.get("n1")).toBe("w1");
  });

  it("keeps the latest title as a mutable label over a stable id", () => {
    const state = foldLedger({
      events: [
        { atIso: "2026-09-04T04:00:00.000Z", kind: "titled", title: "first name", workstreamId: "w1" },
        { atIso: "2026-09-04T05:00:00.000Z", kind: "titled", title: "second name", workstreamId: "w1" },
      ],
    });

    expect(state.titles.get("w1")).toBe("second name");
  });

  it("drops a node that was assigned and then unassigned, so a mistaken assignment is not permanent", () => {
    const state = foldLedger({
      events: [assigned({ nodeId: "n1", workstreamId: "w1" }), unassigned({ nodeId: "n1", workstreamId: "w1" })],
    });

    expect(state.assignments.has("n1")).toBe(false);
    expect(state.assignments.size).toBe(0);
  });

  it("removes only the node named, leaving its siblings in the workstream", () => {
    const state = foldLedger({
      events: [
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        assigned({ nodeId: "n2", workstreamId: "w1" }),
        unassigned({ nodeId: "n1", workstreamId: "w1" }),
      ],
    });

    expect([...state.assignments.keys()]).toEqual(["n2"]);
    expect(state.assignments.get("n2")).toBe("w1");
  });

  it("lets a later assignment put an unassigned node back, so the removal is itself correctable", () => {
    const state = foldLedger({
      events: [
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        unassigned({ nodeId: "n1", workstreamId: "w1" }),
        assigned({ nodeId: "n1", workstreamId: "w2" }),
      ],
    });

    expect(state.assignments.get("n1")).toBe("w2");
  });

  it("removes on the node it names whatever workstream it cites, rather than becoming a silent no-op", () => {
    const state = foldLedger({
      events: [assigned({ nodeId: "n1", workstreamId: "w2" }), unassigned({ nodeId: "n1", workstreamId: "w1" })],
    });

    expect(state.assignments.has("n1")).toBe(false);
  });

  it("is an ordinary no-op for a node that was never assigned", () => {
    const state = foldLedger({ events: [unassigned({ nodeId: "ghost", workstreamId: "w1" })] });

    expect(state.assignments.size).toBe(0);
  });

  it("keeps a workstream's title after its last node leaves, so the id still resolves", () => {
    const state = foldLedger({
      events: [
        { atIso: "2026-09-04T04:00:00.000Z", kind: "titled", title: "security PRs", workstreamId: "w1" },
        assigned({ nodeId: "n1", workstreamId: "w1" }),
        unassigned({ nodeId: "n1", workstreamId: "w1" }),
      ],
    });

    expect(state.assignments.size).toBe(0);
    expect(state.titles.get("w1")).toBe("security PRs");
  });

  it("folds the seeding incident to the three real nodes it should always have held", () => {
    const placeholders = [
      "slack:D0SYN000004:1787540000.000000",
      "slack:D0SYN000006:1787540000.000001",
      "slack:D0SYN000007:1787540000.000002",
    ];
    const real = [
      "slack:D0SYN000004:1787883019.276619",
      "slack:D0SYN000007:1787883027.267399",
      "slack:D0SYN000006:1787883034.773539",
    ];
    const workstreamId = "072a1ac4-df6d-4ece-9434-ff8d2055f7a6";

    const state = foldLedger({
      events: [
        ...placeholders.map((nodeId) => assigned({ nodeId, workstreamId })),
        ...real.map((nodeId) => assigned({ nodeId, workstreamId })),
        ...placeholders.map((nodeId) => unassigned({ nodeId, workstreamId })),
      ],
    });

    expect([...state.assignments.keys()].toSorted()).toEqual(real.toSorted());
  });
});

describe("parseAssignmentEvent", () => {
  it("reads an assignment", () => {
    const event = parseAssignmentEvent({
      line: '{"kind":"assigned","workstreamId":"w1","nodeId":"n1","atIso":"2026-09-04T04:00:00.000Z","by":"owner"}',
    });

    expect(event).toEqual({
      atIso: "2026-09-04T04:00:00.000Z",
      by: "owner",
      kind: "assigned",
      nodeId: "n1",
      workstreamId: "w1",
    });
  });

  it("defaults an unrecognised author to proposed rather than owner", () => {
    const event = parseAssignmentEvent({
      line: '{"kind":"assigned","workstreamId":"w1","nodeId":"n1","atIso":"2026-09-04T04:00:00.000Z","by":"nonsense"}',
    });

    expect(event).toEqual({
      atIso: "2026-09-04T04:00:00.000Z",
      by: "proposed",
      kind: "assigned",
      nodeId: "n1",
      workstreamId: "w1",
    });
  });

  it("refuses a line that is not JSON", () => {
    expect(parseAssignmentEvent({ line: "not json" })).toBeUndefined();
  });

  it("refuses an assignment with no node", () => {
    expect(
      parseAssignmentEvent({ line: '{"kind":"assigned","workstreamId":"w1","atIso":"2026-09-04T04:00:00.000Z"}' }),
    ).toBeUndefined();
  });

  it("reads an unassignment", () => {
    const event = parseAssignmentEvent({
      line: '{"kind":"unassigned","workstreamId":"w1","nodeId":"n1","atIso":"2026-09-04T06:00:00.000Z"}',
    });

    expect(event).toEqual({
      atIso: "2026-09-04T06:00:00.000Z",
      kind: "unassigned",
      nodeId: "n1",
      workstreamId: "w1",
    });
  });

  it("refuses an unassignment with no node", () => {
    expect(
      parseAssignmentEvent({ line: '{"kind":"unassigned","workstreamId":"w1","atIso":"2026-09-04T06:00:00.000Z"}' }),
    ).toBeUndefined();
  });

  it("refuses an unknown kind", () => {
    expect(
      parseAssignmentEvent({ line: '{"kind":"invented","workstreamId":"w1","atIso":"2026-09-04T04:00:00.000Z"}' }),
    ).toBeUndefined();
  });
});

describe("readLedger and appendLedger", () => {
  it("reads an absent ledger as an ordinary empty state", () => {
    const home = newHome();

    expect(unwrap(readLedger({ home }))).toEqual([]);
  });

  it("round-trips what it appended", () => {
    const home = newHome();
    const events = [assigned({ nodeId: "n1", workstreamId: "w1" }), assigned({ nodeId: "n2", workstreamId: "w1" })];

    expect(unwrap(appendLedger({ events, home }))).toBe(2);
    expect(unwrap(readLedger({ home }))).toEqual(events);
  });

  it("appends rather than replacing, so history survives", () => {
    const home = newHome();
    appendLedger({ events: [assigned({ nodeId: "n1", workstreamId: "w1" })], home });
    appendLedger({ events: [assigned({ nodeId: "n2", workstreamId: "w2" })], home });

    expect(unwrap(readLedger({ home })).length).toBe(2);
  });

  it("round-trips an unassignment through the file and folds it away", () => {
    const home = newHome();
    const events = [assigned({ nodeId: "n1", workstreamId: "w1" }), unassigned({ nodeId: "n1", workstreamId: "w1" })];
    appendLedger({ events, home });

    const read = unwrap(readLedger({ home }));

    expect(read).toEqual(events);
    expect(foldLedger({ events: read }).assignments.size).toBe(0);
  });

  it("writes nothing for an empty append", () => {
    const home = newHome();

    expect(unwrap(appendLedger({ events: [], home }))).toBe(0);
    expect(unwrap(readLedger({ home }))).toEqual([]);
  });

  it("skips an unreadable line rather than aborting the whole read", () => {
    const home = newHome();
    const path = ledgerPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      'garbage\n{"kind":"assigned","workstreamId":"w1","nodeId":"n1","atIso":"2026-09-04T04:00:00.000Z","by":"owner"}\n',
      "utf8",
    );

    expect(unwrap(readLedger({ home })).length).toBe(1);
  });
});
