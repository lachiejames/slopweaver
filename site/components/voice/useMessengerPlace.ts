"use client";

/**
 * Where the orb rests, as the widget draws it: the place the owner last dragged it to (`site/lib/messengerPlace.ts`),
 * or the one a drag has reached, kept only when the drag ends so a drag writes storage once (the orb is draggable, and
 * never off screen). Under a shell that takes the place report
 * only, since only that shell moves its window to a place and says where the work area sits in it; anywhere else the
 * orb rests where it always has and offers no drag.
 *
 * A press on the orb that moves past a few pixels is a drag; one that does not is the press it always was. A drag is
 * wired up in the press itself, never in a later effect (`orbDrag.ts`), and the shell is told it began the moment it
 * crosses that threshold, so it holds the pointer and gives the drag the work area before the next move lands.
 *
 * **A drag moves the orb without React** (a drag that re-rendered on every move lagged and
 * flickered). Crossing the threshold is one render, which hides everything but the orb; every move after it is one
 * animation frame that writes a `translate` onto the widget, so neither the card nor its transcript is laid out again
 * until the drag lets go. That also keeps the card from being drawn off the screen mid-drag on a side with no room for
 * it: it comes back on release, on the side with more room.
 */
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { OverlayPlaceLink } from "../../lib/desktopShellPlace";
import {
  clampMessengerAnchor,
  DEFAULT_PANEL_SIDE,
  isMessengerPlaceStorage,
  MESSENGER_PLACE_KEY,
  type MessengerAnchor,
  type MessengerPanelSide,
  messengerAnchorOf,
  messengerDragTranslate,
  messengerPanelRoom,
  messengerPanelSide,
  messengerResizeEdges,
  type OverlayHome,
  type OverlayOrigin,
  type PlacedWidgetStyle,
  placedWidgetStyle,
} from "../../lib/messengerPlace";
import type { MessengerResizeEdge, MessengerSize } from "../../lib/messengerSize";
import { usePreference } from "../console/preference";
import { beginOrbDrag, type LatestPlace, type Press } from "./orbDrag";
import { useMessengerFrame } from "./useMessengerFrame";
import { roomPx, rootFontPx } from "./useMessengerSize";

/** The widget drawn at a place the owner dragged its orb to. */
export interface MessengerPlaced {
  readonly style: PlacedWidgetStyle;
  readonly side: MessengerPanelSide;
  /** The room on the card's side of the orb, which bounds its size (`useMessengerSize`). */
  readonly panelRoom: MessengerSize;
}

/**
 * The orb's place, and the handlers that move it.
 *
 * @param link the shell's ends of the place, `undefined` under a shell from before it or outside the shell
 * @param widget the widget's box, measured for the frame the shell crops its window round, and translated by a drag
 * @param enabled the orb may be dragged now: not while the stage is up
 * @returns the widget's place, `undefined` for where it has always rested; whether the orb is being dragged; the edges
 *   the card resizes by; the orb's ref, its press handler and the guard that keeps a drag's release from also pressing
 *   it; and the reset
 */
export function useMessengerPlace({
  link,
  widget,
  enabled,
}: {
  link: OverlayPlaceLink | undefined;
  widget: HTMLElement | null;
  enabled: boolean;
}): {
  readonly placed: MessengerPlaced | undefined;
  readonly dragging: boolean;
  readonly edges: readonly MessengerResizeEdge[];
  readonly measureOrb: (element: HTMLElement | null) => void;
  readonly pressOrb: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly guardClick: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly reset: () => void;
} {
  const { set: keep, value: stored } = usePreference({
    accept: isMessengerPlaceStorage,
    fallback: "default",
    key: MESSENGER_PLACE_KEY,
  });
  const [origin, setOrigin] = useState<OverlayOrigin | undefined>(undefined);
  const [home, setHome] = useState<OverlayHome | undefined>(undefined);
  const [room, setRoom] = useState<{ readonly width: number; readonly height: number } | undefined>(undefined);
  const [orb, setOrb] = useState<HTMLElement | null>(null);
  // The place a drag began at, drawn by the inline style for the whole drag: an orb resting where it always has has no
  // place of its own for the translate to start from.
  const [reached, setReached] = useState<MessengerAnchor | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const press = useRef<Press | undefined>(undefined);
  const stopFollowing = useRef<(() => void) | undefined>(undefined);
  // A drag's release is also a click on the orb, which must not open or close the messenger.
  const swallowClick = useRef(false);
  // The place the widget's inline style draws the orb at now, which the drag's translate is measured from.
  const drawn = useRef<MessengerAnchor | undefined>(undefined);
  useEffect(() => link?.onOrigin(setOrigin), [link]);
  useEffect(() => link?.onHome?.(setHome), [link]);
  useEffect(() => {
    if (link === undefined) {
      return undefined;
    }
    const measure = (): void => {
      setRoom(roomPx({ underShell: true }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [link]);
  let anchor: MessengerAnchor | undefined;
  const kept = messengerAnchorOf({ stored });
  if (kept !== undefined && room !== undefined) {
    anchor = clampMessengerAnchor({ anchor: kept, home, room, rootFontPx: rootFontPx() });
  }
  if (reached !== undefined) {
    anchor = reached;
  }
  // The kept place, home and room as of the latest render, which an abandoned drag reports: the press's own closure
  // holds them as of the press, and another window changing the kept place mid-drag, or the window's room changing
  // under it, would leave it telling the shell a place the at-rest render does not draw.
  const latest = useRef<LatestPlace>({ home, kept, room });
  useLayoutEffect(() => {
    latest.current = { home, kept, room };
  });
  let placed: MessengerPlaced | undefined;
  if (link !== undefined && anchor !== undefined && origin !== undefined && room !== undefined) {
    const side = messengerPanelSide({ anchor, room });
    placed = {
      panelRoom: messengerPanelRoom({ anchor, room, rootFontPx: rootFontPx(), side }),
      side,
      style: placedWidgetStyle({ anchor, origin, side }),
    };
  }
  // After every render, so a render mid-drag (the window growing under it re-renders on the origin word) still shows
  // the orb where the drag has it, and the render the drag ends on shows it untranslated at the place it kept.
  useLayoutEffect(() => {
    let rendered: MessengerAnchor | undefined;
    if (placed !== undefined) {
      rendered = anchor;
    }
    drawn.current = rendered;
    if (widget === null) {
      return;
    }
    const shown = press.current?.latest;
    let transform = "";
    if (rendered !== undefined && shown !== undefined) {
      transform = messengerDragTranslate({ rendered, shown });
    }
    widget.style.setProperty("transform", transform);
  });
  let sideNow = "corner";
  if (placed !== undefined) {
    sideNow = `${placed.side.vertical}:${placed.side.horizontal}`;
  }
  const frame = useMessengerFrame({ orb, side: sideNow, widget });
  // The place and frame go to the shell whenever either changes at rest, and once more as a drag settles; a drag itself
  // reports only as it begins, since the shell holds the whole work area for it however the orb moves.
  const right = anchor?.right;
  const bottom = anchor?.bottom;
  useEffect(() => {
    if (link === undefined || frame === undefined || dragging) {
      return;
    }
    let reportedAnchor: MessengerAnchor | null = null;
    if (right !== undefined && bottom !== undefined) {
      reportedAnchor = { bottom, right };
    }
    link.report({ anchor: reportedAnchor, frame, manipulating: false });
  }, [link, frame, right, bottom, dragging]);
  // An orb gone mid-drag stops following it and tells the shell the drag is over: the hook unmounting, the widget
  // drawing nothing while the hook stays mounted, or the stage coming up. A layout effect, so a stage coming up is
  // never painted through the drag's translate.
  useLayoutEffect(() => {
    if (orb === null || !enabled) {
      stopFollowing.current?.();
    }
  }, [orb, enabled]);
  // A layout effect's cleanup runs in the commit that unmounts, so no release can reach a drag whose orb has gone.
  useLayoutEffect(
    () => () => {
      stopFollowing.current?.();
    },
    [],
  );
  // Not memoised: it only ever goes to the orb's own handler, never into an effect's dependencies.
  const pressOrb = (event: ReactPointerEvent<HTMLElement>): void => {
    // A drag whose release never reached the page is abandoned by any next press, whatever its button, so it can never
    // hold the orb after the shell re-fits the window under it.
    stopFollowing.current?.();
    swallowClick.current = false;
    if (!enabled || link === undefined || origin === undefined || room === undefined || frame === undefined) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    beginOrbDrag({
      event,
      frame,
      keep,
      link,
      origin,
      refs: { drawn, latest, press, stopFollowing, swallowClick },
      setDragging,
      setReached,
      widget,
    });
  };
  const guardClick = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);
  const reset = useCallback((): void => {
    keep("default");
  }, [keep]);
  let side = DEFAULT_PANEL_SIDE;
  if (placed !== undefined) {
    side = placed.side;
  }
  return {
    dragging,
    edges: messengerResizeEdges({ side }),
    guardClick,
    measureOrb: setOrb,
    placed,
    pressOrb,
    reset,
  };
}
