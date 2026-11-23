"use client";

/**
 * `focus_screen` on the page: the gate (`site/lib/screenFocus.ts`) over the session's own record, the desktop app's
 * placement of the region (`desktop/src/screenShell.ts`), and the one region on show. What is on show drops on the owner's next
 * word, a tap on the dim, a newer lift, the end of the call, or {@link FOCUS_HOLD_MS} — a click inside the region lands
 * in the owner's app, where the voice never sees it.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DesktopBridge } from "../../lib/desktopShell";
import { focusRectReplyOf } from "../../lib/desktopShellWire";
import {
  FOCUS_HOLD_MS,
  type FocusRect,
  type LookTaken,
  latestOwnerTurnOf,
  lookOf,
  type ScreenLook,
  screenFocusVerdict,
} from "../../lib/screenFocus";
import type { HeardSegment } from "../../lib/voiceTranscript";
import type { ToolSeams } from "./talkToolRunTypes";

/** The region on show: where to draw it, the owner's turn it answers, and a key new for every lift. */
export interface ScreenFocusShown {
  readonly rect: FocusRect;
  readonly ownerTurnId: string;
  readonly key: number;
}

/** What the overlay reads: the region on show, if any, and how a tap drops it. */
export interface ScreenFocusControl {
  readonly shown: ScreenFocusShown | undefined;
  readonly drop: () => void;
}

/** The answer when this window cannot ask the desktop app to draw. */
const NOT_DESKTOP = "only the desktop app's voice can lift a region of the owner's screen; say where it is in words";

/**
 * The lift's state and its seam.
 *
 * @param seam the desktop shell's seam, whose lift is read at call time; it has none in a browser or an older shell
 * @param heard the conversation at this moment, for the gate
 * @param segments the conversation as rendered, which drops the region the moment the owner speaks
 * @param callLive whether this window's call is connected; a region never outlives that, a reconnect included
 * @returns what the overlay draws, what a look reports, and the tool's seam
 */
export function useScreenFocus({
  seam,
  heard,
  segments,
  callLive,
}: {
  seam: RefObject<{ readonly focusRegion?: DesktopBridge["focusRegion"] } | undefined>;
  heard: RefObject<{ readonly segments: readonly HeardSegment[] }>;
  segments: readonly HeardSegment[];
  callLive: boolean;
}): {
  readonly control: ScreenFocusControl;
  readonly noteLook: (input: { looked: LookTaken | undefined; ownerTurnId: string | undefined }) => void;
  readonly run: ToolSeams["screenFocus"];
} {
  const [lifted, setLifted] = useState<ScreenFocusShown | undefined>(undefined);
  const look = useRef<ScreenLook | undefined>(undefined);
  const focusedFor = useRef<string | undefined>(undefined);
  const placing = useRef(false);
  const lifts = useRef(0);
  // Each change of the link counts once, so a placement can tell the call dropped under it, even if it is back.
  const links = useRef({ changes: 0, live: callLive });
  useEffect(() => {
    links.current = { changes: links.current.changes + 1, live: callLive };
    if (!callLive) {
      // A reconnected session never saw the picture, so it cannot point into it.
      look.current = undefined;
    }
  }, [callLive]);

  const noteLook = useCallback(
    ({ looked, ownerTurnId }: { looked: LookTaken | undefined; ownerTurnId: string | undefined }): void => {
      look.current = lookOf({ ownerTurnId, looked });
    },
    [],
  );

  const run = useCallback<ToolSeams["screenFocus"]>(
    async ({ args }) => {
      const lift = seam.current?.focusRegion;
      if (lift === undefined) {
        return { answer: { refused: NOT_DESKTOP }, detail: "not the desktop app", refused: true };
      }
      // One placement at a time: two calls fired together would both pass the once-per-ask check before either lands.
      if (placing.current) {
        const why = "a region is already being placed; wait for it";
        return { answer: { refused: why }, detail: why, refused: true };
      }
      const verdict = screenFocusVerdict({
        args,
        focusedFor: focusedFor.current,
        look: look.current,
        segments: heard.current.segments,
      });
      if (verdict.kind === "refused") {
        return { answer: { refused: verdict.why }, detail: verdict.why, refused: true };
      }
      if (!links.current.live) {
        const why = "the call is not connected; say where it is in words";
        return { answer: { refused: why }, detail: why, refused: true };
      }
      const linkAtStart = links.current.changes;
      placing.current = true;
      let placed: unknown;
      try {
        placed = await lift({ region: verdict.region });
      } finally {
        placing.current = false;
      }
      const reply = focusRectReplyOf({ value: placed });
      if (reply.kind === "refused") {
        return { answer: { refused: reply.why }, detail: reply.why, refused: true };
      }
      if (links.current.changes !== linkAtStart) {
        const why = "the call dropped while it was placed; say where it is in words";
        return { answer: { refused: why }, detail: why, refused: true };
      }
      // The owner spoke while the desktop app placed it: their next word has already dropped it, so it never shows.
      if (latestOwnerTurnOf({ segments: heard.current.segments }) !== verdict.ownerTurnId) {
        const why = "the owner spoke while it was placed; say where it is in words";
        return { answer: { refused: why }, detail: why, refused: true };
      }
      focusedFor.current = verdict.ownerTurnId;
      lifts.current += 1;
      setLifted({ ownerTurnId: verdict.ownerTurnId, key: lifts.current, rect: reply.rect });
      const { height, left, top, width } = reply.rect;
      return {
        answer: { shown: "lifted on the owner's screen until they speak or tap" },
        detail: `${String(width)}×${String(height)} at ${String(left)},${String(top)}`,
        refused: false,
      };
    },
    [heard, seam],
  );

  const drop = useCallback((): void => {
    setLifted(undefined);
  }, []);

  const key = lifted?.key;
  useEffect(() => {
    if (key === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setLifted((now) => (now?.key === key ? undefined : now));
    }, FOCUS_HOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [key]);

  // A call that stops being connected drops it for good, so a reconnect never brings it back.
  if (lifted !== undefined && !callLive) {
    setLifted(undefined);
  }
  // Derived: the owner's next turn hides it at once, and can never bring it back — an earlier turn is never the latest again.
  let shown: ScreenFocusShown | undefined;
  if (lifted !== undefined && callLive && latestOwnerTurnOf({ segments }) === lifted.ownerTurnId) {
    shown = lifted;
  }
  const control = useMemo(() => ({ drop, shown }), [drop, shown]);
  return { control, noteLook, run };
}
