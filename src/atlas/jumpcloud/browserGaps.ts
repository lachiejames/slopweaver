/**
 * What one console walk could not answer, as gaps — the honest half of a console generation.
 *
 * Pure: every function takes observations and returns gaps, and the publisher folds them into what is already
 * stored through the kit's accumulate-never-replace lifecycle (`kit/gaps.ts`).
 *
 * ## Every attempted page contributes a RECHECK, whether it succeeded or not
 *
 * A gap closes only when its own `(condition, scope)` pair is rechecked, so a page that becomes reachable
 * must offer the recheck that closes its old gap. A page the walk never attempted rechecks nothing: closing
 * its gap on the strength of a run that skipped it is the false closure the lifecycle exists to prevent.
 */
import type { AtlasGapRecheck } from "../kit/gaps.js";
import { stableGapId } from "../kit/identity.js";

import { JUMPCLOUD_CONSOLE_PAGES } from "./browserPages.js";
import type { JumpcloudPageObservation } from "./browserWalk.js";
import type { JumpcloudConsoleGap, JumpcloudConsoleGapCondition, JumpcloudConsoleKind } from "./consoleModel.js";

/**
 * The scope the standing denominator gap is filed under.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_INVENTORY_SCOPE = "jumpcloud-console-inventory";

/**
 * The scope the standing view-state gap is filed under.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_VIEW_STATE_SCOPE = "jumpcloud-console-view-state";

/** Every condition one declared page can raise, so a run can recheck each of them by name. */
const PAGE_CONDITIONS: readonly JumpcloudConsoleGapCondition[] = [
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
];

/**
 * A console gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing — a declared page's surface name, or a standing scope
 * @param kind the console kind this gap is about, or `null` for a cross-kind gap
 * @param reason why, in English, carrying no URL
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openJumpcloudConsoleGap({
  condition,
  scope,
  kind,
  reason,
  at,
}: {
  condition: JumpcloudConsoleGapCondition;
  scope: string;
  kind: JumpcloudConsoleKind | null;
  reason: string;
  at: string;
}): JumpcloudConsoleGap {
  return {
    condition,
    fields: [],
    firstDetectedAt: at,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: ["admin-console"],
  };
}

/** The one condition a page's own state raises, or `null` when the page is fully held. */
function pageCondition({ page }: { page: JumpcloudPageObservation }): JumpcloudConsoleGapCondition | null {
  if (!page.attempted) {
    return "browser-page-not-attempted";
  }
  if (page.unreachableBecause !== null) {
    return page.redirected ? "browser-page-not-addressable" : "browser-page-unreachable";
  }
  if (page.screenshotMissingBecause !== null || page.artifacts.length === 0) {
    return "browser-screenshot-missing";
  }
  return page.captureComplete ? null : "browser-capture-incomplete";
}

/** The reason line a page's gap carries. */
function pageReason({
  page,
  condition,
}: {
  page: JumpcloudPageObservation;
  condition: JumpcloudConsoleGapCondition;
}): string {
  if (condition === "browser-screenshot-missing") {
    if (page.screenshotMissingBecause !== null) {
      return page.screenshotMissingBecause;
    }
    return "the page was reached but no proof screenshot is held for it";
  }
  if (condition === "browser-capture-incomplete") {
    const { bodyFailed, bodySucceeded, eligible } = page.responseAccounting;
    return `the page was reached and photographed, but ${String(bodyFailed)} of ${String(eligible)} eligible response bodies were lost (${String(bodySucceeded)} kept)`;
  }
  if (page.unreachableBecause !== null) {
    return page.unreachableBecause;
  }
  return "the page was not reached";
}

/**
 * One gap per declared page this walk did not fully hold.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns the gaps, in declaration order
 */
export function consolePageGaps({
  pages,
  at,
}: {
  pages: readonly JumpcloudPageObservation[];
  at: string;
}): readonly JumpcloudConsoleGap[] {
  return pages.flatMap((page): readonly JumpcloudConsoleGap[] => {
    const condition = pageCondition({ page });
    if (condition === null) {
      return [];
    }
    return [
      openJumpcloudConsoleGap({
        at,
        condition,
        kind: "page",
        reason: pageReason({ condition, page }),
        scope: page.surface,
      }),
    ];
  });
}

/**
 * The two standing gaps this surface can never close, said out loud on every walk.
 *
 * @param at this run's ISO timestamp
 * @returns the denominator gap and the view-state gap, always open
 */
export function standingConsoleGaps({ at }: { at: string }): readonly JumpcloudConsoleGap[] {
  return [
    openJumpcloudConsoleGap({
      at,
      condition: "provider-publishes-no-browser-inventory",
      kind: "page",
      reason:
        `JumpCloud publishes no manifest of its administrator console's routes and its navigation fly-outs cannot be ` +
        `opened on a refuse-every-write host, so this surface's denominator is the ` +
        `${String(JUMPCLOUD_CONSOLE_PAGES.length)} hand-declared route(s) in browserPages.ts — a page JumpCloud ` +
        `ships after that list was written is absent from it, and no run can discover the absence`,
      scope: JUMPCLOUD_CONSOLE_INVENTORY_SCOPE,
    }),
    openJumpcloudConsoleGap({
      at,
      condition: "console-view-state-not-addressable",
      kind: "page",
      reason:
        "the console keeps a list's filters, sort and saved view in the client rather than in the address, so no " +
        "declared route can override what the owner's own Chrome restores — a photographed list may be a narrowed view",
      scope: JUMPCLOUD_CONSOLE_VIEW_STATE_SCOPE,
    }),
  ];
}

/**
 * Every `(condition, scope)` pair this walk genuinely rechecked, and what the recheck found.
 *
 * @param pages every declared page's observation
 * @returns the rechecks, one per condition per attempted page
 */
export function consoleRechecks({ pages }: { pages: readonly JumpcloudPageObservation[] }): readonly AtlasGapRecheck[] {
  return pages
    .filter((page) => page.attempted)
    .flatMap((page) => {
      const raised = pageCondition({ page });
      return PAGE_CONDITIONS.map((condition) => ({ condition, resolved: condition !== raised, scope: page.surface }));
    });
}
