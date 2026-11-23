/**
 * The top-level answer rule: both halves — what it ties to our ask, from the two real cases in #C0SYN000001, and the
 * channel moving on that it must not.
 */
import { describe, expect, it } from "vitest";

import { type TopLevelMessage, topLevelTieOf } from "../../../../outbound/slack/topLevelAnswer.js";

const SELF = "U0SYNADAOWN";
/** A Wednesday, 13:48:58 in Melbourne — the real ask to Ari. */
const ASK_SECONDS = 1_791_341_338;
const FRACTION = "708319";

/**
 * A Slack ts a number of seconds after the ask.
 *
 * @param after seconds after the ask, negative for before it
 * @returns the ts, with the ask's own fraction
 */
function at({ after }: { after: number }): string {
  return `${String(ASK_SECONDS + after)}.${FRACTION}`;
}

/** The ask to Ari by name. */
const TO_ARI: TopLevelMessage = {
  text: "Hey <@U0ARI>, are you already chasing any of these?",
  ts: at({ after: 0 }),
  userId: SELF,
};

/**
 * A person's top-level post.
 *
 * @param userId who wrote it
 * @param after seconds after the ask
 * @returns the post
 */
function post({ userId, after }: { userId: string; after: number }): TopLevelMessage {
  return { text: `from ${userId}`, ts: at({ after }), userId };
}

describe("topLevelTieOf — what reads as the answer", () => {
  it("ties the person ours tagged, answering 27 seconds later as the next top-level message", () => {
    const ari = post({ after: 27, userId: "U0ARI" });
    expect(topLevelTieOf({ ask: TO_ARI, posts: [post({ after: 30, userId: "U0ARI" }), ari] })).toEqual({
      kind: "answers",
      post: ari,
    });
  });

  it("ties a member of a group ours tagged, answering four minutes later, though ours named somebody else", () => {
    const ask: TopLevelMessage = {
      text: "<!subteam^S0PLAT> <@U0TOBIAS> <@U0SYNADAOWN> do we already have a plan for who's coordinating the audit?",
      ts: at({ after: 0 }),
      userId: SELF,
    };
    const rosa = post({ after: 242, userId: "U0ROSA" });
    expect(topLevelTieOf({ ask, posts: [rosa] })).toEqual({ kind: "answers", post: rosa });
  });

  it("ties a file shared with a comment, and skips what is nobody's word without breaking adjacency", () => {
    const between: readonly TopLevelMessage[] = [
      post({ after: -60, userId: "U0SETH" }),
      { ...post({ after: 0, userId: SELF }) },
      { ...post({ after: 5, userId: SELF }), text: "also, one more thing" },
      { botId: "B0CI", text: "deploy finished", ts: at({ after: 6 }), userId: "U0CIAPP" },
      { appId: "A0LINEAR", text: "issue synced", ts: at({ after: 7 }), userId: "U0LINEAR" },
      { subtype: "channel_join", text: "joined", ts: at({ after: 8 }), userId: "U0NEW" },
      { subtype: "thread_broadcast", text: "a reply elsewhere", ts: at({ after: 9 }), userId: "U0SETH" },
      { text: "no author", ts: at({ after: 10 }) },
    ];
    const shared: TopLevelMessage = { ...post({ after: 40, userId: "U0ARI" }), subtype: "file_share" };
    expect([
      topLevelTieOf({ ask: TO_ARI, posts: [...between, shared] }),
      topLevelTieOf({ ask: TO_ARI, posts: between }),
    ]).toEqual([{ kind: "answers", post: shared }, undefined]);
  });

  it("reads an ask tagging only ourselves as open, so the next person's prompt post answers it", () => {
    const ask: TopLevelMessage = { text: "<@U0SYNADAOWN> should we revisit this?", ts: at({ after: 0 }), userId: SELF };
    const seth = post({ after: 60, userId: "U0SETH" });
    expect(topLevelTieOf({ ask, posts: [seth] })).toEqual({ kind: "answers", post: seth });
  });

  it("reads a mention or broadcast written inside code as no tag, so the ask stays open", () => {
    const seth = post({ after: 60, userId: "U0SETH" });
    const inline: TopLevelMessage = {
      text: "`<@U0ARI>` should we revisit this?",
      ts: at({ after: 0 }),
      userId: SELF,
    };
    const fenced: TopLevelMessage = { ...inline, text: "```<@U0ARI>``` should we revisit this?" };
    const broadcast: TopLevelMessage = { ...inline, text: "`<!here>` <@U0ARI> should we revisit this?" };
    expect([
      topLevelTieOf({ ask: inline, posts: [seth] }),
      topLevelTieOf({ ask: fenced, posts: [seth] }),
      topLevelTieOf({ ask: broadcast, posts: [seth] }),
    ]).toEqual([
      { kind: "answers", post: seth },
      { kind: "answers", post: seth },
      { kind: "may-answer", post: seth },
    ]);
  });

  it("ties a file shared with no comment at all, as a thread does: a screenshot can be the answer", () => {
    const screenshot: TopLevelMessage = { subtype: "file_share", text: "", ts: at({ after: 27 }), userId: "U0ARI" };
    expect(topLevelTieOf({ ask: TO_ARI, posts: [screenshot] })).toEqual({ kind: "answers", post: screenshot });
  });

  it("holds a post one microsecond past the window's far edge, never tying it on a rounded instant", () => {
    const past: TopLevelMessage = { text: "yes", ts: `${String(ASK_SECONDS + 7200)}.708320`, userId: "U0ARI" };
    expect(topLevelTieOf({ ask: TO_ARI, posts: [past] })).toEqual({ kind: "may-answer", post: past });
  });

  it("includes the window's far edge, two hours to the microsecond, and holds one second past it", () => {
    const edge = post({ after: 7200, userId: "U0ARI" });
    const past = post({ after: 7201, userId: "U0ARI" });
    expect([topLevelTieOf({ ask: TO_ARI, posts: [edge] }), topLevelTieOf({ ask: TO_ARI, posts: [past] })]).toEqual([
      { kind: "answers", post: edge },
      { kind: "may-answer", post: past },
    ]);
  });
});

describe("topLevelTieOf — what is the owner's to judge", () => {
  it("holds the next post by somebody ours did not ask, inside the window", () => {
    const seth = post({ after: 60, userId: "U0SETH" });
    expect(topLevelTieOf({ ask: TO_ARI, posts: [seth] })).toEqual({ kind: "may-answer", post: seth });
  });

  it("holds a later post by the person ours tagged, past unrelated traffic, within the business day", () => {
    const ari = post({ after: 5 * 3600, userId: "U0ARI" });
    const posts = [post({ after: 3 * 3600, userId: "U0SETH" }), ari];
    expect(topLevelTieOf({ ask: TO_ARI, posts })).toEqual({ kind: "may-answer", post: ari });
  });

  it("reads the horizon in business time: Friday 16:00 to Monday 10:00 is inside one business day", () => {
    // Friday 16:00 in Melbourne, then Monday 10:00 — 66 hours on the wall, 18 business hours.
    const ask: TopLevelMessage = { ...TO_ARI, ts: "1791522000.000000" };
    const monday: TopLevelMessage = { text: "back, yes", ts: "1791759600.000000", userId: "U0ARI" };
    expect(topLevelTieOf({ ask, posts: [monday] })).toEqual({ kind: "may-answer", post: monday });
  });

  it("includes the business day's far edge to the second, and nothing one second past it", () => {
    const edge = post({ after: 86_400, userId: "U0ARI" });
    const past = post({ after: 86_401, userId: "U0ARI" });
    expect([topLevelTieOf({ ask: TO_ARI, posts: [edge] }), topLevelTieOf({ ask: TO_ARI, posts: [past] })]).toEqual([
      { kind: "may-answer", post: edge },
      undefined,
    ]);
  });

  it("ties nothing one microsecond past the business day's far edge", () => {
    const past: TopLevelMessage = { text: "answer", ts: "1791427738.708320", userId: "U0ARI" };
    expect(topLevelTieOf({ ask: TO_ARI, posts: [past] })).toBe(undefined);
  });

  it("measures the far edge to the microsecond across a weekend: Friday 16:00:00.5 to Monday 16:00:00.5", () => {
    const ask: TopLevelMessage = { ...TO_ARI, ts: "1791522000.500000" };
    const edge: TopLevelMessage = { text: "back, yes", ts: "1791781200.500000", userId: "U0ARI" };
    const past: TopLevelMessage = { ...edge, ts: "1791781200.500001" };
    expect([topLevelTieOf({ ask, posts: [edge] }), topLevelTieOf({ ask, posts: [past] })]).toEqual([
      { kind: "may-answer", post: edge },
      undefined,
    ]);
  });
});

describe("topLevelTieOf — the channel moving on, never read as an answer", () => {
  it("ties nothing to an open ask whose next post lands three hours later", () => {
    const ask: TopLevelMessage = { text: "does anyone know who owns the audit?", ts: at({ after: 0 }), userId: SELF };
    expect(topLevelTieOf({ ask, posts: [post({ after: 3 * 3600, userId: "U0SETH" })] })).toBe(undefined);
  });

  it("ties nothing to somebody else's post past the window when ours named a person", () => {
    expect(topLevelTieOf({ ask: TO_ARI, posts: [post({ after: 3 * 3600, userId: "U0SETH" })] })).toBe(undefined);
  });

  it("ties nothing when the ask's own ts is unreadable", () => {
    const ask: TopLevelMessage = { ...TO_ARI, ts: "not-a-ts" };
    expect(topLevelTieOf({ ask, posts: [post({ after: 27, userId: "U0ARI" })] })).toBe(undefined);
  });
});
