"use client";

/*
 * The Alignment count, read ONCE for the whole console and handed to both of its readers: the sidebar badge and the
 * page's head. Two calls of `useAlignmentWaiting` would each join the shared channels on their own, and a reader
 * joining after the other gets a provisional reading the first does not, so for one read the head drew a stale mark
 * over the badge's current number. One instance cannot disagree with itself.
 *
 * The hook runs in a SOURCE drawn as the provider's first child, never in the provider itself: React runs a parent's
 * effects after every child's, and the count's reads should subscribe, and so wait for a live slot, ahead of the
 * reads the page opens (`./useAlignmentWaiting.ts`, `../../lib/liveSlots.ts`). The first child's effects run first.
 */

import { createContext, memo, type ReactElement, type ReactNode, useContext, useEffect, useState } from "react";

import { type AlignmentWaiting, useAlignmentWaiting } from "./useAlignmentWaiting";

/** What a reader sees before the source has handed its first value up: nothing measured, so no number. */
const BEFORE_FIRST: AlignmentWaiting = { recovery: { phase: "idle" }, waiting: { phase: "loading" } };

/** `undefined` outside the shell, which is a wiring defect rather than a reading. */
const AlignmentWaitingContext = createContext<AlignmentWaiting | undefined>(undefined);

/**
 * Run the one Alignment hook and hand its value up to the provider. Memoised on its one prop, the state setter React
 * keeps stable, so the provider re-rendering on the value it was just handed never re-renders the source: only the
 * source's own readings do, which is what breaks the hand-up's loop.
 *
 * @param onWaiting the provider's setter
 * @returns nothing drawn
 */
const AlignmentWaitingSource = memo(function AlignmentWaitingSource({
  onWaiting,
}: {
  onWaiting: (value: AlignmentWaiting) => void;
}): null {
  const value = useAlignmentWaiting();
  useEffect(() => {
    onWaiting(value);
  }, [onWaiting, value]);
  return null;
});

/**
 * Read the Alignment count once for everything under it.
 *
 * @param children the console frame
 * @returns the provider
 */
export function AlignmentWaitingProvider({ children }: { children: ReactNode }): ReactElement {
  const [value, setValue] = useState<AlignmentWaiting>(BEFORE_FIRST);
  return (
    <AlignmentWaitingContext.Provider value={value}>
      <AlignmentWaitingSource onWaiting={setValue} />
      {children}
    </AlignmentWaitingContext.Provider>
  );
}

/**
 * The console's one Alignment count, as the sidebar badge and the page head both draw it.
 *
 * @returns the count
 */
export function useSharedAlignmentWaiting(): AlignmentWaiting {
  const value = useContext(AlignmentWaitingContext);
  if (value === undefined) {
    throw new Error(
      "useSharedAlignmentWaiting is drawn outside AlignmentWaitingProvider, which the console frame owns",
    );
  }
  return value;
}
