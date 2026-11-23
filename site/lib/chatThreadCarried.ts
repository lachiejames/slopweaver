/**
 * The turns a conversation giving way to a new one carries onto the page (`./chatThread.ts` reads and places the
 * rest): each stamped with when the page first showed it, and the live window's older turns drawn as carried ones.
 */
import type { EarlierTurn } from "./chatThread";
import type { HeardSegment } from "./voiceTranscript";

/**
 * The finished turns of a conversation that is giving way to a new one, kept on the page so they stay in the history
 * even before the read that has them on disk comes back: the call file is written in batches, and the last may still
 * be in flight when the next conversation opens. A turn cut off mid-sentence is carried as it stands, unfinished.
 * Each is stamped with the moment it was carried, and began when the page first showed it — the instant its first
 * line was stamped with too — so it is set among a read's turns by when it began, never by when its conversation
 * ended. A turn the page never saw begin is taken to begin as it is carried.
 *
 * @param held the turns already carried, oldest first
 * @param segments the ending conversation's shown speech
 * @param medium whether that conversation was spoken or typed
 * @param atIso the instant it gave way, which every carried turn is stamped with
 * @param began when the page first showed each turn, by id
 * @returns the carried turns, the ending conversation's added
 */
export function carriedTurns({
  held,
  segments,
  medium,
  atIso,
  began,
}: {
  held: readonly EarlierTurn[];
  segments: readonly HeardSegment[];
  medium: EarlierTurn["medium"];
  atIso: string;
  began: ReadonlyMap<string, string>;
}): readonly EarlierTurn[] {
  const known = new Set(held.map((turn) => turn.id));
  const added = segments
    .filter((segment) => segment.text.trim() !== "" && !known.has(segment.id))
    .map((segment): EarlierTurn => ({
      atIso,
      beganIso: beganOf({ atIso, began, id: segment.id }),
      final: segment.final,
      id: segment.id,
      medium,
      text: segment.text.trim(),
      who: segment.who,
    }));
  // In the order each began, never the order shown: a turn evicted from the live window and finished late is appended
  // after the turns that began after it.
  return [...held, ...added].toSorted((a, b) => Date.parse(a.beganIso) - Date.parse(b.beganIso));
}

/**
 * When a carried turn began: the page's first sight of it, else the moment it was carried.
 *
 * @param atIso the moment it was carried
 * @param began when the page first showed each turn, by id
 * @param id the turn's id
 * @returns the instant it began
 */
function beganOf({ atIso, began, id }: { atIso: string; began: ReadonlyMap<string, string>; id: string }): string {
  const seen = began.get(id);
  if (seen === undefined) {
    return atIso;
  }
  return seen;
}

/**
 * Note when the page first shows each turn, for `carriedTurns` to stamp it as begun then.
 *
 * @param began the instants already noted, by id, which is extended in place
 * @param segments the speech shown now
 * @param atIso the instant it is shown at
 */
export function noteBegun({
  began,
  segments,
  atIso,
}: {
  began: Map<string, string>;
  segments: readonly HeardSegment[];
  atIso: string;
}): void {
  segments
    .filter((segment) => !began.has(segment.id))
    .forEach((segment) => {
      began.set(segment.id, atIso);
    });
}

/**
 * The speech going on now, cut where the stage's window cuts it: the newest `shown` turns are drawn live, and any older
 * one the provider still holds is drawn in the earlier history instead, as a carried turn begun when the page first
 * showed it — so every turn is drawn once, never in neither place.
 *
 * @param segments the speech the provider holds now, oldest first
 * @param shown how many of the newest turns the stage and messenger draw live
 * @param medium whether the conversation on now is spoken or typed
 * @param began when the page first showed each turn, by id
 * @param atIso the instant read now, which a turn the page never saw begin is taken to begin at
 * @returns the ids drawn live, and the older turns as carried ones, oldest first
 */
export function liveWindowOf({
  segments,
  shown,
  medium,
  began,
  atIso,
}: {
  segments: readonly HeardSegment[];
  shown: number;
  medium: EarlierTurn["medium"];
  began: ReadonlyMap<string, string>;
  atIso: string;
}): { readonly live: readonly string[]; readonly older: readonly EarlierTurn[] } {
  const cutAt = Math.max(0, segments.length - shown);
  const older = carriedTurns({ atIso, began, held: [], medium, segments: segments.slice(0, cutAt) }).map(
    (turn): EarlierTurn => ({ ...turn, atIso: turn.beganIso }),
  );
  return { live: segments.slice(cutAt).map((segment) => segment.id), older };
}
