import { describe, expect, it } from "vitest";

import {
  FIND_BAR_FILL,
  FIND_BAR_HEIGHT,
  FIND_BAR_WIDTH,
  findBarBounds,
  findDocument,
  findShortcut,
  findStatus,
  foundAnswer,
  MAX_QUERY,
  parseFindCommand,
} from "../../src/findBar";
import { type KeyPress, tabShortcut } from "../../src/tabStripKeys";
import { STRIP_HEIGHT } from "../../src/tabStripLook";

/**
 * A keyDown with no modifier but the ones given.
 *
 * @returns the press
 */
function press({ key, ...held }: { key: string } & Partial<Omit<KeyPress, "key">>): KeyPress {
  return { alt: false, control: false, meta: false, shift: false, type: "keyDown", ...held, key };
}

describe("findShortcut", () => {
  it("opens the bar on ⌘F", () => {
    expect(findShortcut({ press: press({ key: "f", meta: true }) })).toEqual({ kind: "open" });
  });

  it("steps forward on ⌘G and back on ⌘⇧G, whichever case Electron reports the letter in", () => {
    expect(findShortcut({ press: press({ key: "g", meta: true }) })).toEqual({ kind: "next" });
    expect(findShortcut({ press: press({ key: "G", meta: true, shift: true }) })).toEqual({ kind: "previous" });
    expect(findShortcut({ press: press({ key: "g", meta: true, shift: true }) })).toEqual({ kind: "previous" });
  });

  it("leaves F without ⌘, ⌘⇧F, ⌃⌘F, ⌘⌥F and a key-up to the page", () => {
    expect(findShortcut({ press: press({ key: "f" }) })).toBe(undefined);
    expect(findShortcut({ press: press({ key: "F", meta: true, shift: true }) })).toBe(undefined);
    expect(findShortcut({ press: press({ control: true, key: "f", meta: true }) })).toBe(undefined);
    expect(findShortcut({ press: press({ alt: true, key: "f", meta: true }) })).toBe(undefined);
    expect(findShortcut({ press: { ...press({ key: "f", meta: true }), type: "keyUp" } })).toBe(undefined);
  });

  it("takes no key a tab shortcut takes, so the two never fight over one press", () => {
    const keys = ["f", "g", "1", "9", "w", "[", "]"];
    const overlap = keys.filter(
      (key) =>
        findShortcut({ press: press({ key, meta: true }) }) !== undefined &&
        tabShortcut({ press: press({ key, meta: true }) }) !== undefined,
    );
    expect(overlap).toEqual([]);
  });
});

describe("parseFindCommand", () => {
  it("takes the text typed with its count, and each step and the close", () => {
    expect(parseFindCommand({ value: { kind: "query", seq: 1, text: "slack" } })).toEqual({
      kind: "query",
      seq: 1,
      text: "slack",
    });
    expect(parseFindCommand({ value: { kind: "query", seq: 7, text: "" } })).toEqual({
      kind: "query",
      seq: 7,
      text: "",
    });
    expect(parseFindCommand({ value: { kind: "next" } })).toEqual({ kind: "next" });
    expect(parseFindCommand({ value: { kind: "previous" } })).toEqual({ kind: "previous" });
    expect(parseFindCommand({ value: { kind: "close" } })).toEqual({ kind: "close" });
  });

  it("drops anything not exactly one command", () => {
    expect(parseFindCommand({ value: "next" })).toBe(undefined);
    expect(parseFindCommand({ value: null })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "next", text: "x" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "query" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "query", seq: 1, text: 3 } })).toBe(undefined);
    expect(parseFindCommand({ value: { extra: 1, kind: "query", seq: 1, text: "a" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "navigate", seq: 1, text: "https://example.com" } })).toBe(undefined);
  });

  it("drops a query with no count, or a count that is not a whole number from one", () => {
    expect(parseFindCommand({ value: { kind: "query", text: "a" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "query", seq: 0, text: "a" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "query", seq: 1.5, text: "a" } })).toBe(undefined);
    expect(parseFindCommand({ value: { kind: "query", seq: "1", text: "a" } })).toBe(undefined);
  });

  it("takes text up to the cap and refuses one character past it", () => {
    const longest = "a".repeat(MAX_QUERY);
    expect(parseFindCommand({ value: { kind: "query", seq: 1, text: longest } })).toEqual({
      kind: "query",
      seq: 1,
      text: longest,
    });
    expect(parseFindCommand({ value: { kind: "query", seq: 1, text: `${longest}a` } })).toBe(undefined);
  });
});

describe("foundAnswer", () => {
  it("takes the first report's count and lit match", () => {
    expect(foundAnswer({ answer: undefined, result: { activeMatchOrdinal: 1, matches: 12 } })).toEqual({
      active: 1,
      matches: 12,
    });
  });

  it("keeps the count an update leaves at -1, and the lit match likewise", () => {
    const first = { active: 1, matches: 12 };
    expect(foundAnswer({ answer: first, result: { activeMatchOrdinal: 4, matches: -1 } })).toEqual({
      active: 4,
      matches: 12,
    });
    expect(foundAnswer({ answer: first, result: { activeMatchOrdinal: -1, matches: 13 } })).toEqual({
      active: 1,
      matches: 13,
    });
  });

  it("has no answer until a report carries a count", () => {
    expect(foundAnswer({ answer: undefined, result: { activeMatchOrdinal: 2, matches: -1 } })).toBe(undefined);
  });

  it("never lights a match past the count", () => {
    expect(foundAnswer({ answer: { active: 9, matches: 9 }, result: { activeMatchOrdinal: -1, matches: 3 } })).toEqual({
      active: 3,
      matches: 3,
    });
  });
});

describe("findStatus", () => {
  it("reads which match is lit of how many, as a browser shows it", () => {
    expect(findStatus({ answer: { active: 3, matches: 12 }, query: "slack" })).toEqual({
      canStep: true,
      none: false,
      status: "3 of 12",
    });
  });

  it("says No results, marked, when the page holds none", () => {
    expect(findStatus({ answer: { active: 0, matches: 0 }, query: "zzz" })).toEqual({
      canStep: false,
      none: true,
      status: "No results",
    });
  });

  it("is empty with no text in the bar, or before the page has answered", () => {
    const empty = { canStep: false, none: false, status: "" };
    expect(findStatus({ answer: { active: 1, matches: 4 }, query: "" })).toEqual(empty);
    expect(findStatus({ answer: undefined, query: "slack" })).toEqual(empty);
  });

  it("counts a match not lit yet as the first", () => {
    expect(findStatus({ answer: { active: 0, matches: 5 }, query: "a" }).status).toBe("1 of 5");
  });
});

describe("findBarBounds", () => {
  it("sits at the top right, just under the tab strip", () => {
    expect(findBarBounds({ width: 1200 })).toEqual({
      height: FIND_BAR_HEIGHT,
      width: FIND_BAR_WIDTH,
      x: 1200 - FIND_BAR_WIDTH - 12,
      y: STRIP_HEIGHT + 6,
    });
  });

  it("narrows to fit a window narrower than the bar, never off its left edge", () => {
    expect(findBarBounds({ width: 300 })).toEqual({ height: FIND_BAR_HEIGHT, width: 276, x: 12, y: STRIP_HEIGHT + 6 });
    expect(findBarBounds({ width: 10 })).toEqual({ height: FIND_BAR_HEIGHT, width: 0, x: 0, y: STRIP_HEIGHT + 6 });
  });
});

describe("findDocument", () => {
  const html = decodeURIComponent(findDocument().replace("data:text/html;charset=utf-8,", ""));

  it("is a data: page carrying the field, the count and the three buttons its preload wires", () => {
    expect(findDocument().startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(html).toContain('<input id="query"');
    expect(html).toContain('<span id="count"');
    expect(html).toContain('data-find="previous"');
    expect(html).toContain('data-find="next"');
    expect(html).toContain('data-find="close"');
  });

  it("caps the field at the longest text a query command may carry", () => {
    expect(html).toContain(`maxlength="${MAX_QUERY}"`);
  });

  it("fills the bar and its field opaque in each mode, so the console never reads through them", () => {
    expect(html).toContain(`--panel:${FIND_BAR_FILL.light.panel};`);
    expect(html).toContain(`--field:${FIND_BAR_FILL.light.field}}`);
    expect(html).toContain(`--panel:${FIND_BAR_FILL.dark.panel};`);
    expect(html).toContain(`--field:${FIND_BAR_FILL.dark.field}}}`);
    expect(html).not.toContain("--panel:rgba");
    expect(html).not.toContain("--field:rgba");
    expect(FIND_BAR_FILL).toEqual({
      dark: { field: "#1d1e23", panel: "#26282e" },
      light: { field: "#fff", panel: "#fafafc" },
    });
  });

  it("runs no script of its own, and its policy allows none and loads nothing", () => {
    expect(html.includes("<script")).toBe(false);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  });
});
