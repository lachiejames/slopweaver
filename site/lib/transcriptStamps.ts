/**
 * The instant and the `writeId` every transcript line is queued with, for `./transcriptSink.ts`. The sink's clocks
 * live here: the one every live line is stamped on, one per call for what reaches a call after its close, and when
 * each stretch of the current call began.
 */

import type { CallLine, PersistedCallLine } from "./talkTranscript";

/** The last instant a JavaScript `Date` can hold, +275760-09-13T00:00:00.000Z. */
const LAST_INSTANT_MS = 8_640_000_000_000_000;

/** One sink's line stamps. Its clocks outlive a call; only when each stretch began starts again with the next. */
export class TranscriptStamps {
  private readonly mintWriteId: () => string;
  private lastMs = Number.NEGATIVE_INFINITY;
  private readonly lastOfCall = new Map<string, number>();
  private beganOn = new Map<string, string>();

  /**
   * Stamps with nothing stamped yet.
   *
   * @param mintWriteId a fresh id for each line stamped
   */
  constructor({ mintWriteId }: { mintWriteId: () => string }) {
    this.mintWriteId = mintWriteId;
  }

  /** A new call: when its stretches began starts again, and the clocks carry on. */
  beginCall(): void {
    this.beganOn = new Map();
  }

  /**
   * A live line, stamped strictly after the one queued before it, so the instants alone give the order the owner spoke in:
   * a keepalive can land ahead of an earlier batch, and two lines in one millisecond would then be ordered by where
   * they fell in the file.
   *
   * @returns the line with its `writeId`, at its instant or just after the last
   */
  stamped({ line }: { line: CallLine }): PersistedCallLine {
    const writeId = this.mintWriteId();
    const atMs = Date.parse(line.atIso);
    if (Number.isNaN(atMs)) {
      return { ...line, writeId };
    }
    // Never past the last instant a Date holds: a clock set there stamps every later line with it rather than throwing
    // and losing the words.
    this.lastMs = Math.min(Math.max(atMs, this.lastMs + 1), LAST_INSTANT_MS);
    return { ...line, atIso: new Date(this.lastMs).toISOString(), writeId };
  }

  /**
   * A reconnect step, or a tool's answer after its call closed, stamped after the last line of ITS call on a sequence
   * of that call's own, so it never moves the one every later call's lines are stamped on: a step would otherwise
   * push the owner's next words a millisecond later.
   *
   * @returns the line with its `writeId`, after its call's last line
   */
  stampedStep({ call, line }: { call: string; line: CallLine }): PersistedCallLine {
    const writeId = this.mintWriteId();
    const atMs = Date.parse(line.atIso);
    if (Number.isNaN(atMs)) {
      return { ...line, writeId };
    }
    let atLeast = atMs;
    const after = this.lastOfCall.get(call);
    if (after !== undefined) {
      atLeast = Math.max(atMs, after + 1);
    }
    const ms = Math.min(atLeast, LAST_INSTANT_MS);
    this.lastOfCall.set(call, ms);
    return { ...line, atIso: new Date(ms).toISOString(), writeId };
  }

  /**
   * A segment line carrying when its stretch was first stamped, on every later line of it: the batch holding its
   * first line can be refused, and the file must still know it began before a stretch that overtook it.
   *
   * @returns the line, a segment with its `beganIso`
   */
  begun({ line }: { line: PersistedCallLine }): PersistedCallLine {
    if (line.kind !== "segment") {
      return line;
    }
    const began = this.beganOn.get(line.id);
    if (began === undefined) {
      this.beganOn.set(line.id, line.atIso);
      return { ...line, beganIso: line.atIso };
    }
    return { ...line, beganIso: began };
  }

  /** A live line of this call was queued: what reaches it after its close is stamped after that line. */
  noteCall({ call }: { call: string }): void {
    this.lastOfCall.set(call, this.lastMs);
  }
}
