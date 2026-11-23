"use client";

/**
 * The earlier conversation the messenger and the stage open on: what the owner and the voice said on every call and typed
 * conversation before this one, read off the call files (`talk thread --json`, `site/lib/chatThread.ts`), so a
 * reopened console shows where the two of them stopped rather than "Nothing said yet".
 *
 * Read once on mount and again as each fresh conversation opens. The conversation giving way is CARRIED on the page
 * first, so it never blinks out while the call file catches up: the sink posts a batch at a time and its last may
 * still be in flight. A read that fails or comes back malformed keeps the last good one rather than clearing the
 * history. A reconnect or rollover is not a fresh conversation and carries nothing.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CHAT_THREAD_SLUG,
  type EarlierTurn,
  earlierTurnsOf,
  heldTurnsOf,
  readChatThread,
  sameEarlierTurns,
  unreadFacts,
} from "../../lib/chatThread";
import { carriedTurns, liveWindowOf, noteBegun } from "../../lib/chatThreadCarried";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { type HeardSegment, SHOWN_SEGMENTS } from "../../lib/voiceTranscript";
import { type LiveState, readyValueOf, refreshLive, useLive } from "../live/useLive";

/** What the history is, in its own words, wherever a mark names it. */
const THREAD_SUBJECT = "what you and the voice said before";

/** What the provider holds of the earlier conversation. */
export interface EarlierConversation {
  /** The earlier turns, oldest first, less any the conversation going on now shows. */
  readonly earlier: readonly EarlierTurn[];
  /**
   * When this page first showed each live turn, by id: the instant a tapped live bubble says it was said, and the one
   * it begins at once carried into the earlier history (`carriedTurns`). An observation, not a stamp off disk, so a
   * turn already on the page when it loaded reads as said when it loaded.
   */
  readonly shownAt: ReadonlyMap<string, string>;
  /**
   * Why the history may be missing something, for one staleness mark after its turns: the thread read failed, or the
   * newest read could not open a call file (`unreadFacts`). `undefined` when nothing is missing.
   */
  readonly unread: readonly StalenessFact[] | undefined;
  /** Whether the thread's first read is still in flight, so the history draws a progress indicator, never "nothing said". */
  readonly reading: boolean;
  /** Whether the conversation going on now is spoken or typed, so its typed turns carry the same mark. */
  readonly medium: EarlierTurn["medium"];
  /**
   * Carry the conversation shown now into the earlier one and read the thread again — called in the same handler that
   * clears the shown speech for a fresh conversation, so the two land in one render.
   */
  readonly fresh: (input: { medium: EarlierTurn["medium"] }) => void;
  /**
   * Turns whose speech the sink lost a batch of before it reached the call file (`site/lib/transcriptSink.ts`): the
   * disk may hold none of it, or only an older snapshot, so a carried copy is kept for the page's life rather than
   * pruned or replaced. Stable.
   */
  readonly noteUnwritten: (input: { turns: readonly string[] }) => void;
}

/**
 * The earlier conversation, beside the one going on now.
 *
 * @param segments the speech shown now
 * @returns the earlier turns, when the page first showed each live one, the medium of the conversation on now, the line naming a call it could not read, the act a fresh conversation calls, and the one a lost batch calls
 */
export function useEarlierConversation({ segments }: { segments: readonly HeardSegment[] }): EarlierConversation {
  const state = useLive({ read: readChatThread, slug: CHAT_THREAD_SLUG });
  const ready = readyValueOf({ state });
  // The last good read, kept while a refresh is loading or after one that failed, and never thinned by one that could
  // not open every call file, so the history never empties.
  const [read, setRead] = useState<readonly EarlierTurn[] | undefined>(undefined);
  const [unread, setUnread] = useState<readonly StalenessFact[] | undefined>(undefined);
  const [cut, setCut] = useState(false);
  // Seen starts at nothing, never at `ready`: a thread already read when the provider mounts is taken on the first
  // render rather than passed over as old.
  const [seen, setSeen] = useState<typeof ready>(undefined);
  if (ready !== seen) {
    setSeen(ready);
    if (ready !== undefined) {
      setRead((held) => heldTurnsOf({ held, read: ready }));
      setUnread(unreadFacts({ unreadable: ready.unreadable }));
      setCut(ready.cut);
    }
  }
  const [carried, setCarried] = useState<readonly EarlierTurn[]>([]);
  // What the conversation on now is, and what it shows, read when the next one opens.
  const medium = useRef<EarlierTurn["medium"]>("voice");
  const [shownMedium, setShownMedium] = useState<EarlierTurn["medium"]>("voice");
  const shown = useRef(segments);
  // When the page first showed each turn, so a carried one is set among a read's by when it began.
  const began = useRef(new Map<string, string>());
  // The same instants as render reads them, so a live turn the stage's window has let go keeps when it began.
  const [beganShown, setBeganShown] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The instant the effect last noted a turn, so render reads no clock. A turn not noted yet is set at it for one
  // render only: the effect is a LAYOUT effect, so it notes that turn at now and redraws before the stale instant —
  // an hour old after an idle call, say — is ever painted.
  const [notedAtIso, setNotedAtIso] = useState(() => new Date().toISOString());
  useLayoutEffect(() => {
    shown.current = segments;
    const noted = began.current.size;
    const atIso = new Date().toISOString();
    noteBegun({ atIso, began: began.current, segments });
    if (began.current.size !== noted) {
      setBeganShown(new Map(began.current));
      setNotedAtIso(atIso);
    }
  }, [segments]);
  const fresh = useCallback(({ medium: next }: { medium: EarlierTurn["medium"] }): void => {
    const ending = shown.current;
    const was = medium.current;
    const atIso = new Date().toISOString();
    const begun = new Map(began.current);
    setCarried((held) => carriedTurns({ atIso, began: begun, held, medium: was, segments: ending }));
    medium.current = next;
    setShownMedium(next);
    refreshLive({ slug: CHAT_THREAD_SLUG });
  }, []);
  const [unwritten, setUnwritten] = useState<ReadonlySet<string>>(() => new Set());
  const noteUnwritten = useCallback(({ turns }: { turns: readonly string[] }): void => {
    setUnwritten((held) => new Set([...held, ...turns]));
  }, []);
  const derived = useMemo(() => {
    // Only the turns the stage's window draws are left out; the provider's older ones are drawn here.
    const split = liveWindowOf({
      atIso: notedAtIso,
      began: beganShown,
      medium: shownMedium,
      segments,
      shown: SHOWN_SEGMENTS,
    });
    const carriedIds = new Set(carried.map((turn) => turn.id));
    const held = [...carried, ...split.older.filter((turn) => !carriedIds.has(turn.id))].toSorted(
      (a, b) => Date.parse(a.beganIso) - Date.parse(b.beganIso),
    );
    return earlierTurnsOf({ carried: held, complete: unread === undefined, cut, live: split.live, read, unwritten });
  }, [beganShown, carried, cut, notedAtIso, read, segments, shownMedium, unread, unwritten]);
  // Every transcript delta derives a fresh array, nearly always of the same turns: the one drawn is kept until the
  // turns themselves change, so the stage words its 200 dates once rather than on every delta (`dateTimeFormat.ts`).
  const [earlier, setEarlier] = useState(derived);
  if (earlier !== derived && !sameEarlierTurns({ left: earlier, right: derived })) {
    setEarlier(derived);
  }
  return {
    earlier,
    fresh,
    medium: shownMedium,
    noteUnwritten,
    reading: state.phase === "loading" && read === undefined,
    shownAt: beganShown,
    unread: missingFacts({ state, unread }),
  };
}

/**
 * Everything the history may be missing: the thread read's own failure — with or without an earlier read kept — and
 * the call files the newest read could not open.
 *
 * @param state the thread read
 * @param unread the files the newest read could not open, as facts
 * @returns the facts for one staleness mark, or `undefined` when nothing is missing
 */
function missingFacts({
  state,
  unread,
}: {
  state: LiveState<unknown>;
  unread: readonly StalenessFact[] | undefined;
}): readonly StalenessFact[] | undefined {
  const facts: StalenessFact[] = [];
  if (state.phase === "not-measured") {
    facts.push({ subject: THREAD_SUBJECT, why: state.why });
  }
  if (state.phase === "ready" && state.stale !== undefined) {
    facts.push({ observedAtIso: state.observedAtIso, subject: THREAD_SUBJECT, why: state.stale.why });
  }
  if (unread !== undefined) {
    facts.push(...unread);
  }
  if (facts.length === 0) {
    return undefined;
  }
  return facts;
}
