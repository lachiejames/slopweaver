/**
 * The gaps and gap rechecks one browser walk's page observations raise.
 *
 * Pure: it turns observations into gap rows and recheck rows and nothing else. Reconciling them against the
 * stored generation and publishing the result stays with the browser surface's publisher.
 */
import type { TrelicaPageObservation } from "./browserWalk.js";
import { openTrelicaGap, type TrelicaGapRecheck } from "./gaps.js";
import type { TrelicaAtlasGap } from "./model.js";

/** The gaps one declared page raises, in the order a reader wants them: reach first, then evidence. */
function pageGaps({ page, at }: { page: TrelicaPageObservation; at: string }): readonly TrelicaAtlasGap[] {
  if (!page.attempted) {
    return [
      openTrelicaGap({
        at,
        condition: "browser-page-not-attempted",
        fields: [],
        kind: "page",
        reason: "the walk stopped before this page's turn, so nothing was learned about it either way",
        scope: page.surface,
        surfaces: ["browser"],
      }),
    ];
  }
  if (page.unreachableBecause !== null) {
    return [
      openTrelicaGap({
        at,
        condition: "browser-page-unreachable",
        fields: [],
        kind: "page",
        reason: page.unreachableBecause,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    ];
  }
  const gaps: TrelicaAtlasGap[] = [];
  if (page.screenshotMissingBecause !== null) {
    gaps.push(
      openTrelicaGap({
        at,
        condition: "browser-screenshot-missing",
        fields: [],
        kind: "page",
        reason: page.screenshotMissingBecause,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    );
  }
  if (!page.captureComplete) {
    gaps.push(
      openTrelicaGap({
        at,
        condition: "browser-capture-incomplete",
        fields: [],
        kind: "page",
        reason: `${String(page.responseAccounting.bodyFailed)} of ${String(page.responseAccounting.eligible)} eligible response bodies could not be read, so this page's observed operations understate what it asked for`,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    );
  }
  return gaps;
}

/**
 * Every gap this walk observed, plus the permanent one about the page list itself.
 *
 * @returns the standing page-inventory gap, then each declared page's own gaps in page order
 */
export function observedGaps({
  pages,
  at,
}: {
  pages: readonly TrelicaPageObservation[];
  at: string;
}): readonly TrelicaAtlasGap[] {
  return [
    openTrelicaGap({
      at,
      condition: "provider-publishes-no-page-inventory",
      fields: [],
      kind: "page",
      reason:
        "this platform's own navigation lives behind a menu button rather than in links, and its route table ships in lazily-loaded client bundles, so the declared page list is maintained in `browserPages.ts` rather than read from the vendor. A page shipped tomorrow is absent from it until somebody notices",
      scope: "declared-page-inventory",
      surfaces: ["browser"],
    }),
    ...pages.flatMap((page) => pageGaps({ at, page })),
  ];
}

/**
 * Every declared page's conditions were genuinely rechecked by this walk, so each may close.
 *
 * @returns the four condition rechecks of every attempted page, none for a page the walk never reached
 */
export function rechecks({ pages }: { pages: readonly TrelicaPageObservation[] }): readonly TrelicaGapRecheck[] {
  return pages.flatMap((page): readonly TrelicaGapRecheck[] => {
    if (!page.attempted) {
      return [];
    }
    return [
      { condition: "browser-page-not-attempted", resolved: true, scope: page.surface },
      { condition: "browser-page-unreachable", resolved: page.unreachableBecause === null, scope: page.surface },
      {
        condition: "browser-screenshot-missing",
        resolved: page.screenshotMissingBecause === null,
        scope: page.surface,
      },
      { condition: "browser-capture-incomplete", resolved: page.captureComplete, scope: page.surface },
    ];
  });
}
