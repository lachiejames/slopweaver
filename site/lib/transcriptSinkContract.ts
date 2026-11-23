/**
 * What the console voice's transcript sink takes and offers: the page's side of `./transcriptSink.ts`, declared apart
 * so a caller that only feeds the sink, or reads a stamp it made, imports no queue.
 */

import type { HeardOver } from "./heardOver";
import type { CardOpenBy, OpenCardContext } from "./pageVoice";
import type { CallLine, ReconnectCallLine } from "./talkTranscript";
import type { WorkContext } from "./workContext";

/** What one post came to: its HTTP status (0 for no answer) and the route's `why`, when it gave one. */
export interface TranscriptPostAnswer {
  readonly status: number;
  readonly why: string | undefined;
}

/** A stretch of speech the grouper has not closed yet. */
export interface OpenSpeech {
  readonly id: string;
  readonly who: "owner" | "voice";
  readonly text: string;
}

/**
 * One stretch of speech as the page hears it, with the card open now, whether the voice opened that card, and the
 * console the owner is on — absent where the caller cannot say, which places a relay over no card nowhere.
 */
export interface HeardInput {
  readonly call: string;
  readonly speech: OpenSpeech;
  readonly open: string | undefined;
  readonly openBy?: CardOpenBy | undefined;
  readonly context?: WorkContext | undefined;
}

/** What a segment is stamped with when first heard: the card open, who opened it, and the console the owner was on. */
export type HeardStamp = OpenCardContext & { readonly context?: WorkContext | undefined };

/** The sink the page feeds. */
export interface TranscriptSink {
  /** A new call: its id, not yet open, nothing of it said. */
  readonly begin: (input: { call: string }) => void;
  /** The call connected: its open line, after which its lines are written. */
  readonly open: (input: { call: string; line: CallLine }) => void;
  /**
   * One line of the named call: `true` when it was queued, `false` when the call is not the current, opened one and
   * the line is written nowhere — what lets a copy-tray offer land only where its line can follow it.
   */
  readonly record: (input: { call: string | undefined; line: CallLine }) => boolean;
  /**
   * A stretch of speech the grouper updated — kept, and written as a partial by `snapshot`. `open` is the
   * shape-checked `?open=` key of the console card open right now, or `undefined`; `openBy` is `voice` when the
   * voice's `open_card` put it there (`./pageVoice.ts` `openByOf`), absent when the owner opened it.
   */
  readonly speaking: (input: HeardInput) => void;
  /** A stretch of speech the grouper closed, written as final; `open` and `openBy` as for `speaking`. */
  readonly spoke: (input: HeardInput) => void;
  /** Write the speech still open as a partial when it changed since the last one, and retry what a post left queued. */
  readonly snapshot: () => void;
  /**
   * Write the call's end once, and post what is left — as a `keepalive` post when the page is going away, which also
   * carries a batch an ended call left queued.
   */
  readonly end: (input: { why: string | undefined; leaving: boolean }) => void;
  /**
   * A step of the console reconnecting a call this sink CLOSED — the one way a line reaches an ended call. It is held
   * until the route took that close, and goes with it if the close is lost. Every other line of an ended call is still
   * refused; a call never opened and closed here takes none.
   */
  readonly reconnect: (input: { call: string; line: ReconnectCallLine }) => void;
  /**
   * A tool line carrying the answer the model was handed, written once that answer was DELIVERED, onto the call that
   * asked for it. While that call runs it is any other line; once it ended, it is held behind the call's `closed` line
   * like a reconnect step, but a full queue or a lost close is SAID through `onRefused`, never dropped silently.
   */
  readonly settledTool: (input: { call: string; line: Extract<CallLine, { kind: "tool" }> }) => void;
  /** The cards the owner's utterances since the last relay began over, or `undefined` when they have said nothing since. */
  readonly heardOver: () => HeardOver | undefined;
  /**
   * What one segment of this call was stamped with when first heard — the card it began over — or `undefined` for a
   * segment this call has not heard. The one stamp: a turn's card draft reads it rather than the card open now.
   */
  readonly heardStamp: (input: { segmentId: string }) => HeardStamp | undefined;
  /** A relay went out carrying the owner's words so far: what a later one is about starts again from their next words. */
  readonly relayed: () => void;
}
