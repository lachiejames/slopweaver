/**
 * The card gate every dispatch crosses — `cli/commands/turn/ensureCard.ts`.
 *
 * The property under test is the one the owner asked for: an ask reaches a worker only with a
 * live progress card standing in its thread. Four paths satisfy it and the fifth refuses, and each case
 * here pins WHICH path ran rather than only that a ref came back — a recovery that silently posted a second
 * card would put two of them in one thread, which is the exact shape that ruling deleted a verb family over.
 *
 * The second property, from the same incident: every one of those three paths ADVANCES the card it proved
 * onto the frame a dispatched ask wears, because nothing else on the dispatch path ever does — `turnBegin`
 * runs only inline. A refused advance is reported, never a refused dispatch.
 *
 * Every seam is a plain recording closure, never a mock: the module does no I/O of its own.
 */
// register-class: public-ask-dispatched-with-no-live-progress-card (docs/recurring-failure-register/bindings.md)
import { describe, expect, it } from "vitest";

import { ensureLiveCard, type LiveCardDeps, liveCardLine } from "../../../../../cli/commands/turn/ensureCard.js";
import { unwrap } from "../../../../../lib/result.js";
import type { StartedChecklist } from "../../../../../live/ask/checklist.js";
import type { AskLifecycleEvent } from "../../../../../live/ask/lifecycle.js";
import { mayWriteCard, type ParentCard } from "../../../../../live/ask/sharedCard.js";
import { buildTurnRoutingBrief, type TurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "why did the staging pool exhaust?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/** One brief for the ask under test, with or without a capture-time card already on it. */
function briefFor({
  ridesOn,
  started,
}: { ridesOn?: string | undefined; started?: StartedChecklist | undefined } = {}): TurnRoutingBrief {
  return buildTurnRoutingBrief({
    channel: "C0SYN000006",
    messageTs: "1789952379.135579",
    question: "why did the staging pool exhaust?",
    ...(ridesOn === undefined ? {} : { ridesOn }),
    routingInput: ROUTING_INPUT,
    ...(started === undefined ? {} : { started }),
    surface: "channel",
    threadTs: "1789952379.135579",
    unavailableCapabilities: [],
    userId: "U0OWNER",
  });
}

/** Everything the seams were asked to do, so a test asserts on the calls rather than on the absence of one. */
interface Recorded {
  readonly posts: string[];
  readonly recorded: StartedChecklist[];
  readonly persisted: StartedChecklist[];
  readonly advanced: StartedChecklist[];
  readonly read: StartedChecklist[];
  readonly parentAsked: string[];
}

/**
 * The deps, recording every call. `recovered` is what the lifecycle log holds; `postFails` and
 * `advanceFails` make the post and the advance reject with that exact message; `parent` is what the parent
 * judgement answers for any brief that names one; `gone` names the card ts Slack reports no longer exists;
 * `writes` is whether this ask is the card's writer, which picks an edit or a read.
 */
function recordingDeps({
  advanceFails,
  gone,
  parent,
  postFails,
  recovered,
  writes = () => true,
}: {
  advanceFails?: string | undefined;
  gone?: string | undefined;
  parent?: ParentCard | undefined;
  postFails?: string | undefined;
  recovered?: StartedChecklist | undefined;
  writes?: LiveCardDeps["mayWriteCard"];
} = {}): { readonly deps: LiveCardDeps; readonly calls: Recorded } {
  const calls: Recorded = { advanced: [], parentAsked: [], persisted: [], posts: [], read: [], recorded: [] };
  return {
    calls,
    deps: {
      advanceCard: async ({ started }) => {
        calls.advanced.push(started);
        if (advanceFails !== undefined) {
          throw new Error(advanceFails);
        }
        return started.workingTs === gone ? "gone" : "stands";
      },
      mayWriteCard: writes,
      mintTurnId: () => "turn-minted-here",
      parentCard: ({ parentMessageTs }) => {
        calls.parentAsked.push(parentMessageTs);
        if (parent === undefined) {
          throw new Error("the parent judgement was consulted for a brief that names no parent");
        }
        return parent;
      },
      persistStarted: ({ started }) => {
        calls.persisted.push(started);
      },
      postCard: async ({ turnId }) => {
        calls.posts.push(turnId);
        if (postFails !== undefined) {
          throw new Error(postFails);
        }
        return { ts: "1789960000.000100" };
      },
      readCard: async ({ started }) => {
        calls.read.push(started);
        return started.workingTs === gone ? "gone" : "stands";
      },
      recordChecklistPosted: ({ started }) => {
        calls.recorded.push(started);
      },
      recordedStarted: () => recovered,
    },
  };
}

describe("ensureLiveCard — the card is already on the brief", () => {
  it("posts nothing and writes nothing, but still ADVANCES it off the pre-routing frame", async () => {
    const started: StartedChecklist = { turnId: "turn-capture-1", workingTs: "1789952400.000100" };
    const { calls, deps } = recordingDeps();

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ started }), deps }));

    expect(card.origin).toBe("on-the-brief");
    expect(card.started).toEqual(started);
    expect(card.advanceFailed).toBeUndefined();
    expect(calls.posts).toEqual([]);
    expect(calls.persisted).toEqual([]);
    expect(calls.recorded).toEqual([]);
    // This is the branch the measured ask actually took: capture HAD posted a card, so the old code returned
    // here having touched nothing, and the card sat on `Work out how to answer` for the whole dispatch.
    expect(calls.advanced).toEqual([started]);
  });

  it("reports a refused advance rather than refusing the dispatch, because the card is still standing", async () => {
    const started: StartedChecklist = { turnId: "turn-capture-1", workingTs: "1789952400.000100" };
    const { calls, deps } = recordingDeps({ advanceFails: "message_not_found" });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ started }), deps }));

    expect(card.origin).toBe("on-the-brief");
    expect(card.advanceFailed).toBe("message_not_found");
    expect(calls.advanced).toEqual([started]);
  });

  it("reports a seam that throws SYNCHRONOUSLY too, which a bare .catch() would have let escape", async () => {
    const started: StartedChecklist = { turnId: "turn-capture-1", workingTs: "1789952400.000100" };
    const { deps } = recordingDeps();
    const throwing: LiveCardDeps = {
      ...deps,
      advanceCard: () => {
        throw new Error("no Slack bot token");
      },
    };

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ started }), deps: throwing }));

    expect(card.advanceFailed).toBe("no Slack bot token");
    expect(card.started).toEqual(started);
  });
});

describe("ensureLiveCard — the brief lost the ref the lifecycle log still has", () => {
  it("recovers it and writes it back to the brief, rather than posting a SECOND card", async () => {
    const recovered: StartedChecklist = { turnId: "turn-capture-2", workingTs: "1789952401.000200" };
    const { calls, deps } = recordingDeps({ recovered });

    const card = unwrap(await ensureLiveCard({ brief: briefFor(), deps }));

    expect(card.origin).toBe("recovered");
    expect(card.started).toEqual(recovered);
    expect(card.advanceFailed).toBeUndefined();
    expect(calls.posts).toEqual([]);
    expect(calls.persisted).toEqual([recovered]);
    // Nothing new happened in Slack, so nothing new is appended to the ask's lifecycle log either.
    expect(calls.recorded).toEqual([]);
    expect(calls.advanced).toEqual([recovered]);
  });
});

describe("ensureLiveCard — no card anywhere, which is the measured incident", () => {
  it("posts one, records the durable checklist-posted ref, and persists it to the brief", async () => {
    const { calls, deps } = recordingDeps();

    const card = unwrap(await ensureLiveCard({ brief: briefFor(), deps }));

    expect(card.origin).toBe("posted");
    expect(card.started).toEqual({ turnId: "turn-minted-here", workingTs: "1789960000.000100" });
    expect(card.advanceFailed).toBeUndefined();
    expect(calls.posts).toEqual(["turn-minted-here"]);
    expect(calls.recorded).toEqual([{ turnId: "turn-minted-here", workingTs: "1789960000.000100" }]);
    expect(calls.persisted).toEqual([{ turnId: "turn-minted-here", workingTs: "1789960000.000100" }]);
    // A card posted here wears the capture frame too, so this branch advances like every other one.
    expect(calls.advanced).toEqual([{ turnId: "turn-minted-here", workingTs: "1789960000.000100" }]);
  });

  it("REFUSES when the post will not land, carrying Slack's own reason and recording nothing", async () => {
    const { calls, deps } = recordingDeps({ postFails: "channel_not_found" });

    const result = await ensureLiveCard({ brief: briefFor(), deps });

    expect(result._unsafeUnwrapErr().code).toBe("LIVE_CARD_POST_FAILED");
    // `cause` carries Slack's own words unmangled; `message` is the sentence the dispatch prints.
    expect(result._unsafeUnwrapErr().cause).toBe("channel_not_found");
    expect(result._unsafeUnwrapErr().message).toBe(
      "this ask has no live progress card and one could not be posted, so no worker was started — " +
        "channel_not_found. Fix that and re-run the dispatch; a public ask never reaches a worker without a " +
        "card standing in its thread (owner ruling).",
    );
    expect(calls.recorded).toEqual([]);
    expect(calls.persisted).toEqual([]);
    // Nothing was proved, so there is nothing to advance: no edit is attempted against a ts that does not exist.
    expect(calls.advanced).toEqual([]);
  });
});

describe("ensureLiveCard — a sub-ask whose brief names the ask it was dispatched from", () => {
  const parentCard: StartedChecklist = { turnId: "turn-1790146109374", workingTs: "1790146110.096759" };

  it("RIDES the parent's card: records and persists the parent's ref, advances it, and posts nothing", async () => {
    const { calls, deps } = recordingDeps({ parent: { kind: "ride", started: parentCard } });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ ridesOn: "1790146101.489459" }), deps }));

    expect(card.origin).toBe("rode-parent");
    expect(card.started).toEqual(parentCard);
    expect(card.parent).toEqual({ messageTs: "1790146101.489459", notRidden: undefined });
    // The incident's second card came from exactly this post; the fix is that it never happens.
    expect(calls.posts).toEqual([]);
    expect(calls.parentAsked).toEqual(["1790146101.489459"]);
    expect(calls.recorded).toEqual([parentCard]);
    expect(calls.persisted).toEqual([parentCard]);
    expect(calls.advanced).toEqual([parentCard]);
  });

  it("recovers a ride its brief write lost, without consulting the parent or attaching a second time", async () => {
    const { calls, deps } = recordingDeps({ recovered: parentCard });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ ridesOn: "1790146101.489459" }), deps }));

    expect(card.origin).toBe("recovered");
    expect(card.started).toEqual(parentCard);
    expect(calls.parentAsked).toEqual([]);
    expect(calls.recorded).toEqual([]);
    expect(calls.posts).toEqual([]);
  });

  it("posts its OWN card when the parent cannot be ridden, and says why on the card it returns", async () => {
    const reason = "the ask it rides, C0SYN000006/1790146101.489459, is in a different thread";
    const { calls, deps } = recordingDeps({ parent: { kind: "post", reason } });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ ridesOn: "1790146101.489459" }), deps }));

    expect(card.origin).toBe("posted");
    expect(card.parent).toEqual({ messageTs: "1790146101.489459", notRidden: reason });
    expect(calls.posts).toEqual(["turn-minted-here"]);
    expect(liveCardLine({ card })).toBe(
      `live progress card posted for this dispatch — ts 1789960000.000100, turn turn-minted-here (not ridden because ${reason})`,
    );
  });

  it("names the unridden parent in the refusal when its own post also fails", async () => {
    const reason = "the ask it rides, C0SYN000006/1790146101.489459, has no progress card";
    const { deps } = recordingDeps({ parent: { kind: "post", reason }, postFails: "channel_not_found" });

    const result = await ensureLiveCard({ brief: briefFor({ ridesOn: "1790146101.489459" }), deps });

    expect(result._unsafeUnwrapErr().code).toBe("LIVE_CARD_POST_FAILED");
    expect(result._unsafeUnwrapErr().message).toContain(`It did not ride the card its brief names because ${reason}.`);
  });

  it("posts a FRESH card when Slack says the card it knows is gone, through both known-ref branches", async () => {
    const posted = { turnId: "turn-minted-here", workingTs: "1789960000.000100" };
    const onBrief = recordingDeps({ gone: parentCard.workingTs });
    const fromLog = recordingDeps({ gone: parentCard.workingTs, recovered: parentCard });

    const briefCard = unwrap(await ensureLiveCard({ brief: briefFor({ started: parentCard }), deps: onBrief.deps }));
    const logCard = unwrap(await ensureLiveCard({ brief: briefFor(), deps: fromLog.deps }));

    expect(briefCard.origin).toBe("posted");
    expect(briefCard.started).toEqual(posted);
    expect(briefCard.replaced).toBe(parentCard.workingTs);
    expect(onBrief.calls.posts).toEqual(["turn-minted-here"]);
    expect(onBrief.calls.advanced).toEqual([parentCard, posted]);
    expect(liveCardLine({ card: briefCard })).toBe(
      "live progress card posted for this dispatch — ts 1789960000.000100, turn turn-minted-here " +
        "(the card it knew, 1790146110.096759, is gone from Slack)",
    );
    expect(logCard.origin).toBe("posted");
    // The dead ref is never written back to the brief; only the fresh card is.
    expect(fromLog.calls.persisted).toEqual([posted]);
  });

  it("posts its OWN card when the parent's card it was about to ride is gone from Slack", async () => {
    const { calls, deps } = recordingDeps({
      gone: parentCard.workingTs,
      parent: { kind: "ride", started: parentCard },
    });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ ridesOn: "1790146101.489459" }), deps }));

    expect(card.origin).toBe("posted");
    expect(card.parent).toEqual({
      messageTs: "1790146101.489459",
      notRidden: "its card (1790146110.096759) is gone from Slack",
    });
    expect(calls.posts).toEqual(["turn-minted-here"]);
  });

  it("READS a shared card it does not write, and replaces it when Slack says it is gone", async () => {
    // P, B and C share X; B and C fail; P answers and deletes X; recovery re-dispatches B and C. The log now
    // shows two open holders of a card that no longer exists, and C (attached last) is its writer — so B's
    // dispatch cannot edit X, and an open holder is no proof X stands.
    const channel = "C0SYN000006";
    const thread = "1789952379.135579";
    const ask = ({ messageTs }: { messageTs: string }) => ({ channel, messageTs, threadTs: thread });
    const P = ask({ messageTs: "1790146101.489459" });
    const B = ask({ messageTs: "1789952379.135579" });
    const C = ask({ messageTs: "1790141967.816599" });
    const at = "2026-09-23T00:00:00.000Z";
    const onX = (who: typeof P): AskLifecycleEvent => ({ ...who, kind: "checklist-posted", tsIso: at, ...parentCard });
    const failed = (who: typeof P): AskLifecycleEvent => ({ ...who, kind: "failed", reason: "died", tsIso: at });
    const redispatched = (who: typeof P): AskLifecycleEvent => ({
      ...who,
      kind: "redispatched",
      reason: "stranded",
      strandedAs: "failed",
      tsIso: at,
    });
    const events: readonly AskLifecycleEvent[] = [
      onX(P),
      onX(B),
      onX(C),
      failed(B),
      failed(C),
      { ...P, answerTs: "1790146300.000100", kind: "answered", tsIso: at },
      redispatched(B),
      redispatched(C),
    ];
    const { calls, deps } = recordingDeps({
      gone: parentCard.workingTs,
      writes: ({ askIdentity, workingTs }) => mayWriteCard({ askIdentity, events, workingTs }),
    });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ started: parentCard }), deps }));

    expect(calls.advanced).toEqual([{ turnId: "turn-minted-here", workingTs: "1789960000.000100" }]);
    expect(calls.read).toEqual([parentCard]);
    expect(card.origin).toBe("posted");
    expect(card.replaced).toBe(parentCard.workingTs);
  });

  it("reuses the replacement the log recorded when the brief still names the dead card, never a third", async () => {
    const replacement: StartedChecklist = { turnId: "turn-replacement", workingTs: "1790146200.000100" };
    const { calls, deps } = recordingDeps({ gone: parentCard.workingTs, recovered: replacement });

    const card = unwrap(await ensureLiveCard({ brief: briefFor({ started: parentCard }), deps }));

    expect(card.origin).toBe("recovered");
    expect(card.started).toEqual(replacement);
    expect(calls.posts).toEqual([]);
    expect(calls.persisted).toEqual([replacement]);
    expect(calls.advanced).toEqual([parentCard, replacement]);
  });

  it("REFUSES a card it just posted that Slack reports gone before its first edit, never handing it on", async () => {
    const { calls, deps } = recordingDeps({ gone: "1789960000.000100" });

    const result = await ensureLiveCard({ brief: briefFor(), deps });

    expect(result._unsafeUnwrapErr().cause).toBe(
      "the card it just posted (1789960000.000100) was deleted before it could be advanced",
    );
    expect(calls.posts).toEqual(["turn-minted-here"]);
  });

  it("names the gone card in the refusal when the fresh post also fails", async () => {
    const { deps } = recordingDeps({ gone: parentCard.workingTs, postFails: "channel_not_found" });

    const result = await ensureLiveCard({ brief: briefFor({ started: parentCard }), deps });

    expect(result._unsafeUnwrapErr().message).toContain(
      "It did not reuse the card its brief names because that card (1790146110.096759) is gone from Slack.",
    );
  });

  it("never consults the parent judgement for a brief that names none", async () => {
    const { calls, deps } = recordingDeps();

    const card = unwrap(await ensureLiveCard({ brief: briefFor(), deps }));

    expect(card.parent).toBeUndefined();
    expect(calls.parentAsked).toEqual([]);
  });
});

describe("liveCardLine", () => {
  it("names which of the four paths produced the card, and the ts either way", () => {
    const started: StartedChecklist = { turnId: "turn-x", workingTs: "1789960000.000300" };
    const advanceFailed = undefined;
    expect(liveCardLine({ card: { advanceFailed, origin: "on-the-brief", parent: undefined, started } })).toBe(
      "live progress card already on the brief — ts 1789960000.000300, turn turn-x",
    );
    expect(liveCardLine({ card: { advanceFailed, origin: "posted", parent: undefined, started } })).toBe(
      "live progress card posted for this dispatch — ts 1789960000.000300, turn turn-x",
    );
    expect(liveCardLine({ card: { advanceFailed, origin: "recovered", parent: undefined, started } })).toBe(
      "live progress card recovered from the ask's lifecycle log and written back to the brief — " +
        "ts 1789960000.000300, turn turn-x",
    );
    expect(
      liveCardLine({
        card: {
          advanceFailed,
          origin: "rode-parent",
          parent: { messageTs: "1790146101.489459", notRidden: undefined },
          started,
        },
      }),
    ).toBe(
      "live progress card of the ask this one was dispatched from (1790146101.489459) ridden, not a second card — " +
        "ts 1789960000.000300, turn turn-x",
    );
  });

  it("names a refused advance on the same line, since a stale frame is invisible from stdout otherwise", () => {
    const started: StartedChecklist = { turnId: "turn-x", workingTs: "1789960000.000300" };
    expect(
      liveCardLine({
        card: { advanceFailed: "message_not_found", origin: "on-the-brief", parent: undefined, started },
      }),
    ).toBe(
      "live progress card already on the brief — ts 1789960000.000300, turn turn-x; still on the pre-routing " +
        "frame, the advance was refused — message_not_found",
    );
  });
});
