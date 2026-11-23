"use client";

/**
 * Where the running list's seen cursor lives in this browser, and the one lock every window takes to change it. The
 * rules for what to write are pure (`../../lib/runningListDraw.ts`); this is the storage they are applied to.
 *
 * Never the console's preference module: that module orders two windows' writes by a clock stamp and a random writer
 * id, and puts the "newer" one back into storage when it hears of it, outside any lock, so a write it ranks newer could
 * bring a cursor down after another window raised it under the lock, and a console still running an
 * older build replays its own cursor over the channel. The key is read and written only here, so the
 * lock alone orders its writes.
 */
import { useSyncExternalStore } from "react";

import {
  RUNNING_LIST_SEEN_KEY,
  RUNNING_LIST_SEEN_UNSET,
  type StorageRead,
  seenCursorFromStorage,
  storageEventIsNews,
} from "../../lib/runningListDraw";

/** The seen cursor as storage holds it this instant, or that storage refused the read. */
function storedSeenCursor(): StorageRead {
  try {
    return { readable: true, value: window.localStorage.getItem(RUNNING_LIST_SEEN_KEY) };
  } catch {
    return { readable: false };
  }
}

/**
 * The last cursor this window wrote or read from storage, read instead of storage while storage refuses it or holds
 * none (`seenCursorFromStorage`).
 */
let lastKnown: string = RUNNING_LIST_SEEN_UNSET;

/** What storage held when this window's last write was refused, `undefined` while its writes land. */
let storedAtRefusal: StorageRead | undefined;

/**
 * Whether the last read could not see storage. Every write is decided on the `seenCursorNow` read just before it,
 * under the same lock, so this says whether that decision was made blind.
 */
let lastReadBlind = false;

/**
 * The seen cursor as it stands this instant.
 *
 * @returns the last cursor this window knew while storage refuses it and nothing else has written, else storage's
 *   when it holds one, else the last cursor this window knew
 */
export function seenCursorNow(): string {
  const stored = storedSeenCursor();
  lastReadBlind = !stored.readable;
  const read = seenCursorFromStorage({ lastKnown, stored, storedAtRefusal });
  if (!read.refusalStands) {
    storedAtRefusal = undefined;
  }
  lastKnown = read.cursor;
  return read.cursor;
}

/** Hear every write of the seen cursor: another window's through the browser, this window's own from `writeSeenCursor`. */
const subscribeSeenCursor: Parameters<typeof useSyncExternalStore>[0] = (onChange) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === RUNNING_LIST_SEEN_KEY || event.key === null) {
      if (event.storageArea !== null && storageEventIsNews({ lastKnown, newValue: event.newValue })) {
        // The browser's own event, so another window's write landed: storage holds a cursor this window's refused
        // write never saw, and wins over it however the refusal's read went. This window's own
        // dispatch below carries no storage area. The event carries that window's cursor, so a window whose own reads
        // are refused still learns it — unless it is older than what this window knows, delivered late
        // from before its own raise.
        storedAtRefusal = undefined;
        lastKnown = event.newValue!;
      }
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
};

/** The cursor a server render draws: unset, since only the browser holds one. */
function seenCursorOnServer(): string {
  return RUNNING_LIST_SEEN_UNSET;
}

/**
 * The seen cursor, redrawn whenever any window writes it.
 *
 * @returns the cursor as it stands
 */
export function useSeenCursor(): string {
  return useSyncExternalStore(subscribeSeenCursor, seenCursorNow, seenCursorOnServer);
}

/**
 * Write the seen cursor straight to storage and tell this window's readers. A storage that refuses the write leaves
 * this window reading the value from memory instead (`lastKnown`) until a write lands, here or in another window.
 */
export function writeSeenCursor({ value }: { value: string }): void {
  lastKnown = value;
  if (lastReadBlind) {
    // The read this was decided on could not see storage, so it came from memory, perhaps behind a write another
    // window made: it stays in memory and never reaches storage, where it could lower that write.
    storedAtRefusal = { readable: false };
    window.dispatchEvent(new StorageEvent("storage", { key: RUNNING_LIST_SEEN_KEY }));
    return;
  }
  try {
    window.localStorage.setItem(RUNNING_LIST_SEEN_KEY, value);
    storedAtRefusal = undefined;
  } catch {
    // Refused: `seenCursorNow` reads `lastKnown` until another window's write is seen or heard.
    storedAtRefusal = storedSeenCursor();
  }
  window.dispatchEvent(new StorageEvent("storage", { key: RUNNING_LIST_SEEN_KEY }));
}

/**
 * Run a read-then-write of the seen cursor under one Web Lock shared by every window of this origin — the console and
 * the overlay both — so no other window writes between this one's read and its write: localStorage
 * alone has no compare-and-set, and its last write wins. The read and the write inside `act` are synchronous, so the
 * lock is held across both.
 */
export function underSeenLock({ act }: { act: () => void }): void {
  void navigator.locks.request(RUNNING_LIST_SEEN_KEY, () => {
    act();
  });
}
