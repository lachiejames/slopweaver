/**
 * A finding act's card, drawn from the one pull request its lookup READ (`./actPullVerb.ts`), and the shapes
 * that read carries. Apart from `./queueCard.ts` because that module imports nothing (its header says why) and
 * sits at the file-length cap; this one imports it, the way every other site module does.
 */
import {
  type BriefingCard,
  type FoldedText,
  localPagesIn,
  readable,
  saidText,
  sentencesOf,
  WHAT_MAX_WORDS,
  wordsOf,
} from "./queueCard";
import { type ActRecord, actCard, type LinkedPullRequest } from "./queueCardAct";

/** Where a pull request stands, as `slopweaver github pr summary` says it. */
export type PullLifecycle = "open" | "draft" | "merged" | "closed";

/** A pull request's own Problem, Risk and Blast radius cells, or why its description does not give them. */
export type PullForm =
  | { readonly kind: "parsed"; readonly problem: string; readonly risk: string; readonly blastRadius: string }
  | { readonly kind: "declined"; readonly reason: string };

/** A pull request a finding act's lookup READ: its link fields, where it stands, and its own description cells. */
export interface ReadPullRequest extends LinkedPullRequest {
  readonly state: PullLifecycle;
  /** When it merged, absent when it has not. */
  readonly mergedAt: string | undefined;
  /** The provider read's own instant — when these fields were true. */
  readonly readAtIso: string;
  readonly form: PullForm;
}

/** A pull request's lifecycle as the stakes row reads it. */
const PULL_STATUS: Readonly<Record<PullLifecycle, string>> = {
  closed: "closed without merging",
  draft: "open, as a draft",
  merged: "merged",
  open: "open",
};

/** Lowercase abbreviations {@link endsSentence} never reads as a sentence end, even before a capital. */
const LOWERCASE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "al",
  "approx",
  "ca",
  "cf",
  "esp",
  "etc",
  "fig",
  "incl",
  "no",
  "ver",
  "viz",
  "vs",
]);

/**
 * Whether a full stop `sentencesOf` split at really ends the sentence. The default is NO, because a list of known
 * abbreviations never closed the class — Codex found one past each (`Prof.`, `U.S.`, `Ph.D.`, `Assoc.`, `ver. 2`,
 * `no. 123`). A stop ends the sentence only when the next piece opens with a capital, a code span or a quote, and the
 * word before it is a plain lowercase word outside {@link LOWERCASE_ABBREVIATIONS}: the shape a sentence ending has.
 * A capitalised or dotted word, or a next piece opening in a digit or a lowercase letter, rejoins — a little more of
 * the Problem, never a fragment. The one shape still read as an end is a lowercase abbreviation outside the list
 * before a capitalised word.
 *
 * @param piece the text up to the break
 * @param next the piece that follows it
 * @returns true when the break is a sentence end
 */
function endsSentence({ piece, next }: { piece: string; next: string }): boolean {
  if (!piece.endsWith(".")) {
    return true;
  }
  const stem = piece.slice(piece.lastIndexOf(" ") + 1, -1);
  return /^[A-Z`"'“]/u.test(next) && /^[a-z]+$/u.test(stem) && !LOWERCASE_ABBREVIATIONS.has(stem);
}

/** Fewer words than this is never a whole reason, so the piece is rejoined to the next. */
const FRAGMENT_WORDS = 4;

/**
 * A Problem cell's first sentence, rejoining the pieces `sentencesOf` split at an abbreviation — so a reason above
 * the fold is never a fragment such as "Use e.g." or "Prof.". A rejoin that
 * was not needed only draws more of the Problem, never less, and {@link findingWhat} still bounds the what, so the
 * test leans toward joining.
 *
 * @param text the Problem cell, already made readable
 * @returns the first sentence, or `undefined` for a blank cell
 */
function firstSentence({ text }: { text: string }): string | undefined {
  const pieces = sentencesOf({ text });
  let sentence = pieces.at(0);
  for (const next of pieces.slice(1)) {
    if (sentence === undefined) {
      break;
    }
    const fragment = sentence.split(" ").length < FRAGMENT_WORDS || !endsSentence({ next, piece: sentence });
    if (!fragment) {
      break;
    }
    sentence = `${sentence} ${next}`;
  }
  return sentence;
}

/**
 * A finding card's WHAT: which pull request and where it stands, what it changes, and why the fleet opened it.
 *
 * A what that is the pull request's title alone leaves the reader asking what it is. A title says what changed but not that the fleet opened it unasked, nor on what — so the what names the
 * number and its state, then the title, then the Problem cell's first sentence as the reason. A blank title or
 * Problem drops its own part and nothing is composed in its place; the whole Problem stays on the card's problem row.
 *
 * Folded HERE, by its two parts, rather than by `foldedText`: that splits at every full stop, so under its sentence
 * and word caps it could end the drawn what at `Prof.` inside a reason this file had already rejoined. The reason is
 * drawn whole when the what fits {@link WHAT_MAX_WORDS}, and otherwise held back entire behind the problem row.
 *
 * @param pull the one pull request the lookup proved is the act's
 * @param problem that pull request's own Problem cell
 * @returns the what, folded
 */
export function findingWhat({ pull, problem }: { pull: ReadPullRequest; problem: string }): FoldedText {
  const which = `#${String(pull.number)}, ${PULL_STATUS[pull.state]}`;
  const title = readable({ text: pull.title }).trim();
  let lead = `${which}.`;
  if (title.length > 0) {
    lead = `${which}: ${title}`;
  }
  if (title.length > 0 && !/[.!?]$/u.test(title)) {
    lead = `${lead}.`;
  }
  const reason = firstSentence({ text: readable({ text: problem }) });
  if (reason === undefined) {
    return { aboveFold: lead, folded: false, whole: lead };
  }
  const whole = `${lead} The fleet opened it without asking, on a problem it found itself: ${reason}`;
  if (wordsOf({ text: whole }) > WHAT_MAX_WORDS) {
    return { aboveFold: lead, folded: true, whole };
  }
  return { aboveFold: whole, folded: false, whole };
}

/**
 * The card for a finding act whose lookup READ its one pull request, and whose description gave its cells.
 *
 * A finding card links the pull request and carries no boilerplate text. So every line that was a register's absence sentence is the pull request's own: the what is
 * {@link findingWhat}, the problem its Problem cell, the stakes its Risk and Blast radius with where it stands. The finding
 * gate's `said` is the same two sentences on every finding row, so it stays in the record and off the card. A
 * finding act with no such pull request gets NO card body — `./queueActRow.ts` `withLookedUpPull` refuses it.
 *
 * @param pull the one pull request the lookup proved is the act's
 * @param cells that pull request's own description cells
 * @returns the card
 */
export function findingActCard({
  act,
  cells,
  pull,
}: {
  act: ActRecord;
  cells: Extract<PullForm, { kind: "parsed" }>;
  pull: ReadPullRequest;
}): BriefingCard {
  const base = actCard({ act, pulls: [pull] });
  let stakes: BriefingCard["stakes"];
  if (saidText({ text: cells.risk }) !== undefined && saidText({ text: cells.blastRadius }) !== undefined) {
    stakes = {
      blastRadius: cells.blastRadius,
      checkedIso: pull.readAtIso,
      kind: "pull-request",
      risk: cells.risk,
      status: PULL_STATUS[pull.state],
    };
  }
  return {
    ...base,
    pages: localPagesIn({ text: `${cells.problem} ${act.why}` }),
    problem: saidText({ text: cells.problem }),
    stakes,
    what: findingWhat({ problem: cells.problem, pull }),
  };
}
