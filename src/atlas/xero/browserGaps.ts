/**
 * What one walk could not answer, as gaps — the honest half of a browser generation.
 *
 * Split from `browserSurface.ts` so the judgement is testable on its own: every function here is pure, takes
 * observations and returns gaps, and none of them writes anything. The publisher folds what these return
 * into what is already stored through the kit's accumulate-never-replace lifecycle.
 *
 * ## Every attempted page contributes RECHECKS, whether it succeeded or not
 *
 * A gap closes only when its own `(condition, scope)` pair is genuinely rechecked, so a page that becomes
 * reachable must offer the recheck that closes its old gap. Emitting the gaps without the rechecks would
 * accumulate an open list that never shrinks, which is a report nobody reads twice. A page the walk never
 * attempted contributes none, because a skipped page is no evidence its old gap is gone.
 */
import { XERO_BROWSER_PAGES } from "./browserPages.js";
import type { XeroPageObservation } from "./browserWalk.js";
import { openXeroGap, type XeroGapCondition, type XeroGapRecheck } from "./gaps.js";
import type { XeroAtlasGap } from "./model.js";

/**
 * The scope a permanent denominator gap is filed under.
 *
 * @internal
 */
export const XERO_INVENTORY_SCOPE = "xero-browser-inventory";

/** Every condition one declared page can raise, so a run can recheck each of them by name. */
const PAGE_CONDITIONS: readonly XeroGapCondition[] = [
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
];

/**
 * The one condition a page's own state raises and the reason line its gap carries, or `null` when the page is
 * fully held. Decided together so each reason is read off the very field that raised its condition. The reason
 * is never a URL — a Xero app URL carries the organisation short code.
 */
function pageVerdict({ page }: { page: XeroPageObservation }): { condition: XeroGapCondition; reason: string } | null {
  if (!page.attempted) {
    return { condition: "browser-page-not-attempted", reason: notAttemptedReason({ page }) };
  }
  if (page.unreachableBecause !== null) {
    const condition = page.redirected ? "browser-page-not-addressable" : "browser-page-unreachable";
    return { condition, reason: page.unreachableBecause };
  }
  if (page.screenshotMissingBecause !== null) {
    return { condition: "browser-screenshot-missing", reason: page.screenshotMissingBecause };
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

/** Why a page the walk never attempted was skipped: the reason it recorded, else that it was never reached. */
function notAttemptedReason({ page }: { page: XeroPageObservation }): string {
  if (page.unreachableBecause === null) {
    return "the page was not reached";
  }
  return page.unreachableBecause;
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
  pages: readonly XeroPageObservation[];
  at: string;
}): readonly XeroAtlasGap[] {
  return pages.flatMap((page): readonly XeroAtlasGap[] => {
    const verdict = pageVerdict({ page });
    if (verdict === null) {
      return [];
    }
    return [
      openXeroGap({
        at,
        condition: verdict.condition,
        fields: [],
        kind: "page",
        reason: verdict.reason,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    ];
  });
}

/**
 * The permanent gap that says this atlas's browser denominator is a hand list.
 *
 * Xero publishes no manifest of its own web routes, and its client has migrated in stages, so a surface Xero
 * ships after `browserPages.ts` was written is absent from it until a person notices. The honest thing an
 * atlas can do about a gap it cannot close is to be the thing that says the gap is there.
 *
 * @param at this run's ISO timestamp
 * @returns the standing gap, always open
 */
export function inventoryGap({ at }: { at: string }): XeroAtlasGap {
  return openXeroGap({
    at,
    condition: "provider-publishes-no-browser-inventory",
    fields: [],
    kind: "page",
    reason:
      `Xero publishes no manifest of its own web-client navigation, so this atlas's denominator is the ` +
      `${String(XERO_BROWSER_PAGES.length)} hand-declared route(s) in browserPages.ts and browserPageEntries.ts — ` +
      `a surface Xero ships after that list was written is absent from it, and no run can discover the absence`,
    scope: XERO_INVENTORY_SCOPE,
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
export function walkRechecks({ pages }: { pages: readonly XeroPageObservation[] }): readonly XeroGapRecheck[] {
  return pages
    .filter((page) => page.attempted)
    .flatMap((page) => {
      const raised = pageVerdict({ page })?.condition;
      return PAGE_CONDITIONS.map((condition) => ({ condition, resolved: condition !== raised, scope: page.surface }));
    });
}
