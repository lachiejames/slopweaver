/**
 * The cards for a pull request `github landing` handed to the owner: one it refused to dispatch, and one waiting on the owner to
 * name a reviewer — split out of `./queueCard.ts`, which holds the shapes and text helpers they build from.
 */

import { asQuestion, type BriefingCard, foldedText, readable, saidText, whatOf } from "./queueCard";

/** A pull request `github landing` handed to the owner rather than to a session. */
export interface PrRecord {
  readonly number: number;
  readonly title: string;
  readonly repoSlug: string;
  readonly action: string;
  readonly actionDetail: string;
  readonly ci: string;
  /** What a red rollup is red on, as `readLanding` read it — `required: undefined` is unknown, never advisory. */
  readonly ciFailure: { readonly kind: "not-red" } | { readonly kind: "red"; readonly required: boolean | undefined };
  readonly dispatchWhy: string | undefined;
  readonly blockedOn: readonly string[];
}

/**
 * The card's CI sentence: the rollup's word, and on red what it is red on, so a card never says merely "red".
 *
 * @returns the sentence, or `undefined` when the rollup gave no word
 */
function prCiSentence({ row }: { row: PrRecord }): string | undefined {
  if (row.ciFailure.kind === "not-red") {
    const word = saidText({ text: row.ci });
    if (word === undefined) {
      return undefined;
    }
    return `CI is ${word}.`;
  }
  if (row.ciFailure.required === true) {
    return "CI is red on a required check.";
  }
  if (row.ciFailure.required === false) {
    return "CI is red on advisory checks only.";
  }
  return "CI is red, and the reading could not tell whether a failing check is required.";
}

/**
 * A refused pull request's lean — the landing verb's own action and why — or `undefined` when the reading gives no
 * why, so the card draws no lean rather than a dangling dash.
 *
 * @param row the landing row
 * @returns the lean, or `undefined`
 */
export function prLeanOf({ row }: { row: Pick<PrRecord, "action" | "actionDetail"> }): string | undefined {
  const detail = saidText({ text: row.actionDetail });
  if (detail === undefined) {
    return undefined;
  }
  return `github landing says ${row.action}: ${detail}`;
}

/**
 * The card for a pull request the landing verb refused to dispatch.
 *
 * @returns the card
 */
export function prCard({ row }: { row: PrRecord }): BriefingCard {
  const on = row.blockedOn.filter((who) => saidText({ text: who }) !== undefined);
  const blocked = on.length === 0 ? undefined : `Blocked on ${on.join(", ")}.`;
  return {
    head: undefined,
    ifSilent:
      "Nothing moves: github landing's verdict is needs-owner-judgment, which is the verb refusing to hand it to a session.",
    lean: prLeanOf({ row }),
    options: [
      {
        how: { command: undefined, kind: "elsewhere", where: "GitHub" },
        letter: "A",
        sentence: "Read it on GitHub and act there.",
      },
      {
        how: { command: undefined, kind: "elsewhere", where: "the pull-requests page" },
        letter: "B",
        sentence: "Open it on the pull-requests page, which carries every test the verb ran.",
      },
      {
        how: {
          command: `slopweaver github enqueue --number ${String(row.number)}`,
          kind: "elsewhere",
          where: "a session (a press here wants the verb's dry-run report in front of you first)",
        },
        letter: "C",
        sentence: "Queue it for GitHub to merge when it is ready.",
      },
    ],
    commands: [],
    examples: undefined,
    pages: [],
    problem: undefined,
    stakes: undefined,
    // The title is bracketed, so its own punctuation survives and never runs into the colon. Brackets rather than
    // quotes, because a title's own quotes of either kind would close a quote early, while brackets nest.
    question: asQuestion({ text: `#${String(row.number)} (${row.title}): ${row.action}` }),
    subject: `${row.repoSlug}#${String(row.number)}`,
    what: whatOf({
      text: readable({
        text: [prCiSentence({ row }), blocked, saidText({ text: row.dispatchWhy })]
          .filter((part) => part !== undefined)
          .join(" "),
      }),
    }),
    kind: "briefing",
    whyYou:
      "github landing's own dispatch verdict on this pull request is needs-owner-judgment; it refused to hand it to a session.",
  };
}

/** A pull request whose one missing fact is the owner's word naming a person on the team that holds it. */
export interface NameTheReviewerRecord {
  readonly number: number;
  readonly title: string;
  readonly repoSlug: string;
  /** The teams GitHub holds it for — the wait's own `who`. */
  readonly who: readonly string[];
  /** The wait's own sentence, the five facts on one line. */
  readonly sentence: string;
}

/**
 * The card for a pull request nobody has been asked to review, held only by teams.
 *
 * When only the owner's "name the reviewer" word is missing, the draft sits at the top of the owner's queue. There
 * is no person to draft a DM TO until the owner names one, so the card asks for exactly that word, and the draft
 * follows it: a session writes the DM as the owner (or, if nothing agreed the change and it is no obvious bug, a
 * discussion opener instead) and parks it in the drafts register, where the owner sends it.
 *
 * @returns the card
 */
export function nameTheReviewerCard({ row }: { row: NameTheReviewerRecord }): BriefingCard {
  const teams = row.who.join(", ");
  return {
    head: undefined,
    ifSilent: "Nothing moves: nobody is asked, and GitHub keeps holding it for a team no one person answers for.",
    lean:
      saidText({ text: row.sentence }) === undefined
        ? undefined
        : `github landing says name the reviewer: ${row.sentence}`,
    options: [
      {
        how: {
          command: undefined,
          kind: "elsewhere",
          where:
            "the supervisor chat: say who, and the ask (or, if nothing agreed the change and it is no obvious bug, a discussion opener) is drafted as you and parked here to send",
        },
        letter: "A",
        sentence: `Name the person on ${teams} who should review it.`,
      },
      {
        how: { command: undefined, kind: "elsewhere", where: "GitHub" },
        letter: "B",
        sentence: "Read it on GitHub first.",
      },
    ],
    commands: [],
    examples: undefined,
    pages: [],
    problem: undefined,
    stakes: undefined,
    question: asQuestion({ text: `Who on ${teams} should review #${String(row.number)} ${row.title}` }),
    subject: `${row.repoSlug}#${String(row.number)}`,
    what:
      saidText({ text: row.sentence }) === undefined
        ? undefined
        : foldedText({ text: readable({ text: `${row.sentence}.` }) }),
    kind: "briefing",
    whyYou: "Nobody has been asked, and only a team holds it, so an ask has no person to go to until you name one.",
  };
}
