import { describe, expect, it } from "vitest";
import { slackReviewState } from "../../../../review/reviewState.js";
import { coverage, mention, NOW } from "./fixtures.js";

describe("slackReviewState", () => {
  it("answers unknown rather than no when the window cannot carry the absence, and says since when", () => {
    const state = slackReviewState({ coverage: coverage(), mentions: [], prUpdatedAtIso: NOW });
    expect(state.mentioned).toBe("unknown");
    expect(state.asked).toBe("unknown");
    expect(state.staleThroughIso).toBe("2026-08-29T10:47:20.000Z");
  });

  it("carries the watermark on an ask found inside a stale window, which cannot say whether it was answered", () => {
    const state = slackReviewState({
      coverage: coverage(),
      mentions: [mention({ tagged: ["U9"] })],
      prUpdatedAtIso: NOW,
    });
    expect([state.asked, state.bounded, state.staleThroughIso]).toStrictEqual([
      "yes",
      false,
      "2026-08-29T10:47:20.000Z",
    ]);
  });

  it("answers no when the window reaches past the pull request's last activity, and carries no watermark", () => {
    const state = slackReviewState({ coverage: coverage(), mentions: [], prUpdatedAtIso: "2026-08-20T00:00:00Z" });
    expect(state.mentioned).toBe("no");
    expect(state.asked).toBe("no");
    expect("staleThroughIso" in state).toBe(false);
  });

  it("carries no watermark when the corpus was never ingested, since there is no instant to be stale since", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: undefined }),
      mentions: [],
      prUpdatedAtIso: NOW,
    });
    expect([state.asked, "staleThroughIso" in state]).toStrictEqual(["unknown", false]);
  });

  it("answers asked-unknown, never no, when a message it abstained on could be the ask — and names it", () => {
    const state = slackReviewState({
      coverage: coverage(),
      mentions: [
        mention({
          authoredText: "<@U9> one more if you have the patience: <https://github.com/o/r/pull/1|#1>",
          permalink: "p-abstained",
        }),
      ],
      prUpdatedAtIso: "2026-08-20T00:00:00Z",
    });
    expect(state.asked).toBe("unknown");
    expect(state.why).toBe(
      "1 message(s) this read cannot settle as an ask or not, for a visible session to read: p-abstained",
    );
  });

  it("separates a link that tagged nobody from one that did", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "2026-08-30T23:00:00.000Z" }),
      mentions: [mention(), mention({ permalink: "p2", tagged: ["U9"] })],
      prUpdatedAtIso: NOW,
    });
    expect(state.mentioned).toBe("yes");
    expect(state.asked).toBe("yes");
    expect(state.asks.length).toBe(1);
  });

  it("answers mentioned-yes and asked-no for a bare link the CORPUS covers", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "2026-08-30T23:00:00.000Z" }),
      mentions: [mention()],
      prUpdatedAtIso: NOW,
    });
    expect(state.mentioned).toBe("yes");
    expect(state.asked).toBe("no");
  });
});

describe("slackReviewState and the collapsed live leg — the 16371 regression", () => {
  /** The exact shape that produced the wrong answer: a live-only link with no mention run on it. */
  const liveLinkNoTag = mention({
    atIso: "2026-08-30T00:10:21.000Z",
    leg: "live",
    permalink: "p-live",
    tagged: [],
  });

  it("answers unknown, never no, when the only evidence is a collapsed live match", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true }),
      mentions: [liveLinkNoTag],
      prUpdatedAtIso: NOW,
    });
    expect(state.mentioned).toBe("yes");
    expect(state.asked).toBe("unknown");
    expect(state.why).toContain("proves the exhaustive leg is behind");
  });

  it("still answers yes the moment any leg sees a tag, since a positive needs no exhaustiveness", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true }),
      mentions: [mention({ atIso: "2026-08-30T00:04:00.000Z", leg: "live", permalink: "p2", tagged: ["U9"] })],
      prUpdatedAtIso: NOW,
    });
    expect(state.asked).toBe("yes");
  });

  it("never reads a live match AT the watermark as beyond it because the two spell one instant differently", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "2026-08-20", liveRan: true }),
      mentions: [{ ...liveLinkNoTag, atIso: "2026-08-20T00:00:00.000Z" }],
      prUpdatedAtIso: "2026-08-19T23:00:00Z",
    });
    expect([state.bounded, "staleThroughIso" in state]).toStrictEqual([true, false]);
  });

  it("never takes a live match on a day no calendar has as proof the corpus is behind", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "2026-02-28T00:00:00.000Z", liveRan: true }),
      mentions: [{ ...liveLinkNoTag, atIso: "2026-02-30T00:00:00.000Z" }],
      prUpdatedAtIso: "2026-02-27T00:00:00Z",
    });
    expect([state.bounded, "staleThroughIso" in state]).toStrictEqual([true, false]);
  });

  it("takes a live match on a leap day in a two-digit year as the real day it is", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "0000-02-28T00:00:00.000Z", liveRan: true }),
      mentions: [{ ...liveLinkNoTag, atIso: "0000-02-29T00:00:00.000Z" }],
      prUpdatedAtIso: "0000-02-27T00:00:00Z",
    });
    expect([state.bounded, state.staleThroughIso]).toStrictEqual([false, "0000-02-28T00:00:00.000Z"]);
  });

  it("answers no only once the corpus itself covers the pull request's last activity", () => {
    const state = slackReviewState({
      coverage: coverage({ corpusThroughIso: "2026-08-30T23:00:00.000Z" }),
      mentions: [mention({ atIso: "2026-08-30T00:10:21.000Z", leg: "corpus", permalink: "p-corpus", tagged: [] })],
      prUpdatedAtIso: NOW,
    });
    expect(state.mentioned).toBe("yes");
    expect(state.asked).toBe("no");
  });
});

describe("slackReviewState and a live hit the run went back and read around", () => {
  /** A live-only link past the watermark — the hit that used to force `unknown` on its own. */
  const liveHit = mention({
    atIso: "2026-08-30T00:10:21.000Z",
    leg: "live",
    messageKey: "C7:1787942086.747699",
    permalink: "p-live",
    tagged: [],
  });

  /** The window a completed read-around of that conversation claims. */
  const window = {
    channelId: "C7",
    fromIso: "2026-08-29T10:47:20.000Z",
    throughIso: "2026-08-30T12:00:00.000Z",
  };

  it("answers no once its own conversation was read exhaustively over the corpus's blind window", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [window] }),
      mentions: [liveHit],
      prUpdatedAtIso: "2026-08-20T00:00:00.000Z",
    });
    expect(state.asked).toBe("no");
    expect(state.bounded).toBe(true);
  });

  it("still answers unknown when the window belongs to a DIFFERENT conversation", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [{ ...window, channelId: "C8" }] }),
      mentions: [liveHit],
      prUpdatedAtIso: "2026-08-20T00:00:00.000Z",
    });
    expect(state.asked).toBe("unknown");
    expect(state.why).toContain("proves the exhaustive leg is behind");
  });

  it("still answers unknown for a hit that postdates the window the walk actually took", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [{ ...window, throughIso: "2026-08-30T00:00:00.000Z" }] }),
      mentions: [liveHit],
      prUpdatedAtIso: "2026-08-20T00:00:00.000Z",
    });
    expect(state.asked).toBe("unknown");
  });

  it("still answers unknown when the walk failed, because a failed walk claims no window at all", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [] }),
      mentions: [liveHit],
      prUpdatedAtIso: "2026-08-20T00:00:00.000Z",
    });
    expect(state.asked).toBe("unknown");
  });

  it("does not let a window rescue a corpus that never reached the pull request's own last activity", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [window] }),
      mentions: [liveHit],
      prUpdatedAtIso: NOW,
    });
    expect(state.asked).toBe("unknown");
    expect(state.why).toContain("the Slack corpus ends 2026-08-29T10:47:20.000Z");
  });

  it("answers yes when reading around the hit turned up the tagged sibling the search collapsed", () => {
    const state = slackReviewState({
      coverage: coverage({ liveRan: true, neighbourhoods: [window] }),
      mentions: [
        liveHit,
        mention({
          atIso: "2026-08-30T00:12:00.000Z",
          leg: "live",
          messageKey: "C7:1787942206.000100",
          permalink: "p-sibling",
          tagged: ["U9"],
        }),
      ],
      prUpdatedAtIso: NOW,
    });
    expect(state.asked).toBe("yes");
    expect(state.asks.map((ask) => ask.permalink)).toEqual(["p-sibling"]);
  });
});
