import { describe, expect, it } from "vitest";

import type { AskLifecycle, StrandedAs } from "../../../../live/ask/lifecycle.js";
import {
  type BuilderSighting,
  liveBuilderHolds,
  redispatchNotice,
  STRANDED_REDISPATCH_MAX_AGE_MINUTES,
  type StrandedAsk,
  type StrandedDecision,
  strandedRedispatch,
  strandedRedispatches,
  strandedSinceIso,
  strandNeedsBuilderSighting,
} from "../../../../live/listen/stranded.js";

const ASK = { channel: "C1", messageTs: "1788000000.000100", threadTs: "1788000000.000100" } as const;
const NOW = "2026-09-05T12:00:00.000Z";

/** One folded ask in a named state, whose last event sat at `atIso`. */
const folded = ({
  atIso,
  redispatched,
  state,
}: {
  atIso: string;
  redispatched?: boolean;
  state: AskLifecycle["state"];
}): AskLifecycle => ({
  capturedIso: "2026-09-04T00:00:00.000Z",
  channel: ASK.channel,
  lastEvent: { ...ASK, kind: "lease-expired", tsIso: atIso },
  messageTs: ASK.messageTs,
  state,
  surface: "channel",
  threadTs: ASK.threadTs,
  userId: "U1",
  ...(redispatched === true
    ? {
        redispatched: {
          ...ASK,
          kind: "redispatched" as const,
          reason: "already picked up",
          strandedAs: "lease-expired" as const,
          tsIso: atIso,
        },
      }
    : {}),
});

/**
 * The strand a decision carries, throwing when it decided something else — the `unwrap` shape, so no
 * assertion below needs a conditional to reach a field.
 */
const strandOf = ({ decision }: { decision: StrandedDecision }): StrandedAsk => {
  if (decision.kind !== "stranded") {
    throw new Error(`expected a stranded decision, got ${decision.kind}`);
  }
  return decision.stranded;
};

describe("strandedRedispatch", () => {
  it.each<{ state: StrandedAs }>([{ state: "failed" }, { state: "dispatch-failed" }, { state: "lease-expired" }])(
    "picks up an unspent ask stranded at $state",
    ({ state }) => {
      const stranded = strandOf({
        decision: strandedRedispatch({
          ask: folded({ atIso: "2026-09-05T11:00:00.000Z", state }),
          nowIso: NOW,
          reviewOpen: false,
        }),
      });

      expect(stranded.strandedAs).toBe(state);
      expect(stranded.sinceMinutes).toBe(60);
      expect(stranded.surface).toBe("channel");
      expect(stranded.ask.messageTs).toBe(ASK.messageTs);
      expect(stranded.reason).toBe(
        `this ask has been ${state} for 60m (last event 2026-09-05T11:00:00.000Z) and has never been re-dispatched`,
      );
    },
  );

  it.each<{ state: StrandedAs }>([{ state: "failed" }, { state: "dispatch-failed" }, { state: "lease-expired" }])(
    "leaves a $state ask alone while its review record is still open, naming the exact ask",
    ({ state }) => {
      // `C0SYN000001/1790048248.995219`: a warn-tier door refusal wrote a `failed` event over a
      // worker that was alive and on review round 7. This classifier called it stranded and minted a second
      // turn, in the same minute `turn dispatch --sweep` read the same review record and said DO NOT ROUTE.
      const decision = strandedRedispatch({
        ask: folded({ atIso: "2026-09-05T11:00:00.000Z", state }),
        nowIso: NOW,
        reviewOpen: true,
      });

      expect(decision.kind).toBe("review-open");
      expect(JSON.stringify(decision)).toBe(
        JSON.stringify({
          ask: { channel: "C1", messageTs: ASK.messageTs, threadTs: ASK.threadTs },
          kind: "review-open",
        }),
      );
    },
  );

  it("reports an ask that was never stranded as ineligible, never as held on a review", () => {
    const decision = strandedRedispatch({
      ask: folded({ atIso: "2026-09-05T11:00:00.000Z", state: "answered" }),
      nowIso: NOW,
      reviewOpen: true,
    });

    expect(decision.kind).toBe("ineligible");
  });

  it("never picks up an ask that already spent its one re-dispatch", () => {
    const decision = strandedRedispatch({
      ask: folded({ atIso: "2026-09-05T11:00:00.000Z", redispatched: true, state: "lease-expired" }),
      nowIso: NOW,
      reviewOpen: false,
    });

    expect(decision.kind).toBe("ineligible");
  });

  it.each([
    { state: "captured" as const },
    { state: "dispatched" as const },
    { state: "answered" as const },
    { state: "withheld" as const },
    { state: "answer-lost" as const },
    { state: "redispatched" as const },
  ])("never picks up an ask in the $state state", ({ state }) => {
    expect(
      strandedRedispatch({ ask: folded({ atIso: "2026-09-05T11:00:00.000Z", state }), nowIso: NOW, reviewOpen: false })
        .kind,
    ).toBe("ineligible");
  });

  it("picks up a strand exactly at the day-long bound", () => {
    const stranded = strandOf({
      decision: strandedRedispatch({
        ask: folded({ atIso: "2026-09-04T12:00:00.000Z", state: "failed" }),
        nowIso: NOW,
        reviewOpen: false,
      }),
    });

    expect(stranded.sinceMinutes).toBe(STRANDED_REDISPATCH_MAX_AGE_MINUTES);
  });

  it("never picks up a strand one minute past the bound", () => {
    expect(
      strandedRedispatch({
        ask: folded({ atIso: "2026-09-04T11:59:00.000Z", state: "failed" }),
        nowIso: NOW,
        reviewOpen: false,
      }).kind,
    ).toBe("ineligible");
  });

  it("picks up a builder that vanished after its first answer ONCE, carrying when the plan was posted", () => {
    const firstAnswer = {
      ...ASK,
      answerDigest: "digest-of-the-plan",
      answerTs: "1788000600.000100",
      kind: "first-answered" as const,
      leaseExpiresAt: "2026-09-05T12:10:00.000Z",
      owes: "pull-requests" as const,
      tsIso: "2026-09-05T10:10:00.000Z",
      what: "open the two pull requests the plan names",
    };
    const once = strandOf({
      decision: strandedRedispatch({
        ask: { ...folded({ atIso: "2026-09-05T11:00:00.000Z", state: "failed" }), firstAnswer },
        nowIso: NOW,
        reviewOpen: false,
      }),
    });
    const twice = strandedRedispatch({
      ask: {
        ...folded({ atIso: "2026-09-05T11:00:00.000Z", redispatched: true, state: "failed" }),
        firstAnswer,
      },
      nowIso: NOW,
      reviewOpen: false,
    });

    expect(once.firstAnswerIso).toBe("2026-09-05T10:10:00.000Z");
    expect(once.strandedAs).toBe("failed");
    expect(twice.kind).toBe("ineligible");
  });

  it("carries no plan instant for an ask that never posted one", () => {
    const stranded = strandOf({
      decision: strandedRedispatch({
        ask: folded({ atIso: "2026-09-05T11:00:00.000Z", state: "failed" }),
        nowIso: NOW,
        reviewOpen: false,
      }),
    });

    expect(stranded.firstAnswerIso).toBeUndefined();
  });

  it("never picks up an ask whose last event is in the future", () => {
    expect(
      strandedRedispatch({
        ask: folded({ atIso: "2026-09-05T12:01:00.000Z", state: "failed" }),
        nowIso: NOW,
        reviewOpen: false,
      }).kind,
    ).toBe("ineligible");
  });

  it("never picks up an ask whose last event has an unreadable instant", () => {
    expect(
      strandedRedispatch({ ask: folded({ atIso: "not-a-time", state: "failed" }), nowIso: NOW, reviewOpen: false })
        .kind,
    ).toBe("ineligible");
  });
});

describe("strandedRedispatches", () => {
  it("returns the oldest strand first and skips everything that is not one", () => {
    const recent = folded({ atIso: "2026-09-05T11:30:00.000Z", state: "failed" });
    const old = {
      ...folded({ atIso: "2026-09-05T04:00:00.000Z", state: "dispatch-failed" }),
      messageTs: "1788000000.000200",
    };
    const live = {
      ...folded({ atIso: "2026-09-05T11:55:00.000Z", state: "dispatched" }),
      messageTs: "1788000000.000300",
    };

    const found = strandedRedispatches({
      candidates: [
        { ask: recent, reviewOpen: false },
        { ask: old, reviewOpen: false },
        { ask: live, reviewOpen: false },
      ],
      nowIso: NOW,
    });

    expect(found.stranded.map((one) => one.sinceMinutes)).toEqual([480, 30]);
    expect(found.stranded.map((one) => one.ask.messageTs)).toEqual(["1788000000.000200", "1788000000.000100"]);
    expect(found.reviewOpen).toEqual([]);
  });

  it("splits a pass into the strands it picks up and the ones a live review holds back", () => {
    const inReview = folded({ atIso: "2026-09-05T11:30:00.000Z", state: "failed" });
    const genuinelyStranded = {
      ...folded({ atIso: "2026-09-05T04:00:00.000Z", state: "dispatch-failed" }),
      messageTs: "1788000000.000200",
    };

    const found = strandedRedispatches({
      candidates: [
        { ask: inReview, reviewOpen: true },
        { ask: genuinelyStranded, reviewOpen: false },
      ],
      nowIso: NOW,
    });

    expect(found.stranded.map((one) => one.ask.messageTs)).toEqual(["1788000000.000200"]);
    expect(found.reviewOpen.map((one) => one.messageTs)).toEqual([ASK.messageTs]);
  });

  it("returns nothing over an empty log", () => {
    expect(strandedRedispatches({ candidates: [], nowIso: NOW })).toEqual({ reviewOpen: [], stranded: [] });
  });
});

describe("strandedSinceIso", () => {
  it("cuts off exactly one day behind the clock", () => {
    expect(strandedSinceIso({ nowIso: NOW })).toBe("2026-09-04T12:00:00.000Z");
  });

  it("answers undefined on an unreadable clock", () => {
    expect(strandedSinceIso({ nowIso: "never" })).toBe(undefined);
  });
});

describe("redispatchNotice", () => {
  it.each<{ expected: string; strandedAs: StrandedAs }>([
    {
      expected: "Picking this back up — the session that had it ran out of time before it answered.",
      strandedAs: "lease-expired",
    },
    {
      expected: "Picking this back up — the session working on it stopped before it could answer.",
      strandedAs: "failed",
    },
    { expected: "Picking this back up — nothing ever ran on it the first time.", strandedAs: "dispatch-failed" },
  ])("tells the thread what happened for $strandedAs", ({ expected, strandedAs }) => {
    expect(redispatchNotice({ strandedAs })).toBe(expected);
  });

  it.each<{ expected: string; strandedAs: StrandedAs }>([
    {
      expected:
        "Picking this back up — the plan above was posted, but the session building it ran out of time before it finished.",
      strandedAs: "lease-expired",
    },
    {
      expected:
        "Picking this back up — the plan above was posted, but the session building it stopped before it finished.",
      strandedAs: "failed",
    },
    {
      expected:
        "Picking this back up — the plan above was posted, but the session building it stopped before it finished.",
      strandedAs: "dispatch-failed",
    },
  ])("never denies a posted plan for $strandedAs", ({ expected, strandedAs }) => {
    expect(redispatchNotice({ firstAnswered: true, strandedAs })).toBe(expected);
  });

  it("never asks the reader to do anything", () => {
    const every = (["failed", "dispatch-failed", "lease-expired"] as const).flatMap((strandedAs) => [
      redispatchNotice({ strandedAs }),
      redispatchNotice({ firstAnswered: true, strandedAs }),
    ]);

    expect(every.length).toBe(6);
    expect(every.filter((line) => line.toLowerCase().includes("tag"))).toEqual([]);
  });
});

describe("liveBuilderHolds", () => {
  /** One strand in a named state, carrying a posted plan or not. */
  const strand = ({ firstAnswer, strandedAs }: { firstAnswer: boolean; strandedAs: StrandedAs }): StrandedAsk => ({
    ask: ASK,
    reason: "its lease ran out",
    sinceMinutes: 60,
    strandedAs,
    surface: "channel",
    ...(firstAnswer ? { firstAnswerIso: "2026-09-05T08:00:00.000Z" } : {}),
  });

  it.each<{ sighting: BuilderSighting }>([{ sighting: "alive" }, { sighting: "unknown" }])(
    "holds a lease-expired plan whose builder is $sighting",
    ({ sighting }) => {
      const stranded = strand({ firstAnswer: true, strandedAs: "lease-expired" });

      expect(liveBuilderHolds({ sighting, stranded })).toBe(true);
    },
  );

  it.each<{ sighting: BuilderSighting }>([{ sighting: "gone" }, { sighting: "unrecorded" }])(
    "lets a lease-expired plan whose builder is $sighting through",
    ({ sighting }) => {
      const stranded = strand({ firstAnswer: true, strandedAs: "lease-expired" });

      expect(liveBuilderHolds({ sighting, stranded })).toBe(false);
    },
  );

  it("never holds a strand with no plan, however alive its workspace", () => {
    const stranded = strand({ firstAnswer: false, strandedAs: "lease-expired" });

    expect(liveBuilderHolds({ sighting: "alive", stranded })).toBe(false);
  });

  it.each<{ strandedAs: StrandedAs }>([{ strandedAs: "failed" }, { strandedAs: "dispatch-failed" }])(
    "never holds a $strandedAs plan — its worker was already recorded as stopped",
    ({ strandedAs }) => {
      expect(liveBuilderHolds({ sighting: "alive", stranded: strand({ firstAnswer: true, strandedAs }) })).toBe(false);
    },
  );

  it("sights only a lease-expired strand whose plan stands", () => {
    const sighted = (["failed", "dispatch-failed", "lease-expired"] as const).flatMap((strandedAs) =>
      [true, false].map((firstAnswer) => ({
        firstAnswer,
        needs: strandNeedsBuilderSighting({ stranded: strand({ firstAnswer, strandedAs }) }),
        strandedAs,
      })),
    );

    expect(sighted.length).toBe(6);
    expect(sighted.filter((one) => one.needs)).toEqual([
      { firstAnswer: true, needs: true, strandedAs: "lease-expired" },
    ]);
  });
});
