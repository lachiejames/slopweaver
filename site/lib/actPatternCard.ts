/**
 * What an act card says when it stands for a whole PATTERN of acts ({@link ../actGroups.ts groupActs}): its title,
 * its filter text and its links count every subject the pattern names, not only the newest act's. Split from
 * `./queueRows.ts`, which builds the cards, so that file stays under the 300-line cap.
 */
import { asQuestion, type BriefingCard, kindWords, type QueueCard, subjectLabel, whatOf } from "./queueCard";
import type { CardLink } from "./queueCardAct";
import type { ActLinks } from "./queueCardActLinks";

/** A GitHub pull request's address, the one subject shape {@link patternActCard} counts by its own name. */
const PULL_REQUEST_ADDRESS = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:$|[/?#])/u;

/**
 * An act row's filter text: every subject its pattern names, so typing any folded pull request still finds the
 * card, and its card's `what` when it has one.
 *
 * @param subjects the pattern's subjects, the newest act's first
 * @param card the built card
 * @returns the hint
 */
export function actHint({ subjects, card }: { subjects: readonly string[]; card: QueueCard }): string {
  const named = subjects.join(" ");
  if (card.what === undefined) {
    return named;
  }
  return `${named} ${card.what.whole}`;
}

/**
 * An act card drawn for a whole pattern: when its acts name more than one subject, the card is about all of them,
 * so its subject and question count them and its `what` leads with that count — "7 pull requests — I rebased
 * your security PR onto staging …" reads as what was done, where "was rebase on the other branch the right call" read as
 * one of seven separate questions. One subject leaves the card exactly as `actCard` drew it.
 *
 * @param card the card `actCard` drew for the pattern's newest act
 * @param kind the pattern's kind
 * @param subjects every subject the pattern names
 * @returns the card to draw
 */
export function patternActCard({
  card,
  kind,
  subjects,
}: {
  card: BriefingCard;
  kind: string;
  subjects: readonly string[];
}): BriefingCard {
  if (subjects.length < 2) {
    return card;
  }
  const count = String(subjects.length);
  let over = `${count} subjects`;
  if (subjects.every((subject) => PULL_REQUEST_ADDRESS.test(subject))) {
    over = `${count} pull requests`;
  }
  let what = `Done on ${over}.`;
  if (card.what !== undefined) {
    what = `${over}: ${card.what.whole}`;
  }
  // A card drawn from one pull request's own cells — a finding pattern's newest act (`./queueActRow.ts`
  // `withLookedUpPull`) — names that pull request as the newest, so its problem and stakes are never read as the
  // whole pattern's. An act card carries a problem or stakes only when `./findingActCard.ts` drew it from one, and
  // either one alone still needs the label, since a blank Risk or Blast radius cell draws the problem without stakes.
  if (card.what !== undefined && (card.problem !== undefined || card.stakes?.kind === "pull-request")) {
    what = `${over}: the newest, ${card.what.whole}`;
  }
  return {
    ...card,
    question: asQuestion({ text: `Was ${kindWords({ kind })} on these ${over} the right call` }),
    subject: over,
    what: whatOf({ text: what }),
    whyYou: `One card for ${over}: the fleet did the same thing on each, and your one word settles every one of them.`,
  };
}

/**
 * An act's links with every subject its pattern names linked too, after the newest act's own — each once.
 *
 * @param links what `actLinks` drew for the newest act
 * @param subjects every subject the pattern names
 * @returns the links, the folded subjects that are addresses appended
 */
export function withPatternSubjects({ links, subjects }: { links: ActLinks; subjects: readonly string[] }): ActLinks {
  let drawn: readonly CardLink[] = [];
  if (links.kind === "linked") {
    drawn = links.links;
  }
  const added = subjects
    .filter((subject) => subject.startsWith("https://") && !drawn.some((link) => link.url === subject))
    .map((subject) => ({ label: subjectLabel({ subject }), url: subject }));
  if (added.length === 0) {
    return links;
  }
  return {
    boardNotice: links.boardNotice,
    kind: "linked",
    landingNotice: links.landingNotice,
    links: [...drawn, ...added],
  };
}
