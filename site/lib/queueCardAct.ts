/**
 * The card for an act the fleet took without asking, the shapes its links read, and the open pull requests it is
 * about — split out of `./queueCard.ts`, which holds the shapes and text helpers it builds from.
 */

import { asQuestion, type BriefingCard, kindWords, localPagesIn, readable, subjectLabel, whatOf } from "./queueCard";

/** An act the fleet took without asking, with no word from the owner on it yet. */
export interface ActRecord {
  readonly kind: string;
  readonly subject: string;
  readonly why: string;
  /** The plain-words line the act was recorded with, absent on a row written before that field existed. */
  readonly said: string | undefined;
}

/**
 * The card for an act the fleet took without asking.
 *
 * The question quotes the ledger's own `kind` and `subject` (see {@link kindWords}) rather than a verb
 * phrase a table invented. The `what` is the row's `said` — the line `slopweaver autonomy record` refuses
 * unless it is in words the owner reads.
 *
 * The `what` is never the `why`: opening on the fleet's own note (rule numbers, board slugs and a session id) is
 * unparsable to the owner. The `why` is NOT deleted — the
 * next session still needs it, and `../components/console/Queue.tsx` still draws it as a `recordLine` in
 * the record disclosure, where `./recordLines.ts`'s cap draws its head and folds the rest behind a press. It simply
 * stops being the first thing the owner reads. An act recorded before `said` existed, with no pull request proven its
 * own, has no `what` at all: the question and the record carry it, and no sentence explains the gap.
 *
 * When the caller passes exactly one pull request PROVEN to be the only one the act opened, the card is ABOUT
 * it: its subject and question name `owner/repo#N`, and its `what` opens on the pull request's own title — the
 * one line saying what it did — before the ledger's line. A finding card that names no pull request, no link
 * and not what the pull request did gets skipped. Two or more leave the card
 * on the ledger's subject rather than picking one of them. Proving uniqueness is the caller's
 * (`./queueRows.ts` `rowsOf`, `./queueActRow.ts` `withLookedUpPull`).
 *
 * @param pulls the pull requests proven to be the act's — the title and number are the provider's, never composed
 * @returns the card
 */
export function actCard({ act, pulls }: { act: ActRecord; pulls: readonly LinkedPullRequest[] }): BriefingCard {
  let subject = subjectLabel({ subject: act.subject });
  const parts = [act.said];
  const only = pulls.length === 1 ? pulls.at(0) : undefined;
  if (only !== undefined) {
    subject = subjectLabel({ subject: only.url });
    const title = only.title.replace(/[.\s]+$/u, "").trim();
    if (title.length > 0) {
      parts.unshift(`${title}.`);
    }
  }
  const what = parts.filter((part) => part !== undefined).join(" ");
  return {
    head: undefined,
    ifSilent: "It stays unsteered. Nothing re-runs, and the fleet keeps acting the same way.",
    lean: undefined,
    options: [
      {
        how: { button: "Approve", kind: "press" },
        letter: "A",
        sentence: "Right call: record it so the fleet keeps doing this.",
      },
      {
        how: { button: "More → Deny", kind: "press" },
        letter: "B",
        sentence: "Wrong call: record it so the fleet stops.",
      },
      {
        how: { command: undefined, kind: "elsewhere", where: "the call's chat, with this card open" },
        letter: "C",
        sentence: "Something in between: say your own word on it.",
      },
    ],
    commands: [],
    examples: undefined,
    pages: localPagesIn({ text: `${what} ${act.why}` }),
    problem: undefined,
    stakes: undefined,
    question: asQuestion({ text: `Was ${kindWords({ kind: act.kind })} on ${subject} the right call` }),
    subject,
    what: whatOf({ text: readable({ text: what }) }),
    kind: "briefing",
    whyYou: "The autonomy ledger holds no word from you on this act; the row is unsteered until you give one.",
  };
}

/**
 * The fixed word an act card's option records, printed on the button that records it: A is Approve, B is Deny. C has
 * no button — the owner's own word is said in the call's chat with the card open, never typed on the console (the console
 * has no text inputs) — so it is the empty string, and nothing presses it.
 *
 * @returns the text, or the empty string for the free option
 */
export function steerDraft({ letter }: { letter: string }): string {
  if (letter === "A") {
    return "right call";
  }
  if (letter === "B") {
    return "wrong call";
  }
  return "";
}

/** A place a card links to, and the words it reads as. */
export interface CardLink {
  readonly label: string;
  readonly url: string;
}

/** A board row, as much of it as an act's links read — `BoardRow` from `../components/live/read.ts` fits. */
export interface LinkedBoardRow {
  readonly slug: string;
  readonly prUrls: readonly string[];
}

/** The act ledger row, as much of it as its links read — `AutonomyRow` fits. */
export interface LinkedAct {
  readonly subject: string;
  /** The board row the act belongs to, absent on a row recorded without one. */
  readonly run: string | undefined;
  readonly said: string | undefined;
  readonly why: string;
  /** The proof the act happened, absent on a row recorded without one. */
  readonly witness: string | undefined;
}

/** One open pull request as an act's card and links read it — `LandingRow` from `../components/live/readLanding.ts` fits. */
export interface LinkedPullRequest {
  readonly url: string;
  readonly number: number;
  readonly title: string;
  readonly repoSlug: string;
  readonly headRefName: string;
  /** The board row declaring this pull request's branch, absent when none declares it. */
  readonly boardRowSlug: string | undefined;
}

/** The pull-request reading as an act's links read it — whether its open pull requests are in yet. */
export type ActLinkLanding =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | { readonly phase: "ready" };

/**
 * The open pull requests an act is about, out of the owner's landing reading — strongest evidence first, and
 * never a guess between two.
 *
 * The finding gate (`src/cli/commands/github/findingRulingGate.ts`) records its ledger row BEFORE the pull
 * request exists, so `subject` and `run` are both the board slug and the ledger alone can never carry the
 * pull request. The landing reading carries it: a finding's pull request is opened from a branch its seat
 * names after the row, or one the row declares. MEASURED: the two finding cards the owner skipped each sit on a head
 * branch spelling its row's slug exactly, and neither doc declares one.
 *
 * In order, the first that matches anything wins: a pull request whose URL IS the subject; one whose
 * declared board row is the act's `run` or `subject`; one whose head branch is, but only when exactly ONE
 * does — a branch name is not unique across repositories (`src/cli/commands/github/landingRegister.ts`), so
 * two matches name nothing rather than the wrong one. An exact join, never a similarity.
 *
 * @param act the ledger row's subject and the board row it belongs to
 * @param rows the open pull requests of a READY landing reading, in its order
 * @returns the matched pull requests, each URL once, in landing order — empty when none matches
 */
export function actPullRequests({
  act,
  rows,
}: {
  act: { readonly subject: string; readonly run: string | undefined };
  rows: readonly LinkedPullRequest[];
}): readonly LinkedPullRequest[] {
  const once = (matched: readonly LinkedPullRequest[]): readonly LinkedPullRequest[] =>
    matched.filter((row, index) => matched.findIndex((other) => other.url === row.url) === index);
  const bySubject = once(rows.filter((row) => row.url === act.subject));
  if (bySubject.length > 0) {
    return bySubject;
  }
  const names = new Set([act.subject, act.run].filter((name): name is string => name !== undefined && name !== ""));
  const byRow = once(rows.filter((row) => row.boardRowSlug !== undefined && names.has(row.boardRowSlug)));
  if (byRow.length > 0) {
    return byRow;
  }
  const byHead = once(rows.filter((row) => names.has(row.headRefName)));
  if (byHead.length === 1) {
    return byHead;
  }
  return [];
}
