import { describe, expect, it } from "vitest";

import { foldLedger } from "../../../footprint/ledger.js";
import type { FootprintNode } from "../../../footprint/nodes.js";
import { composeBrief } from "../../../footprint/scan.js";

const NOW = "2026-09-04T04:00:00.000Z";

const node = ({ id, movedIso = "2026-09-01T00:00:00.000Z" }: { id: string; movedIso?: string }): FootprintNode => ({
  asksForSomething: false,
  entities: new Set<string>(),
  hasDependentStep: false,
  hasResolution: false,
  id,
  label: id,
  lastMovedIso: movedIso,
  ownerSpokeLast: true,
  provenance: { kind: "board", slug: id },
});

describe("composeBrief", () => {
  it("counts every node into exactly one status bucket", () => {
    const brief = composeBrief({
      ledger: foldLedger({ events: [] }),
      nodes: [node({ id: "a" }), node({ id: "b", movedIso: "2026-09-04T03:00:00.000Z" })],
      nowIso: NOW,
    });
    const total = Object.values(brief.statusCounts).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(2);
    expect(brief.statusCounts["status-check"]).toBe(1);
    expect(brief.statusCounts.moving).toBe(1);
  });

  it("holds an already-assigned node OUT of the set a session may re-group", () => {
    const brief = composeBrief({
      ledger: foldLedger({
        events: [{ atIso: NOW, by: "owner", kind: "assigned", nodeId: "a", workstreamId: "w1" }],
      }),
      nodes: [node({ id: "a" }), node({ id: "b" })],
      nowIso: NOW,
    });

    expect(brief.unassigned.map((entry) => entry.node.id)).toEqual(["b"]);
    expect(brief.alreadyAssigned.map((entry) => entry.node.id)).toEqual(["a"]);
  });

  it("offers an unassigned node back for re-grouping instead of holding it out forever", () => {
    const brief = composeBrief({
      ledger: foldLedger({
        events: [
          { atIso: NOW, by: "owner", kind: "assigned", nodeId: "a", workstreamId: "w1" },
          { atIso: NOW, kind: "unassigned", nodeId: "a", workstreamId: "w1" },
        ],
      }),
      nodes: [node({ id: "a" }), node({ id: "b" })],
      nowIso: NOW,
    });

    expect(brief.unassigned.map((entry) => entry.node.id)).toEqual(["a", "b"]);
    expect(brief.alreadyAssigned).toEqual([]);
    expect(brief.nodes[0]!.workstreamId).toBeUndefined();
  });

  it("carries the workstream an assigned node belongs to", () => {
    const brief = composeBrief({
      ledger: foldLedger({
        events: [{ atIso: NOW, by: "owner", kind: "assigned", nodeId: "a", workstreamId: "w1" }],
      }),
      nodes: [node({ id: "a" })],
      nowIso: NOW,
    });

    expect(brief.alreadyAssigned[0]!.workstreamId).toBe("w1");
  });

  it("proposes on everything when the ledger is empty", () => {
    const brief = composeBrief({
      ledger: foldLedger({ events: [] }),
      nodes: [node({ id: "a" }), node({ id: "b" })],
      nowIso: NOW,
    });

    expect(brief.unassigned.length).toBe(2);
    expect(brief.alreadyAssigned).toEqual([]);
  });

  it("gives every node a component, singletons included", () => {
    const brief = composeBrief({
      ledger: foldLedger({ events: [] }),
      nodes: [node({ id: "a" }), node({ id: "b" })],
      nowIso: NOW,
    });

    expect(brief.components.length).toBe(2);
  });

  it("records the instant it judged at, so a reader can weigh the clock", () => {
    const brief = composeBrief({ ledger: foldLedger({ events: [] }), nodes: [], nowIso: NOW });

    expect(brief.nowIso).toBe(NOW);
  });

  it("answers an empty scan without inventing anything", () => {
    const brief = composeBrief({ ledger: foldLedger({ events: [] }), nodes: [], nowIso: NOW });

    expect(brief.nodes).toEqual([]);
    expect(brief.statusCounts["awaiting-decision"]).toBe(0);
  });
});
