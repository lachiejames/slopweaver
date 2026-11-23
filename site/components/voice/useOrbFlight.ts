"use client";

/**
 * The orb flying between the corner and the stage, animated in both directions: from the small presence in the
 * corner to the large presence on the screen, and back. The transform is `site/lib/orbFlight.ts`'s; this plays it.
 *
 * The two orbs are never on screen at once — the stage covers the corner while it shows — so each flight is the
 * ARRIVING orb drawn first over the one it replaces and moved into its own place. The stage's orb measures the
 * corner's where it is right now, since the corner is still laid out under the stage; in the desktop app the overlay
 * window has just grown from the corner to the whole work area, so a box measured before that would be in the wrong
 * window. The corner's orb flies from the stage's last box, kept here because the stage has gone by the time the
 * corner lands — and `VoiceWidget.tsx` holds the overlay whole until it has, so the shell does not shrink the window
 * under a flight. Under reduce-motion neither flies.
 */
import { type RefObject, useLayoutEffect } from "react";

import {
  backdropFadeOf,
  type FlightArrival,
  type FlightRect,
  flightKeyframes,
  ORB_FLIGHT_EASING,
  ORB_FLIGHT_MS,
} from "../../lib/orbFlight";
import { isOrbBackingOpacity } from "../../lib/voiceStage";

/** The stage orb's box when it was last laid out. */
let stageBox: FlightRect | undefined;

/** The corner orb, while one is mounted. */
let cornerOrb: HTMLElement | undefined;

/** A box as the flight reads one. */
function boxOf({ element }: { element: HTMLElement }): FlightRect {
  const rect = element.getBoundingClientRect();
  return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
}

/**
 * Fly `moving` from `from` into its own place, `to`, unless motion is reduced or there is nowhere to fly from. The
 * orb's soft disc inside it fades over the same flight (`backdropFadeOf`), ending on its own resting opacity, so no
 * fill is kept.
 */
function fly({
  moving,
  from,
  to,
  arriving,
}: {
  moving: HTMLElement;
  from: FlightRect;
  to: FlightRect;
  arriving: FlightArrival;
}): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const frames = flightKeyframes({ from, to });
  if (frames === undefined) {
    return;
  }
  const [start, end] = frames;
  const timing = { duration: ORB_FLIGHT_MS, easing: ORB_FLIGHT_EASING };
  moving.animate([{ transform: start }, { transform: end }], timing);
  const backdrop = moving.querySelector("[data-orb-backdrop]");
  if (backdrop !== null) {
    // The owner's slider strength, which `OrbBackdrop` always writes; a backdrop without it is drawn at full.
    const opacity = backdrop.getAttribute("data-backing-opacity");
    let strength = 1;
    if (isOrbBackingOpacity(opacity)) {
      strength = Number(opacity) / 100;
    }
    const [shownFrom, shownTo] = backdropFadeOf({ arriving, strength });
    const fade = backdrop.animate([{ opacity: shownFrom }, { opacity: shownTo }], timing);
    if (arriving === "stage" && !moving.hasAttribute("data-ground")) {
      // The stage's orb leaves the corner on its dark disc, so it is drawn for that ground until the disc has faded,
      // then eases onto the page's own (`lightnessToward`, `orbRamp.ts`). Cancelled or finished, the mark goes.
      moving.setAttribute("data-ground", "dark");
      const clear = (): void => {
        moving.removeAttribute("data-ground");
      };
      fade.finished.then(clear, clear);
    }
  }
}

/**
 * The stage orb's half: fly out of the corner as the stage opens, and keep this orb's box for the corner's landing.
 *
 * @param box the orb's laid-out box, which never moves itself
 * @param moving the layer inside it that flies
 */
export function useStageOrbFlight({
  box,
  moving,
}: {
  box: RefObject<HTMLElement | null>;
  moving: RefObject<HTMLElement | null>;
}): void {
  useLayoutEffect(() => {
    const element = box.current;
    const layer = moving.current;
    if (element === null || layer === null) {
      return undefined;
    }
    const here = boxOf({ element });
    stageBox = here;
    if (cornerOrb?.isConnected === true) {
      fly({ arriving: "stage", from: boxOf({ element: cornerOrb }), moving: layer, to: here });
    }
    return () => {
      // The stage is still laid out while its effects are torn down, and a tray opening shrinks the orb to its small
      // indicator, so it may have moved since it opened; this is the box the corner lands from.
      const last = boxOf({ element });
      if (last.width > 0) {
        stageBox = last;
      }
    };
  }, [box, moving]);
}

/**
 * The corner orb's half: be the box the stage flies out of, and land from the stage's box when it closes.
 *
 * @param box the orb's laid-out box
 * @param moving the layer inside it that flies
 * @param landing true for the render the stage closed in, and until the flight is done
 */
export function useCornerOrbFlight({
  box,
  moving,
  landing,
}: {
  box: RefObject<HTMLElement | null>;
  moving: RefObject<HTMLElement | null>;
  landing: boolean;
}): void {
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) {
      return undefined;
    }
    cornerOrb = element;
    return () => {
      if (cornerOrb === element) {
        cornerOrb = undefined;
      }
    };
  }, [box]);
  useLayoutEffect(() => {
    const element = box.current;
    const layer = moving.current;
    if (!landing || element === null || layer === null || stageBox === undefined) {
      return;
    }
    fly({ arriving: "corner", from: stageBox, moving: layer, to: boxOf({ element }) });
  }, [landing, box, moving]);
}
