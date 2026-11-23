/**
 * The milestone graph a workstream's page draws, derived from the milestones and entries the store holds. What makes
 * a graph incoherent (a repeat, a cycle, an entry tagging nothing declared) is the store's to refuse, and
 * `./store/validation.test.ts` proves it; this file proves only what a coherent graph derives to.
 */
import { describe, expect, it } from "vitest";

import { deriveMilestoneGraph } from "../../../workstreams/milestoneGraph.js";
import type { WorkstreamEntry, WorkstreamMilestone } from "../../../workstreams/store/types.js";

/** The shape the owner described: acceptance and the evidence side by side, the audit after acceptance. */
const AUDIT: readonly WorkstreamMilestone[] = [
  { after: [], anchor: "talk-call:a#acceptance", id: "policy-acceptance", name: "Policy acceptance", position: 0 },
  { after: ["policy-acceptance"], anchor: "talk-call:a#audit", id: "acme-audit", name: "Acme audit", position: 1 },
  { after: [], anchor: "talk-call:a#evidence", id: "evidence", name: "Policy docs and evidence", position: 2 },
];

/**
 * One dated entry, defaults filled.
 *
 * @param milestoneId the milestone it moves, or `null` for none
 * @param done whether it finishes that milestone
 * @returns the entry
 */
function entry({
  date,
  done = false,
  href = null,
  milestoneId,
  position,
}: {
  date: string;
  done?: boolean;
  href?: string | null;
  milestoneId: string | null;
  position: number;
}): WorkstreamEntry {
  return {
    date,
    done,
    href,
    id: `00000000-0000-4000-8000-00000000000${position}`,
    kind: "note",
    milestoneId,
    position,
    text: "moved",
  };
}

describe("deriveMilestoneGraph", () => {
  it("puts two milestones that come after nothing in one column and the one after them in the next", () => {
    const graph = deriveMilestoneGraph({ entries: [], milestones: AUDIT });
    expect(graph.columns).toBe(2);
    expect(graph.milestones.map((node) => [node.id, node.column, node.state])).toEqual([
      ["policy-acceptance", 0, "ready"],
      ["acme-audit", 1, "waiting"],
      ["evidence", 0, "ready"],
    ]);
    expect(graph.milestones[1]!.waitingFor).toEqual(["Policy acceptance"]);
  });

  it("reads moving and done off the entries that tag each milestone, and frees the one waiting on a done one", () => {
    const graph = deriveMilestoneGraph({
      entries: [
        entry({
          date: "2026-10-05",
          done: true,
          href: "https://example.test/accepted",
          milestoneId: "policy-acceptance",
          position: 0,
        }),
        entry({ date: "2026-09-20", milestoneId: "policy-acceptance", position: 1 }),
        entry({ date: "2026-09-25", milestoneId: "evidence", position: 2 }),
        entry({ date: "2026-09-26", milestoneId: null, position: 3 }),
      ],
      milestones: AUDIT,
    });
    const [acceptance, audit, evidence] = graph.milestones;
    expect(acceptance).toEqual({
      after: [],
      anchor: "talk-call:a#acceptance",
      column: 0,
      doneOn: "2026-10-05",
      href: "https://example.test/accepted",
      id: "policy-acceptance",
      lastMovedOn: "2026-10-05",
      name: "Policy acceptance",
      startedOn: "2026-09-20",
      state: "done",
      waitingFor: [],
    });
    expect([audit!.state, audit!.waitingFor]).toEqual(["ready", []]);
    expect([evidence!.state, evidence!.startedOn, evidence!.doneOn]).toEqual(["moving", "2026-09-25", null]);
  });

  it("lists milestones by position, whatever order the store returned them in", () => {
    const graph = deriveMilestoneGraph({ entries: [], milestones: AUDIT.toReversed() });
    expect(graph.milestones.map((node) => node.id)).toEqual(["policy-acceptance", "acme-audit", "evidence"]);
  });

  it("columns by the LONGEST chain, so a milestone after a deep one and a shallow one sits past both", () => {
    const graph = deriveMilestoneGraph({
      entries: [],
      milestones: [
        { after: [], anchor: "x", id: "a", name: "A", position: 0 },
        { after: ["a"], anchor: "x", id: "b", name: "B", position: 1 },
        { after: ["a", "b"], anchor: "x", id: "c", name: "C", position: 2 },
      ],
    });
    expect([graph.milestones.map((node) => node.column), graph.columns]).toEqual([[0, 1, 2], 3]);
  });

  it("is empty for a workstream that declares none", () => {
    expect(deriveMilestoneGraph({ entries: [], milestones: [] })).toEqual({ columns: 0, milestones: [] });
  });
});

describe("deriveMilestoneGraph, reading entries", () => {
  it("dates a moving milestone from its earliest and latest entry, whatever order the entries arrive in", () => {
    const graph = deriveMilestoneGraph({
      entries: [
        entry({ date: "2026-09-30", milestoneId: "evidence", position: 0 }),
        entry({ date: "2026-09-12", milestoneId: "evidence", position: 1 }),
        entry({ date: "2026-09-21", milestoneId: "evidence", position: 2 }),
      ],
      milestones: AUDIT,
    });
    const evidence = graph.milestones.find((node) => node.id === "evidence")!;
    expect(evidence.state).toBe("moving");
    expect(evidence.startedOn).toBe("2026-09-12");
    expect(evidence.lastMovedOn).toBe("2026-09-30");
    expect(evidence.doneOn).toBe(null);
    expect(evidence.href).toBe(null);
  });

  it("takes the first finishing entry as the done date and its link, and ignores a later finisher", () => {
    const graph = deriveMilestoneGraph({
      entries: [
        entry({
          date: "2026-10-09",
          done: true,
          href: "https://example.test/later",
          milestoneId: "evidence",
          position: 0,
        }),
        entry({
          date: "2026-10-03",
          done: true,
          href: "https://example.test/first",
          milestoneId: "evidence",
          position: 1,
        }),
      ],
      milestones: AUDIT,
    });
    const evidence = graph.milestones.find((node) => node.id === "evidence")!;
    expect(evidence.state).toBe("done");
    expect(evidence.doneOn).toBe("2026-10-03");
    expect(evidence.href).toBe("https://example.test/first");
    expect(evidence.lastMovedOn).toBe("2026-10-09");
  });

  it("settles two finishers on one date by their position", () => {
    const graph = deriveMilestoneGraph({
      entries: [
        entry({ date: "2026-10-03", done: true, href: "https://example.test/b", milestoneId: "evidence", position: 4 }),
        entry({ date: "2026-10-03", done: true, href: "https://example.test/a", milestoneId: "evidence", position: 2 }),
      ],
      milestones: AUDIT,
    });
    expect(graph.milestones.find((node) => node.id === "evidence")!.href).toBe("https://example.test/a");
  });

  it("moves no milestone for an entry that tags none", () => {
    const graph = deriveMilestoneGraph({
      entries: [entry({ date: "2026-10-03", milestoneId: null, position: 0 })],
      milestones: AUDIT,
    });
    expect(graph.milestones.map((node) => node.state)).toEqual(["ready", "waiting", "ready"]);
    expect(graph.milestones.map((node) => node.startedOn)).toEqual([null, null, null]);
  });

  it("keeps a successor waiting on a predecessor that is only moving, and names it", () => {
    const graph = deriveMilestoneGraph({
      entries: [entry({ date: "2026-10-03", milestoneId: "policy-acceptance", position: 0 })],
      milestones: AUDIT,
    });
    const audit = graph.milestones.find((node) => node.id === "acme-audit")!;
    expect(audit.state).toBe("waiting");
    expect(audit.waitingFor).toEqual(["Policy acceptance"]);
  });

  it("names only the predecessors not yet done, in declared order", () => {
    const graph = deriveMilestoneGraph({
      entries: [
        entry({ date: "2026-10-03", done: true, href: "https://example.test/a", milestoneId: "a", position: 0 }),
      ],
      milestones: [
        { after: [], anchor: "x", id: "a", name: "A", position: 0 },
        { after: [], anchor: "x", id: "b", name: "B", position: 1 },
        { after: [], anchor: "x", id: "d", name: "D", position: 2 },
        { after: ["d", "a", "b"], anchor: "x", id: "c", name: "C", position: 3 },
      ],
    });
    const last = graph.milestones.find((node) => node.id === "c")!;
    expect(last.waitingFor).toEqual(["D", "B"]);
    expect(last.column).toBe(1);
  });

  it("refuses to lay out a milestone that comes after one the workstream does not declare", () => {
    expect(() =>
      deriveMilestoneGraph({
        entries: [],
        milestones: [{ after: ["ghost"], anchor: "x", id: "a", name: "A", position: 0 }],
      }),
    ).toThrow("deriveMilestoneGraph: ghost is not declared; the store refuses that workstream on write");
  });

  it("ends on a cycle the store's cross-check missed instead of overflowing the stack", () => {
    const graph = deriveMilestoneGraph({
      entries: [],
      milestones: [
        { after: ["b"], anchor: "x", id: "a", name: "A", position: 0 },
        { after: ["a"], anchor: "x", id: "b", name: "B", position: 1 },
      ],
    });
    expect(graph.milestones.map((node) => node.column)).toEqual([2, 1]);
    expect(graph.columns).toBe(3);
  });
});
