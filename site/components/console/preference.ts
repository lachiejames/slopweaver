"use client";

/*
 * A choice the browser keeps between visits — the sidebar's shape, the context — read through
 * `useSyncExternalStore` so every component showing it shares one value and a change in one tab reaches
 * the others.
 *
 * Not React state in an effect: a value read from `localStorage` after mount would render the default
 * first and the stored choice a frame later, and the lint lane refuses a `setState` inside an effect for
 * exactly that reason. The server snapshot is the default, so the first paint is the default and React
 * swaps in the stored choice on hydration, once.
 */

import { useCallback, useSyncExternalStore } from "react";

import {
  announcedWrite,
  nextStampAt,
  PREFERENCE_CHANNEL,
  type PreferenceEntry,
  type PreferenceMessage,
  type PreferenceStamp,
  parsePreferenceMessage,
  receivePreference,
} from "../../lib/preferenceChannel";
import { chooseView, withParamReplaced, withParamSet } from "../../lib/workContext";

/** The event a write dispatches so subscribers in this tab re-read; `storage` covers the other tabs. */
const CHANGED = "sw-preference";

/**
 * Subscribe to every write of any preference, and to the URL changing under one that is addressable.
 *
 * `popstate` is in the list because a `param` choice reads the address: without it, moving between two
 * `?context=` links inside the app would leave the old choice on screen until something else re-rendered.
 *
 * @returns the unsubscribe
 */
export function subscribeToPreferences(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * Per key, the newest write this document has made or heard of, with its value, held when storage refused it — a
 * private window's read-only or full storage. Its value is what the key reads as here, so the control and the page
 * it painted keep agreeing until the tab closes, rather than the control snapping back to an older stored value
 * while the page wears the new one; the stamp is what orders it against another document's write
 * (`lib/preferenceChannel.ts`).
 */
const entries = new Map<string, PreferenceEntry>();

/** This document's end of the preference channel, opened on first use and kept for the document's life. */
let channel: BroadcastChannel | undefined;

/** This document's name on the channel, which breaks a tie between two writes made in the same millisecond. */
const writer = crypto.randomUUID();

/**
 * A stamp for a write this document makes now: later than anything held for the key, even within one millisecond,
 * so a choice made here always replaces the one it was made over.
 *
 * @returns the stamp to keep and announce
 */
function nextStamp({ key }: { key: string }): PreferenceStamp {
  return { at: nextStampAt({ heldAt: entries.get(key)?.stamp.at, now: Date.now() }), writer };
}

/**
 * Tell this document's readers a preference moved: a `storage` event naming the key, the event every reader here
 * already listens for, so a choice another document held unwritten reaches them exactly as a stored one does.
 */
function announce({ key }: { key: string }): void {
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

/**
 * Put the newest write for a key back into storage when storage holds another value, each time this document hears
 * a write of that key — never on a timer. Two documents writing one key at once can commit to storage in the opposite
 * order to their stamps, leaving the older value there; every document that hears of either write checks, so while
 * one of them is still open to hear the other, storage that accepts the repair ends on the newest. Storage that
 * refused it and frees up later gets it on the next write heard. A held entry is tried too: a write read back as another value may have been overwritten between
 * the write and the read rather than refused, and storage that does refuse throws or keeps nothing, at no cost.
 * Writes nothing to the channel, so a repair never starts another round.
 *
 * The stamps live in memory and on the channel only, so one case is not repaired: storage committing an earlier
 * write after a later one, and both writers closing before either hears the other. The next window then reads the
 * earlier choice. Every write of the theme and mode is the owner's own input — a press on one of the Settings modal's looks —
 * or the boot script's carry of the legacy key, which writes the same value in every document and only when ITS read
 * of storage held no choice — unstamped, so a window booting in the instant another chooses can overwrite that choice,
 * and the choice comes back only if a window that heard it is still open to answer once the booting window has
 * joined the channel; that takes an old `sw-theme` key still present, which the first window to boot removes. A
 * window's `setItem` hands its commit to the browser in the same task, and the browser applies
 * commits in the order they arrive, so the first of two choices lands after the second only when both are in flight
 * at once — two of the owner's choices in two windows that close together, not choices a window switch apart. Its cost is one
 * setting reverting. Repairing it needs a stamp that outlives its document — a record per window, whose cleanup
 * races in turn — and is a trade, not an omission.
 */
function settleStorage({ key }: { key: string }): void {
  const entry = entries.get(key);
  if (entry === undefined) {
    return;
  }
  try {
    if (window.localStorage.getItem(key) !== entry.value) {
      window.localStorage.setItem(key, entry.value);
    }
  } catch {
    // Storage that cannot be read or written now keeps what it has; this document still reads the entry.
  }
}

/**
 * This document's end of the preference channel, opened on first use: it answers an `ask` with every write it
 * knows of, and keeps another document's write only when it is later than what it holds (`receivePreference`), so
 * every document settles on the same newest choice whatever order writes arrive in. Opening it asks, so a document
 * that loaded after another's refused write still learns of it.
 *
 * @returns the open channel
 */
function preferenceChannel(): BroadcastChannel {
  if (channel !== undefined) {
    return channel;
  }
  const opened = new BroadcastChannel(PREFERENCE_CHANNEL);
  opened.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = parsePreferenceMessage({ data: event.data });
    if (message === undefined) {
      return;
    }
    if (message.kind === "ask") {
      for (const [key, entry] of entries) {
        opened.postMessage(announcedWrite({ entry, key }) satisfies PreferenceMessage);
      }
      return;
    }
    const next = receivePreference({ entry: entries.get(message.key), write: message });
    if (next !== undefined) {
      entries.set(message.key, next);
      announce({ key: message.key });
    }
    settleStorage({ key: message.key });
  });
  opened.postMessage({ kind: "ask" } satisfies PreferenceMessage);
  channel = opened;
  return opened;
}

/**
 * Join the preference channel, so a choice another document's storage refused reaches this one — `AppearanceSync`
 * calls it on mount, after its `storage` listener is in place, so an answer to the opening `ask` has a reader.
 */
export function joinPreferenceChannel(): void {
  preferenceChannel();
}

/**
 * What a preference holds right now: the newest write this document has made or heard of, stored or held, when
 * there is one, else storage's — `null` when neither holds one, or when storage cannot be read at all, which the
 * boot script reads the same way.
 *
 * The newest write wins over storage even when it was stored: two documents writing one key at once can commit to
 * storage in the opposite order to their stamps, leaving the older value in storage while every document has
 * settled on the newer one. Every write goes through `writePreference` and is announced, so storage never holds a
 * choice newer than the entry. A storage cleared by hand is the one thing an entry outlives, until the tab reloads.
 *
 * @returns the held string, or null
 */
export function readPreference({ key }: { key: string }): string | null {
  const entry = entries.get(key);
  if (entry !== undefined) {
    return entry.value;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Keep a choice: in storage when storage reads it straight back, in this visit's memory otherwise — a refused
 * write and a write that cannot be read back both leave the page showing a value storage will not report. Either
 * way the other documents hear of it on the preference channel, since a refused write fires no `storage` event.
 */
function writePreference({ key, value }: { key: string; value: string }): void {
  const stamp = nextStamp({ key });
  let entry: PreferenceEntry = { held: true, stamp, value };
  try {
    window.localStorage.setItem(key, value);
    if (window.localStorage.getItem(key) === value) {
      entry = { held: false, stamp, value };
    }
  } catch {
    // Refused or unreadable: held.
  }
  entries.set(key, entry);
  preferenceChannel().postMessage(announcedWrite({ entry, key }) satisfies PreferenceMessage);
}

/** Nothing to subscribe to: whether the page has hydrated never changes back. */
function subscribeNever(): () => void {
  return () => undefined;
}

/**
 * Whether this render runs in the browser after hydration, rather than on the server or as the hydration render
 * that must match it. A control whose value comes from `usePreference` shows the server snapshot — the default —
 * until then, while the boot script has already painted the stored choice, so it hides itself until this is true
 * rather than naming a choice the page is not wearing.
 *
 * @returns false on the server and during hydration, true after
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * One stored choice, typed by the guard that accepts it.
 *
 * @param key the `localStorage` key
 * @param accept narrows a stored string to the choice's type; anything else falls back
 * @param fallback what a first visit, or a value the guard refuses, reads as
 * @param param the query parameter that addresses this choice, when it has one — the URL wins over
 *   storage for that view, and is never written back to it
 * @param alwaysAddressed the setter writes `param` into the URL even when the URL did not name it, so the choice
 *   just made is the one a bookmark keeps — the context's shape, never the rail's
 * @param whenAbsent what the choice reads as while neither the URL nor `key` holds one — the theme's carry from
 *   an earlier key it may still be reading — instead of `fallback`; a stable reference, since the read depends on it
 * @returns the current choice and its setter — which also rewrites the URL's `param` when the URL names it
 *   (always, under `alwaysAddressed`), because an address left on the old value would override the choice just made
 */
export function usePreference<T extends string>({
  key,
  accept,
  fallback,
  param,
  alwaysAddressed,
  whenAbsent,
}: {
  key: string;
  accept: (value: unknown) => value is T;
  fallback: T;
  param?: string;
  alwaysAddressed?: boolean;
  whenAbsent?: () => T;
}): { readonly value: T; readonly set: (next: T) => void } {
  const read = useCallback((): T => {
    let fromUrl: string | null = null;
    if (param !== undefined) {
      fromUrl = new URLSearchParams(window.location.search).get(param);
    }
    const stored = readPreference({ key });
    if (fromUrl === null && stored === null && whenAbsent !== undefined) {
      return whenAbsent();
    }
    return chooseView({ accept, fallback, fromUrl, stored });
  }, [key, accept, fallback, param, whenAbsent]);
  const value = useSyncExternalStore(subscribeToPreferences, read, () => fallback);
  const set = useCallback(
    (next: T): void => {
      writePreference({ key, value: next });
      if (param !== undefined) {
        const current = { param, search: window.location.search, value: next };
        const search = alwaysAddressed === true ? withParamSet(current) : withParamReplaced(current);
        if (search !== undefined) {
          // `null`, never the entry's own state: Next's patched `replaceState` passes a state carrying its
          // `__NA` marker straight through WITHOUT syncing `useSearchParams`, so the router kept the old
          // `?context=` and wrote it back on the next panel close (next/dist/client/components/app-router.js).
          window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
        }
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [key, param, alwaysAddressed],
  );
  return { set, value };
}
