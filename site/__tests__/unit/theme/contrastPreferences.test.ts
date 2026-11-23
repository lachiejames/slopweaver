/*
 * How a theme change reaches every document: transitions held off while it switches, the listener each root mounts,
 * and the newest-write-wins channel that carries a choice storage refused.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  announcedWrite,
  isLaterWrite,
  nextStampAt,
  type PreferenceEntry,
  type PreferenceWrite,
  parsePreferenceMessage,
  receivePreference,
  STAMP_AT_MAX,
  STAMP_CLOCK_MAX,
} from "../../../lib/preferenceChannel";
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  themeMoves,
} from "../../../lib/theme";
import { sourceFiles } from "./sourceHarness";

describe("contrast on the opaque planes", () => {
  it("holds every transition off while the palette switches, so no text animates from the old ink over the new ground", () => {
    const site = join(import.meta.dirname, "../../..");
    const css = readFileSync(join(site, "app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");
    expect(css).toContain(
      ".sw-appearance-switching, .sw-appearance-switching *, .sw-appearance-switching *::before, .sw-appearance-switching *::after { transition: none !important; }",
    );
    const sync = readFileSync(join(site, "components/console/AppearanceSync.tsx"), "utf8").replaceAll(/\s+/gu, " ");
    expect(sync).toContain('const SWITCHING_CLASS = "sw-appearance-switching";');
    expect(sync).toContain(
      'root.classList.add(SWITCHING_CLASS); if (family !== undefined) { root.setAttribute("data-sw-family", family); } if (mode !== undefined) { root.setAttribute("data-sw-mode", mode); }',
    );
    expect(sync).toContain(
      "document.body.getBoundingClientRect(); window.setTimeout(() => { root.classList.remove(SWITCHING_CLASS); }, 1);",
    );
    // `switchTheme` is the one writer after the boot script: no component sets either attribute any other way.
    const components = join(site, "components");
    const writers = sourceFiles({ dir: components }).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/setAttribute\("data-sw-(?:family|mode)"/gu)].map(() =>
        file.slice(components.length + 1),
      ),
    );
    expect(writers).toEqual(["console/AppearanceSync.tsx", "console/AppearanceSync.tsx"]);
  });

  it("re-reads the theme in every root on another document's change, from its own keys only", () => {
    expect(themeMoves({ key: THEME_FAMILY_STORAGE_KEY })).toBe(true);
    expect(themeMoves({ key: THEME_MODE_STORAGE_KEY })).toBe(true);
    expect(themeMoves({ key: LEGACY_THEME_STORAGE_KEY })).toBe(true);
    expect(themeMoves({ key: null })).toBe(true);
    // The retired glass key may still sit in the owner's storage; a write to it moves nothing.
    expect(themeMoves({ key: "sw-glass-opacity" })).toBe(false);
    expect(themeMoves({ key: "sw-sidebar" })).toBe(false);
    // Both roots mount the one listener: the overlay mounts no picker, so without it the voice over
    // the owner's desktop kept the appearance it booted with.
    const site = join(import.meta.dirname, "../../..");
    expect(readFileSync(join(site, "components/console/Shell.tsx"), "utf8")).toContain("<AppearanceSync />");
    expect(readFileSync(join(site, "app/(overlay)/voice/layout.tsx"), "utf8")).toContain("<AppearanceSync />");
    // A change made between the boot script's read and the listener's mount fired at no listener: the mount re-reads
    // the theme, after the listener is in place so nothing falls between the two.
    expect(readFileSync(join(site, "components/console/AppearanceSync.tsx"), "utf8")).toContain(
      'window.addEventListener("storage", onStorage);\n    joinPreferenceChannel();\n    switchTheme(storedTheme());',
    );
    // A write storage refused fires no `storage` event, so it travels on the channel and is announced as one here.
    const preference = readFileSync(join(site, "components/console/preference.ts"), "utf8");
    expect(preference).toContain('window.dispatchEvent(new StorageEvent("storage", { key }));');
    expect(preference).toContain(
      "entries.set(key, entry);\n  preferenceChannel().postMessage(announcedWrite({ entry, key }) satisfies PreferenceMessage);",
    );
    expect(preference).toContain(
      "const next = receivePreference({ entry: entries.get(message.key), write: message });",
    );
    // A read answers with the newest write known, stored or held, before storage: two stored writes can commit to
    // storage in the opposite order to their stamps, leaving the older value there.
    expect(preference).toContain(
      "const entry = entries.get(key);\n  if (entry !== undefined) {\n    return entry.value;\n  }\n  try {\n    return window.localStorage.getItem(key);",
    );
    expect(preference).not.toContain("entry?.held === true");
    // Every write heard of, newer or not, puts the newest value back where a reversed commit left another — a held
    // one included, since a write overwritten between its write and its read-back reads as held.
    expect(preference).toContain(
      "if (next !== undefined) {\n      entries.set(message.key, next);\n      announce({ key: message.key });\n    }\n    settleStorage({ key: message.key });",
    );
    expect(preference).toContain(
      "if (entry === undefined) {\n    return;\n  }\n  try {\n    if (window.localStorage.getItem(key) !== entry.value) {\n      window.localStorage.setItem(key, entry.value);",
    );
    expect(preference).not.toContain("entry.held) {\n    return;");
  });

  it("settles every document on the newest refused-or-stored write, whatever order the channel delivers them in", () => {
    const key = THEME_FAMILY_STORAGE_KEY;
    const red: PreferenceWrite = { key, kind: "held", stamp: { at: 1000, writer: "a" }, value: "red" };
    const blue: PreferenceWrite = { key, kind: "held", stamp: { at: 1000, writer: "b" }, value: "blue" };
    const stored: PreferenceWrite = { key, kind: "stored", stamp: { at: 999, writer: "c" }, value: "green" };
    /** What one document holds after the writes arrive in this order, each applied as `preference.ts` applies it. */
    const settle = (writes: readonly PreferenceWrite[]): PreferenceEntry | undefined =>
      writes.reduce<PreferenceEntry | undefined>((entry, write) => {
        const next = receivePreference({ entry, write });
        if (next === undefined) {
          return entry;
        }
        return next;
      }, undefined);
    // Two windows refusing at once (the same millisecond): both orders, and a stale `stored` anywhere, settle on blue.
    const orders = [
      [red, blue, stored],
      [blue, red, stored],
      [stored, red, blue],
      [stored, blue, red],
      [red, stored, blue],
      [blue, stored, red],
    ];
    expect(orders.map((order) => settle(order))).toEqual(
      orders.map(() => ({ held: true, stamp: { at: 1000, writer: "b" }, value: "blue" })),
    );
    // A later `stored` replaces a held choice, carrying its value for a document whose own storage cannot be read;
    // an earlier one changes nothing.
    const held: PreferenceEntry = { held: true, stamp: red.stamp, value: "red" };
    expect(receivePreference({ entry: held, write: stored })).toBeUndefined();
    const later: PreferenceWrite = { key, kind: "stored", stamp: { at: 1001, writer: "c" }, value: "green" };
    expect(receivePreference({ entry: held, write: later })).toEqual({
      held: false,
      stamp: { at: 1001, writer: "c" },
      value: "green",
    });
    // An `ask` is answered with the entry itself, so a document opened late settles on the same newest write.
    expect(announcedWrite({ entry: { held: true, stamp: blue.stamp, value: "blue" }, key })).toEqual(blue);
    expect(announcedWrite({ entry: { held: false, stamp: later.stamp, value: "green" }, key })).toEqual(later);
    expect(isLaterWrite({ current: undefined, incoming: red.stamp })).toBe(true);
    expect(isLaterWrite({ current: blue.stamp, incoming: red.stamp })).toBe(false);
    expect(isLaterWrite({ current: red.stamp, incoming: { at: 1001, writer: "a" } })).toBe(true);
    expect(isLaterWrite({ current: red.stamp, incoming: red.stamp })).toBe(false);
  });

  it("reads only well-formed messages off the channel, any document of the origin being able to post on it", () => {
    const stamp = { at: 1000, writer: "a" };
    expect(parsePreferenceMessage({ data: { kind: "ask" } })).toEqual({ kind: "ask" });
    expect(parsePreferenceMessage({ data: { key: "sw-theme-family", kind: "held", stamp, value: "purple" } })).toEqual({
      key: "sw-theme-family",
      kind: "held",
      stamp,
      value: "purple",
    });
    expect(parsePreferenceMessage({ data: { key: "sw-theme-family", kind: "stored", stamp, value: "red" } })).toEqual({
      key: "sw-theme-family",
      kind: "stored",
      stamp,
      value: "red",
    });
    expect(parsePreferenceMessage({ data: { key: "sw-theme-family", kind: "held", stamp } })).toBeUndefined();
    expect(parsePreferenceMessage({ data: { key: "sw-theme-family", kind: "stored", stamp } })).toBeUndefined();
    expect(parsePreferenceMessage({ data: { key: "sw-theme-family", kind: "stored", value: "red" } })).toBeUndefined();
    expect(
      parsePreferenceMessage({
        data: { key: "k", kind: "stored", stamp: { at: Number.NaN, writer: "a" }, value: "red" },
      }),
    ).toBeUndefined();
    expect(
      parsePreferenceMessage({ data: { key: "k", kind: "stored", stamp: { at: 1 }, value: "red" } }),
    ).toBeUndefined();
    // A stamp so late that one more millisecond is the same number would let a writer's next two writes tie.
    expect(Number.MAX_VALUE + 1).toBe(Number.MAX_VALUE);
    expect(STAMP_AT_MAX + 1).not.toBe(STAMP_AT_MAX);
    for (const at of [Number.MAX_VALUE, STAMP_AT_MAX + 1, -1, 1.5]) {
      expect(
        parsePreferenceMessage({ data: { key: "k", kind: "held", stamp: { at, writer: "a" }, value: "red" } }),
      ).toBeUndefined();
    }
    expect(
      parsePreferenceMessage({
        data: { key: "k", kind: "held", stamp: { at: STAMP_AT_MAX, writer: "a" }, value: "red" },
      }),
    ).toEqual({ key: "k", kind: "held", stamp: { at: STAMP_AT_MAX, writer: "a" }, value: "red" });
    expect(parsePreferenceMessage({ data: { kind: "stored", stamp, value: "red" } })).toBeUndefined();
    expect(parsePreferenceMessage({ data: { key: "k", kind: "other", stamp, value: "red" } })).toBeUndefined();
    expect(parsePreferenceMessage({ data: "ask" })).toBeUndefined();
    expect(parsePreferenceMessage({ data: null })).toBeUndefined();
  });

  it("writes the theme and mode only from the owner's own input, or the boot carry", () => {
    // What bounds the one case `settleStorage` does not repair: two DIFFERENT writes to one key take two of the owner's
    // choices, each a press on one of the Settings modal's looks; the boot script writes family and mode only while
    // storage holds neither choice, carrying the legacy key, so any two documents booting at once write the same
    // value. A writer with no person behind it — a sync that stores what it hears, a timer — would make that case
    // routine, and lands here.
    const site = join(import.meta.dirname, "../../..");
    const readers = ["components", "app", "lib"]
      .flatMap((dir) => sourceFiles({ dir: join(site, dir) }))
      .filter((file) =>
        /THEME_FAMILY_STORAGE_KEY|THEME_MODE_STORAGE_KEY|"sw-theme-family"|"sw-theme-mode"/u.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => file.slice(site.length + 1))
      .toSorted();
    expect(readers).toEqual([
      "components/console/AppearanceSync.tsx",
      "components/console/themeChoices.ts",
      "lib/theme.ts",
    ]);
    // The boot script's only writes of these keys: the legacy carry, each guarded on storage holding no choice and
    // writing the value read from the legacy key.
    const themeSource = readFileSync(join(site, "lib/theme.ts"), "utf8");
    expect(themeSource.split("localStorage.setItem(").length - 1).toBe(2);
    expect(themeSource).toContain(
      "else if(sf===null&&old!==null){f=old.family;try{localStorage.setItem(c.familyKey,f);}catch(e){}}",
    );
    expect(themeSource).toContain(
      "else if(sm===null&&old!==null){m=old.mode;try{localStorage.setItem(c.modeKey,m);}catch(e){}}",
    );
    const consoleDir = join(site, "components/console");
    // The one generic writer those `.set(` calls reach, which names no key: `writePreference` stores the choice,
    // called only from `usePreference`'s setter, and `settleStorage` puts back the newest write it heard,
    // called only from the channel's listener — a repair, writing the value a stamp already ordered.
    const generic = readFileSync(join(consoleDir, "preference.ts"), "utf8");
    expect(generic.split("localStorage.setItem(").length - 1).toBe(2);
    expect(generic).toContain("window.localStorage.setItem(key, value);");
    expect(generic).toContain("window.localStorage.setItem(key, entry.value);");
    expect([...generic.matchAll(/(?<!function )writePreference\(\{/gu)].length).toBe(1);
    expect(generic).toMatch(/\(next: T\): void => \{\s*writePreference\(\{ key, value: next \}\);/u);
    expect([...generic.matchAll(/(?<!function )settleStorage\(\{/gu)].length).toBe(1);
    expect(generic).toContain("    settleStorage({ key: message.key });\n  });");
    const sync = readFileSync(join(consoleDir, "AppearanceSync.tsx"), "utf8");
    expect(sync.split(".set(").length - 1).toBe(0);
    // The four keys of a theme are written in one place, its one setter, reached only from a press on a tile.
    const choices = readFileSync(join(consoleDir, "themeChoices.ts"), "utf8");
    expect(choices.split(".set(").length - 1).toBe(4);
    expect(choices).toMatch(/set: \(values\) => \{\s*family\.set\(values\.family\);\s*mode\.set\(values\.mode\);/u);
    const presets = readFileSync(join(consoleDir, "ThemePresets.tsx"), "utf8");
    expect(presets.split(".set(").length - 1).toBe(1);
    expect(presets).toMatch(
      /const wear = \(preset: ThemePreset\): void => \{\s*switchTheme\(\{ family: preset\.family, mode: preset\.mode \}\);\s*choices\.set\(preset\);/u,
    );
    // Each press wears once: `change` a theme not worn, and, since a press on the theme already worn fires no `change`,
    // `click` the worn one, so a first visit wearing the default keeps it once pressed.
    expect(presets).toMatch(/onChange=\{\(\) => \{\s*if \(!worn\) \{\s*onWear\(preset\);/u);
    expect(presets).toMatch(/onClick=\{\(\) => \{\s*if \(worn\) \{\s*onWear\(preset\);/u);
  });

  it("stamps every write below the cap readers enforce, however far the clock runs ahead", () => {
    // The clock, when it has passed what is held; one past what is held, when it has not.
    expect(nextStampAt({ heldAt: undefined, now: 1000 })).toBe(1000);
    expect(nextStampAt({ heldAt: 999, now: 1000 })).toBe(1000);
    expect(nextStampAt({ heldAt: 1000, now: 1000 })).toBe(1001);
    expect(nextStampAt({ heldAt: 1005, now: 1000 })).toBe(1006);
    // A clock at the readers' cap, two writes in its one millisecond. Unclamped, the second
    // was `STAMP_AT_MAX + 1`, which every other document refused, leaving them on the first.
    expect(STAMP_CLOCK_MAX).toBe(2 ** 51);
    const first = nextStampAt({ heldAt: undefined, now: STAMP_AT_MAX });
    const second = nextStampAt({ heldAt: first, now: STAMP_AT_MAX });
    expect(first).toBe(STAMP_CLOCK_MAX);
    expect(second).toBe(STAMP_CLOCK_MAX + 1);
    expect(
      parsePreferenceMessage({
        data: { key: "k", kind: "stored", stamp: { at: second, writer: "a" }, value: "green" },
      }),
    ).toEqual({ key: "k", kind: "stored", stamp: { at: second, writer: "a" }, value: "green" });
    // The writer side reads `nextStampAt`, so the clamp cannot be bypassed by a second copy of the rule.
    const source = readFileSync(join(import.meta.dirname, "../../../components/console/preference.ts"), "utf8");
    expect(source).toContain("nextStampAt({ heldAt: entries.get(key)?.stamp.at, now: Date.now() })");
  });
});
