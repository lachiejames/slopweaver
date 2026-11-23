import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import {
  activateTab,
  backTarget,
  closeTab,
  holdingEntries,
  moveTab,
  openTab,
  parseTabCommand,
  pinnedStrip,
  restoredStrip,
  savedTabs,
  stripMarkup,
  type TabStrip,
  tabTitle,
  updateTab,
} from "../../src/tabStrip";
import { type KeyPress, shortcutTarget, tabShortcut } from "../../src/tabStripKeys";
import {
  parseStripTokens,
  STRIP_GROUND,
  stripDocument,
  stripPaletteOf,
  stripPaletteProperties,
} from "../../src/tabStripLook";

const QUEUE = pinnedStrip({ id: "tab-1", path: "/queue", title: "Queue" });

/**
 * A strip with the Queue pinned and `count` more tabs opened off it, in order, the last one showing.
 *
 * @returns the strip
 */
function queueWith({ count }: { count: number }): TabStrip {
  let strip = QUEUE;
  for (let index = 2; index < count + 2; index += 1) {
    strip = openTab({
      foreground: true,
      strip,
      tab: { id: `tab-${String(index)}`, opener: "tab-1", path: `/p/${String(index)}`, title: `P${String(index)}` },
    });
  }
  return strip;
}

const ids = ({ strip }: { strip: TabStrip }): readonly string[] => strip.tabs.map((tab) => tab.id);

/**
 * A keyDown with no modifier but the ones given.
 *
 * @returns the press
 */
function press({ key, ...held }: { key: string } & Partial<Omit<KeyPress, "key">>): KeyPress {
  return { alt: false, control: false, meta: false, shift: false, type: "keyDown", ...held, key };
}

describe("openTab", () => {
  it("opens a card's link after the Queue and in front, the Queue left where it was", () => {
    const strip = openTab({
      foreground: true,
      strip: QUEUE,
      tab: { id: "tab-2", opener: "tab-1", path: "/pull-requests/a/b/1", title: "#1" },
    });
    expect(ids({ strip })).toEqual(["tab-1", "tab-2"]);
    expect(strip.active).toBe("tab-2");
    expect(strip.tabs[0]).toEqual({ id: "tab-1", opener: undefined, path: "/queue", title: "Queue" });
  });

  it("keeps a run of links off one page together, in the order opened", () => {
    const opened = queueWith({ count: 2 });
    const off = openTab({
      foreground: false,
      strip: opened,
      tab: { id: "tab-9", opener: "tab-1", path: "/x", title: "X" },
    });
    expect(ids({ strip: off })).toEqual(["tab-1", "tab-2", "tab-3", "tab-9"]);
  });

  it("puts a tab opened off a middle tab right after it", () => {
    const strip = openTab({
      foreground: true,
      strip: queueWith({ count: 2 }),
      tab: { id: "tab-9", opener: "tab-2", path: "/x", title: "X" },
    });
    expect(ids({ strip })).toEqual(["tab-1", "tab-2", "tab-9", "tab-3"]);
  });

  it("opens behind on a background open, and last with no opener", () => {
    const strip = openTab({
      foreground: false,
      strip: queueWith({ count: 1 }),
      tab: { id: "tab-9", opener: undefined, path: "/x", title: "X" },
    });
    expect(ids({ strip })).toEqual(["tab-1", "tab-2", "tab-9"]);
    expect(strip.active).toBe("tab-2");
  });
});

describe("closeTab", () => {
  it("never closes the pinned Queue", () => {
    const strip = queueWith({ count: 1 });
    expect(closeTab({ id: "tab-1", strip })).toBe(strip);
  });

  it("closing a page opened off the Queue lands back on the Queue", () => {
    const strip = closeTab({ id: "tab-3", strip: queueWith({ count: 2 }) });
    expect(ids({ strip })).toEqual(["tab-1", "tab-2"]);
    expect(strip.active).toBe("tab-1");
  });

  it("with its opener gone, shows the right-hand neighbour, else the left", () => {
    const orphaned = {
      active: "tab-2",
      tabs: queueWith({ count: 3 }).tabs.map((tab) => ({ ...tab, opener: undefined })),
    };
    expect(closeTab({ id: "tab-2", strip: orphaned }).active).toBe("tab-3");
    const last = { ...orphaned, active: "tab-4" };
    expect(closeTab({ id: "tab-4", strip: last }).active).toBe("tab-3");
  });

  it("hands the closed tab's children to its own opener", () => {
    const nested = openTab({
      foreground: true,
      strip: queueWith({ count: 1 }),
      tab: { id: "tab-9", opener: "tab-2", path: "/x", title: "X" },
    });
    const strip = closeTab({ id: "tab-2", strip: nested });
    expect(strip.tabs.find((tab) => tab.id === "tab-9")!.opener).toBe("tab-1");
    expect(strip.active).toBe("tab-9");
  });
});

describe("moveTab", () => {
  it("reorders a tab to the index it ends at", () => {
    expect(ids({ strip: moveTab({ id: "tab-2", strip: queueWith({ count: 3 }), to: 3 }) })).toEqual([
      "tab-1",
      "tab-3",
      "tab-4",
      "tab-2",
    ]);
  });

  it("never moves the Queue, nor anything in front of it", () => {
    const strip = queueWith({ count: 2 });
    expect(moveTab({ id: "tab-1", strip, to: 2 })).toBe(strip);
    expect(ids({ strip: moveTab({ id: "tab-3", strip, to: 0 }) })).toEqual(["tab-1", "tab-3", "tab-2"]);
  });
});

describe("tabShortcut", () => {
  it("reads the browser's keys", () => {
    expect(tabShortcut({ press: press({ key: "1", meta: true }) })).toEqual({ index: 0, kind: "select" });
    expect(tabShortcut({ press: press({ key: "9", meta: true }) })).toEqual({ kind: "last" });
    expect(tabShortcut({ press: press({ control: true, key: "Tab" }) })).toEqual({ kind: "next" });
    expect(tabShortcut({ press: press({ control: true, key: "Tab", shift: true }) })).toEqual({ kind: "previous" });
    expect(tabShortcut({ press: press({ key: "}", meta: true, shift: true }) })).toEqual({ kind: "next" });
    expect(tabShortcut({ press: press({ key: "[", meta: true, shift: true }) })).toEqual({ kind: "previous" });
    expect(tabShortcut({ press: press({ alt: true, key: "ArrowRight", meta: true }) })).toEqual({ kind: "next" });
    expect(tabShortcut({ press: press({ key: "w", meta: true }) })).toEqual({ kind: "close" });
    expect(tabShortcut({ press: press({ key: "[", meta: true }) })).toEqual({ kind: "back" });
    expect(tabShortcut({ press: press({ key: "]", meta: true }) })).toEqual({ kind: "forward" });
  });

  it("leaves the page its own keys, and acts on key down only", () => {
    expect(tabShortcut({ press: press({ key: "k", meta: true }) })).toBeUndefined();
    expect(tabShortcut({ press: press({ key: "1" }) })).toBeUndefined();
    expect(tabShortcut({ press: press({ key: "Tab" }) })).toBeUndefined();
    expect(tabShortcut({ press: { ...press({ key: "1", meta: true }), type: "keyUp" } })).toBeUndefined();
  });
});

describe("shortcutTarget", () => {
  it("wraps at either end, and a place past the last is no tab", () => {
    const strip = queueWith({ count: 2 });
    expect(shortcutTarget({ shortcut: { kind: "next" }, strip })).toBe("tab-1");
    expect(shortcutTarget({ shortcut: { kind: "previous" }, strip: activateTab({ id: "tab-1", strip }) })).toBe(
      "tab-3",
    );
    expect(shortcutTarget({ shortcut: { index: 1, kind: "select" }, strip })).toBe("tab-2");
    expect(shortcutTarget({ shortcut: { index: 7, kind: "select" }, strip })).toBeUndefined();
    expect(shortcutTarget({ shortcut: { kind: "last" }, strip })).toBe("tab-3");
  });
});

describe("backTarget", () => {
  it("goes back in the tab while it has history", () => {
    expect(backTarget({ canGoBack: true, id: "tab-2", strip: queueWith({ count: 1 }) })).toBe("history");
  });

  it("goes back to the Queue from a pull request opened off a card, with no history of its own", () => {
    expect(backTarget({ canGoBack: false, id: "tab-2", strip: queueWith({ count: 1 }) })).toEqual({ tab: "tab-1" });
  });

  it("goes nowhere from the Queue's first page, or once its opener is closed", () => {
    expect(backTarget({ canGoBack: false, id: "tab-1", strip: QUEUE })).toBeUndefined();
    const gone: TabStrip = {
      active: "tab-3",
      tabs: [QUEUE.tabs[0]!, { id: "tab-3", opener: "tab-2", path: "/x", title: "X" }],
    };
    expect(backTarget({ canGoBack: false, id: "tab-3", strip: gone })).toBeUndefined();
  });
});

describe("holdingEntries", () => {
  it("removes every holding page but the one showing, highest index first", () => {
    const urls = [
      "data:text/html,starting",
      "http://localhost:3001/queue",
      "data:text/html,down",
      "http://localhost:3001/x",
    ];
    expect(holdingEntries({ current: 3, urls })).toEqual([2, 0]);
    expect(holdingEntries({ current: 2, urls })).toEqual([0]);
  });

  it("leaves a history of console pages alone", () => {
    expect(holdingEntries({ current: 1, urls: ["http://localhost:3001/queue", "http://localhost:3001/x"] })).toEqual(
      [],
    );
  });
});

describe("parseTabCommand", () => {
  it("takes exactly the strip's commands", () => {
    expect(parseTabCommand({ value: { kind: "back" } })).toEqual({ kind: "back" });
    expect(parseTabCommand({ value: { id: "tab-2", kind: "close" } })).toEqual({ id: "tab-2", kind: "close" });
    expect(parseTabCommand({ value: { id: "tab-2", kind: "move", to: 3 } })).toEqual({
      id: "tab-2",
      kind: "move",
      to: 3,
    });
    expect(parseTabCommand({ value: { kind: "new-tab", x: 412, y: 31 } })).toEqual({ kind: "new-tab", x: 412, y: 31 });
  });

  it("drops a new-tab command off the strip's own coordinates, or carrying more", () => {
    expect(parseTabCommand({ value: { kind: "new-tab" } })).toBeUndefined();
    expect(parseTabCommand({ value: { kind: "new-tab", x: -1, y: 31 } })).toBeUndefined();
    expect(parseTabCommand({ value: { kind: "new-tab", x: 4.5, y: 31 } })).toBeUndefined();
    expect(parseTabCommand({ value: { kind: "new-tab", x: "412", y: 31 } })).toBeUndefined();
    expect(parseTabCommand({ value: { kind: "new-tab", path: "/fleet", x: 412, y: 31 } })).toBeUndefined();
  });

  it("drops anything else", () => {
    expect(parseTabCommand({ value: { extra: 1, kind: "back" } })).toBeUndefined();
    expect(parseTabCommand({ value: { id: "../etc", kind: "close" } })).toBeUndefined();
    expect(parseTabCommand({ value: { id: "tab-2", kind: "move", to: -1 } })).toBeUndefined();
    expect(parseTabCommand({ value: { id: "tab-2", kind: "move", to: 1.5 } })).toBeUndefined();
    expect(parseTabCommand({ value: "back" })).toBeUndefined();
  });
});

describe("stripMarkup", () => {
  it("escapes a page's title, and gives every tab but the Queue a close", () => {
    const strip = updateTab({
      change: { title: `<img src=x onerror="alert(1)">` },
      id: "tab-2",
      strip: queueWith({ count: 1 }),
    });
    const markup = stripMarkup({ canGoBack: true, canGoForward: false, strip });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).toContain(`data-close="tab-2"`);
    expect(markup).not.toContain(`data-close="tab-1"`);
    expect(markup).toContain(`data-command="forward" aria-label="forward" disabled`);
    expect(markup).toContain(`data-command="back" aria-label="back">`);
  });

  it("puts each tab's page icon on its left, the pinned Queue's included, and the new-tab button after the last tab", () => {
    const strip = openTab({
      foreground: true,
      strip: QUEUE,
      tab: { id: "tab-2", opener: "tab-1", path: "/pull-requests/acme/app/12", title: "acme/app#12" },
    });
    const markup = stripMarkup({ canGoBack: true, canGoForward: false, strip });
    expect(markup).toContain(`<span class="icon" aria-hidden="true">☰</span><span class="title">Queue</span>`);
    expect(markup).toContain(`<span class="icon" aria-hidden="true">⇄</span><span class="title">acme/app#12</span>`);
    expect(markup).not.toContain(`class="pin"`);
    expect(markup).toMatch(
      /data-tab="tab-2".*<\/div><button class="new-tab" type="button" data-command="new-tab" aria-label="new tab" title="New tab">\+<\/button><\/div>$/u,
    );
  });
});

describe("stripDocument", () => {
  it("paints the strip on an opaque ground in each mode, so no desktop shows through it", () => {
    const document = decodeURIComponent(stripDocument());
    expect(document).toContain(`--ground:${STRIP_GROUND.light};`);
    expect(document).toContain(`@media (prefers-color-scheme:dark){:root{--ground:${STRIP_GROUND.dark};`);
    expect(document).toContain("html,body{margin:0;height:100%;background:var(--ground);");
    expect(document).not.toContain("html,body{margin:0;height:100%;background:transparent");
    expect(STRIP_GROUND).toEqual({ dark: "#16181d", light: "#eceef2" });
  });

  it("draws the ground, edge, tabs and tab showing through the six properties a reported look sets", () => {
    const document = decodeURIComponent(stripDocument());
    expect(document).toContain("html,body{margin:0;height:100%;background:var(--ground);");
    expect(document).toContain(";color:var(--ink);-webkit-user-select:none;");
    expect(document).toContain("box-sizing:border-box;border-bottom:1px solid var(--line);-webkit-app-region:drag}");
    expect(document).toContain("border-radius:8px;background:var(--tab);color:var(--muted);cursor:default}");
    expect(document).toContain(".tab.selected{background:var(--on);color:var(--ink);");
  });
});

/**
 * The six colours each look's console page paints, copied from `site/lib/themePalettes.ts`'s `THEME_PALETTES` for the family
 * and mode `site/lib/themePresets.ts` gives that look — the desktop builds apart from `site/` and imports none of it.
 */
const LOOKS = [
  {
    look: "Night sky (blue, dark)",
    tokens: {
      bg: "oklch(0.155 0.02 260)",
      border: "oklch(0.32 0.03 260)",
      card: "oklch(0.195 0.024 260)",
      ink: "oklch(0.95 0.008 260)",
      muted: "oklch(0.72 0.03 260)",
      sidebar: "oklch(0.125 0.02 260)",
    },
  },
  {
    look: "Deep sea (teal, dark)",
    tokens: {
      bg: "oklch(0.145 0.006 250)",
      border: "oklch(0.3 0.01 250)",
      card: "oklch(0.185 0.007 250)",
      ink: "oklch(0.94 0.005 250)",
      muted: "oklch(0.7 0.012 250)",
      sidebar: "oklch(0.115 0.006 250)",
    },
  },
  {
    look: "Ember (amber, dark)",
    tokens: {
      bg: "oklch(0.2 0.012 55)",
      border: "oklch(0.37 0.02 55)",
      card: "oklch(0.245 0.014 55)",
      ink: "oklch(0.93 0.015 80)",
      muted: "oklch(0.77 0.025 70)",
      sidebar: "oklch(0.165 0.012 55)",
    },
  },
  {
    look: "Dusk (purple, dark)",
    tokens: {
      bg: "oklch(0.155 0.024 300)",
      border: "oklch(0.32 0.04 300)",
      card: "oklch(0.195 0.028 300)",
      ink: "oklch(0.95 0.01 300)",
      muted: "oklch(0.74 0.035 300)",
      sidebar: "oklch(0.125 0.022 300)",
    },
  },
  {
    look: "Daylight (graphite, light)",
    tokens: {
      bg: "oklch(0.965 0.002 250)",
      border: "oklch(0.84 0.006 250)",
      card: "oklch(0.99 0.001 250)",
      ink: "oklch(0.27 0.006 250)",
      muted: "oklch(0.45 0.008 250)",
      sidebar: "oklch(0.935 0.003 250)",
    },
  },
] as const;

describe("parseStripTokens", () => {
  it.each(LOOKS)("takes the colours $look paints, exactly", ({ tokens }) => {
    expect(unwrap(parseStripTokens({ value: { ...tokens } }))).toEqual(tokens);
  });

  it("refuses a report missing a colour or carrying one more, or that is no record", () => {
    const { muted: _muted, ...missing } = LOOKS[0].tokens;
    const fields = "a strip palette report is not exactly the fields sidebar, bg, card, border, ink, muted";
    expect(unwrapErr(parseStripTokens({ value: missing }))).toBe(fields);
    expect(unwrapErr(parseStripTokens({ value: { ...LOOKS[0].tokens, primary: "oklch(0.72 0.13 255)" } }))).toBe(
      fields,
    );
    expect(unwrapErr(parseStripTokens({ value: [] }))).toBe(fields);
    expect(unwrapErr(parseStripTokens({ value: "oklch(0.1 0.2 3)" }))).toBe(fields);
    expect(unwrapErr(parseStripTokens({ value: null }))).toBe(fields);
  });

  it("refuses anything but one plain oklch colour, so nothing but a colour reaches the strip's stylesheet", () => {
    const refused = [
      "oklch(0.1 0.2 3);}",
      "oklch(0.1 0.2 3);--ground:red",
      "#fff",
      "red",
      "var(--c-bg)",
      "oklch(10% 0.2 3)",
      "oklch(0.1 0.2 3 / 0.5)",
      "oklch(1e1 0.2 3)",
      "oklch(-0.1 0.2 3)",
      " oklch(0.1 0.2 3)",
      "",
    ];
    const notAColour = "a strip palette report's bg is not one plain oklch(L C H) colour";
    for (const colour of refused) {
      expect(unwrapErr(parseStripTokens({ value: { ...LOOKS[0].tokens, bg: colour } }))).toBe(notAColour);
    }
    expect(unwrapErr(parseStripTokens({ value: { ...LOOKS[0].tokens, bg: 0.155 } }))).toBe(notAColour);
  });
});

describe("stripPaletteOf", () => {
  it("grounds the strip on the look's sidebar, a tab on its page, the tab showing on its card", () => {
    const tokens = {
      bg: "oklch(0.2 0 0)",
      border: "oklch(0.4 0 0)",
      card: "oklch(0.3 0 0)",
      ink: "oklch(0.9 0 0)",
      muted: "oklch(0.7 0 0)",
      sidebar: "oklch(0.1 0 0)",
    };
    expect(stripPaletteOf({ tokens })).toEqual({
      ground: "oklch(0.1 0 0)",
      ink: "oklch(0.9 0 0)",
      line: "oklch(0.4 0 0)",
      muted: "oklch(0.7 0 0)",
      on: "oklch(0.3 0 0)",
      tab: "oklch(0.2 0 0)",
    });
  });

  it("puts Night sky's blue on the strip rather than the neutral grey every dark look wore", () => {
    const palette = stripPaletteOf({ tokens: LOOKS[0].tokens });
    expect(palette.ground).toBe("oklch(0.125 0.02 260)");
    expect(palette.ground).not.toBe(STRIP_GROUND.dark);
  });

  it("gives each look its own strip ground", () => {
    const grounds = LOOKS.map(({ tokens }) => stripPaletteOf({ tokens }).ground);
    expect(new Set(grounds).size).toBe(5);
  });
});

describe("stripPaletteProperties", () => {
  it("names each colour by the custom property the strip's stylesheet reads", () => {
    const palette = stripPaletteOf({ tokens: LOOKS[4].tokens });
    expect(stripPaletteProperties({ palette })).toEqual({
      "--ground": "oklch(0.935 0.003 250)",
      "--ink": "oklch(0.27 0.006 250)",
      "--line": "oklch(0.84 0.006 250)",
      "--muted": "oklch(0.45 0.008 250)",
      "--on": "oklch(0.99 0.001 250)",
      "--tab": "oklch(0.965 0.002 250)",
    });
  });
});

describe("tabTitle", () => {
  it("names a briefing in the viewer by its slug", () => {
    expect(tabTitle({ path: "/view?src=%2Fapi%2Fpage%2Fweekly-briefing%2Findex.html", title: "Slopweaver" })).toBe(
      "weekly briefing",
    );
  });

  it("drops the console's suffix, and falls back to the address", () => {
    expect(tabTitle({ path: "/queue", title: "Queue · the bot" })).toBe("Queue");
    expect(tabTitle({ path: "/queue", title: "  " })).toBe("/queue");
  });

  it("drops only the last suffix, and keeps a title that is all suffix", () => {
    expect(tabTitle({ path: "/pr", title: "a · b · the bot docs" })).toBe("a · b");
    expect(tabTitle({ path: "/x", title: " · the bot" })).toBe("· the bot");
    expect(tabTitle({ path: "/x", title: "A\n · the bot" })).toBe("A");
    expect(tabTitle({ path: "/x", title: "one — · two" })).toBe("one —");
    expect(tabTitle({ path: "/x", title: "one · — two" })).toBe("one ·");
  });

  it("still drops the em dash suffix a window restored from before carries", () => {
    expect(tabTitle({ path: "/queue", title: "Queue — the bot" })).toBe("Queue");
  });
});

describe("restoredStrip", () => {
  const mint = ({ index }: { readonly index: number }): string => `tab-${String(index + 1)}`;

  it("brings every saved tab back with the Queue showing", () => {
    const saved = savedTabs({ strip: queueWith({ count: 2 }) });
    const strip = restoredStrip({ home: "/queue", mint, saved });
    expect(savedTabs({ strip })).toEqual(saved);
    expect(strip.active).toBe("tab-1");
  });

  it("drops a duplicate Queue tab an earlier build saved, keeping the pinned tab and every other page", () => {
    const saved = [
      { path: "/queue", title: "Queue" },
      { path: "/queue?context=slopweaver", title: "Queue" },
      { path: "/alignment", title: "Alignment" },
      { path: "/queue#settings/appearance", title: "Queue" },
      { path: "/queue/", title: "not the Queue" },
    ];
    expect(savedTabs({ strip: restoredStrip({ home: "/queue", mint, saved }) })).toEqual([
      { path: "/queue", title: "Queue" },
      { path: "/alignment", title: "Alignment" },
      { path: "/queue/", title: "not the Queue" },
    ]);
  });

  it("keeps the pinned tab whatever page it was on", () => {
    const saved = [
      { path: "/fleet", title: "Fleet" },
      { path: "/queue", title: "Queue" },
    ];
    expect(savedTabs({ strip: restoredStrip({ home: "/queue", mint, saved }) })).toEqual([
      { path: "/fleet", title: "Fleet" },
    ]);
  });

  it("opens the Queue alone with nothing saved", () => {
    expect(restoredStrip({ home: "/queue", mint, saved: undefined })).toEqual(
      pinnedStrip({ id: "tab-1", path: "/queue", title: "/queue" }),
    );
    expect(restoredStrip({ home: "/queue", mint, saved: [] }).tabs).toHaveLength(1);
  });
});
