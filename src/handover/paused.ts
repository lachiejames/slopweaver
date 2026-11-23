/**
 * PAUSED ON A PERSON — the one board state that says "waiting on somebody, with nothing owed by a date".
 *
 * ## The state the board could not express
 *
 * A reply often does not arrive in a timely manner, and the work should still be remembered: people are busy, so a
 * pause carries no time limit and no deadline. It is a work stream that is useful but paused on someone else.
 *
 * MEASURED against the board: {@link ./doc.ts}'s `DocStatus` was
 * `draft|ready|in-progress|done|cancelled|rejected|unknown`. `done` takes a row off the board, `blocked`
 * parses to `unknown`, and the only spelling left was `in-progress` plus a `blockedBy:` entry naming a
 * PERSON — which resolves to no doc, so the board printed *"blockedBy names <a sentence about a human>,
 * which no doc on the board claims"* under `NOT YET`, and {@link ./consistency.ts} graded the pair a
 * `transition` rather than a settled state. The row read as a typo and as work mid-flight, and it was
 * neither.
 *
 * ## Why this is a STATUS, when `blocked` was refused as one
 *
 * `./doc.ts` refuses `blocked` because blocking is DERIVED — `blockedBy:` already decides it, and a second
 * declaration of the same fact means nobody can say which is right when they disagree. That argument does
 * not reach here, and the difference is the whole justification: **no other field on a doc carries who we
 * are waiting on.** A person is not a slug, so `blockedBy:` cannot hold one without lying to every reader
 * that resolves it; nothing derives a pause; so the doc has to declare it. A declared fact with no second
 * source is exactly what a status is for.
 *
 * ## No clock, anywhere in this feature
 *
 * There is deliberately no `pausedUntil:`, no cadence, no grace window and no elapsed-time arithmetic in
 * this module or in anything that reads it. {@link PausedState.since} is the DATE the pause was recorded,
 * printed verbatim and never subtracted from — a day-count reads as a countdown, and a countdown is the
 * thing the owner ruled out. The board remembers; a clock does not get to decide the row has expired.
 *
 * Pure: every function reads an already-parsed doc. No filesystem, no clock.
 */

import type { HandoverDoc } from "./doc.js";

/** The fields that only ever make sense on a paused row, with the name a refusal message uses for each. */
const PAUSED_ONLY_FIELDS: readonly { readonly name: string; readonly read: (doc: HandoverDoc) => unknown }[] = [
  { name: "pausedOn", read: (doc) => doc.pausedOn },
  { name: "pausedSince", read: (doc) => doc.pausedSince },
];

/** A paused row's two facts, once the row is known to declare them well. */
export interface PausedState {
  /** Who we are waiting on, in the words whoever paused it used — a person, a team, an outside party. */
  readonly who: string;
  /** The date the pause was recorded. Provenance only: nothing subtracts from it. */
  readonly since: string | undefined;
}

/**
 * Whether a string parses as a real instant — the same question `askedIso` has to answer.
 *
 * Deliberately the only thing this module asks about `pausedSince:`. It is checked for being READABLE, never
 * for being recent, and no caller compares it to now.
 */
function isInstant({ value }: { value: string }): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * Every defect in how a row declares a pause.
 *
 * Symmetric on purpose, and both halves are load-bearing. A `paused` row with no `pausedOn:` is the state
 * this whole feature exists to replace, reintroduced one field later — "paused" with nobody named is exactly
 * the unfalsifiable parking the board already could not act on. A `pausedOn:` written beside any other
 * status is a second source of the same fact, which is the objection `./doc.ts` raises against `blocked` and
 * which applies here just as hard.
 *
 * Reported as `problems`, so a malformed pause reaches `CONTRADICTION` rather than quietly parking a row.
 *
 * @param doc the row to read
 * @param declaredStatus the raw `status:` value, so an unparseable one is not blamed on the pause
 * @returns one sentence per defect, empty for a row that declares no pause and none for a well-formed one
 */
export function pausedProblems({
  doc,
  declaredStatus,
}: {
  doc: HandoverDoc;
  declaredStatus: string | undefined;
}): readonly string[] {
  return doc.status === "paused" ? pausedRowProblems({ doc }) : misplacedProblems({ declaredStatus, doc });
}

/** The defects a row that is NOT paused can still carry: a pause field written beside some other status. */
function misplacedProblems({
  doc,
  declaredStatus,
}: {
  doc: HandoverDoc;
  declaredStatus: string | undefined;
}): readonly string[] {
  // An unreadable `status:` is already its own problem; blaming the pause fields for it would print two
  // sentences for one defect and neither would name the real one.
  if (declaredStatus !== undefined && doc.status === "unknown") {
    return [];
  }
  const misplaced = PAUSED_ONLY_FIELDS.filter((field) => field.read(doc) !== undefined).map((field) => field.name);
  if (misplaced.length === 0) {
    return [];
  }
  return [
    `${misplaced.join(", ")} ${misplaced.length === 1 ? "is" : "are"} only meaningful on a paused row — ` +
      `declare \`status: paused\` or remove ${misplaced.length === 1 ? "it" : "them"}`,
  ];
}

/** The defects a row that DOES declare `status: paused` can carry. */
function pausedRowProblems({ doc }: { doc: HandoverDoc }): readonly string[] {
  const problems: string[] = [];
  if (doc.pausedOn === undefined) {
    problems.push(
      "a paused row declares no pausedOn — `paused` with nobody named is the unfalsifiable parking this state replaced",
    );
  }
  if (doc.pausedSince !== undefined && !isInstant({ value: doc.pausedSince })) {
    problems.push(`pausedSince: "${doc.pausedSince}" is not an instant`);
  }
  return problems;
}

/**
 * The pause a row declares, or `undefined` when it declares none.
 *
 * Returns `undefined` for a `paused` row missing its `pausedOn:` as well, so no surface can print a pause
 * with a blank subject — {@link pausedProblems} has already reported that row as malformed.
 *
 * @param doc the row to read
 * @returns who the row is waiting on and since when, or `undefined` when the row is not validly paused
 */
export function pausedStateOf({ doc }: { doc: HandoverDoc }): PausedState | undefined {
  if (doc.status !== "paused" || doc.pausedOn === undefined) {
    return undefined;
  }
  return { since: doc.pausedSince, who: doc.pausedOn };
}

/**
 * How a paused row reads in one phrase, on the board and in the owner's briefing alike.
 *
 * One renderer for every surface, so "paused on <who>" is the same sentence wherever the owner meets it, and so the
 * no-clock rule is enforced in one place rather than trusted in several.
 *
 * @param state the row's pause
 * @returns the phrase, carrying the recorded date verbatim when there is one
 */
export function pausedPhrase({ state }: { state: PausedState }): string {
  const since = state.since === undefined ? "" : `, since ${state.since}`;
  return `paused on ${state.who}${since} — no deadline, never overdue`;
}

/**
 * Why an execution door must not open a paused row, or `undefined` for a row it may open.
 *
 * A pause is a decision that the work waits on a person, so RESUMING it is also a decision — never a side
 * effect of somebody typing the slug. That is the same reasoning `./askRow.ts`'s `settledAskRefusal` gives
 * for a settled ask, and the same shape: the door refuses, names the fact, and points at the verb that
 * changes it.
 *
 * @param doc the row an execution door was pointed at
 * @returns the sentence refusing it, or `undefined` when it may proceed
 */
export function pausedRefusal({ doc }: { doc: HandoverDoc }): string | undefined {
  const state = pausedStateOf({ doc });
  if (state === undefined) {
    return undefined;
  }
  return (
    `${doc.slug} is ${pausedPhrase({ state })}. ` +
    `Unpausing is a decision, not a side effect of starting it: \`slopweaver handover unpause ${doc.slug}\``
  );
}
