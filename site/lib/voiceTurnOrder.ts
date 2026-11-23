/**
 * Whether a turn of the owner's OPENED after the voice's newest turn opened, read off the session's ordered turn stream
 * and never off the meters. Pure, folded inside the activity fold (`./voiceActivity.ts`), and read by the resume
 * (`resumeDueOf`, `./voiceActivityStatus.ts`) to tell words of the owner's the voice never heard from a late fragment
 * of words it already answered.
 *
 * Why the meters are not enough: the voice can say "Mm-hmm. Let me check." over the end of the owner's sentence, the
 * session ends the owner's turn there and opens a new one for the rest of it, and their microphone, read under the
 * voice's own audio, never clears both bars (`micAudible`, `./micAudible.ts`) after the voice's last sound. The resume
 * then read that meter order as the voice having answered the owner and held for the whole silence: the Codex answer
 * was held "utterance is still open", the orb drew ZZZ, and nothing was said until the owner asked why it went quiet 21s later.
 * Repro, from the home: `grep -nE '<turn-id>|<turn-id>|"name":"resume"|stalled \(badge\)|held msg' talk/calls/<call-id>-*.jsonl` — the owner's new
 * turn opens 265ms after the voice's, and no `resume` line stands across the whole 3m49s silence.
 *
 * Keyed on the voice's turn ID rather than its newest transcript fragment, since the owner talks over the voice's tail:
 * a fragment of the same voice turn landing after the owner's new turn opened is still the turn they spoke after.
 *
 * Judged on the turn of the owner's LATEST segment, never on whether any turn of theirs opened since: a late fragment
 * of a turn open before the voice's, arriving after a new turn of the owner's opened, is still words the voice already
 * answered. Whether a turn is new is read off every turn of the owner's this call has seen, never only the open ones,
 * since a fragment can land after its own turn's final; likewise the voice's newest turn is the newest one first seen,
 * never a late fragment of an older one.
 */

/** The order the fold reads. */
export interface TurnOrder {
  /** The voice's newest turn on the session's turn stream, `undefined` until it has spoken one. */
  readonly voiceTurnId: string | undefined;
  /** Every voice turn this call has seen, so a late fragment of an older one is never taken for the newest. */
  readonly voiceSeen: ReadonlySet<string>;
  /** Every turn of the owner's this call has seen, by turn ID, so a late fragment of a closed one opens nothing. */
  readonly ownerSeen: ReadonlySet<string>;
  /** The owner's turns first seen since {@link TurnOrder.voiceTurnId} was, by turn ID. */
  readonly ownerSinceVoice: ReadonlySet<string>;
  /** Whether the owner's latest segment belongs to one of {@link TurnOrder.ownerSinceVoice}, or their latest turn was typed after it. */
  readonly ownerLatestSinceVoice: boolean;
}

/** No turn of either side yet. */
export const NO_TURN_ORDER: TurnOrder = {
  ownerLatestSinceVoice: false,
  ownerSeen: new Set(),
  ownerSinceVoice: new Set(),
  voiceSeen: new Set(),
  voiceTurnId: undefined,
};

/**
 * The order after one segment arrived.
 *
 * @param order the order so far
 * @param who whose segment it is
 * @param id the turn ID the segment carries
 * @returns the next order, the same object when nothing changed
 */
export function foldTurnOrder({ order, who, id }: { order: TurnOrder; who: "owner" | "voice"; id: string }): TurnOrder {
  if (who === "voice") {
    if (order.voiceSeen.has(id)) {
      return order;
    }
    const voiceSeen = new Set([...order.voiceSeen, id]);
    return { ...order, ownerLatestSinceVoice: false, ownerSinceVoice: new Set(), voiceSeen, voiceTurnId: id };
  }
  if (order.ownerSeen.has(id)) {
    const ownerLatestSinceVoice = order.ownerSinceVoice.has(id);
    return ownerLatestSinceVoice === order.ownerLatestSinceVoice ? order : { ...order, ownerLatestSinceVoice };
  }
  const ownerSeen = new Set([...order.ownerSeen, id]);
  if (order.voiceTurnId === undefined) {
    return { ...order, ownerSeen };
  }
  return { ...order, ownerLatestSinceVoice: true, ownerSeen, ownerSinceVoice: new Set([...order.ownerSinceVoice, id]) };
}

/**
 * The order after the owner typed a turn the voice took. A typed turn is always a new one, and the owner's microphone
 * never sounds for it, so after a voice turn it is their latest words opened since the voice's.
 *
 * @param order the order so far
 * @returns the next order, the same object when nothing changed
 */
export function foldTypedTurn({ order }: { order: TurnOrder }): TurnOrder {
  if (order.voiceTurnId === undefined || order.ownerLatestSinceVoice) {
    return order;
  }
  return { ...order, ownerLatestSinceVoice: true };
}
