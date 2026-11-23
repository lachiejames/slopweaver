"use client";

/**
 * The messenger's size as the card draws it: the one stored (`site/lib/messengerSize.ts`), or the one a drag of an edge
 * away from the orb has reached — its left or top edge in the corner, whichever face the screen's middle beside an orb
 * the owner has dragged — kept only when the drag ends so a drag writes storage once. Under the desktop shell the
 * corner's width goes to the shell, which grows the window to it; while a drag runs the shell takes the room the drag
 * can reach and keeps the pointer, so the edge follows the cursor past the window it began in.
 *
 * A drag is wired up in the press itself, never in a later effect: the shell is told it began, and the release
 * listeners are in place, before the browser can deliver the next event, so a fast press and release always ends.
 */
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  cardDragDeltaPx,
  cardGrabPx,
  cornerWidthPx,
  fitMessenger,
  isMessengerSizeStorage,
  MESSENGER_SIZE_KEY,
  type MessengerResizeEdge,
  type MessengerSize,
  type MessengerSizeStorage,
  messengerMaximum,
  messengerRoomy,
  messengerSizeOf,
  messengerSizeStorageOf,
  resizeMessenger,
  SMALL_MESSENGER_SIZE,
  screenRoomCssPx,
} from "../../lib/messengerSize";
import { usePreference } from "../console/preference";
import { desktopBridge } from "./useDesktopShell";

/** A drag of one edge: what it began from, and the largest it may reach. */
interface Drag {
  readonly edge: MessengerResizeEdge;
  readonly start: MessengerSize;
  /** Where the press landed on the screen, to tell a drag from a press let go where it began. */
  readonly from: { readonly x: number; readonly y: number };
  /** The card the edge belongs to, measured on every move. */
  readonly card: HTMLElement;
  /** Where the press landed, from the edges it drags, CSS pixels (`cardGrabPx`). */
  readonly grab: { readonly x: number; readonly y: number };
  readonly maximum: MessengerSize;
  /** The pointer that pressed the edge; another one's moves and release are not this drag's. */
  readonly pointerId: number;
}

/**
 * One rem, CSS pixels, read off the root as it is drawn now.
 *
 * @returns the root's font size
 */
export function rootFontPx(): number {
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
}

/**
 * The room the messenger may grow into: the screen's work area under the shell, whose window is only the corner, and
 * the page's own viewport in a browser tab.
 *
 * @param underShell the page is the desktop shell's voice window
 * @returns the room, CSS pixels
 */
export function roomPx({ underShell }: { underShell: boolean }): { readonly width: number; readonly height: number } {
  if (underShell) {
    return screenRoomCssPx({
      availPx: { height: window.screen.availHeight, width: window.screen.availWidth },
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
    });
  }
  return { height: window.innerHeight, width: window.innerWidth };
}

/**
 * The shell's report for a corner holding a messenger this wide.
 *
 * @param widthRem the messenger's width
 * @param manipulating a drag holds the pointer
 * @returns the report
 */
function widthReport({ widthRem, manipulating }: { widthRem: number; manipulating: boolean }): {
  readonly width: number;
  readonly manipulating: boolean;
} {
  return {
    manipulating,
    width: cornerWidthPx({ rootFontPx: rootFontPx(), size: { ...SMALL_MESSENGER_SIZE, widthRem } }),
  };
}

/**
 * Follows one drag on the window until its pointer lets go, is cancelled, or loses its capture, whichever comes first.
 *
 * @param drag the drag
 * @param onReach a move reached this size
 * @param onEnd the drag ended, at this size, `moved` false for a press let go where it began
 * @returns stops following, for a card that closes mid-drag
 */
function followDrag({
  drag,
  onReach,
  onEnd,
}: {
  drag: Drag;
  onReach: (size: MessengerSize) => void;
  onEnd: (input: { size: MessengerSize; moved: boolean }) => void;
}): () => void {
  let latest = drag.start;
  let moved = false;
  const follow = ({ event }: { event: PointerEvent }): void => {
    moved = moved || event.screenX !== drag.from.x || event.screenY !== drag.from.y;
    const root = rootFontPx();
    const box = drag.card.getBoundingClientRect();
    latest = resizeMessenger({
      deltaPx: cardDragDeltaPx({
        cardPx: box,
        edge: drag.edge,
        grabPx: drag.grab,
        pointerPx: { x: event.clientX, y: event.clientY },
        rootFontPx: root,
        start: drag.start,
      }),
      edge: drag.edge,
      maximum: drag.maximum,
      rootFontPx: root,
      start: drag.start,
    });
  };
  const onMove = (event: PointerEvent): void => {
    if (event.pointerId === drag.pointerId) {
      follow({ event });
      onReach(latest);
    }
  };
  // A release lands where the pointer let go, which a coalesced last move may not have reported; a cancel carries no
  // place worth trusting, so it keeps the last move's; a capture lost without either (the window stopped taking the
  // pointer) ends it too, so a drag never stays running with no release to come.
  const onUp = (event: PointerEvent): void => {
    if (event.pointerId === drag.pointerId) {
      follow({ event });
      finish();
    }
  };
  const onLost = (event: PointerEvent): void => {
    if (event.pointerId === drag.pointerId) {
      finish();
    }
  };
  const stop = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onLost);
    window.removeEventListener("lostpointercapture", onLost);
  };
  const finish = (): void => {
    stop();
    onEnd({ moved, size: latest });
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onLost);
  window.addEventListener("lostpointercapture", onLost);
  return stop;
}

/**
 * The messenger's size, and the handlers that change it.
 *
 * @param panelRoom the room on the card's side of an orb the owner has dragged (`messengerPanelRoom`), which bounds
 *   the size on top of the screen's; `undefined` for the orb where it has always rested
 * @returns the size to draw; whether its edges may be dragged, which a shell too old to take the corner's width or a
 *   screen without room for the smallest messenger rules out; `begin`, for a press on an edge; and `choose`, for the
 *   size menu's presets and its reset
 */
export function useMessengerSize({ panelRoom }: { panelRoom: MessengerSize | undefined }): {
  readonly size: MessengerSize;
  readonly canDrag: boolean;
  readonly begin: (input: { edge: MessengerResizeEdge; event: ReactPointerEvent<HTMLElement> }) => void;
  readonly choose: (input: { stored: MessengerSizeStorage }) => void;
} {
  const { set: keep, value: stored } = usePreference({
    accept: isMessengerSizeStorage,
    fallback: "small",
    key: MESSENGER_SIZE_KEY,
  });
  const [reached, setReached] = useState<MessengerSize | undefined>(undefined);
  // The running drag's stop, read and written synchronously, so a second press in the same frame sees the first.
  const running = useRef<(() => void) | undefined>(undefined);
  const bridge = desktopBridge();
  const underShell = bridge?.role === "overlay";
  const report = bridge?.reportOverlayWidth;
  const canWiden = !underShell || report !== undefined;
  // The room on this screen, measured once mounted (a server render has no screen) and again as the window changes
  // display; until then the kept size draws as stored, its CSS cap holding it inside the window.
  const [room, setRoom] = useState<MessengerSize | undefined>(undefined);
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const measure = (): void => {
      const screenPx = roomPx({ underShell });
      setRoom(messengerMaximum({ canWiden, rootFontPx: rootFontPx(), screenPx }));
      setRoomy(messengerRoomy({ rootFontPx: rootFontPx(), screenPx }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [canWiden, underShell]);
  let kept = messengerSizeOf({ canWiden, stored });
  if (room !== undefined) {
    kept = fitMessenger({ maximum: room, size: kept });
  }
  if (panelRoom !== undefined) {
    kept = fitMessenger({ maximum: panelRoom, size: kept });
  }
  let size = kept;
  if (reached !== undefined) {
    size = reached;
  }
  // The kept size's width, never the dragged one: the shell holds the drag's room until it ends, and is told the new
  // width as the drag lets go.
  const keptWidthRem = kept.widthRem;
  useEffect(() => {
    if (running.current === undefined) {
      report?.({ report: widthReport({ manipulating: false, widthRem: keptWidthRem }) });
    }
  }, [report, keptWidthRem]);
  // A card closed mid-drag stops following it.
  useEffect(
    () => () => {
      running.current?.();
      running.current = undefined;
    },
    [],
  );
  // A card closed hands the corner back at the default width, holding no pointer, so the orb alone never sits in a wide
  // window and the shell never holds a pointer for a drag that is gone.
  useEffect(
    () => () => {
      report?.({ report: widthReport({ manipulating: false, widthRem: SMALL_MESSENGER_SIZE.widthRem }) });
    },
    [report],
  );
  const begin = useCallback(
    ({ edge, event }: { edge: MessengerResizeEdge; event: ReactPointerEvent<HTMLElement> }): void => {
      // One drag at a time: a second press while one runs is not a new one. The handles sit inside the card, so the
      // card is the handle's parent.
      const card = event.currentTarget.parentElement;
      if (running.current !== undefined || card === null) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Until the shell hears a drag began it decides capture by what is under the pointer, and a fast move off the
      // card would let the window go.
      report?.({ report: widthReport({ manipulating: true, widthRem: kept.widthRem }) });
      const start = kept;
      let maximum = messengerMaximum({ canWiden, rootFontPx: rootFontPx(), screenPx: roomPx({ underShell }) });
      if (panelRoom !== undefined) {
        maximum = fitMessenger({ maximum: panelRoom, size: maximum });
      }
      running.current = followDrag({
        drag: {
          card,
          edge,
          from: { x: event.screenX, y: event.screenY },
          grab: cardGrabPx({
            cardPx: card.getBoundingClientRect(),
            edge,
            pressPx: { x: event.clientX, y: event.clientY },
          }),
          maximum,
          pointerId: event.pointerId,
          start,
        },
        onEnd: ({ size: ended, moved }) => {
          running.current = undefined;
          setReached(undefined);
          // A press let go where it began writes nothing, so a size kept on a larger display is not narrowed by a click.
          let widthRem = start.widthRem;
          if (moved) {
            keep(messengerSizeStorageOf({ size: ended }));
            widthRem = ended.widthRem;
          }
          report?.({ report: widthReport({ manipulating: false, widthRem }) });
        },
        onReach: setReached,
      });
      setReached(start);
    },
    [kept, canWiden, underShell, report, keep, panelRoom],
  );
  const choose = useCallback(
    ({ stored: next }: { stored: MessengerSizeStorage }): void => {
      keep(next);
    },
    [keep],
  );
  return { begin, canDrag: canWiden && roomy, choose, size };
}
