/*
 * What the stored choices resolve to, and that it agrees with what the boot script paints.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_FAMILY,
  DEFAULT_THEME_MODE,
  LEGACY_THEME_STORAGE_KEY,
  resolveStoredTheme,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
} from "../../../lib/theme";
import { boot } from "./bootHarness";

describe("resolveStoredTheme", () => {
  it("lets a valid stored value win over the earlier id", () => {
    expect(resolveStoredTheme({ legacy: "paper-light", storedFamily: "green", storedMode: "dark" })).toEqual({
      family: "green",
      mode: "dark",
    });
  });

  it("fills each ABSENT half from the earlier id while it is still stored", () => {
    expect(resolveStoredTheme({ legacy: "paper-light", storedFamily: null, storedMode: null })).toEqual({
      family: "teal",
      mode: "light",
    });
    expect(resolveStoredTheme({ legacy: "warm-dark", storedFamily: "red", storedMode: null })).toEqual({
      family: "red",
      mode: "dark",
    });
  });

  it("reads a stored value the guard refuses as the default, never the earlier id", () => {
    expect(resolveStoredTheme({ legacy: "paper-light", storedFamily: "teal", storedMode: "system" })).toEqual({
      family: "teal",
      mode: DEFAULT_THEME_MODE,
    });
  });

  it("opens a first visit on the defaults", () => {
    expect(resolveStoredTheme({ legacy: null, storedFamily: null, storedMode: null })).toEqual({
      family: DEFAULT_THEME_FAMILY,
      mode: DEFAULT_THEME_MODE,
    });
  });

  it("agrees with what the boot script paints, read-only storage included, for every case it is given", () => {
    const cases: readonly { legacy: string | null; storedFamily: string | null; storedMode: string | null }[] = [
      { legacy: null, storedFamily: null, storedMode: null },
      { legacy: "paper-light", storedFamily: null, storedMode: null },
      { legacy: "warm-dark", storedFamily: "red", storedMode: null },
      { legacy: "paper-light", storedFamily: "green", storedMode: "dark" },
      { legacy: "paper-light", storedFamily: null, storedMode: "system" },
      { legacy: "constructor", storedFamily: null, storedMode: null },
      { legacy: null, storedFamily: "purple", storedMode: "light" },
    ];
    expect(cases.length).toBe(7);
    for (const stored of cases) {
      const local: Record<string, string> = {};
      for (const [key, value] of [
        [LEGACY_THEME_STORAGE_KEY, stored.legacy],
        [THEME_FAMILY_STORAGE_KEY, stored.storedFamily],
        [THEME_MODE_STORAGE_KEY, stored.storedMode],
      ] as const) {
        if (value !== null) {
          local[key] = value;
        }
      }
      const painted = boot({ local, localReadOnly: true }).attributes;
      expect({ family: painted["data-sw-family"], mode: painted["data-sw-mode"] }).toEqual(resolveStoredTheme(stored));
    }
  });
});
