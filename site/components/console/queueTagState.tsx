"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { parseTagParams, TAG_PARAM, type TagSelection, withoutTags, withTagSelector } from "../../lib/queueTags";
import { type QueueView, VIEW_PARAM, viewOf, withView } from "../../lib/queueViews";

/**
 * The Queue's tag filter, read from and written to the address and nowhere else — the views are not saved, so there
 * is no stored selection to outlive the link that made it. A write replaces the address in place
 * (Next syncs `useSearchParams` from a patched `replaceState`), the same move the card panel makes, so choosing a
 * tag never refetches the page.
 *
 * Only the Queue's own address carries a selection: on any other page the parameters mean nothing and read as none.
 * The Queue's one selector (`../../lib/queueViews.ts`) rides the same address, so the page's whole reading position is
 * one link.
 *
 * @returns the parsed selection, every raw selector in address order, the view, and the setters
 */
export function useQueueTags(): {
  readonly selection: TagSelection;
  readonly raw: readonly string[];
  readonly toggle: (change: { readonly selector: string; readonly on: boolean }) => void;
  readonly clear: () => void;
  /** The view the address opens on, `all` for none. */
  readonly view: QueueView;
  readonly setView: (view: QueueView) => void;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const onQueue = pathname === "/queue" || pathname === "/queue/";
  let view: QueueView = "all";
  if (onQueue) {
    view = viewOf({ value: params.get(VIEW_PARAM) });
  }
  const setView = useCallback((next: QueueView): void => {
    const search = withView({ search: window.location.search, view: next });
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, []);
  // Keyed on the encoded list so the selection is stable while the address is: every filter below memoises on it.
  // JSON rather than a separator, because a selector may carry any character a separator could be.
  const encoded = JSON.stringify(onQueue ? params.getAll(TAG_PARAM) : []);
  const raw = useMemo((): readonly string[] => {
    const decoded: unknown = JSON.parse(encoded);
    return Array.isArray(decoded) ? decoded.filter((each): each is string => typeof each === "string") : [];
  }, [encoded]);
  const selection = useMemo(() => parseTagParams({ values: raw }), [raw]);
  const toggle = useCallback((change: { readonly selector: string; readonly on: boolean }): void => {
    const search = withTagSelector({ on: change.on, search: window.location.search, selector: change.selector });
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, []);
  const clear = useCallback((): void => {
    const search = withoutTags({ search: window.location.search });
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, []);
  return { clear, raw, selection, setView, toggle, view };
}
