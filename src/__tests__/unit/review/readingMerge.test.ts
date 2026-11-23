/*
 * A visible session's readings laid over a pull request's Slack mentions: the override a reading makes, the
 * ask it contributes when no leg found the message, and the edit that retires it — each carried through
 * `slackReviewState` and the ask trail, which is what the pull-request page draws.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { askTrailOf } from "../../../review/askTrail.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";
import { applyReadings, askDecisionFor } from "../../../review/readingMerge.js";
import {
  type ReviewerReadRow,
  type ReviewerRow,
  readingsByPr,
  validateReviewerRow,
} from "../../../review/reviewerRegister.js";
import { slackReviewState } from "../../../review/reviewState.js";
import type { SlackCoverage, SlackMention } from "../../../review/slackEvidenceTypes.js";

const PR = "acme/acme-admin#17648";

/** The batch message the classifier abstains on: addressed, no request verb. */
const BATCH_TEXT =
  "<@U0JASPER> <@U0JONAH> got another batch of these • <https://github.com/acme/acme-admin/pull/17648|#17648>";

/** Where the batch links its pull request, measured the way the legs measure it. */
const BATCH_LINKS = findPrLinkSpans({ text: BATCH_TEXT });

/** A mention of the batch, as the corpus leg returns it. */
const batch: SlackMention = {
  association: "linked",
  atIso: "2026-09-23T08:28:21.000Z",
  authorId: "U0SYNADAOWN",
  authorRole: "owner",
  authoredPrCount: 1,
  authoredText: BATCH_TEXT,
  channel: "#dev-graphql",
  conversation: "channel",
  counterpartId: "",
  excerpt: "got another batch",
  firstLinkAt: firstLinkStart({ spans: BATCH_LINKS }),
  isDirectMessage: false,
  leg: "corpus",
  linkSpans: BATCH_LINKS.map((entry) => entry.span),
  mentions: mentionRunsIn({ text: BATCH_TEXT }),
  messageKey: "C0AV:1790152101.764139",
  permalink: "https://acme.slack.com/archives/C0AV/p1790152101764139",
  prKey: PR,
  quotedPrKeys: [],
  tagged: ["U0JASPER", "U0JONAH"],
  threadKey: "C0AV:1788092874.386579",
  threadPrKeys: [],
  versionsDisagree: false,
};

/** Coverage whose watermark bounds an absence, so a settled row can read `no`. */
const bounded: SlackCoverage = {
  corpusThroughIso: "2026-09-25T00:00:00.000Z",
  liveRan: false,
  neighbourhoods: [],
  shareThreads: {},
  residue: [],
};

/** An ask reading of the batch. */
const askRead: ReviewerReadRow = {
  atIso: "2026-09-23T08:28:21.000Z",
  bySession: "s1",
  channel: "C0AV",
  isDirectMessage: false,
  kind: "read",
  messageKey: "C0AV:1790152101.764139",
  number: 17648,
  permalink: "https://acme.slack.com/archives/C0AV/p1790152101764139",
  prKey: PR,
  quote: "<@U0JASPER> <@U0JONAH> got another batch of these",
  readAtIso: "2026-09-25T03:00:00.000Z",
  recipients: ["U0JASPER", "U0JONAH"],
  repoSlug: "acme/acme-admin",
  schema: 1,
  verdict: "ask",
};

/** The batch root's thread, as `channel:rootTs`. */
const ROOT_KEY = "C0AV:1789775392.910229";

/** An ask reading of that root. */
const rootRead: ReviewerReadRow = {
  ...askRead,
  atIso: "2026-09-18T23:49:52.000Z",
  messageKey: ROOT_KEY,
  permalink: "https://acme.slack.com/archives/C0AV/p1789775392910229",
  quote: "<@U0ROSA> <https://github.com/acme/acme-admin/pull/17648|#17648>",
  recipients: ["U0ROSA"],
};

/** A reply in that thread reaching the pull request only through the root — all the corpus returned. */
const inheritor: SlackMention = {
  ...batch,
  association: "thread",
  atIso: "2026-09-19T00:10:00.000Z",
  authoredText: "Bump for review on these",
  excerpt: "Bump for review on these",
  firstLinkAt: -1,
  linkSpans: [],
  mentions: [],
  messageKey: "C0AV:1789776600.000100",
  permalink: "https://acme.slack.com/archives/C0AV/p1789776600000100",
  tagged: [],
  threadKey: ROOT_KEY,
  threadPrKeys: [PR],
};

/**
 * One pull request's readings, as the landing hands them over.
 *
 * @returns the readings by message key
 */
function readingsOf({ rows }: { rows: readonly ReviewerRow[] }): ReadonlyMap<string, ReviewerReadRow> {
  return readingsByPr({ rows }).get(PR)!;
}

describe("the classifier alone", () => {
  it("abstains on the batch, so the page reads not known — the case a reading exists for", () => {
    expect(askDecisionFor({ mention: batch }).kind).toBe("undecided");
    const state = slackReviewState({ coverage: bounded, mentions: [batch], prUpdatedAtIso: batch.atIso });
    expect(state.asked).toBe("unknown");
  });
});

describe("applyReadings", () => {
  it("turns an abstention into the ask the reading names, trail and all", () => {
    const mentions = applyReadings({
      mentions: [batch],
      readings: readingsOf({ rows: [askRead] }),
    });
    const state = slackReviewState({ coverage: bounded, mentions, prUpdatedAtIso: batch.atIso });
    expect(state.asked).toBe("yes");
    expect(askTrailOf({ asks: state.asks })).toEqual([
      {
        atIso: "2026-09-23T08:28:21.000Z",
        channel: "#dev-graphql",
        isDirectMessage: false,
        leg: "corpus",
        messageKey: "C0AV:1790152101.764139",
        permalink: batch.permalink,
        recipients: ["U0JASPER", "U0JONAH"],
      },
    ]);
    expect(askDecisionFor({ mention: mentions[0]! })).toMatchObject({
      request: { start: 0, text: askRead.quote },
      ruleId: "visible-read",
    });
  });

  it("settles a non-ask, so a bounded window reads nobody asked rather than not known", () => {
    const nonAsk: ReviewerReadRow = { ...askRead, recipients: [], verdict: "non-ask", why: "a status line" };
    const mentions = applyReadings({
      mentions: [batch],
      readings: readingsOf({ rows: [nonAsk] }),
    });
    const state = slackReviewState({ coverage: bounded, mentions, prUpdatedAtIso: batch.atIso });
    expect([state.asked, state.asks.length]).toEqual(["no", 0]);
  });

  it("leaves the classifier's answer standing once an edit removed the quoted line", () => {
    const edited = { ...batch, authoredText: BATCH_TEXT.replace("got another batch of these", "a different batch") };
    const mentions = applyReadings({
      mentions: [edited],
      readings: readingsOf({ rows: [askRead] }),
    });
    expect(mentions[0]!.reading).toBeUndefined();
    expect(slackReviewState({ coverage: bounded, mentions, prUpdatedAtIso: batch.atIso }).asked).toBe("unknown");
  });

  it("adds nothing for an ask reading of a message no leg returned, even while a reply inherits from it", () => {
    expect(applyReadings({ mentions: [inheritor], readings: readingsOf({ rows: [rootRead] }) })).toEqual([inheritor]);
    expect(applyReadings({ mentions: [], readings: readingsOf({ rows: [rootRead] }) })).toEqual([]);
  });

  it("does not attach a reading to a message whose edited versions disagree", () => {
    const disagreeing: SlackMention = { ...batch, versionsDisagree: true };
    const mentions = applyReadings({ mentions: [disagreeing], readings: readingsOf({ rows: [askRead] }) });
    expect(mentions[0]!.reading).toBeUndefined();
  });

  it("adds nothing for a non-ask reading of a message no leg found, and passes mentions through with none", () => {
    const stray: ReviewerReadRow = {
      ...askRead,
      messageKey: "C0AV:1",
      recipients: [],
      verdict: "non-ask",
      why: "status",
    };
    expect(applyReadings({ mentions: [batch], readings: readingsOf({ rows: [stray] }) })).toEqual([batch]);
    expect(applyReadings({ mentions: [batch], readings: undefined })).toEqual([batch]);
  });
});

describe("the read row", () => {
  it("orders readings by instant, not by how the timestamp was spelled", () => {
    const later: ReviewerReadRow = { ...askRead, readAtIso: "2026-09-25T03:00:00.5Z", recipients: ["U0JONAH"] };
    const earlier: ReviewerReadRow = { ...askRead, readAtIso: "2026-09-25T03:00:00.100Z" };
    expect(readingsOf({ rows: [later, earlier] }).get(askRead.messageKey)!.recipients).toEqual(["U0JONAH"]);
  });

  it("lets a later reading of the same message supersede an earlier one", () => {
    const corrected: ReviewerReadRow = { ...askRead, readAtIso: "2026-09-25T04:00:00.000Z", recipients: ["U0JONAH"] };
    expect(readingsOf({ rows: [corrected, askRead] }).get(askRead.messageKey)!.recipients).toEqual(["U0JONAH"]);
  });

  it("validates an ask with recipients and refuses an ask naming nobody or a non-ask with no why", () => {
    expect(unwrap(validateReviewerRow({ lineNumber: 1, value: askRead }))).toEqual(askRead);
    const nobody = validateReviewerRow({ lineNumber: 2, value: { ...askRead, recipients: [] } });
    const noWhy = validateReviewerRow({ lineNumber: 3, value: { ...askRead, recipients: [], verdict: "non-ask" } });
    expect(nobody._unsafeUnwrapErr().message).toContain("an ask names at least one recipient");
    expect(noWhy._unsafeUnwrapErr().message).toContain("a non-ask names nobody and carries the why");
    const elsewhere = validateReviewerRow({ lineNumber: 4, value: { ...askRead, prKey: "acme/acme-admin#1" } });
    expect(elsewhere._unsafeUnwrapErr().message).toContain("prKey is the repository and number the row names");
  });
});
