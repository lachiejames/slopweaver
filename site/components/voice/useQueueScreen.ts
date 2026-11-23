"use client";

/**
 * The Queue on SCREEN, as a voice tool checks the record against it: in the desktop shell's voice window, the console
 * window's, asked for at the tool; in a browser, this page's own.
 *
 * A Queue tool answers from the record, read fresh (`./useQueueRecord.ts`). Measured: the voice's window answered
 * from its own held copy and listed cards the console window's Queue had stopped drawing hours before. This is what
 * is on screen beside the record — the cards the console draws, the keys the Queue drew,
 * and the counts it prints (`../../lib/queueScreenVoice.ts`). An ask that did not arrive is said as not arriving.
 * While a call is up the snapshot is asked for again whenever the console window's page moves, so a sentence's count
 * is checked against the page on screen.
 *
 * In a browser and in the console window itself the page's own readings ARE the screen, so every read passes through.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { PageView } from "../../lib/pageVoice";
import {
  drawnKeysOf,
  onQueuePath,
  type QueueScreenSnapshot,
  SCREEN_ASK_DEADLINE_MS,
  type ScreenHeld,
  screenHeldOf,
  screenSourceOf,
  unreadShown,
} from "../../lib/queueScreenVoice";
import type { QueueShownCounts } from "../../lib/queueShownCounts";
import { screenAskChain } from "../../lib/screenAskChain";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";

/** The cards `read_card`, `open_card` and `triage_next` resolve against, as the console window holds them. */
export type ScreenCards = QueueScreenSnapshot["cards"];

/** No card at all: on the Queue, while the console window's Queue has not arrived. */
const NO_CARDS: ScreenCards = { acts: [], focuses: [], recentlyLeft: [], rows: [] };

/** The monotonic clock a screen ask's start is judged on, so a wall clock set back never stretches a deadline. */
const monotonicNow = (): number => performance.now();

/** What the Queue tools read through. */
export interface QueueScreen {
  /**
   * Ask for the Queue on screen now; settles once it, or why there is none, is held — to that reason when the Queue
   * the owner is on did not reach this window, so a card tool says so rather than reading no cards as an empty Queue.
   * `startBy` is when the asking tool's time is up: an ask queued behind another is never started past it.
   */
  readonly screenNow: (input: { readonly startBy: number }) => Promise<string | undefined>;
  /** On the Queue on screen, every key it drew, in its order; `undefined` off it, or while it has not arrived. */
  readonly drawnNow: () => readonly string[] | undefined;
  /** The counts the app shows, from the Queue on screen. */
  readonly shownNow: () => QueueShownCounts;
  /** The cards the screen draws, or `undefined` where this window's own readings are the screen. */
  readonly cards: () => ScreenCards | undefined;
}

/**
 * The voice window's Queue, read off the console window.
 *
 * @param desktop the desktop shell's seam, whose `requestVoiceQueue` asks the console window
 * @param shownNow this window's own counts, which answer off the Queue or where no shell carries the page
 * @param view this window's own page, whose reading names the keys the Queue drew where it is the screen
 * @param live whether a call is up, while which a page move asks again
 * @returns the reads the Queue tools take
 */
export function useQueueScreen({
  desktop,
  shownNow,
  view,
  live,
}: {
  desktop: DesktopVoiceSeam | undefined;
  shownNow: () => QueueShownCounts;
  view: () => PageView;
  live: boolean;
}): QueueScreen {
  const local = useRef({ shownNow, view });
  const seam = useRef(desktop);
  // At commit, as the readings beneath are held: a tool call between commit and paint reads this render's.
  useLayoutEffect(() => {
    local.current = { shownNow, view };
    seam.current = desktop;
  });
  const held = useRef<ScreenHeld>({ kind: "unasked" });
  /** The shell's voice window: a seam carrying the console window's page rather than publishing its own. */
  const voiceWindow = useCallback(
    (): boolean => seam.current !== undefined && seam.current.publishPage === undefined,
    [],
  );
  const askOnce = useCallback(async (): Promise<void> => {
    const request = seam.current?.requestVoiceQueue;
    if (request === undefined) {
      held.current = {
        kind: "unreached",
        why: "this desktop app predates reading the console window's Queue; restart it after a pull",
      };
      return;
    }
    // This window's own deadline, so a shell that never answers cannot hold a Queue tool, or the asks queued behind
    // it, for ever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ScreenHeld>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          kind: "unreached",
          why: `the desktop app did not answer the ask for the Queue within ${String(SCREEN_ASK_DEADLINE_MS)} ms`,
        });
      }, SCREEN_ASK_DEADLINE_MS);
    });
    try {
      const answered = request().then((value) => screenHeldOf({ value }));
      held.current = await Promise.race([answered, deadline]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      held.current = { kind: "unreached", why: `the ask for the console window's Queue failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }, []);
  // One ask in flight, and at most one queued behind it, never started once every caller on it is past its time.
  // Built at the first ask rather than during render, so rendering neither reads the clock nor touches a ref.
  const chain = useRef<ReturnType<typeof screenAskChain> | undefined>(undefined);
  const source = useCallback(
    () => screenSourceOf({ carriedPath: seam.current?.pageIdentity?.path, held: held.current }),
    [],
  );
  const screenNow = useCallback(
    async ({ startBy }: { startBy: number }): Promise<string | undefined> => {
      if (!voiceWindow()) {
        return undefined;
      }
      // A call whose time ran out before its ask could start reads no screen, never one an older ask left held.
      let ask = chain.current;
      if (ask === undefined) {
        ask = screenAskChain({ nowMs: monotonicNow, start: askOnce });
        chain.current = ask;
      }
      const { asked } = await ask.asked({ startBy });
      if (!asked) {
        return "the Queue tool's time ran out before the Queue on screen was asked";
      }
      const now = source();
      // A card tool handed no cards would read an ask that never arrived as an empty Queue.
      return now.kind === "unreached" ? now.why : undefined;
    },
    [askOnce, source, voiceWindow],
  );
  const drawnNow = useCallback((): readonly string[] | undefined => {
    const now = source();
    if (!voiceWindow() || now.kind === "local") {
      const page = local.current.view();
      return onQueuePath({ path: page.path }) ? drawnKeysOf({ shows: page.shows }) : undefined;
    }
    if (now.kind === "snapshot") {
      return now.snapshot.drawnKeys;
    }
    return undefined;
  }, [source, voiceWindow]);
  const shownOnScreen = useCallback((): QueueShownCounts => {
    const now = source();
    if (!voiceWindow() || now.kind === "local") {
      return local.current.shownNow();
    }
    if (now.kind === "snapshot") {
      return now.snapshot.shown;
    }
    // The local reading's view and other context are the carried page's (`./useVoiceReadings.ts` `contextNow`).
    const carried = local.current.shownNow();
    return unreadShown({ otherContext: carried.otherContext.context, view: carried.view });
  }, [source, voiceWindow]);
  const cards = useCallback((): ScreenCards | undefined => {
    const now = source();
    if (!voiceWindow() || now.kind === "local") {
      return undefined;
    }
    if (now.kind === "snapshot") {
      return now.snapshot.cards;
    }
    return NO_CARDS;
  }, [source, voiceWindow]);
  // While a call is up, the console window's page moving — another page, a redrawn Queue — asks again, so what a
  // sentence's count is checked against is the page on screen (`../../lib/talkCountGrounding.ts`).
  const carried = desktop?.pageIdentity;
  useEffect(() => {
    if (live && carried !== undefined) {
      // No tool waits on this ask, so no deadline abandons it.
      void screenNow({ startBy: Number.POSITIVE_INFINITY });
    }
  }, [carried, live, screenNow]);
  return { cards, drawnNow, screenNow, shownNow: shownOnScreen };
}
