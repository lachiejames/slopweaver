/**
 * What a journal says about a run's drive, and whether its work is complete.
 *
 * These are pure journal-derivation rules, kept apart from any decision about what to do next — that decision
 * engine (launch/resume/stop a headless turn) is gone along with the fleet driver it served. What remains here
 * is read by `fleet status` and by the overlap/claim gate, neither of which acts on it.
 */
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  answeredAfterEnding,
  type CompletionFacts,
  completionOf,
  driveStateOf,
  NO_DRIVE,
} from "../../../measurement/runState.js";

const DONE: CompletionFacts = {
  branchOnRemote: true,
  checks: "green",
  prOpen: true,
  probesFailing: 0,
  probesUnchecked: 0,
};

/** A launched drive at a known instant, so elapsed time is arithmetic rather than a clock read. */
const LAUNCHED: readonly RunEvent[] = [
  { atIso: "2026-08-05T00:00:00.000Z", branch: "feat/x", docHash: "abc", kind: "started" },
  { atIso: "2026-08-05T00:00:01.000Z", kind: "launched", pid: 999, sessionId: "s-1", worktree: "/tmp/wt" },
];

/** That drive ending — what a deliberate stop writes, and what the loop writes when it stops on a question. */
const ENDED: readonly RunEvent[] = [
  { atIso: "2026-08-05T00:10:00.000Z", attempts: 1, kind: "drive-ended", why: "waiting on the owner" },
];

/** The owner settling it afterwards, which is the whole loop this file's rules exist to close. */
const ANSWERED: readonly RunEvent[] = [
  { answer: "yes, transfer it", atIso: "2026-08-05T00:20:00.000Z", kind: "answered" },
];

describe("completionOf", () => {
  it("is complete only when every condition holds", () => {
    const completion = completionOf({ facts: DONE });

    expect(completion.complete).toBe(true);
    expect(completion.missing).toEqual([]);
  });

  it("names an unpushed branch", () => {
    expect(completionOf({ facts: { ...DONE, branchOnRemote: false } }).missing).toEqual([
      "the branch is not on the remote",
    ]);
  });

  it("names a missing pull request", () => {
    expect(completionOf({ facts: { ...DONE, prOpen: false } }).missing).toEqual(["no pull request is open for it"]);
  });

  it("counts failing probes", () => {
    expect(completionOf({ facts: { ...DONE, probesFailing: 2 } }).missing).toEqual(["2 declared probe(s) still fail"]);
  });

  it("refuses to call a doc done when a probe was never examined", () => {
    const completion = completionOf({ facts: { ...DONE, probesUnchecked: 1 } });

    expect(completion.complete).toBe(false);
    expect(completion.missing).toEqual(["1 declared probe(s) were never examined"]);
  });

  it("treats failing checks as incomplete", () => {
    expect(completionOf({ facts: { ...DONE, checks: "failing" } }).missing).toEqual([
      "the pull request's checks are failing",
    ]);
  });

  it("treats pending checks as incomplete — not-yet-green is not green", () => {
    expect(completionOf({ facts: { ...DONE, checks: "pending" } }).missing).toEqual([
      "the pull request's checks have not finished",
    ]);
  });

  it("treats a rollup it could not read as incomplete", () => {
    expect(completionOf({ facts: { ...DONE, checks: "unknown" } }).missing).toEqual([
      "the pull request's check rollup could not be read",
    ]);
  });

  it("treats a pull request with no checks at all as incomplete", () => {
    expect(completionOf({ facts: { ...DONE, checks: "none" } }).missing).toEqual([
      "the pull request reports no checks at all",
    ]);
  });

  it("reports every unmet condition at once rather than the first", () => {
    const completion = completionOf({
      facts: { branchOnRemote: false, checks: "failing", prOpen: false, probesFailing: 1, probesUnchecked: 1 },
    });

    expect(completion.missing).toHaveLength(5);
  });
});

describe("driveStateOf", () => {
  it("reports no drive for a journal that never launched", () => {
    expect(driveStateOf({ events: [LAUNCHED[0]!] })).toEqual(NO_DRIVE);
  });

  it("reads the session, pid and worktree off the launch", () => {
    const state = driveStateOf({ events: LAUNCHED });

    expect(state.sessionId).toBe("s-1");
    expect(state.pid).toBe(999);
    expect(state.worktree).toBe("/tmp/wt");
    expect(state.attempts).toBe(1);
    expect(state.launchedIso).toBe("2026-08-05T00:00:01.000Z");
  });

  it("counts a resume as another attempt", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:10:00.000Z", attempt: 2, kind: "resumed", pid: 1000, sessionId: "s-1" },
      ],
    });

    expect(state.attempts).toBe(2);
  });

  it("takes the pid from the RESUME, because a resume spawns a new process and the launch pid is dead", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:10:00.000Z", attempt: 2, kind: "resumed", pid: 1000, sessionId: "s-1" },
        { atIso: "2026-08-05T00:20:00.000Z", attempt: 3, kind: "resumed", pid: 1001, sessionId: "s-1" },
      ],
    });

    expect(state.pid).toBe(1001);
    expect(state.pidIsCurrentTurn).toBe(true);
  });

  it("keeps the launch pid but marks it NOT current when a resume recorded none", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:10:00.000Z", attempt: 2, kind: "resumed", pid: undefined, sessionId: "s-1" },
      ],
    });

    expect(state.pid).toBe(999);
    expect(state.pidIsCurrentTurn).toBe(false);
  });

  it("recovers currency once a later resume does record its pid", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:10:00.000Z", attempt: 2, kind: "resumed", pid: undefined, sessionId: "s-1" },
        { atIso: "2026-08-05T00:20:00.000Z", attempt: 3, kind: "resumed", pid: 1001, sessionId: "s-1" },
      ],
    });

    expect(state.pid).toBe(1001);
    expect(state.pidIsCurrentTurn).toBe(true);
  });

  it("calls a fresh launch's pid current, since the launch IS the turn", () => {
    const state = driveStateOf({ events: LAUNCHED });

    expect(state.pidIsCurrentTurn).toBe(true);
  });

  it("reads only the MOST RECENT launch, so a second drive does not inherit the first's attempts", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:10:00.000Z", attempt: 2, kind: "resumed", pid: 1000, sessionId: "s-1" },
        { atIso: "2026-08-05T00:20:00.000Z", attempts: 2, kind: "drive-ended", why: "bored" },
        { atIso: "2026-08-05T01:00:00.000Z", kind: "launched", pid: 1000, sessionId: "s-2", worktree: "/tmp/wt" },
      ],
    });

    expect(state.attempts).toBe(1);
    expect(state.sessionId).toBe("s-2");
    expect(state.ended).toBe(false);
  });

  it("marks a drive ended once `drive-ended` is journalled", () => {
    const state = driveStateOf({
      events: [...LAUNCHED, { atIso: "2026-08-05T00:05:00.000Z", attempts: 1, kind: "drive-ended", why: "stopped" }],
    });

    expect(state.ended).toBe(true);
    expect(state.endedIso).toBe("2026-08-05T00:05:00.000Z");
  });

  it("RELEASES the ending when the owner answers after it, and ends that drive's accounting", () => {
    const state = driveStateOf({ events: [...LAUNCHED, ...ENDED, ...ANSWERED] });

    expect(state.ended).toBe(false);
    expect(state.releasedByAnswer).toBe("yes, transfer it");
    expect(state.endedIso).toBeUndefined();
    // Both bounds start again, and the session goes, so the next turn is a fresh LAUNCH rather than a resume of a
    // drive whose 1-turn budget was already spent hours ago.
    expect(state.attempts).toBe(0);
    expect(state.launchedIso).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
  });

  it("keeps the worktree across a release, because that is where the previous drive's commits are", () => {
    expect(driveStateOf({ events: [...LAUNCHED, ...ENDED, ...ANSWERED] }).worktree).toBe("/tmp/wt");
  });

  it("keeps a drive stopped when a `drive-ended` is written AFTER the answer — a deliberate stop still wins", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        ...ENDED,
        ...ANSWERED,
        { atIso: "2026-08-05T00:30:00.000Z", attempts: 0, kind: "drive-ended", why: "changed my mind" },
      ],
    });

    expect(state.ended).toBe(true);
    expect(state.releasedByAnswer).toBeUndefined();
  });

  it("does not release an ending on an answer stamped BEFORE it", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { answer: "an older answer", atIso: "2026-08-05T00:02:00.000Z", kind: "answered" },
        ...ENDED,
      ],
    });

    expect(state.ended).toBe(true);
    expect(state.releasedByAnswer).toBeUndefined();
  });

  it("does NOT release an ended drive on a ruling — recording what the owner decided is not answering a question", () => {
    const ruled = driveStateOf({
      events: [
        ...LAUNCHED,
        ...ENDED,
        {
          anchor: "https://example.invalid/p9",
          atIso: "2026-08-05T00:10:00.000Z",
          decidedIso: "2026-08-05T00:10:00.000Z",
          kind: "ruling",
          ruling: "yes, transfer it",
        },
      ],
    });

    expect(ruled).toEqual(driveStateOf({ events: [...LAUNCHED, ...ENDED] }));
  });

  it("leaves a live drive alone when an answer arrives with no ending to release", () => {
    const state = driveStateOf({ events: [...LAUNCHED, ...ANSWERED] });

    expect(state.ended).toBe(false);
    expect(state.releasedByAnswer).toBeUndefined();
    expect(state.attempts).toBe(1);
    expect(state.sessionId).toBe("s-1");
  });

  it("counts a `said` with no matching `delivered` as undelivered", () => {
    const state = driveStateOf({
      events: [...LAUNCHED, { atIso: "2026-08-05T00:02:00.000Z", kind: "said", message: "hi" }],
    });

    expect(state.undelivered).toBe(1);
  });

  it("clears the undelivered count when the driver hands the messages over", () => {
    const state = driveStateOf({
      events: [
        ...LAUNCHED,
        { atIso: "2026-08-05T00:02:00.000Z", kind: "said", message: "one" },
        { atIso: "2026-08-05T00:03:00.000Z", kind: "said", message: "two" },
        { atIso: "2026-08-05T00:04:00.000Z", count: 2, kind: "delivered" },
      ],
    });

    expect(state.undelivered).toBe(0);
  });

  it("floors the undelivered count at zero rather than reporting a negative", () => {
    const state = driveStateOf({
      events: [...LAUNCHED, { atIso: "2026-08-05T00:04:00.000Z", count: 9, kind: "delivered" }],
    });

    expect(state.undelivered).toBe(0);
  });
});

describe("answeredAfterEnding", () => {
  it("releases the ending when the answer is strictly later", () => {
    expect(answeredAfterEnding({ answeredIso: "2026-08-05T00:20:00.000Z", endedIso: "2026-08-05T00:10:00.000Z" })).toBe(
      true,
    );
  });

  it("does not release on an answer stamped earlier", () => {
    expect(answeredAfterEnding({ answeredIso: "2026-08-05T00:01:00.000Z", endedIso: "2026-08-05T00:10:00.000Z" })).toBe(
      false,
    );
  });

  it("does not release on a TIE — an ambiguous stop stays stopped", () => {
    expect(answeredAfterEnding({ answeredIso: "2026-08-05T00:10:00.000Z", endedIso: "2026-08-05T00:10:00.000Z" })).toBe(
      false,
    );
  });

  it("has nothing to release when no ending was recorded", () => {
    expect(answeredAfterEnding({ answeredIso: "2026-08-05T00:20:00.000Z", endedIso: undefined })).toBe(false);
  });

  it("has nothing to release when nobody has answered", () => {
    expect(answeredAfterEnding({ answeredIso: undefined, endedIso: "2026-08-05T00:10:00.000Z" })).toBe(false);
  });

  it("refuses to release on a stamp it cannot parse, rather than guessing which came first", () => {
    expect(answeredAfterEnding({ answeredIso: "later, honest", endedIso: "2026-08-05T00:10:00.000Z" })).toBe(false);
    expect(answeredAfterEnding({ answeredIso: "2026-08-05T00:20:00.000Z", endedIso: "whenever" })).toBe(false);
  });
});
