/**
 * Whether a relay's OWN writes may act on the owner's words — pure. A relay made while a stretch of the owner's call
 * was still open carries words that may stop short of a "no, wait", and the approval readers already refuse
 * such a relay as their yes. The relay's immediate writes acted on those words anyway: it landed the card on screen
 * and every card it also answered, recorded a check-in or candidate ruling, put a triage verdict on the Queue, and
 * stood a discuss-first go-ahead. So each of those holds whenever
 * this says why.
 *
 * The rule is the approval readers' own: only a relay that SAYS the words were whole stands. A typed steer is whole by
 * construction (`./relayDraft.ts` forces `false`), and a voice relay that never said either way — a page older than
 * `--heard-tail`, or a hand invocation with no segment state behind it — is held, never guessed whole.
 *
 * What it does not hold: a channel steer. A `steered` event only REFUSES a release outside the channel the words
 * named (`../outbound/slack/draftSteerGate.ts`); only a re-cut moves a draft. A measured public mis-send was
 * exactly a steer at the cut END of the owner's words, so holding one on a cut relay would reopen that send to save a
 * refusal. Nor a `no-receipts` send-back, for the same reason: `../outbound/slack/draftSentBack.ts` reads it only to
 * REFUSE a later `--self-evident` re-cut, as with a "got the receipts" send. Cut words may refuse; they never permit.
 * So a later relay's ruling read against an earlier yes (`./approvalRelayRead.ts`'s `wordsWhole`) counts as no ruling
 * when its words were not whole: a cut `send-it` cannot stand that yes past a "no, wait".
 */
import { type TriageVerdictRead, triageVerdictOf } from "./answerContext.js";
import { isRegisterCardKey } from "./cardKey.js";
import type { TurnRecord } from "./relayStore.js";

/** The reason a relay made while the owner was still speaking holds. */
export const STILL_SPEAKING_HOLD =
  "the owner was still speaking when the voice relayed, so the words may stop short of a no";

/** The reason a voice relay that never said whether the owner had finished holds. */
export const TAIL_UNSTATED_HOLD =
  "the relay does not say whether the owner had finished speaking, so the words are never read as whole";

/**
 * Why a relay's own writes hold — cut or unstated — or `undefined` when it says the words were whole.
 *
 * @param heardTailCut the draft's record of whether the words end before the owner did; `false` on every typed steer
 * @returns the reason, one clause, or `undefined` when the writes may act
 */
export function relayCutHold({ heardTailCut }: { heardTailCut: boolean | undefined }): string | undefined {
  if (heardTailCut === false) {
    return undefined;
  }
  if (heardTailCut === true) {
    return STILL_SPEAKING_HOLD;
  }
  return TAIL_UNSTATED_HOLD;
}

/**
 * The triage verdict a relay turn's stored ruling reads as, held when its words may stop short: a voice relay not
 * stated whole that stored a send-it — the one verdict that stands a yes — reads as unreadable for that reason. A
 * refusing verdict stays as stored, because cut words may refuse but never permit; a typed steer is whole.
 *
 * @param record the relay turn's tail state, its row and its stored ruling
 * @returns the read
 */
export function heldTriageVerdictOf({
  record,
}: {
  record: Pick<TurnRecord, "heardTailCut" | "slug" | "triageRuling" | "typed">;
}): TriageVerdictRead {
  const read = triageVerdictOf({ slug: record.slug, triageRuling: record.triageRuling });
  const hold = record.typed ? undefined : relayCutHold({ heardTailCut: record.heardTailCut });
  if (hold === undefined || read.kind !== "stored" || read.ruling.verdict !== "send-it") {
    return read;
  }
  return { kind: "unreadable", why: `${read.ruling.verdict} heard but not applied: ${hold}` };
}

/**
 * The register cards a relay would land on, in landing order — the card on screen, then each it also answers — which
 * a held relay leaves on the Queue. An empty key and a card no register holds (`recipe:`, `align:`, `candidate:`)
 * are never landed at all, so neither is held.
 *
 * @param about the card on screen, or empty
 * @param alsoAnswers the other cards the words answer
 * @returns the keys
 */
export function heldCardKeys({ about, alsoAnswers }: { about: string; alsoAnswers: readonly string[] }): string[] {
  return [about, ...alsoAnswers].filter((key) => key !== "" && isRegisterCardKey({ key }));
}

/**
 * The clause the row's summary and the chair's line open on when a held relay carried a write it held, so the chair
 * reads that nothing landed or ruled rather than inferring it from a card still showing. A relay that carried none
 * holds nothing worth a clause.
 *
 * @param hold why the writes hold, or `undefined` when they acted
 * @param cardKeys the register cards the relay would have landed on: the card on screen, then each it also answers
 * @param ruled whether the relay carried a check-in, candidate or triage ruling
 * @returns the clause, or `undefined`
 */
export function relayHeldLead({
  hold,
  cardKeys,
  ruled,
}: {
  hold: string | undefined;
  cardKeys: readonly string[];
  ruled: boolean;
}): string | undefined {
  if (hold === undefined || (cardKeys.length === 0 && !ruled)) {
    return undefined;
  }
  return `HELD: no Queue card landed and no ruling took effect, because ${hold} — read the whole stretch on the call first.`;
}
