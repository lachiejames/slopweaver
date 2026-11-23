/**
 * What one walk could not answer, as gaps — the honest half of a browser generation.
 *
 * Split from `browserSurface.ts` so the judgement is testable on its own: every function here is pure, takes
 * observations and returns gaps, and none of them writes anything. The publisher folds what these return
 * into what is already stored through the kit's accumulate-never-replace lifecycle.
 *
 * ## Every declared page contributes a RECHECK, whether it succeeded or not
 *
 * A gap closes only when its own `(condition, scope)` pair is genuinely rechecked, so a page that becomes
 * reachable must offer the recheck that closes its old gap. Emitting the gaps without the rechecks would
 * accumulate an open list that never shrinks, which is a report nobody reads twice.
 */
import { absentAs } from "#lib/absent.js";
import { NOTION_BROWSER_PAGES } from "./browserPages.js";
import type { NotionPageObservation } from "./browserWalk.js";
import { type NotionGapCondition, type NotionGapRecheck, openNotionGap } from "./gaps.js";
import type { NotionAtlasGap } from "./model.js";

/** The scope a permanent denominator gap is filed under. */
export const NOTION_INVENTORY_SCOPE = "notion-browser-inventory";

/** Every condition one declared page can raise, so a run can recheck each of them by name. */
const PAGE_CONDITIONS: readonly NotionGapCondition[] = [
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
];

/**
 * The one condition a page's own state raises and the reason line its gap carries, or `null` when the page
 * is fully held. Past the not-attempted branch, each reason is read in the branch that raised its condition,
 * so it is the field that branch just found present. Never a URL — a Notion URL carries the workspace slug.
 */
function pageShortfall({
  page,
}: {
  page: NotionPageObservation;
}): { readonly condition: NotionGapCondition; readonly reason: string } | null {
  const unreachable = page.unreachableBecause;
  if (!page.attempted) {
    return {
      condition: "browser-page-not-attempted",
      reason: absentAs({ value: unreachable, whenAbsent: "the page was not reached" }),
    };
  }
  if (unreachable !== null) {
    return {
      condition: page.redirected ? "browser-page-not-addressable" : "browser-page-unreachable",
      reason: unreachable,
    };
  }
  const screenshotMissing = page.screenshotMissingBecause;
  if (screenshotMissing !== null) {
    return { condition: "browser-screenshot-missing", reason: screenshotMissing };
  }
  if (page.captureComplete) {
    return null;
  }
  const { bodyFailed, bodySucceeded, eligible } = page.responseAccounting;
  return {
    condition: "browser-capture-incomplete",
    reason: `the page was reached and photographed, but ${String(bodyFailed)} of ${String(eligible)} eligible response bodies were lost (${String(bodySucceeded)} kept)`,
  };
}

/**
 * One gap per declared page this walk did not fully hold.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns the gaps, in declaration order
 */
export function walkPageGaps({
  pages,
  at,
}: {
  pages: readonly NotionPageObservation[];
  at: string;
}): readonly NotionAtlasGap[] {
  return pages.flatMap((page): readonly NotionAtlasGap[] => {
    const shortfall = pageShortfall({ page });
    if (shortfall === null) {
      return [];
    }
    return [
      openNotionGap({
        at,
        condition: shortfall.condition,
        fields: [],
        kind: "page",
        reason: shortfall.reason,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    ];
  });
}

/**
 * The permanent gap that says this atlas's browser denominator is a hand list.
 *
 * Notion publishes no manifest of its own settings surface — measured against its own help pages,
 * neither of which documents a deep-link scheme. So a page Notion ships tomorrow is missing from
 * `browserPages.ts` until a person notices, and the honest thing an atlas can do about a gap it cannot close
 * is to be the thing that says the gap is there.
 *
 * @param at this run's ISO timestamp
 * @returns the standing gap, always open
 */
export function inventoryGap({ at }: { at: string }): NotionAtlasGap {
  return openNotionGap({
    at,
    condition: "provider-publishes-no-browser-inventory",
    fields: [],
    kind: "page",
    reason:
      `Notion publishes no manifest of its own settings and admin surface, so this atlas's denominator is the ` +
      `${String(NOTION_BROWSER_PAGES.length)} hand-declared route(s) in browserPages.ts — a surface Notion ships ` +
      `after that list was written is absent from it, and no run can discover the absence`,
    scope: NOTION_INVENTORY_SCOPE,
    surfaces: ["browser"],
  });
}

/**
 * Every `(condition, scope)` pair this walk genuinely rechecked, and what the recheck found.
 *
 * A page that ran at all rechecked every condition it could have raised, so an old gap it no longer raises
 * is CLOSED rather than left standing, and the one it does raise stays open. A page the walk never attempted
 * rechecked nothing — closing its gap on the strength of a run that skipped it is exactly the false closure
 * the lifecycle exists to prevent.
 *
 * @param pages every declared page's observation
 * @returns the rechecks, one per condition per attempted page
 */
export function walkRechecks({ pages }: { pages: readonly NotionPageObservation[] }): readonly NotionGapRecheck[] {
  return pages
    .filter((page) => page.attempted)
    .flatMap((page) => {
      const raised = pageShortfall({ page });
      return PAGE_CONDITIONS.map((condition) => ({
        condition,
        resolved: raised === null || condition !== raised.condition,
        scope: page.surface,
      }));
    });
}
