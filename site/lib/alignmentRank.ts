/**
 * The order the Alignment page asks in: the question one answer would change the most future behaviour for leads, and
 * says what it would change.
 *
 * The page leads with the questions most likely to improve the fleet's behaviour, never the most recent: an opening
 * item about a PR that merged a month ago and was the right call is a waste of the owner's time, so high-value targets
 * sit at the top. The first item has to earn its place by saying what answering it could improve.
 *
 * **A derived order, stated, never a judgement.** Which question the owner would care about most is a session's read (a
 * kind or a judgement is never a keyword match), and no visible session has journalled one yet. So this
 * orders by what the page can count and what one answer structurally governs, and `docs/console/alignment.md` says so
 * — never the page, since no page carries a note on how it is derived:
 *
 * 1. **General rulings**, card classes and act kinds together, by how many times the owner has had to say the same thing
 *    (the distinct draft chains they sent back, the distinct acts they steered), most first; a tie goes to a card class, which
 *    would govern every card reaching the owner, then to the key. One answer would settle every future occurrence.
 * 2. **Acts**, in the Queue's own order: a word on one changes that act only, so an act never leads while anything
 *    broader waits.
 *
 * The owner's voice is not asked here at all: it is learnt from the Slack messages they sent (`./alignmentVoice.ts`).
 *
 * An answered question never leads. Pure, so the unit lane holds it alone.
 */

import { type CardRulingCandidate, FEEDBACK_SUBJECT, type RulingCandidate } from "./alignmentRules";
import { kindWords } from "./queueCard";

/** One act as the order reads it: its card key and the question its card asks. */
export interface AlignmentOrderAct {
  readonly key: string;
  readonly title: string;
}

/** Which list a question came from, so a key two lists happen to share still names one card. */
export type AlignmentOrderSource = "card-ruling" | "act-ruling" | "act";

/** One question in the page's order: what it asks, and what answering it could improve. */
export interface AlignmentOrderItem {
  readonly from: AlignmentOrderSource;
  readonly key: string;
  readonly title: string;
  /** What one answer could change from then on, and the count behind it. */
  readonly improves: string;
}

/** As much of one of the owner's answers as the order reads: the question key it names. */
export interface AlignmentAnswered {
  readonly about: string;
}

/**
 * `1 act`, `3 acts`.
 *
 * @returns the count and its noun
 */
function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** One general ruling before it is ordered: its line, and how many times the owner has said it. */
interface RulingEntry {
  readonly item: AlignmentOrderItem;
  readonly said: number;
}

/**
 * Every question on the page the owner has not answered, in the order this module states: general rulings by how often
 * they have had to say it, then acts.
 *
 * @param actRulings the questions over kinds of act the owner has steered more than once
 * @param cardRulings the questions over classes of card the owner has sent back more than once
 * @param acts the acts the page asks about, in the Queue's order
 * @param answered the owner's answers, so an answered question never leads
 * @returns the questions, first to lead first
 */
export function alignmentOrder({
  actRulings,
  cardRulings,
  acts,
  answered,
}: {
  actRulings: readonly RulingCandidate[];
  cardRulings: readonly CardRulingCandidate[];
  acts: readonly AlignmentOrderAct[];
  answered: readonly AlignmentAnswered[];
}): readonly AlignmentOrderItem[] {
  const rulings: RulingEntry[] = [
    ...cardRulings.map((candidate) => ({
      item: {
        from: "card-ruling" as const,
        improves: `One answer could hold every card that reaches you to this. You have sent back ${counted({ count: candidate.quotes.length, many: "drafts", one: "draft" })} for it.`,
        key: candidate.key,
        title: `Make sending back ${FEEDBACK_SUBJECT[candidate.feedback]} a general ruling?`,
      },
      said: candidate.quotes.length,
    })),
    ...actRulings.map((candidate) => {
      const words = kindWords({ kind: candidate.kind });
      return {
        item: {
          from: "act-ruling" as const,
          improves: `One answer could settle every future “${words}” act. You have given your word on ${counted({ count: candidate.steered, many: "acts", one: "act" })} of this kind.`,
          key: candidate.key,
          title: `Make your word on “${words}” a general ruling?`,
        },
        said: candidate.steered,
      };
    }),
  ];
  const overCards = (entry: RulingEntry): number => Number(entry.item.from === "card-ruling");
  const rankedRulings = rulings
    .toSorted((a, b) => b.said - a.said || overCards(b) - overCards(a) || a.item.key.localeCompare(b.item.key))
    .map((entry) => entry.item);
  const acted = acts.map((act) => ({
    from: "act" as const,
    improves: "Your word records whether this one act was right, and changes that act only.",
    key: act.key,
    title: act.title,
  }));
  const done = new Set(answered.map((answer) => answer.about));
  return [...rankedRulings, ...acted].filter((item) => !done.has(item.key));
}

/**
 * Items the owner has not answered first, each side in the order it came. While their answers have not read, the order
 * stands as given: an unread register is not a measured empty one.
 *
 * @param items the items, in the section's own order
 * @param answered the owner's answers, `undefined` until they read
 * @returns the items, unanswered first
 */
export function answeredLast<T extends { readonly key: string }>({
  items,
  answered,
}: {
  items: readonly T[];
  answered: readonly AlignmentAnswered[] | undefined;
}): readonly T[] {
  if (answered === undefined) {
    return items;
  }
  const done = new Set(answered.map((answer) => answer.about));
  return [...items.filter((item) => !done.has(item.key)), ...items.filter((item) => done.has(item.key))];
}
