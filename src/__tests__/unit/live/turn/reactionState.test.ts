/**
 * THE REACTION MUST NOT CONTRADICT THE TURN — the decision, the predicate, and the incident that produced
 * both.
 *
 * The regression this file exists for is the self-recovery, ask
 * `C0SYN000017`/`1789708136.457099`: a phantom finding correctly settled the tagged message to `:warning:`
 * at 06:12:14.344Z, the loop re-dispatched a live worker at 06:19:51.314Z, and nothing on any dispatch path
 * put the capture emoji back — so a working turn advertised itself as failed for 43 minutes. The owner's
 * rule: it goes back to the first emoji, eyes.
 *
 * `describe("the self-recovery")` drives the SHIPPED assertion over a fake whose reactions are a real
 * set, so "the warning is still standing" is a state the assertions can see rather than a call that was or
 * was not made.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertAskReaction,
  type ReactionAssertDeps,
  reactionAssertionLine,
} from "../../../../cli/commands/turn/reactionAssert.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import type {
  AskLifecycle,
  AskLifecycleEvent,
  AskLifecycleState,
  DispatchedEvent,
} from "../../../../live/ask/lifecycle.js";
import { settleLifecycleReaction } from "../../../../live/turn/poster.js";
import { lifecycleReactionForAsk, reactionConvergenceNeeded } from "../../../../live/turn/reactionState.js";
import { reactingTransport } from "../../../reactingTransportFake.js";

/** The profile-less defaults every emoji resolver falls back to, so a temp home needs no `profile.json`. */
const CAPTURE = "eyes";
const COMPLETION = "white_check_mark";
const STOPPED = "warning";
const ACKNOWLEDGED = "ack";
const QUEUED = "hourglass_flowing_sand";
const LIFECYCLE_SET = [QUEUED, CAPTURE, COMPLETION, STOPPED, ACKNOWLEDGED];

const ASK: AskIdentity = {
  channel: "C0SYN000017",
  messageTs: "1789708136.457099",
  threadTs: "1789708136.457099",
};

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-reaction-state-"));
  fixtureDirs.push(home);
  return home;
}

/** The `dispatched` event a live worker holds — the self-recovery's own second dispatch. */
const LIVE_DISPATCH: DispatchedEvent = {
  ...ASK,
  decision: {
    confidence: "high",
    needs: [],
    rationale: "re-dispatched after the first worker died",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "current",
  },
  kind: "dispatched",
  leaseExpiresAt: "2026-09-18T08:19:51.314Z",
  tier: "fresh-visible-session",
  tsIso: "2026-09-18T06:19:51.314Z",
};

/**
 * The one fully-typed `lastEvent` every case carries. Its own kind never matters here: `lifecycleReactionForAsk`
 * reads `state` and `activeDispatch`, and those two are exactly what the fold keeps APART — see
 * `../../../../live/ask/lifecycle.ts`, where an observation appended over a live dispatch moves `state` while
 * `activeDispatch` stands. So a driver that derived `state` from `lastEvent.kind` would be unable to build
 * the very disagreement this file is testing, and would need a cast to fake the kinds it could not construct.
 */
const A_REAL_EVENT: AskLifecycleEvent = {
  ...ASK,
  kind: "dispatch-failed",
  reason: "cmux has no workspace — the workspace this dispatch recorded is gone",
  tsIso: "2026-09-18T06:12:14.344Z",
};

/**
 * A folded ask, built field by field so each case says exactly which of `state` and `activeDispatch` it is
 * testing — the two that the measured defect turned on.
 *
 * @param activeDispatch the dispatch a worker is holding, absent when none is
 * @param state what the fold reports as the newest event's kind
 * @returns the fold
 */
function fold({
  activeDispatch,
  state,
}: {
  activeDispatch?: DispatchedEvent | undefined;
  state: AskLifecycleState;
}): AskLifecycle {
  return {
    ...ASK,
    capturedIso: "2026-09-18T05:09:00.068Z",
    lastEvent: A_REAL_EVENT,
    state,
    surface: "channel",
    userId: "U_OWNER",
    ...(activeDispatch === undefined ? {} : { activeDispatch }),
  };
}

describe("lifecycleReactionForAsk", () => {
  it("says `working` for the ask whose re-dispatch left a warning standing — the whole self-recovery case", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ activeDispatch: LIVE_DISPATCH, state: "dispatched" }) })).toBe(
      "working",
    );
  });

  it("lets `activeDispatch` OUTRANK a `state` a recovery pass moved off `dispatched`", () => {
    // The measured fold, read through the reaction: a recovery re-capture appends
    // `checklist-posted` over a live dispatch, so `state` alone would call a working turn un-dispatched.
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "checklist-posted" });
    expect(entry.state).toBe("checklist-posted");
    expect(lifecycleReactionForAsk({ entry })).toBe("working");
  });

  it("keeps `working` through an unwitnessed pickup, which posts no warning by design", () => {
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "dispatch-unwitnessed" });
    expect(lifecycleReactionForAsk({ entry })).toBe("working");
  });

  it("says `stopped` for a dispatch failure nobody has recovered yet", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ state: "dispatch-failed" }) })).toBe("stopped");
  });

  it("says `stopped` for a lease that ran out, a turn that failed, a lost answer and a withheld draft", () => {
    const kinds = ["lease-expired", "failed", "answer-lost", "withheld"] as const;
    expect(kinds.map((kind) => lifecycleReactionForAsk({ entry: fold({ state: kind }) }))).toEqual([
      "stopped",
      "stopped",
      "stopped",
      "stopped",
    ]);
  });

  it("says `completion` once the answer has landed", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ state: "answered" }) })).toBe("completion");
  });

  /**
   * The line `acknowledged` and `completion` are drawn on. An ask settled `satisfied-elsewhere` WAS
   * answered — the reply is standing in the thread, it simply belongs to another ask — so it reads as
   * `completion`, while the two triage states read as `acknowledged` because nothing was answered at all.
   */
  it("says `completion` for an ask another turn's answer already satisfied, never `acknowledged`", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ state: "satisfied-elsewhere" }) })).toBe("completion");
  });

  it("says `acknowledged` for both ways an ask is judged to owe no reply", () => {
    const kinds = ["triaged-no-response", "triage-cleanup-intended"] as const;
    expect(kinds.map((kind) => lifecycleReactionForAsk({ entry: fold({ state: kind }) }))).toEqual([
      "acknowledged",
      "acknowledged",
    ]);
  });

  it("says `for-a-human`, never `acknowledged`, for an ask judged and left for a person — cleanup stalled or not", () => {
    const kinds = ["left-for-a-human", "handover-cleanup-intended"] as const;
    expect(kinds.map((kind) => lifecycleReactionForAsk({ entry: fold({ state: kind }) }))).toEqual([
      "for-a-human",
      "for-a-human",
    ]);
  });

  it("says `working` for a turn paused on a human — not over, so not an ending the asker reads as one", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ state: "blocked-on-human" }) })).toBe("working");
  });

  it("says `working`, never `completion`, once a plan is posted and the same worker is still building", () => {
    expect(lifecycleReactionForAsk({ entry: fold({ activeDispatch: LIVE_DISPATCH, state: "first-answered" }) })).toBe(
      "working",
    );
    expect(lifecycleReactionForAsk({ entry: fold({ state: "first-answered" }) })).toBe("working");
  });

  it("says `working` for an ask that was only ever captured and carded", () => {
    const kinds = ["captured", "checklist-posted", "redispatched"] as const;
    expect(kinds.map((kind) => lifecycleReactionForAsk({ entry: fold({ state: kind }) }))).toEqual([
      "working",
      "working",
      "working",
    ]);
  });
});

describe("reactionConvergenceNeeded", () => {
  it("is TRUE for the measured message — eyes absent, the warning still standing", () => {
    expect(reactionConvergenceNeeded({ emojis: LIFECYCLE_SET, present: [STOPPED], standing: CAPTURE })).toBe(true);
  });

  it("is TRUE when the expected emoji is there but a stale one is beside it", () => {
    // The half an "is eyes on it?" check would miss, and the shape of the measured contradiction.
    expect(reactionConvergenceNeeded({ emojis: LIFECYCLE_SET, present: [CAPTURE, STOPPED], standing: CAPTURE })).toBe(
      true,
    );
  });

  it("is FALSE when the message wears exactly the expected reaction", () => {
    expect(reactionConvergenceNeeded({ emojis: LIFECYCLE_SET, present: [CAPTURE], standing: CAPTURE })).toBe(false);
  });

  it("is FALSE when a human's own non-lifecycle reaction sits beside the expected one", () => {
    expect(
      reactionConvergenceNeeded({ emojis: LIFECYCLE_SET, present: ["tada", CAPTURE, "+1"], standing: CAPTURE }),
    ).toBe(false);
  });

  it("is TRUE for a message wearing nothing at all", () => {
    expect(reactionConvergenceNeeded({ emojis: LIFECYCLE_SET, present: [], standing: CAPTURE })).toBe(true);
  });
});

describe("the self-recovery, driven through the shipped assertion", () => {
  /**
   * The real deps over the real convergence — `converge` is `settleLifecycleReaction`, the one seam every
   * live caller uses, so this drives shipped behaviour rather than a restatement of it.
   *
   * @param home the temp home the emoji names resolve from
   * @param standing the reactions each message is wearing, mutated in place
   * @returns the deps `assertAskReaction` takes
   */
  function depsOver({ home, standing }: { home: string; standing: Map<string, Set<string>> }): ReactionAssertDeps {
    const transport = reactingTransport({ standing });
    return {
      converge: async ({ askIdentity, reaction }) =>
        settleLifecycleReaction({ askIdentity, home, reaction, transport }),
      readReactionNames: async ({ askIdentity }) => {
        const live = await transport.readReactions({
          posted: { channel: askIdentity.channel, ts: askIdentity.messageTs },
        });
        return live?.map((reaction) => reaction.name);
      },
    };
  }

  it("takes the warning off and puts eyes back, alone, once a worker holds the ask again", async () => {
    const home = tempHome();
    const standing = new Map([[ASK.messageTs, new Set([STOPPED])]]);
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "dispatched" });

    const assertion = await assertAskReaction({ deps: depsOver({ home, standing }), entry, home });

    expect(assertion.kind).toBe("converged");
    expect(assertion.emoji).toBe(CAPTURE);
    expect([...standing.get(ASK.messageTs)!]).toEqual([CAPTURE]);
  });

  it("leaves a message already wearing eyes alone, and says nothing about it", async () => {
    const home = tempHome();
    const standing = new Map([[ASK.messageTs, new Set([CAPTURE])]]);
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "dispatched" });

    const assertion = await assertAskReaction({ deps: depsOver({ home, standing }), entry, home });

    expect(assertion.kind).toBe("matches");
    expect(reactionAssertionLine({ askIdentity: ASK, assertion })).toBeUndefined();
    expect([...standing.get(ASK.messageTs)!]).toEqual([CAPTURE]);
  });

  it("never touches a human's own reaction while converging the bot's", async () => {
    const home = tempHome();
    const standing = new Map([[ASK.messageTs, new Set(["tada", STOPPED])]]);
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "dispatched" });

    await assertAskReaction({ deps: depsOver({ home, standing }), entry, home });

    expect([...standing.get(ASK.messageTs)!]).toEqual(["tada", CAPTURE]);
  });

  it("reports what it could not check, rather than claiming a match, with no bot token", async () => {
    const home = tempHome();
    const entry = fold({ activeDispatch: LIVE_DISPATCH, state: "dispatched" });

    const assertion = await assertAskReaction({ deps: undefined, entry, home });

    expect(assertion.kind).toBe("unreadable");
    // The witness the replay lane asserts on: the EXPECTATION is derived and printed even in a home that
    // cannot reach Slack at all, so the line is evidence about the decision rather than about the call.
    expect(reactionAssertionLine({ askIdentity: ASK, assertion })).toBe(
      `reaction: ${ASK.channel}/${ASK.messageTs} — expected :${CAPTURE}: (working); could not check what it is wearing — no Slack bot token is configured`,
    );
  });
});
