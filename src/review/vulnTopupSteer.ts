/**
 * WHETHER the owner's explicit steer on one board row may release an idle merge-release gate — the gate's one hatch.
 *
 * The owner's ruling (`docs/doctrine-rationale/explicit-steer.md`): an explicit steer that says it overrides
 * earlier guidance beats every standing rule for THAT instance. A steer can name a delivery instant while the
 * gate (`./vulnTopupGate.ts`) still holds the top-up at 0 of 3 merged; without a hatch no verb could honour it.
 *
 * The hatch is narrow by construction: it reads the ONE row the caller names, releases only while that row's
 * STANDING ruling is an explicit steer naming an instant still ahead, and refuses everything else — no steer, a
 * steer naming no instant, an instant passed, a later ordinary ruling superseding the steer, or a journal line it
 * could not read (which might be exactly that later ruling). A steer with no instant is refused because an
 * open-ended steer would hold the gate open for every firing after it. Pure: the caller read the journal.
 */
import type { RunEvent } from "../handover/ledger.js";
import { standingExplicitSteer } from "../handover/ruling.js";
import { err, ok, type Result } from "../lib/result.js";

/** What a release rests on: the steer's own instant and where it was given. */
export interface TopupSteerRelease {
  readonly deliverByIso: string;
  readonly anchor: string;
}

/** The steered row's journal has lines this build cannot decode, and one may be the ruling that ended the steer. */
export interface SteerJournalUnreadableError {
  readonly code: "STEER_JOURNAL_UNREADABLE";
  readonly message: string;
  readonly unreadable: readonly number[];
}
/** The row's standing ruling is not an explicit steer: none at all, or a later ordinary one superseded it. */
export interface NotASteerError {
  readonly code: "NOT_A_STEER";
  readonly message: string;
}
/** The standing steer names no deliver-by, so it cannot bound how long the gate stays open. */
export interface SteerUnboundedError {
  readonly code: "STEER_UNBOUNDED";
  readonly message: string;
}
/** The instant to judge at, or the steer's deliver-by, does not parse. */
export interface SteerInstantUnparseableError {
  readonly code: "STEER_INSTANT_UNPARSEABLE";
  readonly message: string;
  readonly nowIso: string;
  readonly deliverByIso: string;
}
/** The steer's deliver-by has passed. */
export interface SteerPassedError {
  readonly code: "STEER_PASSED";
  readonly message: string;
  readonly deliverByIso: string;
}
/** Why a row's steer does not release the merge-release gate. */
export type TopupSteerError =
  NotASteerError | SteerInstantUnparseableError | SteerJournalUnreadableError | SteerPassedError | SteerUnboundedError;

/** The one constructor per {@link TopupSteerError} variant. */
export const TopupSteerErrors = {
  instantUnparseable: ({
    deliverByIso,
    nowIso,
  }: {
    deliverByIso: string;
    nowIso: string;
  }): SteerInstantUnparseableError => ({
    code: "STEER_INSTANT_UNPARSEABLE",
    deliverByIso,
    message: `the instant to judge at (${nowIso}) or the steer's deliver-by (${deliverByIso}) does not parse`,
    nowIso,
  }),
  journalUnreadable: ({ unreadable }: { unreadable: readonly number[] }): SteerJournalUnreadableError => ({
    code: "STEER_JOURNAL_UNREADABLE",
    message: `its journal has ${String(unreadable.length)} line(s) this build cannot read, and one may be a later ruling that ended the steer`,
    unreadable,
  }),
  notASteer: (): NotASteerError => ({
    code: "NOT_A_STEER",
    message: "its standing ruling is not an explicit steer",
  }),
  passed: ({ deliverByIso }: { deliverByIso: string }): SteerPassedError => ({
    code: "STEER_PASSED",
    deliverByIso,
    message: `its explicit steer was due ${deliverByIso}, which has passed`,
  }),
  unbounded: (): SteerUnboundedError => ({
    code: "STEER_UNBOUNDED",
    message: "its explicit steer names no deliver-by instant, so it cannot bound how long the gate stays open",
  }),
} as const;

/**
 * Judge whether the named row's explicit steer releases the gate now.
 *
 * @param events the steered row's decoded journal events, in order
 * @param unreadable line numbers of the journal that would not decode — any at all refuses, since one may be the
 *   ruling that ended the steer
 * @param nowIso the instant to judge at
 * @returns the release, or the typed reason the steer does not release it
 */
export function topupSteerRelease({
  events,
  unreadable,
  nowIso,
}: {
  events: readonly RunEvent[];
  unreadable: readonly number[];
  nowIso: string;
}): Result<TopupSteerRelease, TopupSteerError> {
  if (unreadable.length > 0) {
    return err(TopupSteerErrors.journalUnreadable({ unreadable }));
  }
  const steer = standingExplicitSteer({ events });
  if (steer === undefined) {
    return err(TopupSteerErrors.notASteer());
  }
  const { deliverByIso } = steer.explicitSteer;
  if (deliverByIso === undefined) {
    return err(TopupSteerErrors.unbounded());
  }
  const now = Date.parse(nowIso);
  const due = Date.parse(deliverByIso);
  // A comparison with NaN is false either way round, so an unparseable instant must refuse here, never release.
  if (Number.isNaN(now) || Number.isNaN(due)) {
    return err(TopupSteerErrors.instantUnparseable({ deliverByIso, nowIso }));
  }
  if (now >= due) {
    return err(TopupSteerErrors.passed({ deliverByIso }));
  }
  return ok({ anchor: steer.anchor, deliverByIso });
}
