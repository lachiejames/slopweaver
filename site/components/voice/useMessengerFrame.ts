"use client";

/**
 * The widget's frame as the shell crops its window round it: the widget's size and where the orb sits inside it
 * (`messengerFrameOf`, `site/lib/messengerPlace.ts`). Measured on a resize, and whenever the card's side of the orb
 * flips, since a flip moves the orb inside the widget without changing the widget's size.
 */
import { useLayoutEffect, useState } from "react";

import { type MessengerFrame, messengerFrameOf } from "../../lib/messengerPlace";

/**
 * Whether two frames are the same, so an unchanged measure reports nothing again.
 *
 * @param before the frame last measured
 * @param after the frame measured now
 * @returns true when every field matches
 */
function sameFrame({ before, after }: { before: MessengerFrame | undefined; after: MessengerFrame }): boolean {
  return (
    before?.width === after.width &&
    before.height === after.height &&
    before.orbX === after.orbX &&
    before.orbY === after.orbY
  );
}

/**
 * The widget's frame, measured again on a resize and on a flip of the card's side.
 *
 * @param widget the widget's box
 * @param orb the orb's box inside it
 * @param side a key naming the card's side of the orb now, so a flip measures again
 * @returns the frame, `undefined` until both boxes are drawn
 */
export function useMessengerFrame({
  widget,
  orb,
  side,
}: {
  widget: HTMLElement | null;
  orb: HTMLElement | null;
  side: string;
}): MessengerFrame | undefined {
  // The frame is held with the side it was measured on, so a flip measures again.
  const [measured, setMeasured] = useState<{ readonly frame: MessengerFrame; readonly side: string } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    if (widget === null || orb === null) {
      return undefined;
    }
    const measure = (): void => {
      const next = messengerFrameOf({ orb: orb.getBoundingClientRect(), widget: widget.getBoundingClientRect() });
      setMeasured((before) =>
        before?.side === side && sameFrame({ after: next, before: before.frame }) ? before : { frame: next, side },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(widget);
    return () => {
      observer.disconnect();
    };
  }, [widget, orb, side]);
  return measured?.frame;
}
