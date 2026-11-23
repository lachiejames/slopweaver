/**
 * The three respawn gates — pure, so a refusal's exact sentence is assertable.
 */
import { describe, expect, it } from "vitest";

import {
  asksHoldingWorkers,
  confirmedRecordVerdict,
  loopUnmeasuredCause,
  type RespawnRequest,
  respawnVerdict,
  reusedWorktreeRefusal,
  successorArmVerdict,
} from "../../../../live/standing/respawn.js";

/** A request with every gate passing, overridable per test. */
function request(over: Partial<RespawnRequest> = {}): RespawnRequest {
  return {
    force: false,
    grade: "stale",
    heldBy: undefined,
    inFlight: 0,
    inFlightNoun: "ask(s)",
    session: "loop",
    unmeasured: undefined,
    ...over,
  };
}

describe("respawnVerdict", () => {
  it("respawns a stale, quiet session whose successor's run is free", () => {
    const verdict = respawnVerdict({ request: request() });

    expect(verdict.kind).toBe("respawn");
    expect(verdict.why).toBe("loop: STALE and quiet — retiring it and booting its successor on current main.");
  });

  it("refuses a session that is merely behind, and says how to override", () => {
    const verdict = respawnVerdict({ request: request({ grade: "behind" }) });

    expect(verdict.kind).toBe("not-owed");
    expect(verdict.why).toContain("--force");
  });

  it("refuses a current session", () => {
    expect(respawnVerdict({ request: request({ grade: "current" }) }).kind).toBe("not-owed");
  });

  it("refuses rather than guessing when freshness could not be measured", () => {
    const verdict = respawnVerdict({ request: request({ grade: undefined }) });

    expect(verdict.kind).toBe("busy");
    expect(verdict.why).toContain("UNKNOWN");
  });

  it("names the respawn already in flight rather than a read to fix, when the loop is between arms", () => {
    const verdict = respawnVerdict({
      request: request({
        grade: undefined,
        unmeasured: {
          bootedAtIso: "2026-10-14T13:57:25.935Z",
          kind: "respawn-in-flight",
          predecessorArmId: "0aaa37af",
          successor: "live-bot-loop-14oct-w",
        },
      }),
    });

    expect(verdict.kind).toBe("busy");
    expect(verdict.why).toBe(
      "loop: a respawn to live-bot-loop-14oct-w was booted 2026-10-14T13:57:25.935Z and remains " +
        "unconfirmed (predecessor arm 0aaa37af) — no listener is running, so the loop may be between arms and " +
        "there is nothing to measure. Run `slopweaver session respawn loop --confirm` once its arm is up. " +
        "Nothing was retired.",
    );
  });

  it("says the predecessor arm was not recorded when the unconfirmed boot carries none", () => {
    const verdict = respawnVerdict({
      request: request({
        grade: undefined,
        unmeasured: {
          bootedAtIso: "2026-10-14T13:57:25.935Z",
          kind: "respawn-in-flight",
          predecessorArmId: undefined,
          successor: "w",
        },
      }),
    });

    expect(verdict.why).toContain("remains unconfirmed (predecessor arm not recorded) —");
  });

  it("says the loop is not running, not that a read failed, when nothing is listening", () => {
    const verdict = respawnVerdict({ request: request({ grade: undefined, unmeasured: { kind: "no-listener" } }) });

    expect(verdict.kind).toBe("busy");
    expect(verdict.why).toBe(
      "loop: no listener is running, so there is no running loop to retire and nothing to measure. Nothing was retired.",
    );
  });

  it("keeps the fix-the-read sentence for a running listener no tree could be attributed to", () => {
    const fixTheRead =
      "loop: its freshness could not be measured at all, so whether a respawn is owed is UNKNOWN — refusing rather " +
      "than respawning on a guess. Fix the read, then retry.";

    expect(respawnVerdict({ request: request({ grade: undefined, unmeasured: { kind: "unattributed" } }) }).why).toBe(
      fixTheRead,
    );
    expect(respawnVerdict({ request: request({ grade: undefined }) }).why).toBe(fixTheRead);
  });

  it.each([
    { kind: "unattributed" },
    { kind: "no-listener" },
    { bootedAtIso: "2026-10-14T13:57:25.935Z", kind: "respawn-in-flight", predecessorArmId: undefined, successor: "w" },
  ] as const)("refuses an unmeasurable session even under --force, whatever the cause ($kind)", (unmeasured) => {
    expect(respawnVerdict({ request: request({ force: true, grade: undefined, unmeasured }) }).kind).toBe("busy");
  });

  it("refuses an unmeasurable session even under --force — a guess is not a grade", () => {
    expect(respawnVerdict({ request: request({ force: true, grade: undefined }) }).kind).toBe("busy");
  });

  it("refuses while work is in flight, naming the count and the noun", () => {
    const verdict = respawnVerdict({ request: request({ inFlight: 2 }) });

    expect(verdict.kind).toBe("busy");
    expect(verdict.why).toBe(
      "loop: a respawn IS owed (stale), but 2 ask(s) are still in flight — retry at your next quiet moment. Nothing was retired.",
    );
  });

  it("uses the singular verb for exactly one in-flight item", () => {
    expect(respawnVerdict({ request: request({ inFlight: 1 }) }).why).toContain("1 ask(s) is still in flight");
  });

  it("does NOT let --force override the quiet-moment gate", () => {
    expect(respawnVerdict({ request: request({ force: true, inFlight: 1 }) }).kind).toBe("busy");
  });

  it("refuses when a live session already holds the successor's run", () => {
    const verdict = respawnVerdict({ request: request({ heldBy: "session abc at /wt/x" }) });

    expect(verdict.kind).toBe("held");
    expect(verdict.why).toContain("session abc at /wt/x");
  });

  it("does NOT let --force override the held-run gate", () => {
    expect(respawnVerdict({ request: request({ force: true, heldBy: "session abc at /wt/x" }) }).kind).toBe("held");
  });

  it("checks the quiet gate before the held gate, so a busy session is told the cheaper fix first", () => {
    expect(respawnVerdict({ request: request({ heldBy: "session abc", inFlight: 3 }) }).kind).toBe("busy");
  });

  it("respawns a behind session under --force, and says that is why", () => {
    const verdict = respawnVerdict({ request: request({ force: true, grade: "behind" }) });

    expect(verdict.kind).toBe("respawn");
    expect(verdict.why).toBe("loop: --force — retiring and replacing it regardless of its behind grade.");
  });
});

/** One folded ask lifecycle row, only the fields the counter reads. */
function lifecycle(over: { activeDispatch?: unknown; channel?: string; messageTs?: string } = {}) {
  return { channel: "C1", messageTs: "1786937850.043319", ...over };
}

describe("asksHoldingWorkers", () => {
  const never = (): boolean => false;

  it("counts an ask still holding a dispatch", () => {
    expect(
      asksHoldingWorkers({ isIgnored: never, lifecycles: [lifecycle({ activeDispatch: { kind: "dispatched" } })] }),
    ).toBe(1);
  });

  it("does NOT count a lease-expired ask, which carries no dispatch at all", () => {
    expect(asksHoldingWorkers({ isIgnored: never, lifecycles: [lifecycle()] })).toBe(0);
  });

  // The shape measured live: two `lease-expired` rows and one ten-day-old `captured` row, none
  // of them holding a dispatch, which the previous register counted as three asks in flight forever. The
  // channels here are fictional on purpose — a real workspace id in a committed test is a leak class the
  // hygiene gate flags, and it caught this one.
  it("does NOT count the row shape that made this gate impossible to open", () => {
    const stale = [
      lifecycle({ channel: "CHANNELONE", messageTs: "1786644245.029049" }),
      lifecycle({ channel: "CHANNELTWO", messageTs: "1786935577.205539" }),
      lifecycle({ channel: "CHANNELTWO", messageTs: "1786937850.043319" }),
    ];

    expect(asksHoldingWorkers({ isIgnored: never, lifecycles: stale })).toBe(0);
  });

  it("skips an ask that is permanently ignored even while it holds a dispatch", () => {
    const held = [lifecycle({ activeDispatch: { kind: "dispatched" } })];

    expect(asksHoldingWorkers({ isIgnored: () => true, lifecycles: held })).toBe(0);
  });

  it("counts nothing for an empty lifecycle", () => {
    expect(asksHoldingWorkers({ isIgnored: never, lifecycles: [] })).toBe(0);
  });
});

describe("reusedWorktreeRefusal", () => {
  const base = "origin/main";

  it("allows a worktree that does not exist yet — a fresh one is cut from the remote", () => {
    expect(reusedWorktreeRefusal({ base, behind: undefined, exists: false, path: "/wt/new" })).toBeUndefined();
  });

  it("allows a reused worktree that is already current", () => {
    expect(reusedWorktreeRefusal({ base, behind: 0, exists: true, path: "/wt/x" })).toBeUndefined();
  });

  it("refuses a reused worktree that is behind, naming the count and the fast-forward", () => {
    const refusal = reusedWorktreeRefusal({ base, behind: 2, exists: true, path: "/wt/x" })!;

    expect(refusal).toContain("2 commit(s) behind origin/main");
    expect(refusal).toContain("git -C /wt/x fetch origin && git -C /wt/x merge --ff-only origin/main");
    expect(refusal).toContain("Nothing was retired.");
  });

  it("says why a reused tree differs from a fresh one, so the refusal teaches the rule", () => {
    const refusal = reusedWorktreeRefusal({ base, behind: 2, exists: true, path: "/wt/x" })!;

    expect(refusal).toContain("A worktree cut fresh is forked from the remote");
  });

  it("refuses an existing worktree whose drift could not be measured, rather than booting on a guess", () => {
    const refusal = reusedWorktreeRefusal({ base, behind: undefined, exists: true, path: "/wt/x" })!;

    expect(refusal).toContain("could NOT be measured");
    expect(refusal).toContain("Nothing was retired.");
  });
});

describe("successorArmVerdict", () => {
  const pending = { predecessorArmId: "aaaa1111", successor: "live-loop-3sep-a" };
  const successorTree = "/repo/.claude/worktrees.noindex/live-loop-3sep-a";

  it("confirms a healthy arm that is not the predecessor's and runs from the successor's tree", () => {
    const verdict = successorArmVerdict({
      armTree: successorTree,
      liveness: { ageMs: 3_000, armId: "bbbb2222", pid: 4242, state: "healthy" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("confirmed");
    expect(verdict.why).toBe(
      "arm bbbb2222 (pid 4242) is healthy from /repo/.claude/worktrees.noindex/live-loop-3sep-a — the successor " +
        "live-loop-3sep-a is running its own listener. Respawned.",
    );
  });

  it("confirms a starting arm too — a listener mid-handshake is the successor arming, not a death", () => {
    const verdict = successorArmVerdict({
      armTree: successorTree,
      liveness: { armAgeMs: 2_000, armId: "bbbb2222", pid: 4242, state: "starting" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("confirmed");
  });

  it("refuses while nothing is armed, naming the by-design no-op", () => {
    const verdict = successorArmVerdict({ armTree: undefined, liveness: { state: "unarmed" }, pending, successorTree });

    expect(verdict.kind).toBe("not-yet");
    expect(verdict.why).toBe(
      "no listener is armed — the successor for live-loop-3sep-a has not armed yet, and a tag arriving now is a " +
        "no-op BY DESIGN. Not respawned.",
    );
  });

  it("refuses while the live arm is still the predecessor's, whatever tree it runs from", () => {
    const verdict = successorArmVerdict({
      armTree: successorTree,
      liveness: { ageMs: 3_000, armId: "aaaa1111", pid: 1111, state: "healthy" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("not-yet");
    expect(verdict.why).toBe(
      "the live arm aaaa1111 is still the PREDECESSOR's — the successor cannot arm until that session runs " +
        "`slopweaver listen disarm` and stops its listener. Not respawned.",
    );
  });

  it("refuses a new arm that is DOWN", () => {
    const verdict = successorArmVerdict({
      armTree: successorTree,
      liveness: { armId: "bbbb2222", pid: 4242, state: "process-dead" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("not-yet");
    expect(verdict.why).toBe(
      "arm bbbb2222 (pid 4242) is not the predecessor's, but it is DOWN (process-dead). Not respawned.",
    );
  });

  it("refuses a live arm whose pid could not be attributed to a checkout, rather than guessing", () => {
    const verdict = successorArmVerdict({
      armTree: undefined,
      liveness: { ageMs: 3_000, armId: "bbbb2222", pid: 4242, state: "healthy" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("not-yet");
    expect(verdict.why).toBe(
      "arm bbbb2222 (pid 4242) is live but could not be attributed to any checkout, so whether it is the " +
        "successor's is UNKNOWN. Refusing to confirm on a guess. Not respawned.",
    );
  });

  // The new-listener class: a listener IS running, it is new, and it is not the successor's — the four
  // worktree/branch/directory gates all passed that morning without asking this question.
  it("refuses a new, healthy arm that runs from a tree other than the successor's", () => {
    const verdict = successorArmVerdict({
      armTree: "/repo/.claude/worktrees.noindex/live-loop-2sep-d",
      liveness: { ageMs: 3_000, armId: "bbbb2222", pid: 4242, state: "healthy" },
      pending,
      successorTree,
    });

    expect(verdict.kind).toBe("not-yet");
    expect(verdict.why).toBe(
      "arm bbbb2222 (pid 4242) runs from /repo/.claude/worktrees.noindex/live-loop-2sep-d, not from the " +
        "successor's tree /repo/.claude/worktrees.noindex/live-loop-3sep-a — that is a listener, but it is not " +
        "live-loop-3sep-a's. Not respawned.",
    );
  });

  it("treats a boot with no predecessor arm as confirmable by any live arm from the successor's tree", () => {
    const verdict = successorArmVerdict({
      armTree: successorTree,
      liveness: { ageMs: 3_000, armId: "bbbb2222", pid: 4242, state: "healthy" },
      pending: { predecessorArmId: undefined, successor: "live-loop-3sep-a" },
      successorTree,
    });

    expect(verdict.kind).toBe("confirmed");
  });
});

// The record on disk said a successor was confirmed on an arm, and `--confirm`
// exited 0 on it whatever stood live. A confirmation counts only while the arm it names is the live one.
describe("confirmedRecordVerdict", () => {
  const record = { confirmedArmId: "7f55cc50", confirmedAt: "2026-10-18T03:09:01.300Z", successor: "loop-18oct-e" };
  const onRecord = "the confirmation on record (loop-18oct-e on arm 7f55cc50, at 2026-10-18T03:09:01.300Z)";
  const refusal =
    "so it is not evidence of a current respawn, and it is never re-judged against another arm. A respawn is " +
    "confirmed again only by a new boot's own arm. Not respawned.";
  const trees = { arm: "/wt/loop-18oct-e", successor: "/wt/loop-18oct-e" };

  it("still holds while the confirmed arm is the one live and up", () => {
    const verdict = confirmedRecordVerdict({
      liveness: { ageMs: 3_000, armId: "7f55cc50", pid: 4242, state: "healthy" },
      record,
      trees,
    });

    expect(verdict).toStrictEqual({
      kind: "still-live",
      why: "already confirmed — loop-18oct-e was respawned on arm 7f55cc50 at 2026-10-18T03:09:01.300Z, and that arm is live (healthy) now",
    });
  });

  it("still holds while the confirmed arm is starting or reconnecting, which are not down", () => {
    const starting = confirmedRecordVerdict({
      liveness: { armAgeMs: 2_000, armId: "7f55cc50", pid: 4242, state: "starting" },
      record,
      trees,
    });
    const reconnecting = confirmedRecordVerdict({
      liveness: { armId: "7f55cc50", pid: 4242, socketDownMs: 1_000, state: "reconnecting" },
      record,
      trees,
    });

    expect([starting.kind, reconnecting.kind]).toStrictEqual(["still-live", "still-live"]);
  });

  it("is stale when the listener reads unarmed — the successor's own arm never went live", () => {
    expect(confirmedRecordVerdict({ liveness: { state: "unarmed" }, record, trees })).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: the listener reads unarmed now, ${refusal}`,
    });
  });

  it("is stale when a DIFFERENT arm is live, and never re-judges that arm under the old successor's name", () => {
    const verdict = confirmedRecordVerdict({
      liveness: { ageMs: 3_000, armId: "c0ffee11", pid: 5151, state: "healthy" },
      record,
      trees,
    });

    expect(verdict).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: the live arm is c0ffee11 (healthy), not 7f55cc50, ${refusal}`,
    });
  });

  // An arm id is eight hex characters, so the id alone is not the successor's own arm.
  it("is stale when an arm carrying the confirmed id runs from another tree, or from one that cannot be read", () => {
    const liveness = { ageMs: 3_000, armId: "7f55cc50", pid: 6161, state: "healthy" } as const;
    const elsewhere = confirmedRecordVerdict({
      liveness,
      record,
      trees: { arm: "/wt/other", successor: "/wt/loop-18oct-e" },
    });
    const unreadable = confirmedRecordVerdict({
      liveness,
      record,
      trees: { arm: undefined, successor: "/wt/loop-18oct-e" },
    });

    expect(elsewhere).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: that arm runs from /wt/other, not /wt/loop-18oct-e, ${refusal}`,
    });
    expect(unreadable).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: that arm runs from a checkout that could not be read, not /wt/loop-18oct-e, ${refusal}`,
    });
  });

  it("is stale when the confirmed arm is still recorded but DOWN", () => {
    const dead = confirmedRecordVerdict({
      liveness: { armId: "7f55cc50", pid: 4242, state: "process-dead" },
      record,
      trees,
    });
    const stale = confirmedRecordVerdict({
      liveness: { ageMs: 900_000, armId: "7f55cc50", pid: 4242, state: "heartbeat-stale" },
      record,
      trees,
    });

    expect(dead).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: that arm is DOWN (process-dead), ${refusal}`,
    });
    expect(stale).toStrictEqual({
      kind: "stale",
      why: `${onRecord} is stale: that arm is DOWN (heartbeat-stale), ${refusal}`,
    });
  });
});

describe("loopUnmeasuredCause", () => {
  const pending = {
    bootedAtIso: "2026-10-14T13:57:25.935Z",
    predecessorArmId: "0aaa37af",
    successor: "live-bot-loop-14oct-w",
  };

  /** A clean read of no running listener, with the record pending, overridable per test. */
  const clean = {
    listenerLive: false,
    livenessProblems: [],
    pending,
    successor: "live-bot-loop-14oct-w",
  };

  it("reads an unconfirmed boot of the named successor, nothing running, as in flight, carrying the record's facts", () => {
    expect(loopUnmeasuredCause(clean)).toEqual({
      bootedAtIso: "2026-10-14T13:57:25.935Z",
      kind: "respawn-in-flight",
      predecessorArmId: "0aaa37af",
      successor: "live-bot-loop-14oct-w",
    });
  });

  it("reads nothing running and no pending record as no listener", () => {
    expect(loopUnmeasuredCause({ ...clean, pending: undefined })).toEqual({ kind: "no-listener" });
  });

  it("reads a CONFIRMED record with nothing running as no listener — that respawn already finished", () => {
    expect(loopUnmeasuredCause({ ...clean, pending: { ...pending, confirmedArmId: "8c091ce3" } })).toEqual({
      kind: "no-listener",
    });
  });

  it("reads an unconfirmed record for a DIFFERENT successor as no listener — it cannot speak for this one", () => {
    expect(loopUnmeasuredCause({ ...clean, successor: "live-bot-loop-15oct-a" })).toEqual({
      kind: "no-listener",
    });
  });

  it("reads a running listener as unattributed even with a boot pending — something IS listening and no tree came of it", () => {
    expect(loopUnmeasuredCause({ ...clean, listenerLive: true })).toEqual({ kind: "unattributed" });
  });

  it("reads a liveness read that reported a problem as unattributed — an unreadable arm is not an absent one", () => {
    expect(loopUnmeasuredCause({ ...clean, livenessProblems: ["arm record unreadable"] })).toEqual({
      kind: "unattributed",
    });
  });
});
