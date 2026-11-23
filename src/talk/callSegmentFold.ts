/**
 * Folding a call's speech lines into its stretches (`./callRecord.ts`'s `foldCall`): a stretch's id repeats, each line
 * carrying the whole text so far, so the latest snapshot wins, a partial never undoes the final, and when the stretch
 * began is the earliest instant any of its lines carries or names — the order the stretches stand in.
 */
import type { CallEntry, CallSegment } from "./callRecord.js";

/**
 * Whether a line was taken no earlier than the one it would replace. Lines are compared by their own instant, not
 * their place in the file: a `keepalive` post as the page goes can land before a batch still in flight, so the
 * file's order is not always the call's.
 *
 * @returns whether `next` is at or after `held`
 */
export function notEarlier({ next, held }: { next: string; held: string }): boolean {
  return Date.parse(next) >= Date.parse(held);
}

/**
 * Fold one stretch of speech in: its latest snapshot wins at its first position, and a partial never undoes the
 * final (a flush racing the close), whichever landed first.
 *
 * @param segments the call's segments so far, updated in place
 */
export function foldSegment({
  segments,
  entry,
}: {
  segments: CallSegment[];
  entry: Extract<CallEntry, { kind: "segment" }>;
}): void {
  const index = segments.findIndex((segment) => segment.id === entry.id);
  const began = lineBeganIso({ entry });
  if (index === -1) {
    segments.push({
      atIso: entry.atIso,
      beganIso: began,
      final: entry.final,
      id: entry.id,
      open: entry.open,
      text: entry.text,
      who: entry.who,
    });
    return;
  }
  const held = segments[index]!;
  // A line can land in the file after a later one of the same stretch, so when it began is the earliest any carries.
  let beganIso = held.beganIso;
  if (Date.parse(began) < Date.parse(held.beganIso)) {
    beganIso = began;
  }
  if (!held.final && (entry.final || notEarlier({ held: held.atIso, next: entry.atIso }))) {
    segments[index] = {
      atIso: entry.atIso,
      beganIso,
      final: entry.final,
      id: entry.id,
      open: entry.open,
      text: entry.text,
      who: entry.who,
    };
    return;
  }
  segments[index] = { ...held, beganIso };
}

/**
 * When one segment line says its stretch began: the instant it carries for that, else its own. A line never began
 * after it was written, so a later claim is not taken.
 *
 * @param entry the segment line
 * @returns the instant
 */
export function lineBeganIso({ entry }: { entry: Extract<CallEntry, { kind: "segment" }> }): string {
  if (entry.beganIso !== undefined && Date.parse(entry.beganIso) < Date.parse(entry.atIso)) {
    return entry.beganIso;
  }
  return entry.atIso;
}
