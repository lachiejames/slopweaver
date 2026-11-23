/**
 * What a call file's `open` lines say about the call — its session, when it opened, its voice and its surface — and how
 * one more open line folds onto them. The `open` half of `./callRecord.ts`'s fold, split along its own seam.
 *
 * Pure: no filesystem, no clock.
 */
import type { CallOrigin } from "./callOrigin.js";
import type { CallEntry } from "./callRecord.js";
import type { TalkSurface } from "./talkSurface.js";

/** What a call's open lines have said so far: its session, when it opened, its voice, its surface and its origin. */
export interface Opened {
  readonly openedIso: string;
  /**
   * Which console served the session the record holds; `undefined` for an open line that predates the stamp. Once any
   * open line carried the desktop test instance's mark, the mark is kept ({@link openedAfter}).
   */
  readonly origin: CallOrigin | undefined;
  readonly sessionId: string | undefined;
  /** When the session the record holds first opened, so a late line for an older one is known as stale. */
  readonly sessionOpenedMs: number;
  readonly voice: string | undefined;
  readonly surface: TalkSurface;
}

/**
 * What a call says before any open line is read: dated by its first line, no session, a voice call.
 *
 * @param openedIso the instant of the call's first dated line
 * @returns the starting point the open lines fold onto
 */
export function openedBeforeAny({ openedIso }: { openedIso: string }): Opened {
  return {
    openedIso,
    origin: undefined,
    sessionId: undefined,
    sessionOpenedMs: Number.NEGATIVE_INFINITY,
    surface: "voice",
    voice: undefined,
  };
}

/**
 * What the open lines say after one more. An open for ANOTHER session dated before the one the record holds is a
 * stale line landing late under a reused call id: it never takes the record back from the newer session. Two sessions opened in the same millisecond cannot say which is newer, so the one whose id sorts
 * later holds the record — whichever order their lines land in, the record is the same.
 *
 * @param entry the open line just read
 * @param opened what the open lines before it said
 * @returns what they say now
 */
export function openedAfter({
  entry,
  opened,
}: {
  entry: Extract<CallEntry, { kind: "open" }>;
  opened: Opened;
}): Opened {
  const at = Date.parse(entry.atIso);
  const another = entry.sessionId !== opened.sessionId;
  const tiedAndSortsFirst =
    at === opened.sessionOpenedMs && opened.sessionId !== undefined && entry.sessionId < opened.sessionId;
  if (another && (at < opened.sessionOpenedMs || tiedAndSortsFirst)) {
    return keepTestInstance({ entry, next: opened, previous: opened });
  }
  let { sessionOpenedMs } = opened;
  if (another) {
    sessionOpenedMs = at;
  }
  // An open line with no surface predates the typed box, so it was a voice call.
  let surface: TalkSurface = "voice";
  if (entry.surface !== undefined) {
    surface = entry.surface;
  }
  const next: Opened = {
    openedIso: entry.atIso,
    origin: entry.origin,
    sessionId: entry.sessionId,
    sessionOpenedMs,
    surface,
    voice: entry.voice,
  };
  return keepTestInstance({ entry, next, previous: opened });
}

/**
 * The fold with the desktop test instance's mark kept once any open line carried it. A record holds every segment of
 * its file whichever open won, so a later unmarked open must never launder a marked open's speech into the owner's words
 * (on the e2e marker): the record's origin stays the marked one.
 */
function keepTestInstance({
  entry,
  next,
  previous,
}: {
  entry: Extract<CallEntry, { kind: "open" }>;
  next: Opened;
  previous: Opened;
}): Opened {
  if (next.origin?.instance === "e2e") {
    return next;
  }
  if (entry.origin?.instance === "e2e") {
    return { ...next, origin: entry.origin };
  }
  if (previous.origin?.instance === "e2e") {
    return { ...next, origin: previous.origin };
  }
  return next;
}
