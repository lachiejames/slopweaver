/**
 * Which of the owner's open pull requests need THEIR word — the one rule the Queue and the pull-requests page both draw.
 *
 * The Queue cards these rows; the pull-requests page marks each with its one accent and asks nothing itself, since what
 * needs the owner's attention is the Queue's job. One function, so the page's accent and the Queue's cards
 * can never disagree about which pull request is waiting on the owner.
 */
import type { LandingRow } from "../components/live/readLanding";
import { type Reviewers, reviewerRowFor } from "../components/live/readReviewers";

/**
 * The one dispatch verdict `github landing` reserves for the owner — the verb's own word, never the page's.
 * `src/briefing/nothingStalePullRequests.ts`'s `OWNER_JUDGEMENT_VERDICT` is held equal by
 * `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_JUDGEMENT_VERDICT = "needs-owner-judgment" as const;

/** The one human-wait act only the owner's word settles — `src/review/humanWait.ts`'s own word. */
export const NAME_THE_REVIEWER = "name-the-reviewer";

/**
 * The dispatch verdict that hands the FIRST review ask to a session, which drafts it (or, with no agreed
 * discussion, a discussion opener instead) and parks it for the owner's yes with `slack draft record` —
 * `src/review/landingDispatch.ts`'s own word. That parked draft is the card the owner sees; a naming card drawn off the
 * same row would card the owner twice, before the draft exists.
 */
const DRAFT_FIRST_REVIEW_ASK = "draft-first-review-ask";

/** Which word of the owner's a row is missing: a reviewer's name, or their judgment on a row the verb refused to dispatch. */
export type OwnerWord = "naming" | "judgment";

/**
 * The word of the owner's this row is missing, if any.
 *
 * A row whose only missing fact is the owner's word naming a reviewer is `naming` — unless the verb dispatched it as
 * {@link DRAFT_FIRST_REVIEW_ASK}, whose session's parked draft is the one card, or the owner already picked somebody:
 * `github landing` never reads the reviewer register, so its wait keeps saying `name-the-reviewer` after the owner
 * approved a suggestion, and that approve parked the ask on their queue. A row the verb refused to dispatch is
 * `judgment`. A row that is both is the name it needs.
 *
 * @param picked who the owner picked, when the reviewer reading's hook on this row is `picked`
 * @returns the missing word, or `undefined` when the fleet holds the row
 */
export function ownerWordOn({
  row,
  picked,
}: {
  row: LandingRow;
  picked: { readonly reviewer: string } | undefined;
}): OwnerWord | undefined {
  const naming =
    row.humanWait?.next === NAME_THE_REVIEWER && row.verdict !== DRAFT_FIRST_REVIEW_ASK && picked === undefined;
  if (naming) {
    return "naming";
  }
  if (row.verdict === OWNER_JUDGEMENT_VERDICT) {
    return "judgment";
  }
  return undefined;
}

/**
 * The rows that need the owner's word, each with the word it is missing: every `naming` row first, then every
 * `judgment` row, each in the reading's own order — the order the Queue draws its cards in, so the naming draft sits at
 * the top of the owner's queue.
 *
 * @param reviewers the reviewer reading, or `undefined` while it is unread — no pick withdraws a row until it is
 * @returns the rows and their missing word, in draw order
 */
export function needsOwnerRows({
  rows,
  reviewers,
}: {
  rows: readonly LandingRow[];
  reviewers: Reviewers | undefined;
}): readonly { readonly row: LandingRow; readonly word: OwnerWord }[] {
  const words = rows.flatMap((row) => {
    let picked: { readonly reviewer: string } | undefined;
    if (reviewers !== undefined) {
      picked = reviewerRowFor({ number: row.number, repoSlug: row.repoSlug, reviewers })?.picked;
    }
    const word = ownerWordOn({ picked, row });
    return word === undefined ? [] : [{ row, word }];
  });
  return [...words.filter((entry) => entry.word === "naming"), ...words.filter((entry) => entry.word === "judgment")];
}
