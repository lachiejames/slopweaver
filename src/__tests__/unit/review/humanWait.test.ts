/*
 * The five facts on a row waiting on a human. The property: each next act is the
 * one only the missing fact can settle — the owner's word naming a person, an ask, a bump, a sync, a session reading
 * — and staleness is measured from the last ask, or from the request when nobody was asked.
 */

import { describe, expect, it } from "vitest";

import type { BumpVerdict } from "../../../review/cadence.js";
import type { ChannelShare } from "../../../review/channelShare.js";
import { humanWaitOf, type ReviewRequestTimes } from "../../../review/humanWait.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";
import type { SlackReviewState } from "../../../review/reviewState.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";

const NOW = "2026-09-24T17:00:00.000Z";
const TEAM = "@acme/platform";
const PERSON = "@quinn-acme";

/** A request event per name, all at one instant. */
const requested = ({ names, atIso }: { names: readonly string[]; atIso: string }): ReviewRequestTimes => ({
  latestByReviewer: Object.fromEntries(names.map((name) => [name, atIso])),
  truncated: false,
});

/** A message linking the pull request; `tagged` makes it an ask naming that id. */
const mention = ({ tagged = [], atIso }: { tagged?: readonly string[]; atIso: string }): SlackMention => {
  const authoredText =
    `${tagged.map((id) => `<@${id}>`).join(" ")} pls review <https://github.com/o/r/pull/1>`.trimStart();
  const links = findPrLinkSpans({ text: authoredText });
  return {
    association: "linked",
    atIso,
    authoredPrCount: 1,
    authoredText,
    authorId: "U1",
    authorRole: "owner",
    channel: "#dev",
    conversation: "channel",
    counterpartId: "",
    excerpt: "pls review",
    firstLinkAt: firstLinkStart({ spans: links }),
    isDirectMessage: false,
    leg: "corpus",
    linkSpans: links.map((entry) => entry.span),
    mentions: mentionRunsIn({ text: authoredText }),
    messageKey: `C1:${atIso}`,
    permalink: "https://example.slack.com/archives/C1/p1",
    prKey: "o/r#1",
    quotedPrKeys: [],
    tagged,
    threadKey: `C1:${atIso}`,
    threadPrKeys: [],
    versionsDisagree: false,
  };
};

const NOBODY_ASKED: SlackReviewState = { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" };
const NO_BUMP: BumpVerdict = { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" };

describe("humanWaitOf", () => {
  it("asks for the owner's word naming a person when nobody was asked and only a team holds it", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect(wait.next).toBe("name-the-reviewer");
    expect(wait.stale).toBe("yes");
    expect(wait.requestedAtIso).toBe("2026-09-22T05:07:00Z");
    expect(wait.lastAsk).toBe(undefined);
    expect(wait.sentence).toBe(
      "Waiting on @acme/platform · requested 2026-09-22 05:07Z · no ask found · stale — a business day of " +
        "silence (24 business hours, weekends excluded) · next: name a person to ask — only your word is missing",
    );
  });

  it("asks for the owner's word naming a person when GitHub names NOBODY — a BLOCKED, undecided merge", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [] }),
      who: [],
    });
    expect(wait.next).toBe("name-the-reviewer");
    expect(wait.sentence).toBe(
      "Waiting on nobody GitHub names · requested at a time this read did not carry · no ask found · staleness " +
        "unknown · next: name a person to ask — only your word is missing",
    );
  });

  it("is not stale on the Sunday after a Friday-afternoon request — the weekend never counts", () => {
    // Requested Friday late afternoon, read Sunday night, Melbourne time: 53 calendar hours, 7 business hours.
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: "2026-09-27T12:00:00.000Z",
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-25T07:00:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect(wait.stale).toBe("no");
  });

  it("reads ask, the fleet's to draft, when a named person holds it — no word from the owner is missing", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-24T12:00:00Z", names: [TEAM, PERSON] }),
      who: [TEAM, PERSON],
    });
    expect([wait.next, wait.stale]).toStrictEqual(["ask", "no"]);
  });

  it("bumps a day-silent ask and names when it went", () => {
    const ask = mention({ atIso: "2026-09-23T09:00:00.000Z", tagged: ["U9"] });
    const wait = humanWaitOf({
      share: undefined,
      bump: { eligibleSinceIso: "2026-09-24T09:00:00.000Z", kind: "due", silentSinceIso: ask.atIso },
      nowIso: NOW,
      slack: { asked: "yes", asks: [ask], bounded: true, mentioned: "yes", mentions: [ask], why: "" },
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect([wait.next, wait.stale]).toStrictEqual(["bump", "yes"]);
    expect(wait.lastAsk).toStrictEqual({ atIso: ask.atIso, permalink: ask.permalink, to: "U9" });
  });

  it("waits inside the day", () => {
    const ask = mention({ atIso: "2026-09-24T09:00:00.000Z", tagged: ["U9"] });
    const wait = humanWaitOf({
      share: undefined,
      bump: { eligibleAtIso: "2026-09-25T09:00:00.000Z", kind: "too-soon", why: "inside the day" },
      nowIso: NOW,
      slack: { asked: "yes", asks: [ask], bounded: true, mentioned: "yes", mentions: [ask], why: "" },
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect([wait.next, wait.stale]).toStrictEqual(["wait", "no"]);
  });

  it("says sync Slack when the corpus ends before the pull request's last activity, and since when", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: {
        asked: "unknown",
        asks: [],
        bounded: false,
        mentioned: "unknown",
        mentions: [],
        staleThroughIso: "2026-09-25T11:40:22.000Z",
        why: "corpus ends",
      },
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect([wait.next, wait.stale, wait.slackThroughIso]).toStrictEqual([
      "sync-slack",
      "unknown",
      "2026-09-25T11:40:22.000Z",
    ]);
    expect(wait.sentence).toBe(
      `Waiting on ${TEAM} · requested 2026-09-22 05:07Z · no ask found · staleness unknown · next: Slack history stale since 2026-09-25 11:40Z, sync to know`,
    );
  });

  it("claims no staleness when no watermark proves the history behind", () => {
    const wait = humanWaitOf({
      bump: NO_BUMP,
      nowIso: NOW,
      slack: { asked: "unknown", asks: [], bounded: false, mentioned: "unknown", mentions: [], why: "never ingested" },
      share: undefined,
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect([wait.next, wait.slackThroughIso]).toStrictEqual(["sync-slack", undefined]);
    expect(wait.sentence.endsWith("next: Slack history does not settle this, sync to know")).toBe(true);
  });

  it("carries no watermark on an act a sync would not settle, even over a stale window", () => {
    const ask = mention({ atIso: "2026-09-24T09:00:00.000Z", tagged: ["U9"] });
    const wait = humanWaitOf({
      bump: { eligibleAtIso: "2026-09-25T09:00:00.000Z", kind: "too-soon", why: "inside the day" },
      nowIso: NOW,
      slack: {
        asked: "yes",
        asks: [ask],
        bounded: false,
        mentioned: "yes",
        mentions: [ask],
        staleThroughIso: "2026-09-23T00:00:00.000Z",
        why: "",
      },
      share: undefined,
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect([wait.next, wait.slackThroughIso]).toStrictEqual(["wait", undefined]);
  });

  it("never dates a wait off a reviewer the timeline page did not carry", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: NOBODY_ASKED,
      times: { latestByReviewer: { [TEAM]: "2026-09-22T05:07:00Z" }, truncated: true },
      who: [TEAM, PERSON],
    });
    expect([wait.requestedAtIso, wait.stale]).toStrictEqual([undefined, "unknown"]);
  });

  it("dates a team the codeowner read and the timeline spell differently", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: NOW,
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-22T05:07:00Z", names: ["@Acme/Platform"] }),
      who: [TEAM],
    });
    expect(wait.requestedAtIso).toBe("2026-09-22T05:07:00Z");
  });

  it("never dates a team's wait off a person of the same name (the r1 counterexample)", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: "2026-09-25T00:00:00.000Z",
      slack: NOBODY_ASKED,
      times: {
        latestByReviewer: { "@design": "2026-09-24T12:00:00Z", "@acme/design": "2026-09-20T00:00:00Z" },
        truncated: false,
      },
      who: ["@acme/design"],
    });
    expect([wait.requestedAtIso, wait.stale]).toStrictEqual(["2026-09-20T00:00:00Z", "yes"]);
  });

  it("leaves a person's wait undated when only a same-named team was requested", () => {
    const wait = humanWaitOf({
      share: undefined,
      bump: NO_BUMP,
      nowIso: "2026-09-25T00:00:00.000Z",
      slack: NOBODY_ASKED,
      times: { latestByReviewer: { "@acme/design": "2026-09-20T00:00:00Z" }, truncated: true },
      who: ["@design"],
    });
    expect([wait.requestedAtIso, wait.stale]).toStrictEqual([undefined, "unknown"]);
  });
});

describe("humanWaitOf — shared with a channel, nobody named", () => {
  const share = ({ tone }: { tone: ChannelShare["tone"] }): ChannelShare => ({
    asOfIso: NOW,
    asksThroughIso: NOW,
    badge: "no engagement",
    businessDaysSincePost: 1.2,
    channel: "#dev-team",
    lastReplyAtIso: undefined,
    messageKey: "C0SYN000002:1790508621.312739",
    permalink: "https://acme.slack.com/archives/C0SYN000002/p1790508621312739",
    postedAtIso: "2026-09-22T01:30:21.000Z",
    redAfterBusinessDays: 3,
    replies: 0,
    repliesThroughIso: NOW,
    seen: "asks and replies seen through now",
    tone,
    why: "no reply in 1.2 business days since the post",
  });
  const wait = ({ tone }: { tone: ChannelShare["tone"] }) =>
    humanWaitOf({
      bump: NO_BUMP,
      nowIso: NOW,
      share: share({ tone }),
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-22T01:30:10Z", names: [TEAM] }),
      who: [TEAM],
    });

  it("waits on the channel while green, and names the post as the last nudge", () => {
    const green = wait({ tone: "green" });
    expect([green.next, green.stale]).toEqual(["wait-on-channel", "no"]);
    expect(green.sentence).toBe(
      "Waiting on @acme/platform · requested 2026-09-22 01:30Z · shared in #dev-team 2026-09-22 01:30Z, nobody named · not stale · next: the channel has it — name a reviewer if nobody picks it up",
    );
  });

  it("is stale but still waiting on the channel at yellow, and names a reviewer at red", () => {
    const yellow = wait({ tone: "yellow" });
    const red = wait({ tone: "red" });
    expect([yellow.next, yellow.stale, red.next, red.stale]).toEqual([
      "wait-on-channel",
      "yes",
      "name-the-reviewer",
      "yes",
    ]);
  });

  it("says how far Slack was read when the clock was read short of now", () => {
    const behind = humanWaitOf({
      bump: NO_BUMP,
      nowIso: NOW,
      share: { ...share({ tone: "green" }), asOfIso: "2026-09-24T15:19:32.000Z" },
      slack: NOBODY_ASKED,
      times: requested({ atIso: "2026-09-22T01:30:10Z", names: [TEAM] }),
      who: [TEAM],
    });
    expect(behind.sentence).toContain(
      "shared in #dev-team 2026-09-22 01:30Z, nobody named as of the Slack read at 2026-09-24 15:19Z",
    );
  });

  it("says sync Slack on an unknown clock, never a reviewer suggestion the clock has not earned", () => {
    const unknown = wait({ tone: "unknown" });
    expect([unknown.next, unknown.stale]).toEqual(["sync-slack", "unknown"]);
    expect(unknown.sentence).toBe(
      "Waiting on @acme/platform · requested 2026-09-22 01:30Z · shared in #dev-team 2026-09-22 01:30Z, nobody named · staleness unknown · next: Slack history does not settle this, sync to know",
    );
  });
});
