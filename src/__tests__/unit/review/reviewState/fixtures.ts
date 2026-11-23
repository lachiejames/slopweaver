/*
 * The shared clock and builders the `reviewState` split's test files read: the instant a review state is read
 * at, the instant a chase is read at, and a Slack mention and Slack coverage with a test's own fields laid over.
 */
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../../review/prLink.js";
import type { SlackCoverage, SlackMention } from "../../../../review/slackEvidenceTypes.js";

/** When a review state is read: a Sunday, two days after the Friday asks the cases build. */
export const NOW = "2026-08-30T12:00:00.000Z";

/**
 * When a chase is read: a Monday night in Melbourne, 36 business hours after the Friday-morning asks below,
 * so it is due. {@link NOW} is a Sunday and would count only Friday's fourteen — the weekend never counts.
 */
export const CHASE_NOW = "2026-08-31T12:00:00.000Z";

/**
 * A Slack mention, with the fields a test cares about overridden.
 *
 * The authored text is DERIVED from `tagged` unless a test supplies its own, exactly as the effectful shell
 * derives the tags from the text — so `tagged: ["U9"]` means "the owner wrote a review ask naming U9", which is
 * what every call site here has always meant. A test that needs different words passes `authoredText`.
 *
 * @returns a complete mention linking `o/r#1`, with every field `over` names laid on top
 */
export const mention = (over: Partial<SlackMention> = {}): SlackMention => {
  const {
    tagged = [],
    authoredText = `${tagged.map((id) => `<@${id}>`).join(" ")} pls review <https://github.com/o/r/pull/1>`.trimStart(),
  } = over;
  const links = findPrLinkSpans({ text: authoredText });
  return {
    atIso: "2026-08-28T18:34:46.000Z",
    authoredPrCount: new Set(links.map((entry) => `${entry.ref.owner}/${entry.ref.repo}#${entry.ref.number}`)).size,
    authoredText,
    firstLinkAt: firstLinkStart({ spans: links }),
    versionsDisagree: false,
    quotedPrKeys: [],
    authorId: "U1",
    authorRole: "owner",
    channel: "#a-channel",
    conversation: "channel",
    counterpartId: "",
    excerpt: "could you review",
    isDirectMessage: false,
    leg: "corpus",
    linkSpans: links.map((entry) => entry.span),
    mentions: mentionRunsIn({ text: authoredText }),
    messageKey: "C1:1",
    threadKey: "C1:1",
    association: "linked",
    threadPrKeys: [],
    permalink: "https://example.slack.com/archives/C1/p1",
    prKey: "o/r#1",
    tagged,
    ...over,
  };
};

/**
 * Slack coverage, with the fields a test cares about overridden.
 *
 * @returns coverage whose corpus reaches a fixed instant with no live leg, under whatever `over` names
 */
export const coverage = (over: Partial<SlackCoverage> = {}): SlackCoverage => ({
  corpusThroughIso: "2026-08-29T10:47:20.000Z",
  liveRan: false,
  neighbourhoods: [],
  shareThreads: {},
  residue: [],
  ...over,
});
