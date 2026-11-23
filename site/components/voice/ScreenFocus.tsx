"use client";

/**
 * One region of the owner's screen lifted on their ask, everything else dimmed, so a section of the screen comes into
 * focus. The desktop app's window is transparent and
 * cannot blur the apps under it, so the rest is dimmed instead — what makes the one thing stand out.
 *
 * Four dim panels round a hole, never one sheet over it: the hole takes no pointer, so the owner's click on the thing lands in
 * their app beneath, while a tap on the dim drops the highlight (each panel is `data-overlay-interactive`, so the shell
 * takes the pointer over it and nowhere else). Portalled under the widget (z-40, the widget z-45), so the orb stays
 * reachable while it is up. The gate and what drops it are `useScreenFocus.ts`'s; the placement is the shell's.
 */
import { Portal } from "radix-ui";
import type { CSSProperties, ReactElement } from "react";

import type { ScreenFocusShown } from "./useScreenFocus";

/** The looking mood's colour (`EdgeGlow.tsx`), so the lifted region reads as the voice's eyes on it. */
const LOOKING = "oklch(0.86 0.16 95)";

/** The layer: the whole window, under the widget, taking the pointer only where a panel does. */
const LAYER = "pointer-events-none fixed inset-0 z-40";

/** One dim panel: a tap anywhere on it drops the highlight. */
const PANEL = "pointer-events-auto absolute cursor-default bg-black/55";

/**
 * The lifted region and the dim round it.
 *
 * @param shown the region on show, or `undefined` with none
 * @param ready the window covers the whole display, so the rect is the screen's — nothing is drawn in the corner
 * @param onDrop a tap on the dim
 * @returns the dim and the ring, or nothing
 */
export function ScreenFocus({
  shown,
  ready,
  onDrop,
}: {
  shown: ScreenFocusShown | undefined;
  ready: boolean;
  onDrop: () => void;
}): ReactElement | null {
  if (shown === undefined || !ready) {
    return null;
  }
  const { height, left, top, width } = shown.rect;
  const panels: readonly { readonly side: string; readonly style: CSSProperties }[] = [
    { side: "top", style: { height: top, left: 0, right: 0, top: 0 } },
    { side: "bottom", style: { bottom: 0, left: 0, right: 0, top: top + height } },
    { side: "left", style: { height, left: 0, top, width: left } },
    { side: "right", style: { height, left: left + width, right: 0, top } },
  ];
  const ring: CSSProperties = {
    boxShadow: `0 0 0 3px ${LOOKING}, 0 0 28px 6px color-mix(in oklch, ${LOOKING} 60%, transparent)`,
    height,
    left,
    top,
    width,
  };
  return (
    <Portal.Root key={shown.key} data-screen-focus="" className={LAYER}>
      <div className="absolute inset-0 motion-safe:animate-focus-in">
        {panels.map(({ side, style }) => (
          <button
            key={side}
            type="button"
            aria-label="Drop the highlight"
            data-overlay-interactive=""
            className={PANEL}
            style={style}
            onClick={onDrop}
          />
        ))}
        <span aria-hidden="true" className="pointer-events-none absolute rounded-md" style={ring} />
      </div>
    </Portal.Root>
  );
}
