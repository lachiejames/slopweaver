"use client";

/**
 * The console window's half of the Queue on screen: when the voice's window asks (`./useQueueScreen.ts`), this
 * window answers with what is on screen at that instant — the cards it draws from its own live readings, on the Queue
 * the keys the page drew in its order (`drawnKeys`, `../../lib/queueVoice.ts`), and the counts it prints. A Queue page
 * whose reading has not registered answers none, which the voice says rather than guessing.
 *
 * The voice answers from the record, read fresh (`./useQueueRecord.ts`); this is only what
 * that record is checked against, so the voice never says a count or opens a card the screen does not show.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import type { PageView } from "../../lib/pageVoice";
import { drawnKeysOf, onQueuePath, screenSnapshotWire } from "../../lib/queueScreenVoice";
import type { QueueShownCounts } from "../../lib/queueShownCounts";
import type { HeldCards } from "../../lib/voiceRecordQueue";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";

/**
 * Answer the voice's window's asks for the Queue this window holds.
 *
 * @param desktop the desktop shell's seam, whose `serveVoiceQueue` takes the asks — absent anywhere but the console
 *   window
 * @param cards the cards this window draws, from its own readings
 * @param shownNow this window's own counts
 * @param view the page this window draws, whose reading names the cards the Queue drew
 */
export function useQueueScreenServer({
  desktop,
  cards,
  shownNow,
  view,
}: {
  desktop: DesktopVoiceSeam | undefined;
  cards: () => HeldCards;
  shownNow: () => QueueShownCounts;
  view: () => PageView;
}): void {
  const held = useRef({ cards, shownNow, view });
  // At commit, as the readings beneath are held: an ask between commit and paint reads this render's.
  useLayoutEffect(() => {
    held.current = { cards, shownNow, view };
  });
  const serve = desktop?.serveVoiceQueue;
  useEffect(() => {
    if (serve === undefined) {
      return undefined;
    }
    return serve(() => {
      const now = held.current;
      const page = now.view();
      const onQueue = onQueuePath({ path: page.path });
      const drawn = drawnKeysOf({ shows: page.shows });
      // The Queue page has not registered what it drew yet: no answer, rather than one it did not draw.
      if (onQueue && drawn === undefined) {
        return null;
      }
      const snapshot = { cards: now.cards(), path: page.path, shown: now.shownNow() };
      const wire = screenSnapshotWire({
        snapshot: onQueue && drawn !== undefined ? { ...snapshot, drawnKeys: drawn } : snapshot,
      });
      if (wire === undefined) {
        return null;
      }
      return wire;
    });
  }, [serve]);
}
