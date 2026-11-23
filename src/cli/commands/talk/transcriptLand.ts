/**
 * Landing one call's finished utterances on the cards they were said over — the act `talk transcript`
 * (`./transcriptRun.ts`) repeats for the call a batch was appended to and for every earlier call its sweep finds
 * with words still to land.
 */
import { cutUnknownWhy } from "../../../talk/callLines.js";
import { readCallEntriesCounted } from "../../../talk/callStore.js";
import { holdCardLandingLock } from "../../../talk/cardLandingStore.js";
import { type CardUtterance, transcriptCardUtterances } from "../../../talk/cardUtterance.js";
import { landCardHeld } from "./cardLandApply.js";
import { applyCallMoves } from "./cardMoveApply.js";

/** What landing one call's utterances came to. */
export interface Landings {
  /** Utterances landed on a card just now. */
  readonly landed: number;
  /** Each landing that failed, as `<card>: <why>`. */
  readonly failed: readonly string[];
}

/**
 * Land every finished utterance of one call on the card it was said over, reading the call under the ledger's lock:
 * a second run of the same call then lands only what it read after this one landed, never an older grouping of an
 * utterance this one already landed whole.
 *
 * @param ended the call dropped, so its last utterance is finished even with no close line
 * @returns how many landed just now, and each that failed
 */
export async function landCall({
  callId,
  ended,
  handoverDir,
  home,
}: {
  callId: string;
  ended: boolean;
  handoverDir: string;
  home: string;
}): Promise<Landings> {
  const lock = holdCardLandingLock({ home });
  if (lock.isErr()) {
    return { failed: [`any card: ${lock.error.message}`], landed: 0 };
  }
  try {
    return await landCallHeld({ callId, ended, handoverDir, home });
  } finally {
    lock.value();
  }
}

/**
 * Land one finished utterance on the card it was said over.
 *
 * @param cutUnknown the call file holds a line that might be the unfinished end of any utterance, so this one lands cut
 * @returns whether it landed just now, and each problem to report as failed
 */
async function landUtterance({
  cutUnknown,
  handoverDir,
  home,
  utterance,
}: {
  cutUnknown: boolean;
  handoverDir: string;
  home: string;
  utterance: CardUtterance;
}): Promise<{ readonly failed: readonly string[]; readonly landed: boolean }> {
  const outcome = await landCardHeld({
    input: {
      anchor: utterance.anchor,
      cardKey: utterance.cardKey,
      decidedIso: utterance.decidedIso,
      handoverDir,
      home,
      nowIso: new Date().toISOString(),
      laterAnchors: utterance.laterAnchors,
      relayTurns: utterance.relayTurns,
      source: "transcript",
      words: utterance.words,
      wordsCut: utterance.wordsCut || cutUnknown,
      // The call file records the card they spoke over, never where the page placed it: a row this registers is a
      // finding until it is placed, while a relay of the same words already stated its workspace on its own row.
      workspace: undefined,
    },
  });
  if (outcome.isErr()) {
    // A card that is not theirs, or words that are no answer to it, is the verdict rather than a failure to retry.
    const verdict = outcome.error.code === "CARD_NOT_HIS" || outcome.error.code === "NOT_AN_ANSWER";
    return { failed: verdict ? [] : [`${utterance.cardKey}: ${outcome.error.message}`], landed: false };
  }
  // Landed, but its steer or quote did not reach the card: reported as failed, so the next run retries it.
  return {
    failed: outcome.value.unquoted.map((problem) => `${utterance.cardKey}: ${problem}`),
    landed: outcome.value.outcome === "landed",
  };
}

/**
 * {@link landCall} under the ledger's lock.
 *
 * @param ended the call dropped, so its last utterance is finished even with no close line
 * @returns how many landed just now, and each that failed
 */
async function landCallHeld({
  callId,
  ended,
  handoverDir,
  home,
}: {
  callId: string;
  ended: boolean;
  handoverDir: string;
  home: string;
}): Promise<Landings> {
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return { failed: [`any card: ${read.error.message}`], landed: 0 };
  }
  const { entries } = read.value;
  // A torn line or a stamp that does not read might be the unfinished end of any utterance, so each lands cut: the
  // approval read refuses on the same evidence (`../../../handover/hisWordsLanded.ts`), and the two agree.
  const cutUnknown = cutUnknownWhy({ read: read.value }) !== undefined;
  let landed = 0;
  const failed: string[] = [];
  // Only words the voice's relay judged an answer to the card they opened are landed (`transcriptCardUtterances`).
  for (const utterance of transcriptCardUtterances({ callId, ended, entries })) {
    const one = await landUtterance({ cutUnknown, handoverDir, home, utterance });
    failed.push(...one.failed);
    if (one.landed) {
      landed += 1;
    }
  }
  // Then the walk's own movement: a card they moved on from leaves their Queue whether or not they answered it.
  const moved = applyCallMoves({ callId, entries, home, nowIso: new Date().toISOString() });
  failed.push(...moved.failed);
  return { failed, landed };
}
