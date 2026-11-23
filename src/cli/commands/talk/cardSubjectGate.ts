/**
 * Whether a card takes their words at all — asked by `./cardLandApply.ts` before any read of the ledger or any write.
 * Words that are no answer never land (`../../../talk/cardAnswer.ts`), and
 * a `pr:` card must be THEIRS, the effectful half of `../../../talk/cardSubject.ts`: a colleague's pull request that
 * reached their Queue once held twenty-three of their utterances, most about other work.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ReadingsError } from "../../../readings/errors.js";
import { lastReading } from "../../../readings/store.js";
import type { Reading } from "../../../readings/types.js";
import { cardAnswerRefusal } from "../../../talk/cardAnswer.js";
import { type CardLandingError, CardLandingErrors } from "../../../talk/cardLandingErrors.js";
import {
  appendCardNotOwners,
  cardsNotOwnersUnreadableLines,
  readCardsNotOwners,
} from "../../../talk/cardNotOwnerStore.js";
import { prCardSubject } from "../../../talk/cardSubject.js";
import { prCardKeyParts } from "../../../talk/prCardKey.js";
import { LANDING_PRODUCER } from "../reading/core.js";

/**
 * Whether their words may land on this card: refused `NOT_AN_ANSWER` on a hand step and on greeting or filler alone,
 * for every source, then a `pr:` card judged by {@link prSubjectOn}. Nothing here writes but that verdict's record.
 *
 * @param kind the card key's kind, from `cardKeyParts`
 * @param decidedIso when they said it
 * @param nowIso when a verdict reached now is recorded
 * @returns ok when the words may land, else the refusal
 */
export function cardTakesWords({
  cardKey,
  decidedIso,
  home,
  kind,
  nowIso,
  words,
}: {
  cardKey: string;
  decidedIso: string;
  home: string;
  kind: string;
  nowIso: string;
  words: string;
}): Result<void, CardLandingError> {
  const refusal = cardAnswerRefusal({ cardKey, words });
  if (refusal !== undefined) {
    return err(refusal);
  }
  if (kind !== "pr") {
    return ok(undefined);
  }
  return prSubjectOn({ cardKey, decidedIso, home, nowIso });
}

/**
 * Refuse a `pr:` card whose pull request somebody else opened, judged by the landing reading the ledger held when they
 * SPOKE (`../../../talk/cardSubject.ts`) — never the newest. A refused utterance stays unlanded, so every later
 * transcript batch and call open re-judges it; judged by the newest reading, it landed on the colleague's card the
 * moment their pull request merged out of the census. A verdict once reached is recorded
 * (`../../../talk/cardNotOwnerStore.ts`) and read first, because the instant itself moves when an utterance grows or
 * splits. No reading then says nobody else did, so it lands; a ledger that will not read is a fault, retried.
 *
 * @param cardKey the whole key, repository and number, under which a verdict is kept and read
 * @param decidedIso when they said it, which fixes the reading that judges it
 * @param nowIso when a verdict reached now is recorded
 * @returns ok unless the key names no repository (`CARD_KEY_INVALID`), a reading says it is not their (`CARD_NOT_HIS`)
 * or the ledger would not say (`SUBJECT_UNREADABLE`)
 */
export function prSubjectOn({
  cardKey,
  decidedIso,
  home,
  nowIso,
}: {
  cardKey: string;
  decidedIso: string;
  home: string;
  nowIso: string;
}): Result<void, CardLandingError> {
  // A bare `pr:<n>` names no pull request the Queue draws, so it lands nowhere — with or without a reading to judge it.
  if (prCardKeyParts({ key: cardKey }) === undefined) {
    return err(CardLandingErrors.cardKeyInvalid({ cardKey }));
  }
  const recorded = readCardsNotOwners({ home });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  for (const msg of cardsNotOwnersUnreadableLines({ read: recorded.value })) {
    logger.error({ msg });
  }
  // Kept under the exact key: one pull request has one key (`../../../talk/prCardKey.ts` refuses a leading zero), and
  // a key naming the repository keeps one repository's verdict off another's same-numbered card.
  const known = recorded.value.byCard.get(cardKey);
  if (known !== undefined) {
    return err(CardLandingErrors.cardNotOwner({ cardKey, why: known.why }));
  }
  const reading = readingInForce({ decidedIso, home });
  if (reading.isErr()) {
    if (reading.error.code === "NO_READING") {
      return ok(undefined);
    }
    return err(CardLandingErrors.subjectUnreadable({ cardKey, why: reading.error.message }));
  }
  const subject = prCardSubject({
    cardKey,
    document: reading.value.document,
    observedAtIso: reading.value.record.observedAtIso,
  });
  if (subject.kind === "not-owner") {
    const kept = appendCardNotOwners({ home, row: { cardKey, recordedAtIso: nowIso, why: subject.why } });
    if (kept.isErr()) {
      return err(kept.error);
    }
    return err(CardLandingErrors.cardNotOwner({ cardKey, why: subject.why }));
  }
  return ok(undefined);
}

/**
 * The landing reading in force when they spoke — or, when that one document will not read, the newest. The instant is
 * fixed by the call file, so a retry would meet the same unreadable document forever and their own pull request would
 * never land again; the newest is what judged every card before the instant did, and the
 * verdicts already recorded still hold whatever it says.
 *
 * @param decidedIso when they said it
 * @returns the reading, `NO_READING`, or the newest reading's own failure
 */
function readingInForce({ decidedIso, home }: { decidedIso: string; home: string }): Result<Reading, ReadingsError> {
  const asOf = lastReading({ asOfIso: decidedIso, home, producer: LANDING_PRODUCER });
  if (asOf.isOk() || asOf.error.code === "NO_READING") {
    return asOf;
  }
  logger.error({
    msg: `talk land: the landing reading in force at ${decidedIso} will not read (${asOf.error.message}); judging by the newest`,
  });
  return lastReading({ home, producer: LANDING_PRODUCER });
}
