/*
 * The ask trail: the recipients a trail entry names are the classifier's, scoped to THIS pull request, and the
 * first of them is the person the bump verdict judges — never the message's first tag.
 */
import { describe, expect, it } from "vitest";

import { askTrailOf, slackIdsOf } from "../../../review/askTrail.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";
import { askTarget } from "../../../review/reviewState.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";

/** An `#dev-alerts` batch shape — one reviewer per LINE, three pull requests in one message. */
const BATCH =
  "fresh batch of vulnerability-fix PRs for your review:\n" +
  "• <@U0SYN000004> <https://github.com/acme/acme-admin/pull/16996|#16996> bump relay-operation-optimizer\n" +
  "• <@U0SYN000002> <https://github.com/acme/acme-admin/pull/17001|#17001> bump simple-git\n" +
  "• <@U0SYN000006> <https://github.com/acme/acme-admin/pull/17012|#17012> bump fast-xml-parser";

/**
 * One message as the Slack legs hand it over, measured off its own text the way the shell measures it, with
 * only THIS pull request's links kept as its link spans.
 */
function askMention({
  text,
  number,
  atIso = "2026-09-23T04:46:00.000Z",
  messageKey = "C0SYN000002:1790138766.748499",
  conversation = "channel",
  counterpartId = "",
}: {
  text: string;
  number: number;
  atIso?: string;
  messageKey?: string;
  conversation?: SlackMention["conversation"];
  counterpartId?: string;
}): SlackMention {
  const spans = findPrLinkSpans({ text });
  const isDirectMessage = conversation === "direct-message";
  let channel = "#dev-alerts";
  if (isDirectMessage) {
    channel = "Rosa Lindqvist";
  }
  return {
    association: "linked",
    atIso,
    authorId: "U0SYN000001",
    authorRole: "owner",
    authoredPrCount: new Set(spans.map((entry) => entry.ref.number)).size,
    authoredText: text,
    channel,
    conversation,
    counterpartId,
    excerpt: text.slice(0, 40),
    firstLinkAt: firstLinkStart({ spans }),
    isDirectMessage,
    leg: "corpus",
    linkSpans: spans.filter((entry) => entry.ref.number === number).map((entry) => entry.span),
    mentions: mentionRunsIn({ text }),
    messageKey,
    permalink: `https://acme.slack.com/archives/${messageKey.replace(":", "/p").replace(".", "")}`,
    prKey: `acme/acme-admin#${String(number)}`,
    quotedPrKeys: [],
    tagged: mentionRunsIn({ text }).map((run) => run.id),
    threadKey: messageKey,
    threadPrKeys: [],
    versionsDisagree: false,
  };
}

describe("askTrailOf", () => {
  it("names the batch line's own reviewer for the last pull request, never the message's first tag", () => {
    const trail = askTrailOf({ asks: [askMention({ number: 17012, text: BATCH })] });
    expect(trail).toEqual([
      {
        atIso: "2026-09-23T04:46:00.000Z",
        channel: "#dev-alerts",
        isDirectMessage: false,
        leg: "corpus",
        messageKey: "C0SYN000002:1790138766.748499",
        permalink: "https://acme.slack.com/archives/C0SYN000002/p1790138766748499",
        recipients: ["U0SYN000006"],
      },
    ]);
  });

  it("puts the bump verdict's own target first, so the name beside 'ask again' is the one it judged", () => {
    const asks = [
      askMention({ number: 17001, text: BATCH }),
      askMention({ atIso: "2026-09-20T01:00:00.000Z", messageKey: "C1:1", number: 17001, text: BATCH }),
    ];
    const trail = askTrailOf({ asks });
    expect(trail[0]!.recipients[0]).toBe(askTarget({ mention: asks[0]! }));
    expect(trail.map((ask) => ask.atIso)).toEqual(["2026-09-23T04:46:00.000Z", "2026-09-20T01:00:00.000Z"]);
  });

  it("names the counterpart of a direct message that tags nobody", () => {
    const trail = askTrailOf({
      asks: [
        askMention({
          conversation: "direct-message",
          counterpartId: "U0SYN000002",
          number: 17001,
          text: "could you review <https://github.com/acme/acme-admin/pull/17001> when you get a chance",
        }),
      ],
    });
    expect(trail.map((ask) => [ask.channel, ask.isDirectMessage, ask.recipients])).toEqual([
      ["Rosa Lindqvist", true, ["U0SYN000002"]],
    ]);
  });

  it("drops a message the classifier does not certify, rather than carrying an entry that names nobody", () => {
    const fyi = askMention({ number: 17001, text: "fyi <https://github.com/acme/acme-admin/pull/17001> merged" });
    expect(askTrailOf({ asks: [fyi] })).toEqual([]);
  });
});

describe("slackIdsOf", () => {
  it("lists every recipient once, in first-seen order", () => {
    const one = askTrailOf({ asks: [askMention({ number: 17012, text: BATCH })] });
    const two = askTrailOf({ asks: [askMention({ number: 16996, text: BATCH })] });
    expect(slackIdsOf({ trails: [one, two, one, []] })).toEqual(["U0SYN000006", "U0SYN000004"]);
  });
});
