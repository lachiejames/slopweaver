/**
 * What the Proposed workstreams section does with the candidates it read: the heading, which are answered, the few
 * shown first, the press each control sends and the summary line. Split out of `./workstreamCandidates.ts`, which
 * reads the document.
 */

import {
  CANDIDATE_REACTIONS,
  type CandidateRowView,
  type CandidatesView,
  OPENING_FEW,
  type PressReaction,
  type PriorSteerView,
  REACTION_LABEL,
} from "./workstreamCandidatesTypes";
import { shortDate } from "./workstreamTiles";

/**
 * The heading a candidate shows: the title the owner gave it, else its mined name.
 *
 * @returns the heading
 */
export function candidateHeading({ candidate }: { candidate: CandidateRowView }): string {
  if (candidate.title === null) {
    return candidate.name;
  }
  return candidate.title;
}

/** The candidates split by whether a word has been given: the ones waiting on one first, then the answered. */
export interface CandidatePartition {
  readonly unanswered: readonly CandidateRowView[];
  readonly answered: readonly CandidateRowView[];
}

/**
 * Split candidates into the ones still waiting on a word, ranked by how much of the owner's own words back each
 * (most first, then the verb's rank `n`), and the ones answered, in rank order. The section shows the unanswered ones
 * and folds the answered away, so a person working down the list always sees what is left, strongest first.
 *
 * @returns the two lists
 */
export function partitionCandidates({ candidates }: { candidates: readonly CandidateRowView[] }): CandidatePartition {
  const ranked = candidates.toSorted((a, b) => a.n - b.n);
  return {
    answered: ranked.filter((one) => one.reaction !== null),
    unanswered: ranked
      .filter((one) => one.reaction === null)
      .toSorted((a, b) => b.evidenceCount - a.evidenceCount || a.n - b.n),
  };
}

/**
 * The few the section opens on and how many wait behind the one link: never the whole mined list.
 *
 * @param unanswered the candidates still waiting on a word, ranked
 * @param showAll whether the owner followed the link
 * @returns the candidates drawn, and how many are not
 */
export function openingFew({ unanswered, showAll }: { unanswered: readonly CandidateRowView[]; showAll: boolean }): {
  readonly shown: readonly CandidateRowView[];
  readonly behind: number;
} {
  if (showAll) {
    return { behind: 0, shown: unanswered };
  }
  const shown = unanswered.slice(0, OPENING_FEW);
  return { behind: unanswered.length - shown.length, shown };
}

/**
 * Which candidate the one-at-a-time view shows, and whether there is one before and after it: the asked position
 * clamped into the list, never wrapping, so the last one does not loop back to the first as if nothing were left.
 *
 * @param list the candidates the view walks, in order
 * @param at the position asked for
 * @returns the candidate shown and its neighbours' existence, or `null` for an empty list
 */
export function oneAtATime({ list, at }: { list: readonly CandidateRowView[]; at: number }): {
  readonly candidate: CandidateRowView;
  readonly index: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
} | null {
  if (list.length === 0) {
    return null;
  }
  const index = Math.min(Math.max(at, 0), list.length - 1);
  return { candidate: list[index], hasNext: index < list.length - 1, hasPrev: index > 0, index };
}

/**
 * A definition of done chosen on the page and not yet recorded: an offered option, or all of the options with the one
 * the owner says leads. One in the owner's own words is said in the call's chat — the console takes no typed words —
 * so a recorded `words` definition is shown, never chosen.
 */
export type DefinitionChoice =
  { readonly kind: "option"; readonly optionId: string } | { readonly kind: "all"; readonly first: string | null };

/** A press the page runs: an act row and its slots. */
export interface PagePress {
  readonly slug: string;
  readonly slots: Readonly<Record<string, string>>;
}

/**
 * The choice a card opens on: the definition already recorded, so a re-render never forgets what stands.
 *
 * @returns the standing choice, or `null` when none is recorded or it is one in the owner's own words
 */
export function standingChoice({ candidate }: { candidate: CandidateRowView }): DefinitionChoice | null {
  const standing = candidate.definition;
  if (standing === null) {
    return null;
  }
  if (standing.kind === "option") {
    return { kind: "option", optionId: standing.optionId };
  }
  if (standing.kind === "all") {
    return { first: standing.first, kind: "all" };
  }
  return null;
}

/**
 * Whether a choice is the definition already recorded, so pressing it again would append nothing.
 *
 * @returns true when it is
 */
function alreadyStanding({ candidate, choice }: { candidate: CandidateRowView; choice: DefinitionChoice }): boolean {
  const standing = standingChoice({ candidate });
  if (standing === null || standing.kind !== choice.kind) {
    return false;
  }
  if (standing.kind === "option" && choice.kind === "option") {
    return standing.optionId === choice.optionId;
  }
  if (standing.kind === "all" && choice.kind === "all") {
    return standing.first === choice.first;
  }
  return false;
}

/**
 * The define press a word press runs FIRST, so "accept, done meaning this" lands as one answer: the act row and its
 * slots when the page holds a choice that is not already recorded, and `null` otherwise. A "not mine" records no
 * definition — a definition of done for something that is not the owner's is a fact about nothing.
 *
 * @param word the word being pressed, or `null` for the record-definition button on its own
 * @returns the press to run first, or `null`
 */
export function definePress({
  candidate,
  choice,
  word,
}: {
  candidate: CandidateRowView;
  choice: DefinitionChoice | null;
  word: PressReaction | null;
}): PagePress | null {
  if (choice === null || word === "no" || alreadyStanding({ candidate, choice })) {
    return null;
  }
  if (choice.kind === "option") {
    return { slots: { candidate: candidate.id, option: choice.optionId }, slug: "workstream-define-option" };
  }
  if (choice.first === null) {
    return { slots: { candidate: candidate.id }, slug: "workstream-define-all" };
  }
  return { slots: { candidate: candidate.id, option: choice.first }, slug: "workstream-define-all-first" };
}

/**
 * A word that places a candidate against something, chosen from what the page offers: a register entry it is the
 * same as, a milestone of or an outcome of; the register entry that covers it, as not the owner's; or the earlier
 * steer an accept answers. Every arm names something the page listed — what superseded it, whose it is or a new title
 * is said in the call's chat.
 */
export type PlacingChoice =
  | { readonly kind: "same-as" | "milestone-of" | "outcome-of"; readonly target: string }
  | { readonly kind: "not-mine"; readonly coveredBy: string }
  | { readonly kind: "accept-steer"; readonly steer: string };

/**
 * The press a placing choice runs, or `null` when it is not yet complete enough for the verb to take.
 *
 * @returns the press, or `null`
 */
export function placingPress({
  candidate,
  choice,
}: {
  candidate: CandidateRowView;
  choice: PlacingChoice;
}): PagePress | null {
  const id = candidate.id;
  // Narrowed by the field, since one member carries all three naming kinds and `kind ===` cannot rule it out.
  if ("target" in choice) {
    if (choice.target === "") {
      return null;
    }
    return { slots: { candidate: id, target: choice.target }, slug: `workstream-${choice.kind}` };
  }
  if (choice.kind === "accept-steer") {
    return choice.steer === ""
      ? null
      : { slots: { candidate: id, steer: choice.steer }, slug: "workstream-accept-steer" };
  }
  if (choice.coveredBy === "") {
    return null;
  }
  return { slots: { candidate: id, target: choice.coveredBy }, slug: "workstream-not-mine-covered" };
}

/**
 * The words an accept tied to an earlier steer carries: the steer as the owner said it, dated, and where.
 *
 * @returns e.g. `<date>: ratchet everything to three hundred lines [<anchor>]`
 */
export function steerWords({ steer }: { steer: PriorSteerView }): string {
  return `${steer.date}: ${steer.text} [${steer.anchor}]`;
}

/**
 * `1 promotion`, `2 stories` — a count and its noun, plural when it is not one.
 *
 * @returns the phrase
 */
function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Each debt the seat may owe, its noun singular and plural. */
const DEBTS = [
  { key: "promotionOwed", many: "promotions", one: "promotion" },
  { key: "definitionOwed", many: "definitions", one: "definition" },
  { key: "placementOwed", many: "placements", one: "placement" },
  { key: "proposalOwed", many: "proposals to mine", one: "proposal to mine" },
  { key: "storyOwed", many: "stories", one: "story" },
  { key: "retractions", many: "retractions", one: "retraction" },
] as const;

/**
 * The one line over the section: how many candidates, how many still wait on a word, each word the owner has given,
 * then what the Workstreams seat owes. Unanswered is always named; a word only once the owner has used it, because
 * eleven zeroes are a wall; the seat's debts only when there are some, and "owes nothing" said plainly when there are
 * none.
 *
 * @returns e.g. `3 candidates, 1 unanswered: 1 accepted · 1 not mine. The seat owes 1 story.`
 */
export function candidatesSummary({ view }: { view: CandidatesView }): string {
  const words = CANDIDATE_REACTIONS.filter((word) => view.counts[word] > 0).map(
    (word) => `${String(view.counts[word])} ${REACTION_LABEL[word]}`,
  );
  const owed = DEBTS.filter((debt) => view[debt.key].length > 0).map((debt) =>
    counted({ count: view[debt.key].length, many: debt.many, one: debt.one }),
  );
  let seat = "The seat owes nothing.";
  if (owed.length > 0) {
    seat = `The seat owes ${owed.join(", ")}.`;
  }
  const total = counted({ count: view.candidates.length, many: "candidates", one: "candidate" });
  const head = `${total}, ${String(view.counts.unanswered)} unanswered`;
  if (words.length === 0) {
    return `${head}. ${seat}`;
  }
  return `${head}: ${words.join(" · ")}. ${seat}`;
}

/**
 * What a ruled candidate's word says in one clause: the word, what it names, and the owner's own words on it quoted
 * — the steer it answers, the owner's why, and what they said as heard — as the reactions ledger kept them, never a paraphrase.
 *
 * @returns e.g. `milestone of pool-e2e`, `not mine — the platform team's — covered by merge-gate — "not driving it"`
 */
export function answeredLine({ candidate }: { candidate: CandidateRowView }): string {
  if (candidate.reaction === null) {
    return "unanswered";
  }
  const parts = [REACTION_LABEL[candidate.reaction]];
  const named = [candidate.sameAs, candidate.milestoneOf, candidate.outcomeOf].find((one) => one !== null);
  if (named !== undefined) {
    parts[0] = `${parts[0]} ${named}`;
  }
  if (candidate.supersededBy !== null) {
    parts[0] = `superseded by ${candidate.supersededBy}`;
  }
  if (candidate.owner !== null) {
    parts.push(`${candidate.owner}'s`);
  }
  if (candidate.coveredBy !== null) {
    parts.push(`covered by ${candidate.coveredBy}`);
  }
  if (candidate.steer !== null) {
    parts.push(`answers "${candidate.steer}"`);
  }
  if (candidate.reason !== null) {
    parts.push(`"${candidate.reason}"`);
  }
  // An abandoned word heard aloud keeps the same words as its reason; quoting them twice says nothing more.
  if (candidate.heard !== null && candidate.heard !== candidate.reason) {
    parts.push(`"${candidate.heard}"`);
  }
  return parts.join(" · ");
}

/**
 * The period a candidate spans, as its row shows it: one date when it began and ended the same day.
 *
 * @returns e.g. `<first date> to <last date>`
 */
export function candidatePeriod({ candidate }: { candidate: CandidateRowView }): string {
  if (candidate.first === candidate.last) {
    return candidate.first;
  }
  return `${candidate.first} to ${candidate.last}`;
}

/**
 * Where the proposals came from, in one line: the owner's own stated outcomes always, and the last mine when there was one —
 * when, from what, and how many records each source gave.
 *
 * @returns the provenance line the section prints under its question
 */
export function provenanceLine({ view }: { view: CandidatesView }): string {
  if (view.mined === null) {
    return "Proposed from your words: the outcomes you have stated. Keep each you still want; nothing is kept until you do.";
  }
  const { minedFrom, minedIso, minedSources } = view.mined;
  const sources = minedSources.map((one) => `${one.source} ${String(one.recordsRead)}`).join(" · ");
  let readCounts = "";
  if (sources !== "") {
    readCounts = ` (${sources} records)`;
  }
  return (
    `Proposed from your words: the outcomes you have stated, then mined from ${minedFrom} on ` +
    `${shortDate({ date: minedIso.slice(0, 10) })}${readCounts}, ranked by how much of your own words back each.`
  );
}
