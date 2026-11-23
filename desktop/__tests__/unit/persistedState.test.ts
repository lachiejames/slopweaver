/**
 * What the shell keeps across a restart: the saved file is decoded field by field, a console path never
 * becomes an external URL, and a window saved onto a display since unplugged opens where you can see it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import {
  type Bounds,
  consolePath,
  consolePathOf,
  decodePersistedState,
  FRESH_STATE,
  windowPlacement,
  withUpdateFields,
} from "../../src/persistedState";

const SAVED = {
  callOpen: true,
  checkout: "/src/slopweaver",
  lastPath: "/automations?tab=health#top",
  version: 1,
  window: { bounds: { height: 900, width: 1400, x: 80, y: 40 }, fullscreen: false, maximised: true },
};

const PENDING = {
  id: "2026-10-10t03-30-00z-1a2b3c4d",
  logPath: "/u/updates/1.log",
  outcomePath: "/u/updates/1.json",
  startedIso: "2026-10-10T03:30:00.000Z",
};

describe("decodePersistedState", () => {
  it("round-trips an update in flight across the quit it causes, and the call owed a restart", () => {
    const value = { ...SAVED, resumeVoice: { sinceIso: "2026-10-10T03:29:58.000Z" }, update: PENDING };
    expect(unwrap(decodePersistedState({ value }))).toEqual(value);
  });

  it("sets and clears the update's two fields, a cleared one absent rather than undefined, and keeps the rest", () => {
    const resumeVoice = { sinceIso: "2026-10-10T03:29:58.000Z" };
    const both = withUpdateFields({ change: { resumeVoice, update: PENDING }, state: FRESH_STATE });
    expect(both).toEqual({ ...FRESH_STATE, resumeVoice, update: PENDING });
    const cleared = withUpdateFields({ change: { update: null }, state: both });
    expect(Object.keys(cleared).toSorted()).toEqual([
      "callOpen",
      "checkout",
      "lastPath",
      "resumeVoice",
      "version",
      "window",
    ]);
    expect(withUpdateFields({ change: {}, state: both })).toEqual(both);
  });

  it("round-trips a saved state", () => {
    const result = decodePersistedState({ value: SAVED });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(SAVED);
  });

  it("round-trips the fresh state", () => {
    expect(unwrap(decodePersistedState({ value: JSON.parse(JSON.stringify(FRESH_STATE)) as unknown }))).toEqual(
      FRESH_STATE,
    );
  });

  it("names the field that failed", () => {
    const cases: readonly { value: unknown; field: string }[] = [
      { field: "version", value: { ...SAVED, version: 2 } },
      { field: "version", value: [] },
      { field: "checkout", value: { ...SAVED, checkout: 4 } },
      { field: "window", value: { ...SAVED, window: "big" } },
      { field: "window.bounds", value: { ...SAVED, window: { ...SAVED.window, bounds: { x: 1 } } } },
      {
        field: "window.bounds",
        value: { ...SAVED, window: { ...SAVED.window, bounds: { ...SAVED.window.bounds, x: Number.NaN } } },
      },
      { field: "window.maximised/fullscreen", value: { ...SAVED, window: { ...SAVED.window, fullscreen: "no" } } },
      { field: "lastPath", value: { ...SAVED, lastPath: "https://example.com/" } },
      { field: "callOpen", value: { ...SAVED, callOpen: "yes" } },
      { field: "tabs", value: { ...SAVED, tabs: "queue" } },
      { field: "tabs", value: { ...SAVED, tabs: [{ path: "https://example.com/", title: "x" }] } },
      { field: "tabs", value: { ...SAVED, tabs: [{ path: "/queue", title: "Queue", url: "/x" }] } },
      { field: "tabs", value: { ...SAVED, tabs: [{ path: "/queue", title: "Q".repeat(513) }] } },
      { field: "tabs", value: { ...SAVED, tabs: Array.from({ length: 101 }, () => ({ path: "/queue", title: "Q" })) } },
      { field: "permissionsDismissed", value: { ...SAVED, permissionsDismissed: "screen" } },
      { field: "permissionsDismissed", value: { ...SAVED, permissionsDismissed: ["camera"] } },
      { field: "permissionsDismissed", value: { ...SAVED, permissionsDismissed: ["screen", "screen"] } },
      { field: "permissionsDismissed", value: { ...SAVED, permissionsDismissed: ["systemaudio"] } },
      { field: "permissionsDismissed", value: { ...SAVED, permissionsDismissed: ["systemAudio", "systemAudio"] } },
      { field: "update", value: { ...SAVED, update: { ...PENDING, outcomePath: "u.json" } } },
      { field: "update", value: { ...SAVED, update: null } },
      { field: "resumeVoice", value: { ...SAVED, resumeVoice: { sinceIso: "after the call" } } },
      { field: "inputControlConsent", value: { ...SAVED, inputControlConsent: "yes" } },
      { field: "inputControlConsent", value: { ...SAVED, inputControlConsent: "Accepted" } },
      { field: "inputControlConsent", value: { ...SAVED, inputControlConsent: true } },
      { field: "inputControlConsent", value: { ...SAVED, inputControlConsent: null } },
    ];
    expect(cases.map(({ value }) => unwrapErr(decodePersistedState({ value })).message)).toEqual(
      cases.map(({ field }) => `the saved window state was malformed at ${field}, so it opened fresh`),
    );
  });

  it("round-trips saved tabs, and reads a state from before tabs with none", () => {
    const tabs = [
      { path: "/queue", title: "Queue" },
      { path: "/pull-requests/lachiejames/slopweaver/1866", title: "#1866" },
    ];
    expect(unwrap(decodePersistedState({ value: { ...SAVED, tabs } }))).toEqual({ ...SAVED, tabs });
    expect(unwrap(decodePersistedState({ value: SAVED })).tabs).toBeUndefined();
  });

  it("round-trips the permissions you said Not now to, and reads a state from before the guide with none", () => {
    const permissionsDismissed = ["microphone", "systemAudio", "screen"];
    expect(unwrap(decodePersistedState({ value: { ...SAVED, permissionsDismissed } }))).toEqual({
      ...SAVED,
      permissionsDismissed,
    });
    // Saved before System Audio Recording joined the guide: read as it was, so the new step raises once.
    expect(
      unwrap(decodePersistedState({ value: { ...SAVED, permissionsDismissed: ["microphone", "screen"] } }))
        .permissionsDismissed,
    ).toEqual(["microphone", "screen"]);
    expect(
      unwrap(decodePersistedState({ value: { ...SAVED, permissionsDismissed: [] } })).permissionsDismissed,
    ).toEqual([]);
    expect(unwrap(decodePersistedState({ value: SAVED })).permissionsDismissed).toBeUndefined();
  });

  it("round-trips the owner's answer to mouse and keyboard control, and reads a state from before the offer as unanswered", () => {
    expect(unwrap(decodePersistedState({ value: { ...SAVED, inputControlConsent: "accepted" } }))).toEqual({
      ...SAVED,
      inputControlConsent: "accepted",
    });
    expect(unwrap(decodePersistedState({ value: { ...SAVED, inputControlConsent: "not-now" } }))).toEqual({
      ...SAVED,
      inputControlConsent: "not-now",
    });
    expect(unwrap(decodePersistedState({ value: SAVED })).inputControlConsent).toBeUndefined();
  });
});

describe("consolePath", () => {
  it("keeps a path with its query and hash", () => {
    expect(consolePath({ path: "/queue?card=abc#links" })).toBe("/queue?card=abc#links");
  });

  it("refuses anything that would leave the console", () => {
    const refused = [
      "https://example.com/",
      "//example.com/queue",
      "/\\example.com",
      "javascript:alert(1)",
      "queue",
      "",
    ];
    expect(refused.map((path) => consolePath({ path }))).toEqual(refused.map(() => undefined));
  });
});

describe("consolePathOf", () => {
  it("reads the path of a console URL", () => {
    expect(consolePathOf({ origin: "http://localhost:3000", url: "http://localhost:3000/voice?x=1" })).toBe(
      "/voice?x=1",
    );
  });

  it("is undefined for another origin, another port, or no URL at all", () => {
    expect(consolePathOf({ origin: "http://localhost:3000", url: "https://github.com/" })).toBe(undefined);
    expect(consolePathOf({ origin: "http://localhost:3000", url: "http://localhost:3001/queue" })).toBe(undefined);
    expect(consolePathOf({ origin: "http://localhost:3000", url: "not a url" })).toBe(undefined);
  });
});

describe("windowPlacement", () => {
  const primary: Bounds = { height: 1000, width: 1600, x: 0, y: 25 };
  const external: Bounds = { height: 1440, width: 2560, x: 1600, y: 0 };
  const centred: Bounds = { height: 860, width: 1320, x: 140, y: 95 };

  it("centres a fresh window on the primary display", () => {
    expect(windowPlacement({ displays: [primary], primary, saved: null })).toEqual(centred);
  });

  it("restores saved bounds that sit on a display", () => {
    const saved: Bounds = { height: 900, width: 1400, x: 1800, y: 100 };
    expect(windowPlacement({ displays: [primary, external], primary, saved })).toEqual(saved);
  });

  it("centres a window saved onto a display that is gone", () => {
    const saved: Bounds = { height: 900, width: 1400, x: 1800, y: 100 };
    expect(windowPlacement({ displays: [primary], primary, saved })).toEqual(centred);
  });

  it("keeps a window exactly half on a display, and moves one less than half on", () => {
    const half: Bounds = { height: 800, width: 1000, x: 1100, y: 100 };
    const less: Bounds = { height: 800, width: 1000, x: 1101, y: 100 };
    expect(windowPlacement({ displays: [primary], primary, saved: half })).toEqual(half);
    expect(windowPlacement({ displays: [primary], primary, saved: less })).toEqual(centred);
  });

  it("centres a window saved smaller than 400 points on a side", () => {
    const saved: Bounds = { height: 399, width: 900, x: 100, y: 100 };
    expect(windowPlacement({ displays: [primary], primary, saved })).toEqual(centred);
  });

  it("fits a fresh window to a primary display smaller than the fresh size", () => {
    const small: Bounds = { height: 700, width: 1024, x: 0, y: 0 };
    expect(windowPlacement({ displays: [small], primary: small, saved: null })).toEqual(small);
  });
});
