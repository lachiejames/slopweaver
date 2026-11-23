"use client";

/**
 * The overlay's half of shrinking its window to the corner (`desktop/src/overlayWindow.ts` says why: a window over
 * the whole work area is the one macOS's ⌘⇧5 picker finds above the owner's app, and it refuses the shot). The widget's box
 * is measured from the window's bottom edge and reported with whether anything drawn needs the whole work area; and
 * what does need it waits for the shell's word that the window is the whole work area, so the stage, a screen focus
 * and a page-drawn edge glow never paint into the corner while the shell grows the window. Only the height is
 * measured: the corner's width is the open messenger's static cap (`CORNER_WIDTH`), and the messenger opens in it. Each turn to the whole work area is a
 * numbered ask the shell echoes, so a word it sent before reading the newest ask is never taken for an answer to it.
 *
 * Whole, the window is the primary display, menu bar and Dock included, so the stage reaches the screen's edge; the
 * shell's inset word says where the work area sits inside it, written onto the root as `--sw-inset-{top,right,bottom,
 * left}` so the orb, the panel and the stage's content stay off the menu bar and the Dock in every portal. The shell's
 * floor word says where the widget rests, level with a bottom Dock or clear of an app's bottom bar, written as `--sw-orb-floor`; the
 * widget is measured from it. A shell that sends no floor rests the corner on the work area, so the floor is the
 * inset's bottom edge there.
 *
 * Under a shell that predates the report there is no link, the window is always the whole work area, and the gate is
 * open from the first frame.
 */
import { useCallback, useEffect, useState } from "react";

import { SCREEN_HEIGHT_PROPERTY } from "../../lib/callTrays";
import {
  askedFor,
  FIRST_AREA,
  FIRST_ASK,
  NO_INSET,
  type OverlayArea,
  type OverlayExtent,
  type OverlayInset,
  overlayCovers,
  overlayExtentOf,
} from "../../lib/desktopShellOverlay";

/**
 * The shell's ends of the extent: the report out, its word back on whether the window is whole, and — from a shell
 * whose whole window runs under the menu bar and the Dock — where the work area sits inside it.
 */
export interface OverlayExtentLink {
  readonly report: (extent: OverlayExtent) => void;
  readonly onArea: (listener: (area: OverlayArea) => void) => () => void;
  readonly onInset?: (listener: (inset: OverlayInset) => void) => () => void;
  readonly onFloor?: (listener: (floor: number) => void) => () => void;
}

/** The root's custom property the widget's own CSS rests on. */
const FLOOR_PROPERTY = "--sw-orb-floor";

/** The root's custom property for each inset edge, read by the widget's and the stage's own CSS. */
const INSET_PROPERTIES = {
  bottom: "--sw-inset-bottom",
  left: "--sw-inset-left",
  right: "--sw-inset-right",
  top: "--sw-inset-top",
} as const satisfies Record<keyof OverlayInset, string>;

/** The four edges, in the order the properties are written. */
const INSET_EDGES = ["top", "right", "bottom", "left"] as const satisfies readonly (keyof OverlayInset)[];

/** Where the widget's box sat in the window when last measured, CSS pixels. */
interface WidgetGeometry {
  readonly viewportHeight: number;
  readonly widgetTop: number;
}

/**
 * Measure the widget and report what the overlay needs.
 *
 * @param link the shell's ends of the extent, `undefined` under a shell from before it
 * @param wholeArea something the widget draws spans the display (`overlayWantsWhole`) and needs the whole work area
 * @returns the callback ref that measures the widget's box, and the box it last held, for the orb's place
 *   (`useMessengerPlace`); whether what needs the whole work area may draw now; and whether the extent has gone to the
 *   shell, so the first status — which shows the window — never reaches a shell still holding the whole display for a
 *   page that will ask for a corner
 */
export function useOverlayExtent({ link, wholeArea }: { link: OverlayExtentLink | undefined; wholeArea: boolean }): {
  readonly measureWidget: (element: HTMLElement | null) => void;
  readonly widget: HTMLElement | null;
  readonly covers: boolean;
  readonly reported: boolean;
} {
  const [widget, setWidget] = useState<HTMLElement | null>(null);
  const [geometry, setGeometry] = useState<WidgetGeometry | undefined>(undefined);
  const [area, setArea] = useState(FIRST_AREA);
  const [inset, setInset] = useState(NO_INSET);
  const [sentFloor, setSentFloor] = useState<number | undefined>(undefined);
  let floor = inset.bottom;
  if (sentFloor !== undefined) {
    floor = sentFloor;
  }
  // Moved during render, React's pattern for state derived from a prop, so the gate shuts in the same render that
  // needs the whole work area again rather than a frame later.
  const [heldAsk, setHeldAsk] = useState(FIRST_ASK);
  const ask = askedFor({ before: heldAsk, wholeArea });
  if (ask !== heldAsk) {
    setHeldAsk(ask);
  }
  const measureWidget = useCallback((element: HTMLElement | null) => {
    setWidget(element);
  }, []);
  useEffect(() => link?.onArea(setArea), [link]);
  useEffect(() => link?.onInset?.(setInset), [link]);
  useEffect(() => link?.onFloor?.(setSentFloor), [link]);
  useEffect(() => {
    const root = document.documentElement.style;
    for (const edge of INSET_EDGES) {
      root.setProperty(INSET_PROPERTIES[edge], `${inset[edge]}px`);
    }
  }, [inset]);
  useEffect(() => {
    document.documentElement.style.setProperty(FLOOR_PROPERTY, `${floor}px`);
  }, [floor]);
  // The screen's work-area height, which the card is bounded by (`cardHeightCss`): the window here is the corner, sized
  // off the card, so `100vh` would bound the card by itself. Re-read on a resize, which a zoom fires, and on the
  // screen's own change, which Chromium fires when the window moves to another display — a move the shell makes
  // without resizing when the corner fits both. A link exists only under the desktop shell, so the host is
  // always Electron's Chromium, where `Screen` is an EventTarget; the DOM typings say otherwise, so the guard narrows
  // the type and never branches at run time (a non-Chromium host cannot carry a link).
  useEffect(() => {
    if (link === undefined) {
      return undefined;
    }
    const write = (): void => {
      document.documentElement.style.setProperty(SCREEN_HEIGHT_PROPERTY, `${String(window.screen.availHeight)}px`);
    };
    const display = window.screen;
    write();
    window.addEventListener("resize", write);
    if (display instanceof EventTarget) {
      display.addEventListener("change", write);
    }
    return () => {
      window.removeEventListener("resize", write);
      if (display instanceof EventTarget) {
        display.removeEventListener("change", write);
      }
    };
  }, [link]);
  const measuring = link !== undefined && widget !== null;
  useEffect(() => {
    if (!measuring || widget === null) {
      return undefined;
    }
    const measure = (): void => {
      const next = { viewportHeight: window.innerHeight, widgetTop: widget.getBoundingClientRect().top };
      // The shell's own resize re-measures the same box; an unchanged measure reports nothing again.
      setGeometry((before) => {
        if (before?.viewportHeight === next.viewportHeight && before.widgetTop === next.widgetTop) {
          return before;
        }
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(widget);
    // A resize is the shell moving between its two sizes, or a zoom changing what a CSS pixel is.
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measuring, widget]);
  const { asks } = ask;
  useEffect(() => {
    if (link === undefined) {
      return;
    }
    if (geometry === undefined) {
      // Unmeasured, the corner's height is unknown: only the whole work area can be asked for, and the shell already
      // holds a page that has not reported over it.
      if (wholeArea) {
        link.report({ asks, height: 0, wholeArea });
      }
      return;
    }
    const { viewportHeight, widgetTop } = geometry;
    link.report(overlayExtentOf({ asks, floor, viewportHeight, wholeArea, widgetTop }));
  }, [link, wholeArea, geometry, asks, floor]);
  // Whether the effect above has said what the widget needs, so a status effect declared after it reports second.
  const reported = link === undefined || geometry !== undefined || wholeArea;
  return { covers: link === undefined || overlayCovers({ area, ask }), measureWidget, reported, widget };
}
