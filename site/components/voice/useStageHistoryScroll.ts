"use client";

/**
 * How the stage's history scrolls, as one transaction (`StageHistory.tsx` draws the rows): it follows the newest turn
 * until the owner scrolls up, holds there with a back-to-live arrow, reopens on the place they were reading, and keeps a turn's
 * edge still when they open or fold it, or opens its time. Every writer of the scroll state lives here, so the order
 * of a follow, a hold and a restore is read in one place.
 */
import { type MouseEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type PlaceKeeper, type ReadingPlace, readingPlaceOf, scrollTopFor } from "../../lib/readingPlace";
import { followsAfterScroll, isAtBottom } from "../../lib/voiceTranscript";

/**
 * The history's scrolling: the list's ref, whether the view is held, and the handlers the rows and the arrow call.
 *
 * @param pin every shown row's id, state and words, joined: the follow runs only when it changes, never on the render
 *   the arrow's own click makes
 * @param place where the owner was reading, kept across every history the widget draws
 * @returns the list's ref, the held flag, the open folds and times, and the scroll and tap handlers
 */
export function useStageHistoryScroll({ pin, place }: { pin: string; place: PlaceKeeper }): {
  readonly backToLive: () => void;
  readonly held: boolean;
  readonly list: RefObject<HTMLOListElement | null>;
  readonly onScroll: () => void;
  readonly opened: ReadonlySet<string>;
  readonly tapBubble: (options: { id: string; event: MouseEvent<HTMLLIElement> }) => void;
  readonly timed: ReadonlySet<string>;
  readonly toggle: (options: { id: string; from: HTMLElement }) => void;
  readonly toggleTime: (options: { id: string; from: HTMLElement }) => void;
} {
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const pinned = useRef("");
  const [held, setHeld] = useState(false);
  // A place kept by the last history drawn, still to be scrolled back to: held until its row is drawn — the earlier
  // turns may still be reading — or until the owner scrolls up, which makes a new place.
  const pending = useRef(place.read() !== undefined);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // The bubbles whose when-it-was-said line is open, apart from the folds: a long turn may be folded and timed at once.
  const [timed, setTimed] = useState<ReadonlySet<string>>(new Set());
  const laidOut = useRef({ opened, timed });
  const anchor = useRef<{ from: HTMLElement; edge: "top" | "bottom"; at: number } | null>(null);
  // Runs, before paint, only when a shown turn moved — never on the render the arrow's own click makes, so its smooth
  // scroll is not cut short by a jump. It scrolls only while following, so a reader holding an earlier
  // line stays there; and a move that left a held history at the bottom with no scroll event — the oldest turn
  // trimmed, say — follows again, as reaching the bottom by hand would.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) {
      // No list, so nothing is pinned or held: whatever list mounts next starts at its foot, however alike it is to
      // the last one.
      pinned.current = "";
      lastTop.current = 0;
      if (!following.current) {
        following.current = true;
        setHeld(false);
      }
      return;
    }
    if (pinned.current === pin) {
      return;
    }
    pinned.current = pin;
    // A list opening with a place kept opens on it, held, as the owner left the last one (`readingPlace.ts`); until its row
    // is drawn the list follows, and the place stays kept.
    if (pending.current) {
      const restored = restorePlace({ element, place: place.read() });
      if (restored !== "absent") {
        pending.current = false;
      }
      if (restored === "held") {
        following.current = false;
        setHeld(true);
        lastTop.current = element.scrollTop;
        return;
      }
    }
    const bottom = isAtBottom({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    });
    if (!following.current && bottom) {
      following.current = true;
      setHeld(false);
    }
    if (following.current) {
      element.scrollTop = element.scrollHeight;
    }
    lastTop.current = element.scrollTop;
  }, [pin, place]);
  // A reflow that changes no turn — the card narrowing, the window growing to the display, a font arriving — still
  // moves the history's height under a reader following it, and `pin` never sees it; so while following, the newest
  // line is put back in view whenever the list or a row changes size. A reader holding an earlier line stays there.
  // Rebuilt after every render, so it always watches the rows the list holds now, whichever turn changed.
  useEffect(() => {
    const element = list.current;
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (!following.current) {
        return;
      }
      element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
    });
    observer.observe(element);
    for (const row of element.children) {
      observer.observe(row);
    }
    return () => {
      observer.disconnect();
    };
  });
  const onScroll = (): void => {
    const element = list.current;
    if (element === null) {
      return;
    }
    const was = following.current;
    following.current = followsAfterScroll({
      atBottom: isAtBottom({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      }),
      following: following.current,
      lastScrollTop: lastTop.current,
      scrollTop: element.scrollTop,
    });
    lastTop.current = element.scrollTop;
    if (!following.current) {
      pending.current = false;
    }
    if (!pending.current) {
      place.keep(placeOf({ element, following: following.current }));
    }
    // Only a change reaches React, never every frame of a smooth scroll.
    if (following.current !== was) {
      setHeld(!following.current);
    }
  };
  const backToLive = (): void => {
    const element = list.current;
    if (element === null) {
      return;
    }
    following.current = true;
    lastTop.current = element.scrollTop;
    pending.current = false;
    place.keep(undefined);
    setHeld(false);
    element.scrollTo({ behavior: "smooth", top: element.scrollHeight });
  };
  // Opening or folding a turn of the owner's, or a bubble's time, is the owner's own act, so it is never scrolled away from: once the
  // new height is laid out, before paint, the turn's kept edge goes back where it was — its top while that is in view,
  // so it grows downward, else its bottom, so a turn above the view grows upward and what the owner is reading stays put
  // — and whether the history still follows is read from where that left the view.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null || (laidOut.current.opened === opened && laidOut.current.timed === timed)) {
      return;
    }
    laidOut.current = { opened, timed };
    const kept = anchor.current;
    anchor.current = null;
    if (kept !== null && kept.from.isConnected) {
      element.scrollTop += edgeOf({ edge: kept.edge, from: kept.from }) - kept.at;
    }
    const was = following.current;
    following.current = isAtBottom({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    });
    lastTop.current = element.scrollTop;
    if (!pending.current) {
      place.keep(placeOf({ element, following: following.current }));
    }
    if (following.current !== was) {
      setHeld(!following.current);
    }
  }, [opened, timed, place]);
  // Which edge of a turn about to change height stays put. A time line opened on the newest bubble while following
  // keeps its bottom, so the line is drawn in view and the history still follows; a fold keeps the rule it always had.
  const keepEdge = ({ from, bottomWhileFollowing }: { from: HTMLElement; bottomWhileFollowing: boolean }): void => {
    const element = list.current;
    if (element === null) {
      return;
    }
    let edge: "top" | "bottom" = "bottom";
    const inView = from.getBoundingClientRect().top >= element.getBoundingClientRect().top;
    if (inView && !(bottomWhileFollowing && following.current)) {
      edge = "top";
    }
    anchor.current = { at: edgeOf({ edge, from }), edge, from };
  };
  const toggle = ({ id, from }: { id: string; from: HTMLElement }): void => {
    keepEdge({ bottomWhileFollowing: false, from });
    setOpened((was) => flipped({ id, set: was }));
  };
  const toggleTime = ({ id, from }: { id: string; from: HTMLElement }): void => {
    keepEdge({ bottomWhileFollowing: true, from });
    setTimed((was) => flipped({ id, set: was }));
  };
  // A click anywhere on a bubble is a tap, but for its fold or a code block's copy, each a button of its own, a link in
  // the voice's rendered reply, and a drag that selected words.
  const tapBubble = ({ id, event }: { id: string; event: MouseEvent<HTMLLIElement> }): void => {
    if (event.target instanceof Element && event.target.closest("a, button") !== null) {
      return;
    }
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) {
      return;
    }
    toggleTime({ from: event.currentTarget, id });
  };
  return { backToLive, held, list, onScroll, opened, tapBubble, timed, toggle, toggleTime };
}

/** Where the owner is reading in a drawn list: the row at its top, or `undefined` while the owner follows the newest turn. */
function placeOf({ element, following }: { element: HTMLElement; following: boolean }): ReadingPlace | undefined {
  if (following) {
    return undefined;
  }
  const rows = [...element.children].flatMap((child) => {
    if (!(child instanceof HTMLElement) || child.dataset["row"] === undefined) {
      return [];
    }
    const box = child.getBoundingClientRect();
    return [{ bottom: box.bottom, row: child.dataset["row"], top: box.top }];
  });
  return readingPlaceOf({ listTop: element.getBoundingClientRect().top, rows });
}

/**
 * Scroll a list opening to a kept place's row, if it holds that row: `absent` leaves the place kept for a later draw,
 * `held` opens the list held on it, and `follows` is a row that could only reach the list's foot, which follows.
 *
 * @returns what became of the place
 */
function restorePlace({
  element,
  place,
}: {
  element: HTMLElement;
  place: ReadingPlace | undefined;
}): "absent" | "held" | "follows" {
  if (place === undefined) {
    return "absent";
  }
  const row = [...element.children].find((child) => child instanceof HTMLElement && child.dataset["row"] === place.row);
  if (row === undefined) {
    return "absent";
  }
  const { held, top } = scrollTopFor({
    listTop: element.getBoundingClientRect().top,
    maxScrollTop: element.scrollHeight - element.clientHeight,
    place,
    rowTop: row.getBoundingClientRect().top,
    scrollTop: element.scrollTop,
  });
  element.scrollTop = top;
  if (held) {
    return "held";
  }
  return "follows";
}

/** A set with one id added, or taken out when it was already there. */
function flipped({ set, id }: { set: ReadonlySet<string>; id: string }): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** Where a turn's kept edge sits in the window, in pixels from its top. */
function edgeOf({ edge, from }: { edge: "top" | "bottom"; from: HTMLElement }): number {
  return from.getBoundingClientRect()[edge];
}
