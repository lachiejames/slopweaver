/**
 * The repeat matcher: what "the same message" means, read the same way off an outgoing payload and a stored
 * one. The incident fixture is a #defects pair — two cuts of one finding whose bytes differed and whose
 * first line did not.
 */
import { describe, expect, it } from "vitest";

import {
  DAY_MS,
  findRepeat,
  isOwnMessage,
  normaliseRepeatText,
  priorsFromRaw,
  type RepeatPrior,
  repeatIdentity,
  repeatTextOf,
} from "../../../../outbound/slack/repeatMatch.js";

const WORKSPACE = "https://acme.slack.com/";
const BUGS = "C0SYN000003";
const SELF_USER = "U0SYN000001";

/** The earlier cut that stayed. */
const FIRST_CUT =
  "*P2 in production, not tracked yet:* every third-party provider `time_slots` call for the Acme Booking Service has 404'd since 24 Sep\n\n" +
  "<https://app.datadoghq.com/logs?q=x|3 graphs> show it is every call, not a spike.";
/** The later hand-composed cut: same opening line, different body. */
const SECOND_CUT =
  "P2 in production, not tracked yet: every third-party provider time_slots call for the acme booking service has 404'd since 24 sep\n" +
  "Blast radius: every acme booking.";

/** A prior at a given instant, built through the same path a real read takes. */
function priorAt({ text, ts }: { text: string; ts: string }): RepeatPrior {
  const [prior] = priorsFromRaw({
    channel: BUGS,
    rawMessages: [{ text, ts, user: SELF_USER }],
    self: { userId: SELF_USER },
    workspaceUrl: WORKSPACE,
  });
  return prior!;
}

const WINDOWS = { digestWindowMs: 7 * DAY_MS, firstLineWindowMs: 7 * DAY_MS };

describe("normaliseRepeatText", () => {
  it("reduces mrkdwn to the words a reader sees", () => {
    expect(normaliseRepeatText({ text: "*Hi*  <https://x.io/a|the  Link> &amp; `<@U1|ada>`\n\n  Next  " })).toBe(
      "hi the link & <@u1>\nnext",
    );
  });

  it("keeps a bare link as its url", () => {
    expect(normaliseRepeatText({ text: "see <https://x.io/a>" })).toBe("see https://x.io/a");
  });
});

describe("repeatIdentity", () => {
  it("gives the two incident cuts one first line and two digests", () => {
    const first = repeatIdentity({ text: FIRST_CUT });
    const second = repeatIdentity({ text: SECOND_CUT });
    expect(first.firstLine).toBe(
      // `_` is an emphasis marker to the normaliser, so it goes wherever it stands — the same on both sides.
      "p2 in production, not tracked yet: every third-party provider timeslots call for the acme booking service has 404'd since 24 sep",
    );
    expect(second.firstLine).toBe(first.firstLine);
    expect(second.digest).not.toBe(first.digest);
    expect(first.firstLineCounts).toBe(true);
  });

  it("does not count a short opener under the floor", () => {
    expect(repeatIdentity({ text: "thanks" }).firstLineCounts).toBe(false);
  });
});

describe("findRepeat", () => {
  it("catches the incident's second cut on its first line, naming the first cut's permalink", () => {
    const prior = priorAt({ text: FIRST_CUT, ts: "1790604264.247109" });
    const match = findRepeat({
      ...WINDOWS,
      nowMs: 1790611538684,
      outgoing: repeatIdentity({ text: SECOND_CUT }),
      priors: [prior],
    });
    expect(match!.rule).toBe("first-line");
    expect(match!.prior.permalink).toBe("https://acme.slack.com/archives/C0SYN000003/p1790604264247109");
  });

  it("catches a short message by its digest alone", () => {
    const prior = priorAt({ text: "Thanks!", ts: "1790604264.247109" });
    const match = findRepeat({
      ...WINDOWS,
      nowMs: 1790604300000,
      outgoing: repeatIdentity({ text: "thanks!" }),
      priors: [prior],
    });
    expect(match!.rule).toBe("digest");
  });

  it("does not match a short shared opener with a different body", () => {
    const prior = priorAt({ text: "hey\nthe build is red", ts: "1790604264.247109" });
    const match = findRepeat({
      ...WINDOWS,
      nowMs: 1790604300000,
      outgoing: repeatIdentity({ text: "hey\nthe deploy is done" }),
      priors: [prior],
    });
    expect(match).toBeUndefined();
  });

  it("lets a prior older than the window pass", () => {
    const prior = priorAt({ text: FIRST_CUT, ts: "1790604264.247109" });
    const match = findRepeat({
      ...WINDOWS,
      nowMs: 1790604264247 + 7 * DAY_MS + 1,
      outgoing: repeatIdentity({ text: FIRST_CUT }),
      priors: [prior],
    });
    expect(match).toBeUndefined();
  });

  it("names the EARLIEST matching prior", () => {
    const later = priorAt({ text: FIRST_CUT, ts: "1790610000.000100" });
    const earlier = priorAt({ text: FIRST_CUT, ts: "1790604264.247109" });
    const match = findRepeat({
      ...WINDOWS,
      nowMs: 1790611538684,
      outgoing: repeatIdentity({ text: FIRST_CUT }),
      priors: [later, earlier],
    });
    expect(match!.prior.ts).toBe("1790604264.247109");
  });
});

describe("repeatTextOf", () => {
  it("reads text when it has any", () => {
    expect(repeatTextOf({ message: { attachments: [{ fallback: "f" }], text: "t" } })).toBe("t");
  });

  it("reads a card's wrapper fallback when text is empty", () => {
    expect(repeatTextOf({ message: { attachments: [{ fallback: "the card" }], text: "" } })).toBe("the card");
  });

  it("answers undefined for a message with no words", () => {
    expect(repeatTextOf({ message: { text: " " } })).toBeUndefined();
  });
});

describe("isOwnMessage and priorsFromRaw", () => {
  it("matches the bot by bot_id and the owner by user", () => {
    expect(isOwnMessage({ message: { bot_id: "B1", user: "U9" }, self: { botId: "B1" } })).toBe(true);
    expect(isOwnMessage({ message: { user: "U9" }, self: { botId: "B1", userId: SELF_USER } })).toBe(false);
  });

  it("keeps own messages, drops joins, and threads a reply under its root", () => {
    const priors = priorsFromRaw({
      channel: BUGS,
      rawMessages: [
        { text: "root", thread_ts: "1790604264.247109", ts: "1790604264.247109", user: SELF_USER },
        { text: "reply", thread_ts: "1790604264.247109", ts: "1790604300.000100", user: SELF_USER },
        { subtype: "channel_join", text: "joined", ts: "1790604301.000100", user: SELF_USER },
        { text: "someone else", ts: "1790604302.000100", user: "U2" },
      ],
      self: { userId: SELF_USER },
      workspaceUrl: WORKSPACE,
    });
    expect(priors.map((prior) => [prior.ts, prior.threadTs])).toEqual([
      ["1790604264.247109", undefined],
      ["1790604300.000100", "1790604264.247109"],
    ]);
    expect(priors[1]!.permalink).toBe(
      "https://acme.slack.com/archives/C0SYN000003/p1790604300000100?thread_ts=1790604264.247109&cid=C0SYN000003",
    );
  });
});
