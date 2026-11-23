/*
 * The console's appearance: the family list, light and dark, and the storage keys each choice lives under.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_FAMILY,
  DEFAULT_THEME_MODE,
  isThemeFamily,
  isThemeMode,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
} from "../../../lib/theme";
import { THEME_FAMILIES, THEME_MODES } from "../../../lib/themePalettes";

describe("the family list", () => {
  it("lists nine Chrome-profile-style families, the original teal first, and opens a first visit in Night sky's blue", () => {
    expect(THEME_FAMILIES.map((family) => family.id)).toEqual([
      "teal",
      "blue",
      "green",
      "citron",
      "amber",
      "red",
      "rose",
      "purple",
      "graphite",
    ]);
    expect(DEFAULT_THEME_FAMILY).toBe("blue");
  });

  it("has unique labels", () => {
    expect(new Set(THEME_FAMILIES.map((family) => family.label)).size).toBe(THEME_FAMILIES.length);
  });

  it("offers light and dark only, dark by default — never a system mode", () => {
    expect(THEME_MODES).toEqual(["light", "dark"]);
    expect(DEFAULT_THEME_MODE).toBe("dark");
    expect(isThemeMode("system")).toBe(false);
  });

  it("accepts every listed family and mode and nothing else", () => {
    expect(THEME_FAMILIES.every((family) => isThemeFamily(family.id))).toBe(true);
    expect(THEME_MODES.every((mode) => isThemeMode(mode))).toBe(true);
    expect(isThemeFamily("midnight-teal")).toBe(false);
    expect(isThemeFamily(undefined)).toBe(false);
    expect(isThemeFamily("")).toBe(false);
    expect(isThemeMode("")).toBe(false);
  });

  it("keeps each choice under its own key", () => {
    expect([THEME_FAMILY_STORAGE_KEY, THEME_MODE_STORAGE_KEY]).toEqual(["sw-theme-family", "sw-theme-mode"]);
  });
});
