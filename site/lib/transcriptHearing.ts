/**
 * What the transcript sink has heard of the current call, for `./transcriptSink.ts`: the stretch of speech still open,
 * the card each stretch BEGAN over, and the cards the owner's utterances since the last relay began over. It builds the
 * segment lines; the sink alone decides when one is queued and posted.
 *
 * Every word the owner says while a card is open lands on that card. The card is taken the
 * first time a segment id is heard and kept for every later line of it, so opening the next card while finishing a
 * sentence does not move the sentence.
 */

import { type HeardOver, heardOverAfter } from "./heardOver";
import type { OpenCardContext } from "./pageVoice";
import { type CallLine, segmentLine } from "./talkTranscript";
import type { HeardStamp, OpenSpeech } from "./transcriptSinkContract";

/** A stretch heard with no card open. */
const NO_CARD: OpenCardContext = { open: undefined, openBy: undefined };

/** A stretch of speech still open, and the call it is of. */
type HeldSpeech = OpenSpeech & { readonly call: string };

/** One line of a named call, for the sink to queue. */
interface CallSegment {
  readonly call: string;
  readonly line: CallLine;
}

/** One sink's hearing of the current call. A new call starts it all again. */
export class TranscriptHearing {
  private readonly nowIso: () => string;
  private speech: HeldSpeech | undefined;
  private written = "";
  // The card open when each segment id was first heard, and whether the voice opened it, for this call only.
  private openedOn = new Map<string, HeardStamp>();
  private heard: HeardOver | undefined;

  /**
   * A hearing with nothing heard.
   *
   * @param nowIso the clock each segment line is stamped with
   */
  constructor({ nowIso }: { nowIso: () => string }) {
    this.nowIso = nowIso;
  }

  /** A new call: no speech open, no stretch stamped, nothing the owner said since a relay. */
  beginCall(): void {
    this.speech = undefined;
    this.written = "";
    this.openedOn = new Map();
    this.heard = undefined;
  }

  /**
   * The cards the owner's utterances since the last relay began over.
   *
   * @returns those cards, or `undefined` when the owner has said nothing since
   */
  heardOver(): HeardOver | undefined {
    return this.heard;
  }

  /**
   * What one segment of this call was stamped with when first heard.
   *
   * @returns the card it began over, or `undefined` for a segment this call has not heard
   */
  heardStamp({ segmentId }: { segmentId: string }): HeardStamp | undefined {
    return this.openedOn.get(segmentId);
  }

  /** A relay went out carrying the owner's words so far: what a later one is about starts again from their next words. */
  relayed(): void {
    this.heard = undefined;
  }

  /**
   * A stretch of the current call the grouper updated, now held open. A stretch is written the moment it is first
   * heard, so its first line is when the owner began: a relay posted before the next snapshot already carries these words,
   * and must not read as having come before them.
   *
   * @returns its partial line when this is the first time it was heard, else `undefined`
   */
  speaking({
    call,
    current,
    speech,
    stamp,
  }: {
    call: string;
    current: string | undefined;
    speech: OpenSpeech;
    stamp: HeardStamp;
  }): CallSegment | undefined {
    const first = !this.openedOn.has(speech.id);
    this.hear({ call, current, speech, stamp });
    this.speech = { ...speech, call };
    if (!first) {
      return undefined;
    }
    return this.openPartial();
  }

  /**
   * A stretch the grouper closed. Only this call's own close ends the speech held open: ids repeat across calls.
   *
   * @returns its final line, over the card it began over
   */
  spoke({
    call,
    current,
    speech,
    stamp,
  }: {
    call: string;
    current: string | undefined;
    speech: OpenSpeech;
    stamp: HeardStamp;
  }): CallLine {
    if (this.speech?.id === speech.id && this.speech.call === call) {
      this.speech = undefined;
    }
    const began = this.hear({ call, current, speech, stamp });
    return segmentLine({
      atIso: this.nowIso(),
      final: true,
      id: speech.id,
      open: began.open,
      openBy: began.openBy,
      text: speech.text,
      who: speech.who,
    });
  }

  /**
   * The speech still open, as a partial, recorded as the last one written.
   *
   * @returns its call and partial line, or `undefined` while no speech is open
   */
  openPartial(): CallSegment | undefined {
    const open = this.speech;
    if (open === undefined) {
      return undefined;
    }
    this.written = `${open.id}:${open.text}`;
    const began = this.openedOn.get(open.id);
    return {
      call: open.call,
      line: segmentLine({
        atIso: this.nowIso(),
        final: false,
        id: open.id,
        open: began?.open,
        openBy: began?.openBy,
        text: open.text,
        who: open.who,
      }),
    };
  }

  /**
   * The speech still open, as a partial, when it changed since the last one written.
   *
   * @returns its call and partial line, or `undefined` when none is open or it is unchanged
   */
  changedPartial(): CallSegment | undefined {
    if (this.speech === undefined || `${this.speech.id}:${this.speech.text}` === this.written) {
      return undefined;
    }
    return this.openPartial();
  }

  /** The speech held open is done with: the call ended. */
  clearSpeech(): void {
    this.speech = undefined;
  }

  // Stamp a segment of the current call with the card it began over, and keep the owner's latest one for a relay.
  private hear({
    call,
    current,
    speech,
    stamp,
  }: {
    call: string;
    current: string | undefined;
    speech: OpenSpeech;
    stamp: HeardStamp;
  }): HeardStamp {
    // A late event of an earlier call is never recorded, and must not claim a segment id in this call's map: ids
    // repeat across calls, so its card would become this call's for that id.
    if (call !== current) {
      return NO_CARD;
    }
    const began = this.openOf({ id: speech.id, now: stamp });
    // A relay is about the card the owner's words began over whoever opened it: a steer on a card the voice opened is the owner's.
    this.heard = heardOverAfter({
      context: began.context,
      held: this.heard,
      open: began.open,
      segmentId: speech.id,
      who: speech.who,
    });
    return began;
  }

  private openOf({ id, now }: { id: string; now: HeardStamp }): HeardStamp {
    const held = this.openedOn.get(id);
    if (held !== undefined) {
      return held;
    }
    this.openedOn.set(id, now);
    return now;
  }
}
