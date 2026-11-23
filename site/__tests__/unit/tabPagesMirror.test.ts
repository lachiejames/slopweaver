/*
 * A desktop tab wears the glyph its page wears in the console's sidebar.
 *
 * `desktop/src/tabPages.ts` restates `site/lib/sidebarCounts.ts`'s `SIDEBAR_ENTRIES` because the desktop builds apart
 * from `site/` and imports none of it; this file, in the lane that reaches both roots, holds the two to one table so a
 * sidebar glyph, label or page changed on one side and missed on the other fails here. The e2e new-tab step's
 * `NEW_TAB_PAGES` (`src/desktop/e2eNewTab.ts`) restates it once more, for the same reason, and is held here too.
 */

import { describe, expect, it } from "vitest";

import { TAB_PAGES, tabIcon } from "../../../desktop/src/tabPages";
import { NEW_TAB_PAGES } from "../../../src/desktop/e2eNewTab";
import { SIDEBAR_ENTRIES } from "../../lib/sidebarCounts";

describe("TAB_PAGES", () => {
  it("is the sidebar's pages, in its order, each with the sidebar's glyph and label", () => {
    const pages = SIDEBAR_ENTRIES.filter((entry) => entry.href !== null).map((entry) => ({
      glyph: entry.glyph,
      label: entry.label,
      path: entry.href,
    }));
    expect(pages.length).toBeGreaterThan(0);
    expect(TAB_PAGES).toEqual(pages);
  });

  it("is what the e2e new-tab step expects the + menu to offer, the Queue aside", () => {
    const offered = TAB_PAGES.filter((page) => page.path !== "/queue");
    expect(offered.length).toBeGreaterThan(0);
    expect(NEW_TAB_PAGES).toEqual(offered.map((page) => ({ glyph: page.glyph, name: page.label, path: page.path })));
  });

  it("gives a tab on each sidebar page the glyph that page's sidebar entry wears", () => {
    const linked = SIDEBAR_ENTRIES.filter((entry) => entry.href !== null);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.map((entry) => tabIcon({ path: entry.href }))).toEqual(linked.map((entry) => entry.glyph));
  });
});
