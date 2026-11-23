"use client";

/**
 * What the Queue tools answer from: the RECORD, read fresh when one is called (`./freshVoiceRecord.ts`), checked
 * against the Queue on screen (`./useQueueScreen.ts`) — never the page's held copy.
 *
 * The record is read, never the page's copy. `action_items`, `read_card`, `open_card`, `triage_next` and `triage_end`, and a relay naming `also_answers`,
 * each call {@link QueueRecord.readQueueRecord} first (`./talkToolRun.ts`); it reads the record, then the screen once
 * the record has arrived, and what they read answers until the next one. `open_card` asks the screen again before it
 * moves the console. The projection runs at the asking tool's own clock, so the
 * recently-left window ends when the owner asks. The rules the answer keeps against the screen are
 * `../../lib/voiceRecordQueue.ts`'s.
 *
 * Before any Queue tool has read it, a tool that resolves a card without being a Queue tool (`draft_edit_start`) reads
 * the screen's cards, as it always has.
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { ActionItemReadings, ActionItemsAnswer, UnreadSource } from "../../lib/talkActionItems";
import { TOOL_TIMEOUT_MS } from "../../lib/talkToolsList";
import {
  byDeadline,
  cardOnlyUnreadOf,
  type DeadlineTimer,
  type HeldCards,
  heldCardsOf,
  newerRead,
  recordQueueAnswer,
  recordThenScreen,
  type ScreenSeen,
  screenBy,
  undrawnNowWhy,
} from "../../lib/voiceRecordQueue";
import { useWorkspacePlacer } from "../console/organisationState";
import { heldSteersNow } from "../console/steered";
import { freshVoiceRecord } from "./freshVoiceRecord";
import { recordReadingsOf } from "./recordReadings";
import type { QueueCall } from "./talkToolRunTypes";
import type { QueueScreen } from "./useQueueScreen";

/** A real timer for a deadline race (`byDeadline`), cleared once the race is decided. */
function timerAfter({ ms }: { readonly ms: number }): DeadlineTimer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    cancel: () => {
      clearTimeout(timer);
    },
    done,
  };
}

/** The work context the page the owner is on shows, and its filter over a row, read at the moment a call asks. */
export type VoiceContextNow = Pick<Parameters<typeof recordQueueAnswer>[0], "context" | "shows">;

/** What the Queue tools read through. */
export interface QueueRecord {
  /**
   * Read the record and the screen fresh, now; what they read answers the reads below until the next one. Returns the
   * calling tool's own deadline, which nothing a later call reads replaces.
   */
  readonly readQueueRecord: () => Promise<QueueCall>;
  /** `action_items`, answered from the latest record read. */
  readonly actionItems: () => ActionItemsAnswer;
  /** The cards the card tools resolve against, from the latest record read. */
  readonly cards: () => HeldCards;
  /** The sources only those cards stand on that the latest read could not read (`cardOnlyUnreadOf`). */
  readonly cardsUnread: () => readonly UnreadSource[];
  /** The cards this page draws from its own readings: the screen, where this page is the console. */
  readonly pageCards: () => HeldCards;
}

/**
 * The Queue tools' record.
 *
 * @param readings this page's own readings, which draw what is on screen where this page is the console
 * @param screen the Queue on screen
 * @param contextNow the work context of the page the owner is on, at the moment a tool asks
 * @returns the read, and the answers it backs
 */
export function useQueueRecord({
  readings,
  screen,
  contextNow,
}: {
  readings: ActionItemReadings;
  screen: QueueScreen;
  contextNow: () => VoiceContextNow;
}): QueueRecord {
  const placer = useWorkspacePlacer();
  const held = useRef({ contextNow, placer, readings, screen });
  // At commit, not after paint: a tool call between the two would read the render before.
  useLayoutEffect(() => {
    held.current = { contextNow, placer, readings, screen };
  });
  const latest = useRef<
    { readonly readings: ActionItemReadings; readonly screen: ScreenSeen; readonly startedAtMs: number } | undefined
  >(undefined);
  const pageCards = useCallback(
    (): HeldCards =>
      heldCardsOf({ nowIso: new Date().toISOString(), placer: held.current.placer, readings: held.current.readings }),
    [],
  );
  /** The screen as it stands, without asking for it again. */
  const screenHeld = useCallback((): Extract<ScreenSeen, { kind: "seen" }> => {
    const now = held.current.screen;
    return { cards: now.cards() ?? pageCards(), drawn: now.drawnNow(), kind: "seen", shown: now.shownNow() };
  }, [pageCards]);
  /** The screen, asked for now, an ask queued behind another never started past `startBy`. */
  const screenSeen = useCallback(
    async ({ startBy }: { startBy: number }): Promise<ScreenSeen> => {
      const unreached = await held.current.screen.screenNow({ startBy });
      if (unreached !== undefined) {
        return { kind: "unreached", why: unreached };
      }
      return screenHeld();
    },
    [screenHeld],
  );
  /** The screen, asked for now, inside what is left of the tool's deadline. */
  const screenSeenBy = useCallback(
    ({ deadlineAtMs }: { deadlineAtMs: number }): Promise<ScreenSeen> =>
      screenBy({
        after: timerAfter,
        ask: () => screenSeen({ startBy: deadlineAtMs }),
        deadlineAtMs,
        nowMs: () => performance.now(),
      }),
    [screenSeen],
  );
  const readQueueRecord = useCallback(async (): Promise<QueueCall> => {
    // One deadline for the whole tool, the record and every wait after it, held by this call
    // alone, so an overlapping call's later read never lends it more time.
    // Every instant here is the monotonic clock, so a wall clock set back never stretches the deadline.
    const startedAtMs = performance.now();
    const deadlineAtMs = startedAtMs + TOOL_TIMEOUT_MS;
    const { record, screen: seen } = await recordThenScreen({
      record: freshVoiceRecord,
      screen: () => screenSeenBy({ deadlineAtMs }),
    });
    // Only a read begun later replaces the one held: an older call's slow read landing last never puts a record
    // older than its own back under a call still answering.
    const read = { readings: recordReadingsOf({ heldSteers: heldSteersNow(), record }), screen: seen, startedAtMs };
    latest.current = newerRead({ held: latest.current, read });
    return {
      // Past the deadline the console is left where it was, and the answer says so.
      undrawnWhy: ({ key }) => undrawnNowWhy({ key, screen: () => screenSeenBy({ deadlineAtMs }) }),
      within: ({ ask, late }) =>
        byDeadline({ after: timerAfter, ask, deadlineAtMs, late, nowMs: () => performance.now() }),
    };
  }, [screenSeenBy]);
  const actionItems = useCallback((): ActionItemsAnswer => {
    const answerFrom = ({
      now,
    }: {
      now: { readonly readings: ActionItemReadings; readonly screen: ScreenSeen };
    }): ActionItemsAnswer =>
      recordQueueAnswer({
        ...held.current.contextNow(),
        nowIso: new Date().toISOString(),
        placer: held.current.placer,
        readings: now.readings,
        screen: now.screen,
        view: held.current.screen.shownNow().view,
      });
    const read = latest.current;
    if (read === undefined) {
      return answerFrom({ now: { readings: held.current.readings, screen: screenHeld() } });
    }
    return answerFrom({ now: read });
  }, [screenHeld]);
  const cards = useCallback((): HeldCards => {
    const now = latest.current;
    if (now === undefined) {
      return screenHeld().cards;
    }
    return heldCardsOf({ nowIso: new Date().toISOString(), placer: held.current.placer, readings: now.readings });
  }, [screenHeld]);
  const cardsUnread = useCallback((): readonly UnreadSource[] => {
    const now = latest.current;
    if (now === undefined) {
      return cardOnlyUnreadOf({ acts: held.current.readings.acts });
    }
    return cardOnlyUnreadOf({ acts: now.readings.acts });
  }, []);
  return useMemo(
    () => ({ actionItems, cards, cardsUnread, pageCards, readQueueRecord }),
    [actionItems, cards, cardsUnread, pageCards, readQueueRecord],
  );
}
