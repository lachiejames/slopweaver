/**
 * The console's pages as the tab strip knows them: the icon each tab wears on its left, and the pages the new-tab
 * button offers. Pure; `tabStrip.ts` draws the icon and `tabsShell.ts` pops the menu.
 *
 * The tabs are modelled on Chrome's (an export the strip keeps): an icon, a truncated title sharing the
 * width, and a new-tab button. A console page has no favicon of its own, so a tab's icon is the glyph its section wears
 * in the console's sidebar — the one place the owner already reads those glyphs as pages. `site/lib/sidebarCounts.ts`
 * `SIDEBAR_ENTRIES` is where they are written; the desktop builds apart from `site/` and imports none of it, so they are
 * restated here, and `site/__tests__/unit/tabPagesMirror.test.ts` fails when the two disagree.
 */

/** One console page a tab can be on: where its section starts, the sidebar's glyph for it, and its name. */
export interface TabPage {
  readonly path: string;
  readonly glyph: string;
  readonly label: string;
}

/** Every sidebar page, in the sidebar's order. Settings is not one: it opens as a modal over a page. */
export const TAB_PAGES = [
  { glyph: "☰", label: "Queue", path: "/queue" },
  { glyph: "◇", label: "Alignment", path: "/alignment" },
  { glyph: "⇄", label: "Pull requests", path: "/pull-requests" },
  { glyph: "▰", label: "Workstreams", path: "/workstreams" },
  { glyph: "↻", label: "Automations", path: "/automations" },
  { glyph: "◎", label: "Fleet", path: "/fleet" },
  { glyph: "▦", label: "Store", path: "/store" },
  { glyph: "¶", label: "Docs", path: "/docs" },
] as const satisfies readonly TabPage[];

/**
 * The pages the new-tab button offers: every sidebar page but the Queue, which has exactly one tab, the pinned one
 * (the one static tab that never closes), and is always a
 * click away at the strip's left.
 */
export const NEW_TAB_PAGES: readonly TabPage[] = TAB_PAGES.filter((page) => page.path !== "/queue");

/** The icon of a local page — a briefing — framed in the viewer. */
export const LOCAL_PAGE_GLYPH = "▤";

/** The icon of a console page no sidebar section holds. */
export const OTHER_PAGE_GLYPH = "○";

/**
 * Whether a pathname is a section's own page or under it: `/pull-requests/a/b/1` is in Pull requests, `/fleetx` is not.
 *
 * @returns true when it is
 */
function inSection({ pathname, section }: { pathname: string; section: string }): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * The glyph a pathname's section wears.
 *
 * @returns the glyph, or `undefined` when no section holds it
 */
function sectionGlyph({ pathname }: { pathname: string }): string | undefined {
  return TAB_PAGES.find((page) => inSection({ pathname, section: page.path }))?.glyph;
}

/**
 * The icon a tab on a path wears: its section's sidebar glyph, a pull request's or a fleet session's included; for the
 * viewer, the glyph of the document it frames — the Docs glyph for a docs page, the local-page glyph for a briefing;
 * and a neutral ring for anything else, so every tab has one.
 *
 * @param path the tab's page: path, query and hash
 * @returns one glyph
 */
export function tabIcon({ path }: { path: string }): string {
  const address = new URL(path, "http://console.invalid");
  if (address.pathname !== "/view") {
    const glyph = sectionGlyph({ pathname: address.pathname });
    if (glyph === undefined) {
      return OTHER_PAGE_GLYPH;
    }
    return glyph;
  }
  const src = address.searchParams.get("src");
  if (src === null) {
    return LOCAL_PAGE_GLYPH;
  }
  const framed = sectionGlyph({ pathname: new URL(src, "http://console.invalid").pathname });
  if (framed === undefined) {
    return LOCAL_PAGE_GLYPH;
  }
  return framed;
}
