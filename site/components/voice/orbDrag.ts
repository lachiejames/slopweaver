/**
 * A press on the orb, wired up in the press itself: past a few pixels it is a drag, one animation frame follows the
 * newest pointer, and the release keeps the place the orb was shown at. `useMessengerPlace.ts` owns the place and
 * decides whether a press may drag at all; this module owns everything from the press to the drag's end.
 *
 * **A drag moves the orb without React** (a drag that re-rendered on every move lagged and flickered). Crossing the
 * threshold is one render, which hides everything but the orb; every move after it is one animation frame that writes
 * a `translate` onto the widget, so neither the card nor its transcript is laid out again until the drag lets go.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { OverlayPlaceLink } from "../../lib/desktopShellPlace";
import {
  anchorOfCentre,
  clampMessengerAnchor,
  draggedMessengerAnchor,
  isMessengerHome,
  type MessengerAnchor,
  type MessengerFrame,
  type MessengerPlaceStorage,
  messengerDragTranslate,
  messengerPlaceStorageOf,
  type OverlayHome,
  type OverlayOrigin,
  orbDragCrossed,
} from "../../lib/messengerPlace";
import { roomPx, rootFontPx } from "./useMessengerSize";

/** A point in the window, client CSS pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A press on the orb: where it landed, and whether it has moved far enough to be a drag. */
export interface Press {
  readonly pointerId: number;
  readonly from: Point;
  /** Where on the orb the press landed, from its centre, client CSS pixels. */
  readonly grab: Point;
  crossed: boolean;
  /** Where the orb was drawn as the press became a drag. */
  start: MessengerAnchor | undefined;
  /** Where the drag has reached: the place the orb is SHOWN at, through the widget's translate. */
  latest: MessengerAnchor | undefined;
  /** The newest pointer not yet followed, read once per animation frame. */
  pending: Point | undefined;
  /** The animation frame that follows it, while one is asked for. */
  frameAsked: number | undefined;
}

/** The kept place, home and room as of the latest render, which a drag reads rather than its press's own closure. */
export interface LatestPlace {
  kept: MessengerAnchor | undefined;
  home: OverlayHome | undefined;
  room: { readonly width: number; readonly height: number } | undefined;
}

/** The hook's refs a drag reads and writes, each outliving the press that began it. */
interface OrbDragRefs {
  /** The press in flight, `undefined` between presses. */
  readonly press: RefObject<Press | undefined>;
  /** Abandons the drag in flight; set while one is wired up. */
  readonly stopFollowing: RefObject<(() => void) | undefined>;
  /** A drag's release is also a click on the orb, which must not open or close the messenger. */
  readonly swallowClick: RefObject<boolean>;
  /** The place the widget's inline style draws the orb at now, which the drag's translate is measured from. */
  readonly drawn: RefObject<MessengerAnchor | undefined>;
  readonly latest: RefObject<LatestPlace>;
}

/**
 * The centre of an element's box, client CSS pixels.
 *
 * @param element the element
 * @returns its centre
 */
function centreOf({ element }: { element: Element }): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Wire a primary press on the orb up as a drag that follows the pointer, and keep or abandon it when it ends.
 *
 * @param event the primary press the orb heard, which the hook has already let through
 * @param link the shell's ends of the place, told as the drag begins and ends
 * @param origin where the work area's corner sits inside the window, for an orb with no place yet
 * @param frame the widget's frame the shell crops its window round
 * @param widget the box a drag translates each animation frame
 * @param keep writes the place a drag ended at into storage
 * @param setReached draws the place a drag began at for the whole drag, and clears it as the drag ends
 * @param setDragging tells the widget a drag is under way, which hides everything but the orb
 */
export function beginOrbDrag({
  event,
  link,
  origin,
  frame,
  widget,
  refs,
  keep,
  setReached,
  setDragging,
}: {
  event: ReactPointerEvent<HTMLElement>;
  link: OverlayPlaceLink;
  origin: OverlayOrigin;
  frame: MessengerFrame;
  widget: HTMLElement | null;
  refs: OrbDragRefs;
  keep: (next: MessengerPlaceStorage) => void;
  setReached: (next: MessengerAnchor | undefined) => void;
  setDragging: (next: boolean) => void;
}): void {
  const { drawn, latest, press, stopFollowing, swallowClick } = refs;
  const element = event.currentTarget;
  element.setPointerCapture(event.pointerId);
  const centre = centreOf({ element });
  press.current = {
    crossed: false,
    frameAsked: undefined,
    from: { x: event.clientX, y: event.clientY },
    grab: { x: event.clientX - centre.x, y: event.clientY - centre.y },
    latest: undefined,
    pending: undefined,
    pointerId: event.pointerId,
    start: undefined,
  };
  // One animation frame follows the newest pointer: the orb is measured where it is shown, the place reached from
  // it, and the widget translated there. Until the render that draws the drag's start has landed there is nothing
  // to translate from, so it waits a frame.
  const follow = (): void => {
    const held = press.current;
    if (held === undefined) {
      return;
    }
    held.frameAsked = undefined;
    const pointer = held.pending;
    const from = held.latest ?? held.start;
    if (pointer === undefined || from === undefined) {
      return;
    }
    const rendered = drawn.current;
    if (rendered === undefined) {
      ask();
      return;
    }
    held.pending = undefined;
    held.latest = draggedMessengerAnchor({
      drawn: from,
      grab: held.grab,
      orbCentre: centreOf({ element }),
      home: latest.current.home,
      pointer,
      room: roomPx({ underShell: true }),
      rootFontPx: rootFontPx(),
    });
    widget?.style.setProperty("transform", messengerDragTranslate({ rendered, shown: held.latest }));
  };
  const ask = (): void => {
    const held = press.current;
    if (held !== undefined && held.frameAsked === undefined) {
      held.frameAsked = window.requestAnimationFrame(follow);
    }
  };
  const onMove = (moved: PointerEvent): void => {
    const held = press.current;
    if (moved.pointerId !== event.pointerId || held === undefined) {
      return;
    }
    // A move with no button held is never followed: the shell growing the window mid-drag makes the page synthesise
    // one at a stale point (measured by the desktop e2e's orb-drag step), and following it would jump the orb there.
    if ((moved.buttons & 1) === 0) {
      return;
    }
    const pointer = { x: moved.clientX, y: moved.clientY };
    if (!held.crossed) {
      if (!orbDragCrossed({ delta: { x: pointer.x - held.from.x, y: pointer.y - held.from.y } })) {
        return;
      }
      held.crossed = true; // An orb resting where it always has has no place yet: it starts from where it is drawn, kept on the screen
      // the shell will take a report for.
      held.start = clampMessengerAnchor({
        anchor:
          drawn.current ??
          anchorOfCentre({
            centre: centreOf({ element }),
            origin,
            viewport: { height: window.innerHeight, width: window.innerWidth },
          }),
        home: latest.current.home,
        room: roomPx({ underShell: true }),
        rootFontPx: rootFontPx(),
      });
      // Before the window grows under the cursor, so the shell holds the pointer from this move on.
      link.report({ anchor: held.start, frame, manipulating: true });
      setReached(held.start);
      setDragging(true);
    }
    held.pending = pointer;
    ask();
  };
  const onUp = (released: PointerEvent): void => {
    if (released.pointerId !== event.pointerId) {
      return;
    }
    // A release after the orb left the page is not the owner choosing a place: the orb unmounted under the held
    // pointer, so wherever the pointer is now says nothing about where the owner wanted it.
    if (!element.isConnected) {
      abandon();
      return;
    }
    const held = press.current;
    if (held?.crossed === true) {
      held.pending = { x: released.clientX, y: released.clientY };
      follow();
    }
    finish();
  };
  // A cancelled pointer, or a capture lost because the orb went, is abandoned, never kept: an orb unmounted mid-drag
  // drops its capture before the unmount cleanup runs, and keeping that drag would keep a place nobody chose. A capture
  // lost while the orb is still on the page ends nothing: the shell growing the window under the held pointer drops it
  // about 20ms after the drag crosses (measured by the desktop e2e's orb-drag step on the installed shell), and the
  // window still hears every move and the release while the button is held.
  const onLost = (lost: PointerEvent): void => {
    if (lost.pointerId !== event.pointerId) {
      return;
    }
    if (lost.type === "lostpointercapture" && element.isConnected) {
      return;
    }
    abandon();
  };
  // Any next press anywhere on the page, not only on the orb, abandons a drag whose release never reached it: a press
  // on a blank point of the overlay would otherwise drive the stale drag and its release keep that unrelated point.
  // Heard in the capture phase, which the press that began this drag has already passed, and checked against it
  // besides.
  const onNextPress = (next: PointerEvent): void => {
    if (next === event.nativeEvent) {
      return;
    }
    abandon();
  };
  const stop = (): void => {
    window.removeEventListener("pointerdown", onNextPress, { capture: true });
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onLost);
    window.removeEventListener("lostpointercapture", onLost);
    stopFollowing.current = undefined;
  };
  // The press is over: its frame, if one is asked for, is not followed, and a drag's release is never a press.
  const letGo = (): Press | undefined => {
    stop();
    const held = press.current;
    press.current = undefined;
    if (held?.frameAsked !== undefined) {
      window.cancelAnimationFrame(held.frameAsked);
    }
    if (held?.crossed === true) {
      swallowClick.current = true;
    }
    return held;
  };
  // The drag ends where it was shown: kept, told to the shell, and drawn there by the inline style in the same
  // render that drops the translate (the hook's layout effect), so letting go never moves the orb. Ended exactly on
  // the orb's home it is kept as no place at all, so the corner fits exactly as it always has.
  const finish = (): void => {
    const held = letGo();
    if (held?.crossed !== true) {
      return;
    }
    const ended = held.latest ?? held.start;
    let at: MessengerAnchor | null = null;
    // Home as of the latest render, which the drag's last frame was clamped against too: one the shell moved mid-drag
    // would otherwise keep the old corner as the default and draw it at the new one.
    const { home: homeNow } = latest.current;
    if (
      ended !== undefined &&
      homeNow !== undefined &&
      isMessengerHome({ anchor: ended, home: homeNow, rootFontPx: rootFontPx() })
    ) {
      keep("default");
    } else if (ended !== undefined) {
      keep(messengerPlaceStorageOf({ anchor: ended }));
      at = ended;
    }
    // The shell hears the drag end here, in the release itself: a drag that crosses and ends in one release, the orb
    // already against the screen's edge, changes no state the report effect would see. That effect
    // reports again with the frame measured where the drag let go, should that differ.
    link.report({ anchor: at, frame, manipulating: false });
    setReached(undefined);
    setDragging(false);
  };
  // A drag the owner did not let go of — the stage coming up, the orb gone — is abandoned, never kept: the orb goes
  // back to the place it had, untranslated at once, and the shell hears the drag is over there.
  const abandon = (): void => {
    // The listeners come off first, so the lost capture releasing the pointer fires ends nothing a second time; the
    // pointer goes back for an orb still drawn, which the stage coming up mid-drag keeps mounted, so the orb never
    // stays captured by a drag that has ended.
    const held = letGo();
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    if (held?.crossed !== true) {
      return;
    }
    widget?.style.setProperty("transform", "");
    let at: MessengerAnchor | null = null;
    const now = latest.current;
    if (now.kept !== undefined && now.room !== undefined) {
      at = clampMessengerAnchor({ anchor: now.kept, home: now.home, room: now.room, rootFontPx: rootFontPx() });
    }
    link.report({ anchor: at, frame, manipulating: false });
    setReached(undefined);
    setDragging(false);
  };
  window.addEventListener("pointerdown", onNextPress, { capture: true });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onLost);
  window.addEventListener("lostpointercapture", onLost);
  stopFollowing.current = abandon;
}
