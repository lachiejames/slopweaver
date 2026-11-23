/*
 * The boot script that puts the family, the mode and the shell's surface on `<html>` before the first paint.
 */

import { describe, expect, it } from "vitest";

import {
  appearanceBootScript,
  LEGACY_THEME_STORAGE_KEY,
  SURFACE_SESSION_STORAGE_KEY,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
} from "../../../lib/theme";
import { boot } from "./bootHarness";

describe("appearanceBootScript", () => {
  it("opens a first visit in blue, dark, and not as the shell's surface", () => {
    const booted = boot({});
    expect(booted.attributes).toEqual({ "data-sw-family": "blue", "data-sw-mode": "dark" });
    expect(booted.properties).toEqual({});
  });

  it("applies a stored family and mode before the first paint, and nothing for a retired glass opacity", () => {
    const booted = boot({
      local: { "sw-glass-opacity": "40", "sw-theme-family": "purple", "sw-theme-mode": "light" },
    });
    expect(booted.attributes).toEqual({ "data-sw-family": "purple", "data-sw-mode": "light" });
    expect(booted.properties).toEqual({});
    expect(booted.local["sw-glass-opacity"]).toBe("40");
  });

  it("reads each choice on its own: an invalid family keeps a valid mode, and the reverse", () => {
    expect(boot({ local: { "sw-theme-family": "neon", "sw-theme-mode": "light" } }).attributes).toEqual({
      "data-sw-family": "blue",
      "data-sw-mode": "light",
    });
    expect(boot({ local: { "sw-theme-family": "red", "sw-theme-mode": "system" } }).attributes).toEqual({
      "data-sw-family": "red",
      "data-sw-mode": "dark",
    });
  });

  it("carries each earlier theme forward, writes the new pair and drops the old key", () => {
    const booted = boot({ local: { "sw-theme": "warm-dark" } });
    expect(booted.attributes).toEqual({ "data-sw-family": "amber", "data-sw-mode": "dark" });
    expect(booted.local).toEqual({ "sw-theme-family": "amber", "sw-theme-mode": "dark" });
    expect(boot({ local: { "sw-theme": "paper-light" } }).attributes["data-sw-mode"]).toBe("light");
    expect(boot({ local: { "sw-theme": "low-contrast-grey" } }).attributes["data-sw-family"]).toBe("graphite");
    expect(boot({ local: { "sw-theme": "midnight-teal" } }).attributes["data-sw-family"]).toBe("teal");
  });

  it("finishes a carry that died between its two writes, keeping the half already written", () => {
    const resumed = boot({ local: { "sw-theme": "paper-light", "sw-theme-family": "teal" } });
    expect(resumed.attributes).toEqual({ "data-sw-family": "teal", "data-sw-mode": "light" });
    expect(resumed.local).toEqual({ "sw-theme-family": "teal", "sw-theme-mode": "light" });
  });

  it("never lets the old key overwrite a new choice", () => {
    const chosen = boot({ local: { "sw-theme": "paper-light", "sw-theme-family": "green", "sw-theme-mode": "dark" } });
    expect(chosen.attributes).toEqual({ "data-sw-family": "green", "data-sw-mode": "dark" });
    expect(chosen.local[LEGACY_THEME_STORAGE_KEY]).toBeUndefined();
  });

  it("paints a carried theme even when nothing can be written, and keeps the old key to try again", () => {
    const booted = boot({ local: { "sw-theme": "warm-dark" }, localReadOnly: true });
    expect(booted.attributes).toEqual({ "data-sw-family": "amber", "data-sw-mode": "dark" });
    expect(booted.local).toEqual({ "sw-theme": "warm-dark" });
  });

  it("ignores an old value that was never a theme", () => {
    const junk = boot({ local: { "sw-theme": "constructor" } });
    expect(junk.attributes).toEqual({ "data-sw-family": "blue", "data-sw-mode": "dark" });
    expect(junk.local).toEqual({ "sw-theme": "constructor" });
  });

  it("paints the defaults when storage throws", () => {
    const booted = boot({ localThrows: true });
    expect(booted.attributes).toEqual({ "data-sw-family": "blue", "data-sw-mode": "dark" });
  });

  it("reads each key on its own, so one unreadable key costs only its own choice, as the controls read it", () => {
    const booted = boot({
      local: { [THEME_MODE_STORAGE_KEY]: "light" },
      unreadable: [THEME_FAMILY_STORAGE_KEY],
    });
    expect(booted.attributes).toEqual({ "data-sw-family": "blue", "data-sw-mode": "light" });
  });

  it("marks the shell's surface from the query and remembers it for this window", () => {
    const booted = boot({ search: "?sw-surface=native" });
    expect(booted.attributes["data-sw-surface"]).toBe("native");
    expect(booted.session).toEqual({ [SURFACE_SESSION_STORAGE_KEY]: "native" });
  });

  it("keeps the shell's surface across a reload without the query", () => {
    expect(boot({ session: { "sw-surface": "native" } }).attributes["data-sw-surface"]).toBe("native");
  });

  it("marks the surface from the query even when session storage throws", () => {
    expect(boot({ search: "?sw-surface=native", sessionThrows: true }).attributes["data-sw-surface"]).toBe("native");
  });

  it("never marks a browser tab: no query and no remembered surface, or a value that is not native", () => {
    expect(boot({ search: "?sw-surface=browser" }).attributes["data-sw-surface"]).toBeUndefined();
    expect(boot({ session: { "sw-surface": "yes" } }).attributes["data-sw-surface"]).toBeUndefined();
  });

  it("lets a non-native query override a remembered native surface, and forgets it for this window", () => {
    const booted = boot({ search: "?sw-surface=browser", session: { "sw-surface": "native" } });
    expect(booted.attributes["data-sw-surface"]).toBeUndefined();
    expect(booted.session).toEqual({});
  });

  it("leaves the shell's own role attribute alone", () => {
    expect(boot({ attributes: { "data-shell": "overlay" } }).attributes["data-shell"]).toBe("overlay");
  });

  it("never reads the system's light or dark appearance", () => {
    expect(appearanceBootScript()).not.toContain("matchMedia");
    expect(appearanceBootScript()).not.toContain("prefers-color-scheme");
  });
});
