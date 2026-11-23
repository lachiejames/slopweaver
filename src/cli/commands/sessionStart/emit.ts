/**
 * The two ways `session-start` shows one assembled list: as a machine-readable document, and as the
 * terminal output the owner actually reads.
 *
 * Split out of `./run` along the seam that file's own header names — the shell's job is to choose between
 * two ways of printing the SAME thing, so the assembling and the printing are different jobs. Everything
 * here reads {@link AssembledList} and writes; nothing here decides what is on the list.
 *
 * The rendering rules themselves live one layer down in `../../../sessionStart/render`, which is pure. This
 * module is the thin effectful wrapper that puts those lines on a logger in the right order.
 */

import { logger } from "../../../lib/logger.js";
import type { Ranking } from "../../../sessionStart/rank.js";
import type { Movement } from "../../../sessionStart/reconcile.js";
import { movementTally } from "../../../sessionStart/reconcile.js";
import type { PausedRow } from "../../../sessionStart/render.js";
import { listLines, movementLines, pausedLines } from "../../../sessionStart/render.js";
import type { Standing } from "../../../sessionStart/standing.js";

/**
 * Everything one run produced, in the shape both emitters read.
 *
 * @internal the contract between the gathering step and the two ways of showing it.
 */
export interface AssembledList {
  readonly ranking: Ranking;
  /**
   * What the run's `--deadline` stopped it reading — a leg's name, or the live re-read — empty for a whole list.
   * Carried into `--json` so a reader tells a list cut short from a complete one without parsing prose.
   */
  readonly cutShort: readonly string[];
  readonly docsRead: number;
  readonly proposalsRead: number;
  /** How many inbox messages the mail leg read. */
  readonly mailRead: number;
  readonly pullRequestsRead: number;
  readonly pullRequestsWaiting: number;
  /** How many mail threads were answered after the owner's last word. */
  readonly mailAnsweredAfterOwner: number;
  /** How many Slack threads the owner spoke in, in the leg's window. */
  readonly slackThreadsRead: number;
  /** How many of those moved on without the owner, before the non-human filter dropped any. */
  readonly slackThreadsMoved: number;
  /** How many Slack threads tagged the owner inside the window, before the has-the-owner-answered rule. */
  readonly slackThreadsTagging: number;
  /** How many of those the owner has not spoken in since — the mention detector's own yield. */
  readonly slackThreadsTagged: number;
  readonly settledByLockIn: number;
  /**
   * Every board row parked on a person — printed as context under the list, never ranked into it.
   *
   * A workstream waiting on somebody is still worth remembering, with no deadline
   * and no cadence. It is not the owner's move, so it does not compete for a position; it is not gone, so it does
   * not disappear. See {@link ./read.readWaitingOnOwner} for why the split lives at the read.
   */
  readonly paused: readonly PausedRow[];
  /** How many rows each standing accounted for, ranked and dropped alike, so a held-back row is countable. */
  readonly standingTally: StandingTally;
  readonly couldNotSee: readonly string[];
  readonly nowIso: string;
  readonly movements: readonly Movement[];
  readonly sinceIso: string | undefined;
}

/**
 * How many rows each standing accounted for, across the ranked rows and the drops alike.
 *
 * @internal the contract between the gathering step and the two ways of showing it.
 */
interface StandingTally {
  readonly ruled: number;
  readonly inFlight: number;
  readonly untouched: number;
}

/**
 * Which standing one row carries, with the no-standing case written as a branch.
 *
 * A row `../../../sessionStart/standing.applyStandings` never touched is UNTOUCHED — the same word that
 * standing itself uses for a row nothing on record names — so the substitution is an identity rather than a
 * default, and saying it in a line of code is what the `no-silent-fallback` gate asks for.
 *
 * @param standing the row own standing, absent until standings have run
 * @returns the standing kind to count this row under
 */
function standingKindOf({ standing }: { standing: Standing | undefined }): Standing["kind"] {
  if (standing === undefined) {
    return "untouched";
  }
  return standing.kind;
}

/**
 * Count each standing across the whole ranking.
 *
 * Zeros included, so a run where nothing was ruled is distinguishable from one where standings never ran.
 *
 * @param ranking the ranking after {@link ../../../sessionStart/standing.applyStandings}
 * @returns one count per standing
 */
export function standingTally({ ranking }: { ranking: Ranking }): StandingTally {
  const kinds = [...ranking.ranked, ...ranking.dropped].map((row) => standingKindOf({ standing: row.standing }));
  return {
    inFlight: kinds.filter((kind) => kind === "in-flight").length,
    ruled: kinds.filter((kind) => kind === "ruled").length,
    untouched: kinds.filter((kind) => kind === "untouched").length,
  };
}

/**
 * A previous run instant as the document spells it.
 *
 * `null` rather than `undefined` because `JSON.stringify` DROPS an undefined value, so the key would
 * simply be missing and a reader could not tell "there was no previous run" from "this version does not
 * write that key". The branch is here rather than inline so the substitution is a stated one.
 *
 * @param sinceIso when the previous run happened, absent on a first run
 * @returns the instant, or null when this is the first run
 */
function sinceOf({ sinceIso }: { sinceIso: string | undefined }): string | null {
  if (sinceIso === undefined) {
    return null;
  }
  return sinceIso;
}

/**
 * The whole run as one machine-readable document.
 *
 * `since` is `null` rather than absent on a first run, so a reader can tell "there was no previous run" from
 * "this key is not in this version's output" without knowing which version wrote it.
 *
 * @param ranking what made the list and what did not
 * @param docsRead how many board docs the board leg read
 * @param proposalsRead how many proposals the cycle pass made
 * @param slackThreadsRead how many Slack threads the owner spoke in
 * @param slackThreadsMoved how many of those moved on without the owner
 * @param slackThreadsTagging how many Slack threads tagged the owner
 * @param slackThreadsTagged how many of those the owner has not spoken in since
 * @param mailRead how many inbox messages the mail leg read
 * @param mailAnsweredAfterOwner how many mail threads were answered after the owner's last word
 * @param pullRequestsRead how many of the owner's open pull requests the GitHub leg read
 * @param pullRequestsWaiting how many of those are sitting with somebody else
 * @param settledByLockIn how many rows a standing resolution of the owner's held back
 * @param standingTally how many rows each standing accounted for
 * @param couldNotSee every limit this run carries
 * @param nowIso the run's own instant
 * @param movements what changed since the previous run
 * @param sinceIso when the previous run happened, absent when this is the first
 * @returns the document to serialise
 */
export function jsonDocument({
  ranking,
  docsRead,
  proposalsRead,
  slackThreadsRead,
  slackThreadsMoved,
  slackThreadsTagging,
  slackThreadsTagged,
  mailRead,
  mailAnsweredAfterOwner,
  pullRequestsRead,
  pullRequestsWaiting,
  settledByLockIn,
  standingTally: tally,
  couldNotSee,
  cutShort,
  nowIso,
  movements,
  paused,
  sinceIso,
}: AssembledList): Record<string, unknown> {
  return {
    couldNotSee,
    cutShort,
    docsRead,
    movementTally: movementTally({ movements }),
    movements,
    nowIso,
    paused,
    proposalsRead,
    pullRequestsRead,
    pullRequestsWaiting,
    ranking,
    settledByLockIn,
    since: sinceOf({ sinceIso }),
    standingTally: tally,
    mailAnsweredAfterOwner,
    mailRead,
    slackThreadsMoved,
    slackThreadsRead,
    slackThreadsTagged,
    slackThreadsTagging,
  };
}

/**
 * Print the rows parked on a person, or nothing at all when none are.
 *
 * The lines themselves are {@link ../../../sessionStart/render.pausedLines}, which is where the no-clock rule
 * is stated and tested; this is only the effectful half.
 *
 * @param paused every row the board placed under `PAUSED`
 */
function printPaused({ paused }: { paused: readonly PausedRow[] }): void {
  pausedLines({ paused }).forEach((line) => {
    logger.info({ msg: line });
  });
}

/**
 * Print what moved since the previous run, or say plainly that nothing did.
 *
 * A first run prints neither: with no baseline there is nothing to compare, and "nothing moved" would be a
 * claim rather than a measurement. The two silences are different facts and the reader is never shown one
 * dressed as the other.
 *
 * @param movements the diff against the previous run
 * @param sinceIso when that run happened, absent on a first run
 */
function printMovements({
  movements,
  sinceIso,
}: {
  movements: readonly Movement[];
  sinceIso: string | undefined;
}): void {
  if (sinceIso === undefined) {
    return;
  }
  const lines = movementLines({ movements, sinceIso });
  logger.info({ msg: "" });
  if (lines.length === 0) {
    logger.info({ msg: `Nothing moved since your last run at ${sinceIso}.` });
    return;
  }
  lines.forEach((line) => {
    logger.info({ msg: line });
  });
}

/**
 * Print the whole list, the counts and the limits.
 *
 * @param ranking what made the list and what did not
 * @param top how many rows the owner asked to see
 * @param docsRead how many board docs the board leg read
 * @param proposalsRead how many proposals the cycle pass made
 * @param slackThreadsRead how many Slack threads the owner spoke in
 * @param slackThreadsMoved how many of those moved on without the owner
 * @param slackThreadsTagging how many Slack threads tagged the owner
 * @param slackThreadsTagged how many of those the owner has not spoken in since
 * @param mailRead how many inbox messages the mail leg read
 * @param mailAnsweredAfterOwner how many mail threads were answered after the owner's last word
 * @param pullRequestsRead how many of the owner's open pull requests the GitHub leg read
 * @param pullRequestsWaiting how many of those are sitting with somebody else
 * @param couldNotSee every limit this run carries, the legs' own included
 * @param nowIso the run's own instant
 * @param settledByLockIn how many rows a standing resolution of the owner's held back
 * @param standingTally how many rows each standing accounted for
 * @param movements what changed since the previous run
 * @param sinceIso when the previous run happened, absent when this is the first
 */
export function printList({
  ranking,
  top,
  docsRead,
  proposalsRead,
  slackThreadsRead,
  slackThreadsMoved,
  slackThreadsTagging,
  slackThreadsTagged,
  mailRead,
  mailAnsweredAfterOwner,
  pullRequestsRead,
  pullRequestsWaiting,
  couldNotSee,
  nowIso,
  paused,
  settledByLockIn,
  standingTally: tally,
  movements,
  sinceIso,
}: AssembledList & { top: number }): void {
  listLines({ ranking, top }).forEach((line) => {
    logger.info({ msg: line });
  });
  printPaused({ paused });
  printMovements({ movements, sinceIso });
  logger.info({ msg: "" });
  logger.info({
    msg: `read ${String(docsRead)} board doc(s) and ${String(proposalsRead)} cycle proposal(s) at ${nowIso}`,
  });
  logger.info({
    msg: `read ${String(slackThreadsRead)} Slack thread(s) you spoke in, ${String(slackThreadsMoved)} of which moved on without you; ${String(slackThreadsTagging)} thread(s) tagged you, ${String(slackThreadsTagged)} of which you have not answered`,
  });
  logger.info({
    msg: `read ${String(mailRead)} inbox message(s), ${String(mailAnsweredAfterOwner)} of which answered you after your last reply`,
  });
  logger.info({
    msg: `read ${String(pullRequestsRead)} open pull request(s) of yours, ${String(pullRequestsWaiting)} of which are sitting with somebody else`,
  });
  if (settledByLockIn > 0) {
    logger.info({
      msg: `${String(settledByLockIn)} row(s) held back by what you said last time — --json says which`,
    });
  }
  if (tally.ruled + tally.inFlight > 0) {
    logger.info({
      msg: `${String(tally.ruled)} row(s) you already ruled on, ${String(tally.inFlight)} a session is already inside — --json carries each row's standing`,
    });
  }
  couldNotSee.forEach((limit) => {
    logger.info({ msg: `could not see: ${limit}` });
  });
}
