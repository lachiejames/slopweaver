/**
 * The gap every declared admin-console page raises while no walk has visited it. Pure.
 *
 * Split out of `sync.ts`, which assembles the page kind's file around these: the gaps are the whole of what a
 * declared-but-unvisited page publishes, because `kit/read.ts` requires an entity's observations to be
 * non-empty and a page no channel has seen has none. Each gap names the route a walk would take to close it.
 */
import { MICROSOFT365_BROWSER_PAGES, type Microsoft365BrowserPage, microsoft365PageUrl } from "./browserPages.js";
import { openMicrosoft365Gap } from "./gaps.js";
import { MICROSOFT365_PAGE_KIND, type Microsoft365AtlasGap } from "./model.js";

/**
 * Where a reader finds one declared page: its address, or — on the SharePoint console, whose origin embeds
 * the organisation's name and so is resolved only at run time — the console and path it is declared at.
 */
function declaredPageLocation({ page }: { page: Microsoft365BrowserPage }): string {
  const url = microsoft365PageUrl({ page });
  if (url === null) {
    return `${page.console}: ${page.path}`;
  }
  return url;
}

/**
 * One `browser-page-not-attempted` gap per declared page, each naming what the page governs and where it is.
 *
 * @param at this run's ISO timestamp, which a newly opened gap is first detected at
 * @returns the gaps, in the declaration's own order
 */
export function declaredPageGaps({ at }: { at: string }): readonly Microsoft365AtlasGap[] {
  return MICROSOFT365_BROWSER_PAGES.map((page) =>
    openMicrosoft365Gap({
      at,
      condition: "browser-page-not-attempted",
      fields: [],
      kind: MICROSOFT365_PAGE_KIND,
      reason: `declared and never visited: ${page.description} (${declaredPageLocation({ page })})`,
      scope: page.surface,
      surfaces: ["browser"],
    }),
  );
}
