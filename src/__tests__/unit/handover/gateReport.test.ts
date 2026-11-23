import { describe, expect, it } from "vitest";

import {
  anythingChecked,
  deltaLine,
  type GateObservation,
  lastGateObservation,
  NOTHING_CHECKED,
  progressSince,
  recheckTally,
  unmetOf,
} from "../../../handover/gateReport.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { Probe, ProbeOutcome, ProbeResult } from "../../../handover/probe.js";

const AT = "2026-08-06T02:00:00.000Z";
const LATER = "2026-08-06T03:00:00.000Z";
const PROBE: Probe = { file: "src/a.ts", kind: "present", symbol: "export" };
const STARTED: RunEvent = { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" };

/** One evaluated probe. */
function result({ outcome }: { outcome: ProbeOutcome }): ProbeResult {
  return { note: `note for ${outcome}`, outcome, probe: PROBE };
}

/** A recorded gate observation. */
function gated({
  passed,
  failed,
  head,
  atIso = AT,
  notEvaluated = 0,
}: {
  passed: number;
  failed: number;
  head: string | undefined;
  atIso?: string;
  notEvaluated?: number;
}): RunEvent {
  return { atIso, failed, head, kind: "gated", notEvaluated, passed, sessionId: "s" };
}

describe("recheckTally", () => {
  it("counts each outcome separately, keeping unexamined apart from failing", () => {
    const results = [
      result({ outcome: "pass" }),
      result({ outcome: "pass" }),
      result({ outcome: "fail" }),
      result({ outcome: "not-evaluated" }),
    ];

    expect(recheckTally({ results })).toEqual({ failed: 1, notEvaluated: 1, passed: 2 });
  });

  it("is all zeroes for a doc with no probes at all", () => {
    expect(recheckTally({ results: [] })).toEqual(NOTHING_CHECKED);
  });
});

describe("unmetOf", () => {
  /** The same rule `finish`'s residue uses: "nothing looked" is not evidence of doneness. */
  it("counts an unexamined probe as unmet, exactly as the residue does", () => {
    expect(unmetOf({ tally: { failed: 2, notEvaluated: 3, passed: 1 } })).toBe(5);
  });

  it("is zero when everything passed", () => {
    expect(unmetOf({ tally: { failed: 0, notEvaluated: 0, passed: 4 } })).toBe(0);
  });
});

describe("anythingChecked", () => {
  it("is false when every probe was declined or unreadable — blocking on that is blocking on ignorance", () => {
    expect(anythingChecked({ tally: { failed: 0, notEvaluated: 4, passed: 0 } })).toBe(false);
  });

  it("is false for a doc with no probes", () => {
    expect(anythingChecked({ tally: NOTHING_CHECKED })).toBe(false);
  });

  it("is true as soon as one probe returned an answer, in either direction", () => {
    expect(anythingChecked({ tally: { failed: 1, notEvaluated: 3, passed: 0 } })).toBe(true);
    expect(anythingChecked({ tally: { failed: 0, notEvaluated: 3, passed: 1 } })).toBe(true);
  });
});

describe("lastGateObservation", () => {
  it("is undefined when the gate has never looked at this run", () => {
    expect(lastGateObservation({ events: [STARTED] })).toBeUndefined();
  });

  it("reads back the tally and head the gate recorded", () => {
    const events = [STARTED, gated({ failed: 2, head: "abc1234def", passed: 1 })];

    expect(lastGateObservation({ events })).toEqual({
      atIso: AT,
      head: "abc1234def",
      tally: { failed: 2, notEvaluated: 0, passed: 1 },
    });
  });

  it("takes the LAST observation, so the delta is against the most recent firing", () => {
    const events = [
      STARTED,
      gated({ failed: 3, head: "aaa", passed: 0 }),
      gated({ atIso: LATER, failed: 1, head: "bbb", passed: 2 }),
    ];

    expect(lastGateObservation({ events })!.atIso).toBe(LATER);
  });

  /** A previous cycle's observations describe a run that has already ended. */
  it("ignores observations from a cycle that has already finished", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      gated({ failed: 3, head: "aaa", passed: 0 }),
      { atIso: LATER, kind: "finished", residue: [] },
      STARTED,
    ];

    expect(lastGateObservation({ events })).toBeUndefined();
  });
});

describe("progressSince", () => {
  const previous: GateObservation = {
    atIso: AT,
    head: "aaaaaaaaaaaa",
    tally: { failed: 2, notEvaluated: 0, passed: 1 },
  };

  it("is a first look when the gate has no baseline, which is the one case worth interrupting on no evidence", () => {
    expect(progressSince({ head: "aaaaaaaaaaaa", previous: undefined, tally: previous.tally })).toEqual({
      kind: "first-look",
    });
  });

  it("is static when neither the branch nor the tally moved", () => {
    expect(progressSince({ head: "aaaaaaaaaaaa", previous, tally: previous.tally })).toEqual({ kind: "static" });
  });

  /** A session can commit work that satisfies no declared probe, and calling that "no progress" reads as hostile. */
  it("counts a new commit as progress, and abbreviates both heads", () => {
    const progress = progressSince({ head: "bbbbbbbbbbbb", previous, tally: previous.tally });

    expect(progress).toEqual({ because: "the branch moved aaaaaaa → bbbbbbb", kind: "moved" });
  });

  it("counts an improved tally as progress even when the branch did not move", () => {
    const progress = progressSince({
      head: "aaaaaaaaaaaa",
      previous,
      tally: { failed: 0, notEvaluated: 0, passed: 3 },
    });

    expect(progress).toEqual({ because: "probes improved, 2 unmet → 0", kind: "moved" });
  });

  it("does not call a WORSENING tally progress", () => {
    const progress = progressSince({
      head: "aaaaaaaaaaaa",
      previous,
      tally: { failed: 3, notEvaluated: 0, passed: 0 },
    });

    expect(progress).toEqual({ kind: "static" });
  });

  /**
   * Both heads must be known for a difference to mean anything. An unreadable head compared against a recorded
   * one differs on every firing, which would silence the gate permanently on the strength of a git failure.
   */
  it("does not read an unreadable head as a moved branch", () => {
    expect(progressSince({ head: undefined, previous, tally: previous.tally })).toEqual({ kind: "static" });
  });

  it("does not read a previously-unreadable head as a moved branch either", () => {
    const noHead: GateObservation = { ...previous, head: undefined };

    expect(progressSince({ head: "bbbbbbbbbbbb", previous: noHead, tally: previous.tally })).toEqual({
      kind: "static",
    });
  });
});

describe("deltaLine", () => {
  const previous: GateObservation = {
    atIso: AT,
    head: "aaaaaaaaaaaa",
    tally: { failed: 2, notEvaluated: 0, passed: 1 },
  };

  it("announces a first look, where the present state IS the news", () => {
    const line = deltaLine({
      head: "aaaaaaaaaaaa",
      previous: undefined,
      slug: "my-doc",
      tally: { failed: 2, notEvaluated: 0, passed: 1 },
    });

    expect(line).toBe("my-doc — first look at this run: 2 of 3 probe(s) unmet (re-checked just now).");
  });

  /** The whole point: a gate that repeats itself nine times teaches the reader to skip the tenth. */
  it("states plainly that NOTHING changed, rather than restating the state as if it were new", () => {
    const line = deltaLine({ head: "aaaaaaaaaaaa", previous, slug: "my-doc", tally: previous.tally });

    expect(line).toBe(
      `my-doc — NOTHING has changed since ${AT}: still 2 of 3 probe(s) unmet (re-checked just now), ` +
        "branch still at aaaaaaa.",
    );
  });

  it("leads with what moved when something did", () => {
    const line = deltaLine({
      head: "aaaaaaaaaaaa",
      previous,
      slug: "my-doc",
      tally: { failed: 1, notEvaluated: 0, passed: 2 },
    });

    expect(line).toBe(`my-doc — since ${AT}: probes improved, 2 unmet → 1.`);
  });

  it("counts unexamined probes into the total it prints", () => {
    const line = deltaLine({
      head: undefined,
      previous: undefined,
      slug: "my-doc",
      tally: { failed: 1, notEvaluated: 2, passed: 3 },
    });

    expect(line).toBe("my-doc — first look at this run: 3 of 6 probe(s) unmet (re-checked just now).");
  });

  it("says the head is unknown rather than printing nothing where it should be", () => {
    const noHead: GateObservation = { ...previous, head: undefined };
    const line = deltaLine({ head: undefined, previous: noHead, slug: "my-doc", tally: previous.tally });

    expect(line).toContain("branch still at (unknown).");
  });
});
