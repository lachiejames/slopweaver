"use client";

/*
 * The moment the owner last had a page in front of the owner, kept in this browser under that page's own key — the Automations
 * page's (`../../lib/automationsLooked.ts`) and the Fleet page's landed history (`../../lib/landedLooked.ts`).
 *
 * The mark moves when the owner STOPS looking — the tab is hidden, the page is left, or the component unmounts — never
 * when the owner arrives, so while the page is open it counts everything since the owner was last here, and anything that
 * lands while the owner watches is counted too. Read through `useSyncExternalStore` for the reason
 * `components/console/preference.ts` gives: the server snapshot is "no mark", and the stored one swaps in on
 * hydration once.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** Move one key's mark to now; the key doubles as the event this tab re-reads on, and `storage` covers the others. */
function markNow({ key }: { key: string }): void {
  window.localStorage.setItem(key, new Date().toISOString());
  window.dispatchEvent(new Event(key));
}

/**
 * An unmount's mark per key, deferred one task: React re-runs a mount's effects at once in development, and a mark
 * taken on that synthetic unmount would read as a look the moment the page opened. A real remount cancels it.
 */
const pendingUnmountMarks = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * The last-looked mark under one key, moved to now whenever the owner stops looking.
 *
 * @param key the `localStorage` key the page keeps its mark under
 * @returns the ISO instant the owner last looked, or `null` when this browser has never shown the page
 */
export function useLastLooked({ key }: { key: string }): string | null {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(key, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(key, onChange);
      };
    },
    [key],
  );
  const mark = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key),
    () => null,
  );
  useEffect(() => {
    clearTimeout(pendingUnmountMarks.get(key));
    const onHide = (): void => {
      if (document.visibilityState === "hidden") {
        markNow({ key });
      }
    };
    const onPageHide = (): void => {
      markNow({ key });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      pendingUnmountMarks.set(
        key,
        setTimeout(() => {
          markNow({ key });
        }, 0),
      );
    };
  }, [key]);
  return mark;
}
