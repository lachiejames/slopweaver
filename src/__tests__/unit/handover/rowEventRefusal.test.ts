/**
 * The write door's pure judgements, called over a journal as read — no file, no clock. The `rowEvent/` tests
 * drive the same rules through `applyRowEvent`'s round trip; this pins the two exports directly, the caller's
 * precondition included, so a refusal is read off the function that decides it.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { evidenceRefusal, transitionRefusal } from "../../../handover/rowEventRefusal.js";

const AT = "2026-10-20T01:00:00.000Z";
const LATER = "2026-10-20T02:00:00.000Z";

const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc123", kind: "started" };
const FINISHED: RunEvent = { atIso: LATER, kind: "finished", residue: [] };
const TAGGED: RunEvent = {
  atIso: LATER,
  drop: [],
  kind: "tagged",
  set: [{ key: "impact", value: "high" }],
  why: "a test",
};

describe("transitionRefusal", () => {
  it("lets an ending onto an open cycle through when no precondition is passed", () => {
    expect(
      transitionRefusal({ event: FINISHED, events: [STARTED], precondition: undefined, unreadable: [] }),
    ).toBeUndefined();
  });

  it("refuses a second ending on one cycle, naming the ending already there", () => {
    const refused = transitionRefusal({
      event: { atIso: LATER, kind: "abandoned", why: "changed my mind" },
      events: [STARTED, FINISHED],
      precondition: undefined,
      unreadable: [],
    });
    expect(refused!.code).toBe("FORBIDDEN_TRANSITION");
    expect(refused!.message).toBe(
      `refusing to record "abandoned" on a run that is closed — this cycle already ended "finished" at ${LATER}; start a new run rather than recording a second ending`,
    );
  });

  it("refuses with the caller's precondition reason, judged over the same read it was handed", () => {
    const seen: { events: readonly RunEvent[]; unreadable: readonly number[] }[] = [];
    const refused = transitionRefusal({
      event: FINISHED,
      events: [STARTED],
      precondition: (read) => {
        seen.push(read);
        return "a reseat claimed the cycle since";
      },
      unreadable: [],
    });
    expect(refused!.message).toBe(
      `refusing to record "finished" on a run that is open — a reseat claimed the cycle since`,
    );
    expect(seen).toEqual([{ events: [STARTED], unreadable: [] }]);
  });

  it("never asks the precondition when the cycle's own rules already refuse", () => {
    const seen: string[] = [];
    transitionRefusal({
      event: FINISHED,
      events: [STARTED, FINISHED],
      precondition: () => {
        seen.push("asked");
        return undefined;
      },
      unreadable: [],
    });
    expect(seen).toEqual([]);
  });

  it("refuses an orphaned ending over undecodable lines, naming them", () => {
    const refused = transitionRefusal({
      event: { atIso: LATER, cycleEvents: 1, deadSessionId: "session-a", kind: "orphaned", lastEventIso: AT },
      events: [STARTED],
      precondition: undefined,
      unreadable: [2, 4],
    });
    expect(refused!.message).toBe(
      `refusing to record "orphaned" on a run that is open — the journal has undecodable line(s) 2, 4, so what this ending claims about the cycle cannot be checked`,
    );
  });
});

describe("evidenceRefusal", () => {
  it("refuses a tag onto a journal with an undecodable line", () => {
    const refused = evidenceRefusal({ event: TAGGED, events: [STARTED], unreadable: [2] });
    expect(refused!.code).toBe("JOURNAL_INCOMPLETE");
    expect(refused!.message).toBe(
      "refusing to record a tag on a journal with undecodable line(s) 2 — one of them could be a tag this write repeats or contradicts",
    );
  });

  it("lets a tag through when every line decoded", () => {
    expect(evidenceRefusal({ event: TAGGED, events: [STARTED], unreadable: [] })).toBeUndefined();
  });

  it("has nothing to say about an ending, whose rules are the transition's", () => {
    expect(evidenceRefusal({ event: FINISHED, events: [STARTED], unreadable: [3] })).toBeUndefined();
  });
});
