"use client";

/*
 * The one stored choice the Presence tab sets: what fills the orb (`lib/orbPresence.ts`), kept under its own key apart
 * from the theme's, so a press on a theme never changes it and a press on a presence never changes the theme: the presence choice sticks and the theme
 * supplies its colours. A valid `?stage=` preview names a
 * presence in the address, which wins over storage for that view and is never written back to it.
 */

import { useSyncExternalStore } from "react";

import { DEFAULT_PRESENCE, isPresenceId, PRESENCE_STORAGE_KEY, type PresenceId } from "../../lib/orbPresence";
import { presenceWorn } from "../../lib/voiceStage";
import { subscribeToPreferences, usePreference } from "./preference";

/** The current query string, on the client. */
function searchNow(): string {
  return window.location.search;
}

/** No query string, while rendering on the server. */
function searchOnServer(): string {
  return "";
}

/**
 * The presence the orb wears now, and its setter, which keeps it for the next launch and reaches every open window.
 * A valid `?stage=` pin wins, judged by the stage's own parser (`presenceWorn`), so a repeated or unknown `stage` is no
 * pin and the stored choice applies live; the setter writes storage alone, so a pick made in a pinned
 * window never rewrites its address.
 *
 * @returns the presence, and `set`
 */
export function usePresenceChoice(): { readonly value: PresenceId; readonly set: (next: PresenceId) => void } {
  const stored = usePreference({ accept: isPresenceId, fallback: DEFAULT_PRESENCE, key: PRESENCE_STORAGE_KEY });
  const search = useSyncExternalStore(subscribeToPreferences, searchNow, searchOnServer);
  return { set: stored.set, value: presenceWorn({ search, stored: stored.value }) };
}
