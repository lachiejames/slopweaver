/**
 * A spoken reaction to a check-in, recorded as the owner's word on every card it covers — the write that makes one
 * reaction on a hands-free walk clear a batch.
 *
 * `talk relay` calls this once the owner's words are on the board, when the voice named the check-in it read them and
 * how far their reaction reaches. Which cards that is, is `../autonomy/checkIns.ts`'s; this writes one `autonomy steer`
 * row per card, in the owner's transcribed words, provenance `talk:<turnId>`.
 *
 * ## A replay writes nothing twice
 *
 * The relay is idempotent on its turn, and so is this: the cards are worked out over the register WITHOUT this
 * turn's own words, and a card already carrying a word from this turn is skipped. A run that died part way through
 * is finished by the retry, and a whole replay writes nothing.
 */
import { type CheckInRulingError, placeOfSubject, type RulingCovers, rulingTargets } from "../autonomy/checkIns.js";
import { type AutonomyError } from "../autonomy/errors.js";
import type { AutonomyLedgerPort } from "../autonomy/port.js";
import { foldAutonomy } from "../autonomy/query.js";
import { buildAutonomySteer } from "../autonomy/row.js";
import type { AutonomyStoreError } from "../autonomy/storeErrors.js";
import { type AutonomyRecord, type AutonomySteerRow } from "../autonomy/types.js";
import { err, ok, type Result } from "../lib/result.js";

/** The prefix an act's key carries on the Queue and in the voice's pack. */
export const CHECK_IN_KEY_PREFIX = "act:";

/** What one reaction came to: the cards the owner's word now settles, the read card first. */
export interface CheckInRuling {
  readonly covers: RulingCovers;
  /** The act the owner was read. */
  readonly actionId: string;
  readonly kind: string;
  readonly place: string;
  /** Every card's newest act the owner's word is now on, the read card's first — this turn's earlier writes included. */
  readonly settled: readonly string[];
  /** How many of those this run wrote; zero on a replay. */
  readonly written: number;
}

/** Why a reaction was not recorded as a ruling: a ledger refusal, a store refusal, or no check-in to settle. */
export type CheckInRulingFailure = CheckInRulingError | AutonomyError | AutonomyStoreError;

/**
 * The provenance every word of one relayed turn carries.
 *
 * @returns `talk:<turnId>`, the `bySession` of each steer row the turn writes
 */
function rulingSession({ turnId }: { turnId: string }): string {
  return `talk:${turnId}`;
}

/**
 * The steer rows one reaction needs written, over the register as it stands — pure, so the reach and the replay are
 * unit tests.
 *
 * @param records every record the register holds, in append order
 * @param actionId the act the owner was read
 * @param covers how far the owner's reaction reaches
 * @param heard the owner's transcribed words, the word recorded on each card
 * @param turnId the relay's turn, which makes a replay find its own words
 * @param nowIso when the word is recorded
 * @returns the ruling and the rows still to write, or why there is no ruling
 */
export function checkInRulingRows({
  records,
  actionId,
  covers,
  heard,
  turnId,
  nowIso,
}: {
  records: readonly AutonomyRecord[];
  actionId: string;
  covers: RulingCovers;
  heard: string;
  turnId: string;
  nowIso: string;
}): Result<{ ruling: CheckInRuling; rows: readonly AutonomySteerRow[] }, CheckInRulingFailure> {
  const bySession = rulingSession({ turnId });
  // A word row (a steer or a class steer) carries no `kind`; an act row always does, whoever recorded it.
  const isThisTurns = (record: AutonomyRecord): boolean => !("kind" in record) && record.bySession === bySession;
  const before = foldAutonomy({ records: records.filter((record) => !isThisTurns(record)) });
  if (before.isErr()) {
    return err(before.error);
  }
  const targets = rulingTargets({ actionId, actions: before.value, covers });
  if (targets.isErr()) {
    return err(targets.error);
  }
  const already = new Set(records.filter(isThisTurns).map((record) => record.actionId));
  const rows: AutonomySteerRow[] = [];
  for (const target of targets.value.filter((id) => !already.has(id))) {
    const built = buildAutonomySteer({ actionId: target, bySession, steer: heard, steeredIso: nowIso });
    if (built.isErr()) {
      return err(built.error);
    }
    rows.push(built.value);
  }
  const read = before.value.find((entry) => entry.action.actionId === actionId)!.action;
  return ok({
    ruling: {
      actionId,
      covers,
      kind: read.kind,
      place: placeOfSubject({ subject: read.subject }),
      settled: targets.value,
      written: rows.length,
    },
    rows,
  });
}

/**
 * Record the owner's reaction as their word on every card it covers, in the ledger.
 *
 * @param ledger the autonomy ledger read and written
 * @param home the state home the ledger answers for
 * @param about the relay's `act:<actionId>` key
 * @param covers how far the owner's reaction reaches
 * @param heard the owner's transcribed words
 * @param turnId the relay's turn
 * @param nowIso when the word is recorded
 * @returns what the reaction settled, or why nothing was recorded
 */
export async function applyCheckInRuling({
  ledger,
  home,
  about,
  covers,
  heard,
  turnId,
  nowIso,
}: {
  ledger: AutonomyLedgerPort;
  home: string;
  about: string;
  covers: RulingCovers;
  heard: string;
  turnId: string;
  nowIso: string;
}): Promise<Result<CheckInRuling, CheckInRulingFailure>> {
  // Whole, never tolerant: the port refuses the read on one unreadable row, because a ruling can name a whole
  // pattern or class of acts and one sitting on a skipped row would take the owner's word on only part of it.
  const records = await ledger.readRecords({ home });
  if (records.isErr()) {
    return err(records.error);
  }
  const actionId = about.slice(CHECK_IN_KEY_PREFIX.length);
  const planned = checkInRulingRows({ actionId, covers, heard, nowIso, records: records.value, turnId });
  if (planned.isErr()) {
    return err(planned.error);
  }
  for (const row of planned.value.rows) {
    const written = await ledger.appendRecord({ home, record: row });
    if (written.isErr()) {
      return err(written.error);
    }
  }
  return ok(planned.value.ruling);
}
