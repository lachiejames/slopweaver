/**
 * Which Queue cards the morning `hygiene-sweep` seat re-verifies by reading them.
 *
 * `PR_ENDED` (`./endedPullRequest.ts`) settles what GitHub alone can answer. A card overtaken in prose, a briefing a
 * later one replaced with no declaration, and a reading a later action cleared carry no link a program can follow,
 * so a visible session compares them against later evidence, a few each morning because that session is spend.
 *
 * This module only CHOOSES and ORDERS. Age picks which card is read first and never removes one: the settle the
 * seat may then run needs a witness that answers the card's own question
 * (`skills/automation/reference/queue-recheck.md`).
 */
import { asBoardPriority, type BoardPriority, effectivePriority, priorityIndex } from "../handover/rowKind.js";

/** The most cards one morning seat reads: five judged properly beat a skim of all of them, and each costs tokens. */
export const RECHECK_LIMIT = 5;

/**
 * The fields of a registered ask the choice reads. A row with a run behind it never arrives here: that run owns the
 * question, and only a registered ask (`registeredAskOf`) waits on the owner with nobody on it.
 */
export interface RecheckRow {
  readonly slug: string;
  readonly priority: string | undefined;
  readonly question: string | undefined;
  readonly questionAskedIso: string | undefined;
  readonly stillRealIso: string | undefined;
}

/**
 * The band a card ranks in: what it declared, or an ask's default.
 *
 * @param row the card
 * @returns its effective priority
 */
export function recheckBand({ row }: { row: RecheckRow }): BoardPriority {
  return effectivePriority({ declared: asBoardPriority({ value: row.priority }), kind: "ask" });
}

/** Two optional instants, the absent one first: a card never verified outranks every card that was. */
function compareAbsentFirst({ a, b }: { a: string | undefined; b: string | undefined }): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined) {
    return -1;
  }
  if (b === undefined) {
    return 1;
  }
  return a < b ? -1 : 1;
}

/** Priority, then least recently verified, then oldest question, then slug so two runs order alike. */
function compareRows({ a, b }: { a: RecheckRow; b: RecheckRow }): number {
  const band =
    priorityIndex({ priority: recheckBand({ row: a }) }) - priorityIndex({ priority: recheckBand({ row: b }) });
  return (
    band ||
    compareAbsentFirst({ a: a.stillRealIso, b: b.stillRealIso }) ||
    compareAbsentFirst({ a: a.questionAskedIso, b: b.questionAskedIso }) ||
    a.slug.localeCompare(b.slug)
  );
}

/**
 * The cards to re-verify today: the registered asks nobody verified this UTC day.
 *
 * A card the seat keeps is reconfirmed, which stamps today on it, so a second pass the same day cannot pick it again.
 *
 * @param rows every registered ask waiting on the owner
 * @param todayIso the current UTC day, `YYYY-MM-DD`
 * @param limit the most cards to return
 * @returns how many are due, and the ones to read in order
 */
export function recheckCandidates({
  rows,
  todayIso,
  limit,
}: {
  rows: readonly RecheckRow[];
  todayIso: string;
  limit: number;
}): { due: number; picked: readonly RecheckRow[] } {
  const due = rows.filter((row) => row.stillRealIso === undefined || row.stillRealIso < todayIso);
  return { due: due.length, picked: due.toSorted((a, b) => compareRows({ a, b })).slice(0, limit) };
}
