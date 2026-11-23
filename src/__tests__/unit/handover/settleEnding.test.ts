import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { NO_RUN, type RunEvent, type RunState } from "../../../handover/ledger.js";
import {
  alreadySettledRefusalLines,
  releasedCycleEnding,
  releasedCycleMoved,
  releasedCycleOf,
  settleReapedLines,
  settleRunResidue,
  settleRunResidueLines,
} from "../../../handover/settleEnding.js";

const run = (over: Partial<RunState> = {}): RunState => ({ ...NO_RUN, ...over });

const rowText = ({ extra }: { extra: readonly string[] }): string =>
  [
    "---",
    "slug: some-ask",
    "kind: ask",
    'summary: "an ask"',
    "status: ready",
    "askedIso: 2026-09-07T00:00:00Z",
    ...extra,
    "blockedBy: []",
    "artifact: null",
    "doneWhen: []",
    "---",
    "",
    "# an ask",
    "",
  ].join("\n");

const row = ({ extra }: { extra: readonly string[] }) =>
  parseHandoverDoc({ path: "/h/some-ask.md", text: rowText({ extra }) });

describe("settleRunResidue", () => {
  it("owes nothing when no cycle was ever opened, so a bookkeeping settle stays quiet", () => {
    expect(settleRunResidue({ run: NO_RUN })).toEqual({ kind: "never-started" });
  });

  it("owes nothing when the cycle already ended", () => {
    expect(settleRunResidue({ run: run({ entries: 4, phase: "closed" }) })).toEqual({ kind: "run-closed" });
  });

  it("reports an OPEN run — the state `session close-done` refuses to reap", () => {
    expect(settleRunResidue({ run: run({ entries: 3, phase: "open" }) })).toEqual({ kind: "open" });
  });

  it("carries the unanswered question, because settle clears neither it nor the run", () => {
    const residue = settleRunResidue({
      run: run({ entries: 3, openQuestion: "which base?", phase: "waiting-on-owner" }),
    });

    expect(residue).toEqual({ kind: "waiting-on-owner", question: "which base?" });
  });

  it("says the question is not on the journal rather than printing undefined", () => {
    const residue = settleRunResidue({ run: run({ entries: 3, phase: "waiting-on-owner" }) });

    expect(residue).toEqual({ kind: "waiting-on-owner", question: "the question is not on the journal" });
  });
});

describe("settleRunResidueLines", () => {
  it("prints nothing for a run that never started", () => {
    expect(settleRunResidueLines({ residue: { kind: "never-started" }, slug: "some-ask" })).toEqual([]);
  });

  it("prints nothing for a run that already ended", () => {
    expect(settleRunResidueLines({ residue: { kind: "run-closed" }, slug: "some-ask" })).toEqual([]);
  });

  it("names `handover finish` and why it matters when the run is open", () => {
    const lines = settleRunResidueLines({ residue: { kind: "open" }, slug: "some-ask" });

    expect(lines.join("\n")).toContain("slopweaver handover finish some-ask");
    expect(lines.join("\n")).toContain("session close-done");
    expect(lines.join("\n")).toContain("slopweaver handover\n  abandon some-ask");
  });

  it("puts `handover answer` before `handover finish` when a question is open", () => {
    const joined = settleRunResidueLines({
      residue: { kind: "waiting-on-owner", question: "which base?" },
      slug: "some-ask",
    }).join("\n");

    expect(joined).toContain('WAITING ON THE OWNER: "which base?"');
    expect(joined.indexOf("handover answer some-ask")).toBeLessThan(joined.indexOf("handover finish some-ask"));
    expect(joined).toContain("clears neither the question nor the run");
  });
});

describe("alreadySettledRefusalLines", () => {
  it("is undefined for an unsettled row, so settle may proceed", () => {
    expect(alreadySettledRefusalLines({ doc: row({ extra: [] }) })).toBeUndefined();
  });

  it("names the FIELD, so the ask row's settlement cannot be read as the run's `answered` event", () => {
    const lines = alreadySettledRefusalLines({
      doc: row({ extra: ["settlement: answered", "settlementWitness: https://example.invalid/p1"] }),
    });

    expect(lines!.join("\n")).toContain("already carries `settlement: answered`");
    expect(lines!.join("\n")).toContain("witness: https://example.invalid/p1");
    expect(lines!.join("\n")).toContain("not the run's `answered` event");
    expect(lines!.join("\n")).toContain("`slopweaver handover resume some-ask` shows whether it is still open");
    expect(lines!.join("\n")).not.toContain("handover finish");
  });

  it("says no witness was recorded rather than printing undefined", () => {
    const lines = alreadySettledRefusalLines({ doc: row({ extra: ["settlement: filed"] }) });

    expect(lines![0]).toBe("some-ask already carries `settlement: filed` (witness: none recorded)");
  });
});

describe("settleReapedLines", () => {
  it("names the dead session, the event written and that nothing is left to claim", () => {
    const lines = settleReapedLines({
      deadSessionId: "1145d148",
      lastEventIso: "2026-09-04T21:52:38.002Z",
      slug: "nx-cloud-atlas",
    });

    expect(lines).toEqual([
      "  The RUN for nx-cloud-atlas was held by session 1145d148, which is DEAD (last event 2026-09-04T21:52:38.002Z) and can",
      "  never finish it — so settle appended the `orphaned` ending `slopweaver handover reap` writes. Nothing is",
      "  left to claim.",
    ]);
  });
});

describe("releasedCycleOf and releasedCycleMoved", () => {
  const STARTED: RunEvent = { atIso: "2026-10-04T20:47:23.229Z", branch: "b", docHash: "h", kind: "started" };
  const LAUNCHED: RunEvent = {
    atIso: "2026-10-04T20:47:23.229Z",
    kind: "launched",
    pid: 1,
    sessionId: "seat",
    worktree: "/w",
  };
  const PARKED: RunEvent = {
    atIso: "2026-10-04T21:31:15.422Z",
    branch: "b",
    kind: "parked",
    screenTail: "",
    sessionId: "seat",
    workspaceRef: "workspace:357",
    worktree: "/w",
  };
  const CLAIMED: RunEvent = {
    atIso: "2026-10-05T00:00:00.000Z",
    host: "claude-code",
    kind: "claimed",
    pid: 2,
    sessionId: "reseat",
    why: "reseated",
    worktree: "/w",
  };
  const DECIDED = { journalEvents: 3, releasedAtIso: PARKED.atIso, releasedBy: "seat" };

  it("reads the parked cycle as released by the seat that parked it", () => {
    expect(releasedCycleOf({ events: [STARTED, LAUNCHED, PARKED] })).toEqual(DECIDED);
  });

  it("reads a held run as not released", () => {
    expect(releasedCycleOf({ events: [STARTED, LAUNCHED] })).toBeUndefined();
  });

  it("lets the ending through while the cycle is still the one decided about", () => {
    expect(
      releasedCycleMoved({ decided: DECIDED, events: [STARTED, LAUNCHED, PARKED], unreadable: [] }),
    ).toBeUndefined();
  });

  it("refuses once a reseat claimed the run after the decision — the counterexample", () => {
    expect(releasedCycleMoved({ decided: DECIDED, events: [STARTED, LAUNCHED, PARKED, CLAIMED], unreadable: [] })).toBe(
      "the run is no longer released and open — somebody claimed or ended it since settle looked",
    );
  });

  it("refuses a claim and re-park by the same seat, which only the count can see", () => {
    const retaken: RunEvent = { ...CLAIMED, sessionId: "seat" };
    expect(
      releasedCycleMoved({ decided: DECIDED, events: [STARTED, LAUNCHED, PARKED, retaken, PARKED], unreadable: [] }),
    ).toBe("the journal now holds 5 event(s), not the 3 settle decided over");
  });

  it("refuses a claim then a fresh cycle re-parked at the same instant, which rebuilds the decided cycle", () => {
    const restarted: RunEvent = { ...STARTED, atIso: "2026-10-05T01:00:00.000Z" };
    expect(
      releasedCycleMoved({
        decided: DECIDED,
        events: [STARTED, LAUNCHED, PARKED, CLAIMED, restarted, LAUNCHED, PARKED],
        unreadable: [],
      }),
    ).toBe("the journal now holds 7 event(s), not the 3 settle decided over");
  });

  it("refuses over an undecodable line, which could be the claim", () => {
    expect(releasedCycleMoved({ decided: DECIDED, events: [STARTED, LAUNCHED, PARKED], unreadable: [3] })).toBe(
      "the journal has undecodable line(s) 3, so whether anyone claimed the run cannot be checked",
    );
  });
});

describe("releasedCycleEnding", () => {
  const AT = "2026-10-21T02:00:00.000Z";

  it("finishes the cycle of a filed row, because filed derives done and `abandoned` contradicts done", () => {
    expect(releasedCycleEnding({ atIso: AT, reason: undefined, settlement: "filed", witness: "other-row" })).toEqual({
      atIso: AT,
      kind: "finished",
      residue: [],
    });
  });

  it("abandons a declined row's cycle with the witness alone when no reason was given", () => {
    expect(releasedCycleEnding({ atIso: AT, reason: undefined, settlement: "declined", witness: "w-1" })).toEqual({
      atIso: AT,
      kind: "abandoned",
      why: "the row was settled declined (witness: w-1)",
    });
  });
});
