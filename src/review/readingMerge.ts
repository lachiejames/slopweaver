/**
 * A visible session's readings, laid over the mentions the Slack legs found for one pull request.
 *
 * The classifier answers `undecided` exactly where a message needs reading, and `github reviewer read` is
 * where a reader writes the answer down (`./reviewerRegister.ts`'s `read` row). This module is how the landing
 * honours it: a reading of a message a leg found attaches to that mention, and {@link askDecisionFor} answers
 * with it before the classifier — so the ask trail, the bump verdict and the human wait all see it.
 *
 * It attaches only to words a leg can still vouch for, so an edit never leaves a verdict about words no longer
 * there. The copy must still carry the quoted line, and its edited versions must agree: the classifier abstains
 * there on purpose, and the copy matched may be the older one. A PIN copy is ordered against its message's
 * edits by the scan (`./slackEvidenceScan.ts`'s `currentVersions`).
 *
 * A reading of a message NO leg returned adds nothing — its words cannot be re-checked here, and every anchor
 * tried for it let an edit leave an ask standing. MEASURED over the owner's real acme-admin pull requests:
 * every one of the 57 readings that settled "not known who was asked"
 * matched a mention a leg found; none needed the join.
 *
 * Pure.
 */
import { classifyReviewCandidate } from "./askClassification.js";
import type { AskDecision } from "./evidence.js";
import type { ReviewerReadRow } from "./reviewerRegister.js";
import type { MentionReading, SlackMention } from "./slackEvidenceTypes.js";

/** The rule id a decision carries when a visible session's reading made it. */
const VISIBLE_READ_RULE = "visible-read";

/**
 * A recorded reading as the decision it stands for. The request span is the quoted line, located in the
 * message's own words — a reading attaches only while they still carry it.
 *
 * @param reading the reading a mention carries
 * @param text the message's own words
 * @returns the ask with its recipients, or the non-ask with its reason
 */
function readingDecision({ reading, text }: { reading: MentionReading; text: string }): AskDecision {
  if (reading.verdict === "non-ask") {
    return { kind: "non-ask", ruleId: VISIBLE_READ_RULE, why: reading.why };
  }
  const start = Math.max(0, text.indexOf(reading.quote));
  return {
    kind: "ask",
    recipients: reading.recipients,
    request: { end: start + reading.quote.length, start, text: reading.quote },
    ruleId: VISIBLE_READ_RULE,
  };
}

/**
 * What one message proves about one pull request — delegated to `./askClassification.ts`, never re-decided.
 *
 * It is never decided STRUCTURALLY: a tagged id that is not the poster does not make a message an ask, and
 * a link in a direct message does not make one with no tag. A message merely containing the link, or the
 * link plus the word review, is NOT an ask; the measurements behind that are in `./askClassification.ts`.
 *
 * A visible session's recorded reading answers first (`ruleId` `visible-read`): the classifier abstains
 * exactly where a reader is needed, and a reading is that reader's answer, carrying the line it rests on.
 *
 * @param mention one message that linked the pull request
 * @returns the ask, the certified non-ask, or the abstention
 */
export function askDecisionFor({ mention }: { mention: SlackMention }): AskDecision {
  const { reading } = mention;
  if (reading !== undefined) {
    return readingDecision({ reading, text: mention.authoredText });
  }
  return classifyReviewCandidate({
    candidate: {
      authoredPrCount: mention.authoredPrCount,
      authoredText: mention.authoredText,
      authorId: mention.authorId,
      firstLinkAt: mention.firstLinkAt,
      versionsDisagree: mention.versionsDisagree,
      quotedPrKeys: mention.quotedPrKeys,
      threadPrKeys: mention.threadPrKeys,
      authorRole: mention.authorRole,
      conversation: mention.conversation,
      counterpartId: mention.counterpartId,
      linkSpans: mention.linkSpans,
      mentions: mention.mentions,
      prKey: mention.prKey,
    },
  });
}

/**
 * One row as the reading a mention carries.
 *
 * @returns the reading
 */
function readingOf({ row }: { row: ReviewerReadRow }): MentionReading {
  if (row.verdict === "ask") {
    return { quote: row.quote, recipients: row.recipients, verdict: "ask" };
  }
  let why = "a visible session read it as not an ask";
  if (row.why !== undefined) {
    why = row.why;
  }
  return { quote: row.quote, verdict: "non-ask", why };
}

/**
 * One pull request's mentions with its readings applied: each mention a reading names carries it while the
 * copy still vouches for the quoted line. Order is unchanged.
 *
 * @param mentions what the Slack legs found for this pull request
 * @param readings this pull request's readings, by message key
 * @returns the mentions the landing classifies
 */
export function applyReadings({
  mentions,
  readings,
}: {
  mentions: readonly SlackMention[];
  readings: ReadonlyMap<string, ReviewerReadRow> | undefined;
}): readonly SlackMention[] {
  if (readings === undefined || readings.size === 0) {
    return mentions;
  }
  return mentions.map((mention) => {
    const row = readings.get(mention.messageKey);
    const vouches = row !== undefined && !mention.versionsDisagree && mention.authoredText.includes(row.quote);
    if (!vouches) {
      return mention;
    }
    return { ...mention, reading: readingOf({ row }) };
  });
}
