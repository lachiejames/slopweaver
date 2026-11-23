/**
 * The queue card for a review of somebody else's pull request, parked under the owner's name — the sibling of `postCard`
 * (`./postCard.ts`) for GitHub rather than Slack.
 *
 * The owner approves the draft review comments on the relevant lines in a queue card, as they do Slack native UI
 * drafts. The card carries the verdict, the why and the one command the owner's yes becomes; the panel (`../components/console/ReviewDraft.tsx`) draws every comment
 * on its hunk. Every option is a command rather than a button: the console posts nothing.
 */

import type { ParkedReview, ReviewComment } from "../components/live/readReviewDrafts";
import { asQuestion, type BriefingCard, foldedText, localPagesIn, readable, saidText } from "./queueCard";

/** The words a verdict posts as, in the sentence the card asks. */
const VERDICT_WORDS: Record<ParkedReview["verdict"], string> = {
  APPROVE: "an approval",
  COMMENT: "a comment review",
  REQUEST_CHANGES: "a request for changes",
};

/**
 * Where a review lands, as the subject line names it.
 *
 * @returns `owner/name#number`
 */
export function reviewSubject({ review }: { review: Pick<ParkedReview, "repo" | "number"> }): string {
  return `${review.repo}#${String(review.number)}`;
}

/**
 * Where one comment sits, the way GitHub names it: `path:line`, or `path:start-end` for a range.
 *
 * @returns the location
 */
export function commentLocation({ comment }: { comment: Pick<ReviewComment, "path" | "line" | "startLine"> }): string {
  if (comment.startLine === undefined) {
    return `${comment.path}:${String(comment.line)}`;
  }
  return `${comment.path}:${String(comment.startLine)}-${String(comment.line)}`;
}

/**
 * The review's heading: what it would post, where, and on what.
 *
 * @returns `<verdict> on owner/name#number — title`
 */
export function reviewHeading({ review }: { review: ParkedReview }): string {
  return `${review.verdict} on ${reviewSubject({ review })}: ${review.title}`;
}

/** How many line comments it carries, in words. */
function commentCount({ review }: { review: ParkedReview }): string {
  if (review.comments.length === 0) {
    return "It carries no line comments.";
  }
  const noun = review.comments.length === 1 ? "line comment" : "line comments";
  return `It carries ${String(review.comments.length)} ${noun}, each drawn on the lines it sits on.`;
}

/**
 * The card for one HELD review draft.
 *
 * @param review the parked review, held
 * @param command the post command the register printed for it
 * @returns the card
 */
export function reviewDraftCard({ review, command }: { review: ParkedReview; command: string }): BriefingCard {
  const author = review.author === undefined ? "" : ` by @${review.author}`;
  return {
    commands: [],
    examples: undefined,
    head: undefined,
    ifSilent: "Nothing is posted. The review stays parked and the pull request hears nothing from you.",
    kind: "briefing",
    lean: undefined,
    options: [
      {
        how: { command, kind: "elsewhere", where: "a session, through the door" },
        letter: "A",
        sentence: `Post it as it stands: ${VERDICT_WORDS[review.verdict]} on the pull request under your own name.`,
      },
      {
        how: {
          command: `slopweaver github review-draft drop ${review.id} --note "<why>"`,
          kind: "elsewhere",
          where: "a session",
        },
        letter: "B",
        sentence: "Discard it: nothing is posted and the row is resolved.",
      },
      {
        how: { kind: "silence" },
        letter: "C",
        sentence: "Leave it parked while you read it; every comment is on this panel, on its lines.",
      },
    ],
    pages: localPagesIn({ text: review.why }),
    problem: undefined,
    question: asQuestion({ text: `Post ${VERDICT_WORDS[review.verdict]} on ${reviewSubject({ review })} as you` }),
    stakes: undefined,
    subject: `${reviewSubject({ review })}: ${review.title}${author}`,
    what: foldedText({
      text: [
        saidText({ text: readable({ text: review.why }) }),
        commentCount({ review }),
        review.deeperReview === undefined ? undefined : `A deeper review is offered: ${review.deeperReview}`,
        "Nothing has been posted: the reviewer parked it here.",
      ]
        .filter((part) => part !== undefined)
        .join(" "),
    }),
    whyYou: undefined,
  };
}
