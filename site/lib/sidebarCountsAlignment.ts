/**
 * The Alignment count: every general-ruling question on the page the owner has not answered, for the sidebar's badge and
 * the page's head. Split out of `./sidebarCounts.ts`, over the judgement in `./sidebarCountsBasis.ts`.
 *
 * Only a card that needs the owner's call is counted, never an act the fleet already did: acts stay listed on the page
 * to look back on, but a count of them grew with every merge the fleet pressed under a standing rule, into a number
 * nobody would answer. So the board, which places acts, is no input here.
 */
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import { type CardFeedback, cardRulingCandidates, rulingCandidates, type SteeredAct } from "./alignmentRules";
import type { LiveState } from "./liveState";
import { countBasisOf, counted, currentValueOf, type SidebarCount, type SidebarReading } from "./sidebarCountsBasis";

/**
 * The owner's latest answer to one Alignment question.
 *
 * @param answers every answer the owner has given there, `undefined` until they read
 * @param key the question's key — `align:rule-<kind>`, `align:rule-card-<class>`
 * @returns the answer, or `undefined` when the owner has given none
 */
export function answerTo<T extends { readonly about: string }>({
  answers,
  key,
}: {
  answers: readonly T[] | undefined;
  key: string;
}): T | undefined {
  return answers?.find((answer) => answer.about === key);
}

/**
 * The Alignment badge, and the number that page's head prints: every general-ruling question the owner has not
 * answered. Zero is printed as zero.
 *
 * @param questionKeys every question the page asks: its general-ruling and card-ruling questions
 * @param answers every answer the owner has given there
 * @returns the count and its title
 */
export function alignmentWaitingOf({
  questionKeys,
  answers,
}: {
  questionKeys: readonly string[];
  answers: readonly { readonly about: string }[];
}): SidebarCount {
  const count = questionKeys.filter((key) => answerTo({ answers, key }) === undefined).length;
  if (count === 0) {
    return { count, title: "no general-ruling question waiting on your answer" };
  }
  const questionWords = counted({ count, many: "general-ruling questions", one: "general-ruling question" });
  return { count, title: `${questionWords} waiting on your answer` };
}

/**
 * The Alignment count over the readings its questions are made from, the same for the sidebar's badge and the page's
 * head: each kind of act the owner has steered twice with no standing rule, and each class of card they have sent back
 * twice, less the ones they have answered. No number while any of those readings is on its way or failed: a partial
 * total is a number nobody read. A reading handed over from the page before while its re-read waits for a slot counts,
 * and marks the number stale ({@link countBasisOf}), so the head prints at once rather than a spinner.
 *
 * @param acts the autonomy ledger, which the general-ruling questions over kinds of act are found in
 * @param posts the draft register, which a card-ruling question resolves its re-cut drafts against
 * @param feedback the owner's feedback on drafts they sent back
 * @param answers every answer the owner has given on the page
 * @returns the count, stale when a reading behind it is, or why there is none yet
 */
export function alignmentWaitingReadingOf({
  acts,
  posts,
  feedback,
  answers,
}: {
  acts: LiveState<readonly SteeredAct[]>;
  posts: LiveState<readonly ParkedDraft[]>;
  feedback: LiveState<readonly CardFeedback[]>;
  answers: LiveState<readonly { readonly about: string }[]>;
}): SidebarReading {
  const basis = countBasisOf({
    inputs: [
      { state: acts, subject: "the autonomy ledger" },
      { state: posts, subject: "the draft register" },
      { state: feedback, subject: "your feedback on drafts you sent back" },
      { state: answers, subject: "your answers on the page" },
    ],
  });
  if (basis.phase === "not-measured" || basis.phase === "loading") {
    return basis;
  }
  const questionKeys = [
    ...rulingCandidates({ acts: currentValueOf({ state: acts }) }).map((candidate) => candidate.key),
    ...cardRulingCandidates({
      drafts: currentValueOf({ state: posts }),
      feedback: currentValueOf({ state: feedback }),
    }).map((candidate) => candidate.key),
  ];
  const count = alignmentWaitingOf({ answers: currentValueOf({ state: answers }), questionKeys });
  if (basis.phase === "provisional") {
    return { count, phase: "measured", stale: basis.stale };
  }
  return { count, phase: "measured" };
}
