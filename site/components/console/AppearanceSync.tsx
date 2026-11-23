"use client";

import { useEffect } from "react";

import {
  LEGACY_THEME_STORAGE_KEY,
  resolveStoredTheme,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  themeMoves,
} from "../../lib/theme";
import type { ThemeFamily, ThemeMode } from "../../lib/themePalettes";
import { joinPreferenceChannel, readPreference } from "./preference";

/**
 * What the preferences hold — a choice storage refused this visit included — resolved by the boot script's own
 * rules (`resolveStoredTheme`).
 *
 * @returns the family and mode the page should wear
 */
export function storedTheme(): { readonly family: ThemeFamily; readonly mode: ThemeMode } {
  return resolveStoredTheme({
    legacy: readPreference({ key: LEGACY_THEME_STORAGE_KEY }),
    storedFamily: readPreference({ key: THEME_FAMILY_STORAGE_KEY }),
    storedMode: readPreference({ key: THEME_MODE_STORAGE_KEY }),
  });
}

/** The class on `<html>` that holds every transition still while the palette changes under it (`console-tw.css`). */
const SWITCHING_CLASS = "sw-appearance-switching";

/**
 * Put a family, a mode or both on `<html>`, where every palette reads them — the one place after the boot script
 * that does. Transitions are held off across the change: an element with a colour transition would otherwise start
 * from the old palette's ink over a ground that has already switched, light ink on light for a moment (about 1:1).
 * Every colour is resolved while they are off, so turning them back on animates nothing.
 */
export function switchTheme({ family, mode }: { family?: ThemeFamily; mode?: ThemeMode }): void {
  const root = document.documentElement;
  root.classList.add(SWITCHING_CLASS);
  if (family !== undefined) {
    root.setAttribute("data-sw-family", family);
  }
  if (mode !== undefined) {
    root.setAttribute("data-sw-mode", mode);
  }
  // A layout read resolves every element's style now, with the transitions off.
  document.body.getBoundingClientRect();
  window.setTimeout(() => {
    root.classList.remove(SWITCHING_CLASS);
  }, 1);
}

/**
 * Keeps a document's appearance in step with a change made in ANOTHER document — a second console tab, or the
 * console window while the desktop voice overlay is open over the owner's desktop. Mounted once per root: in the console's
 * `Shell` and in the overlay's layout, which mounts no picker, so without this the overlay kept the appearance it
 * booted with until it was reloaded.
 *
 * Storage is re-read rather than the event's own `newValue` trusted: two writes in quick succession queue two
 * events, and the first one's value is already stale when it arrives. A change made in THIS document is applied by
 * the control that made it; the browser never fires `storage` at the writer.
 *
 * On mount it also re-reads the theme once, after the listener is in place: a change made between the boot script's read
 * and this mount fired its event at no listener, and would otherwise be missed until the next change. Storage is
 * what the boot script read too, so on a document nothing changed under this writes the values it already wears.
 *
 * A choice the other document's storage REFUSED fires no `storage` event at all; it arrives on the preference
 * channel instead, which `preference.ts` turns into the same `storage` event this listens for. Joining asks every
 * open document for what it holds, so one refused before this document loaded arrives too.
 *
 * @returns nothing visible
 */
export function AppearanceSync(): null {
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (themeMoves({ key: event.key })) {
        switchTheme(storedTheme());
      }
    };
    window.addEventListener("storage", onStorage);
    joinPreferenceChannel();
    switchTheme(storedTheme());
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
