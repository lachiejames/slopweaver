/**
 * The Slack atlas's gap reconciliation: this run's method disagreements and declared-page findings folded into
 * the gaps each kind file already holds. Pure, and the gap half of `./atlasSync.ts`'s generation assembly.
 */
import type { Result } from "../../lib/result.js";
import type { AtlasGap } from "../kit/gaps.js";
import { openGap, reconcileGaps } from "../kit/gaps.js";

import type { SlackAtlasGap } from "./atlasModel.js";
import type { DrivenPage } from "./atlasProjection.js";
import { disagreementGaps, type SurfaceComparison } from "./disagreement.js";
import type { DrivenSession } from "./drivenSession.js";
import { SLACK_SURFACE_PAGES, type SlackSurfacePage, surfacePageKey } from "./surfacePages.js";

/** Widen a kit gap into this atlas's stored gap shape, dropping nothing. */
function storedGap({ gap }: { gap: AtlasGap }): SlackAtlasGap {
  return {
    condition: gap.condition,
    fields: [...gap.fields],
    firstDetectedAt: gap.firstDetectedAt,
    id: gap.id,
    kind: gap.kind === "method" || gap.kind === "page" ? gap.kind : null,
    lastCheckedAt: gap.lastCheckedAt,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
    surfaces: gap.surfaces.filter(
      (surface): surface is "api" | "browser" => surface === "api" || surface === "browser",
    ),
  };
}

/**
 * Fold this run's method-level findings into the gaps already stored.
 *
 * Every method compared this run is offered as a RECHECK, so a disagreement that has since been closed —
 * by an SDK bump that finally declared a parameter the web client always sent — closes rather than
 * lingering. A method nobody compared is neither rechecked nor closed.
 *
 * @param comparisons every comparison this run made
 * @param stored the gaps the method file already holds
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileMethodGaps({
  comparisons,
  stored,
  at,
}: {
  comparisons: readonly SurfaceComparison[];
  stored: readonly SlackAtlasGap[];
  at: string;
}): Result<readonly SlackAtlasGap[]> {
  return reconcileGaps({
    at,
    observed: disagreementGaps({ at, comparisons }).map((gap) => storedGap({ gap })),
    rechecks: comparisons.map((row) => ({
      condition: "api-browser-disagreement",
      resolved: row.paramsBrowserOnly.length === 0 && row.pathsBrowserOnly.length === 0,
      scope: row.method,
    })),
    runFailed: false,
    stored,
  });
}

/** What one declared page came to this run, as the gap pass reads it. */
interface PageOutcome {
  readonly scope: string;
  readonly reached: boolean;
  /** The picture this run holds of it, or the reason it holds none. */
  readonly missingShotBecause: string | null;
}

/**
 * What one declared page came to, judged against what the walk handed back.
 *
 * @param page the declared page
 * @param walked the pages this run stood on, with their screenshots already attached
 * @returns the outcome the gap pass branches on
 */
function outcomeFor({ page, walked }: { page: SlackSurfacePage; walked: readonly DrivenPage[] }): PageOutcome {
  const scope = surfacePageKey({ page });
  const stood = walked.find((row) => row.path === scope);
  if (stood === undefined) {
    return { missingShotBecause: `this run did not stand on ${scope}`, reached: false, scope };
  }
  if (stood.screenshot !== null) {
    return { missingShotBecause: null, reached: true, scope };
  }
  // A page the walk photographed but whose picture `sync` stored none of carries no reason of its own, so the
  // outcome says what is known: this run holds no picture of it.
  const because = stood.screenshotMissingBecause;
  if (because === null) {
    return { missingShotBecause: `this run holds no picture of ${scope}`, reached: true, scope };
  }
  return { missingShotBecause: because, reached: true, scope };
}

/**
 * The gaps one declared page raises this run, and the rechecks that would close them.
 *
 * Split out of {@link reconcilePageGaps} to keep each half readable, and because the four conditions below
 * are the whole vocabulary this kind has — a reader after "why is this page not in the atlas" reads exactly
 * this function.
 *
 * @param page the declared page
 * @param outcome what the walk came to for it
 * @param at this run's ISO timestamp
 * @returns the gaps observed and the rechecks offered
 */
function pageGapsFor({ page, outcome, at }: { page: SlackSurfacePage; outcome: PageOutcome; at: string }): {
  observed: readonly SlackAtlasGap[];
  rechecks: readonly { condition: string; resolved: boolean; scope: string }[];
} {
  const { scope, reached } = outcome;
  if (page.notNavigableBecause !== null) {
    // Permanent by construction, and re-raised every run rather than closed: nothing a future walk does
    // makes a sign-out URL safe to open or gives a rail pane an address.
    return {
      observed: [gapFor({ at, condition: "page-not-addressable", reason: page.notNavigableBecause, scope })],
      rechecks: [],
    };
  }
  if (page.needsAdmin) {
    // An admin page is bounded by the signed-in member's own role, which is a CURRENT bound and not a permanent
    // one (docs/atlas-intent/06-holdings.md). Declared as a gap naming the entitlement, so the atlas stays honest
    // about what its credential could not reach; it closes the moment a walk lands on the page.
    const reason = `${scope} needs a workspace or organisation admin role, and the walk's signed-in session did not reach it`;
    return {
      observed: reached ? [] : [gapFor({ at, condition: "admin-entitlement-missing", reason, scope })],
      rechecks: [{ condition: "admin-entitlement-missing", resolved: reached, scope }],
    };
  }
  const observed: SlackAtlasGap[] = [];
  if (!reached) {
    const reason = `${scope} is declared and this run did not stand on it`;
    observed.push(gapFor({ at, condition: "declared-page-not-walked", reason, scope }));
  }
  const missing = outcome.missingShotBecause;
  const shotOwed = page.screenshot === "required" && missing !== null;
  if (shotOwed) {
    const reason = `${scope} is a page the owner asked to be photographed, and ${missing}`;
    observed.push(gapFor({ at, condition: "required-screenshot-missing", reason, scope }));
  }
  return {
    observed,
    rechecks: [
      { condition: "declared-page-not-walked", resolved: reached, scope },
      { condition: "required-screenshot-missing", resolved: !shotOwed, scope },
    ],
  };
}

/**
 * Fold this run's findings into the page gaps already stored, judged against the DECLARED surface map.
 *
 * Every declared page is considered, not only the ones the walk tried — which is the whole reason the map
 * is declared. A page nobody visited raises `declared-page-not-walked`; one this credential cannot open
 * raises `admin-entitlement-missing`; one the owner asked to be photographed and this run holds no picture
 * of raises `required-screenshot-missing`, carrying the walk's own reason where it gave one.
 *
 * @param session what the driven browser saw, for the destinations it could not reach at all
 * @param walked the pages this run stood on, with their screenshots already attached
 * @param stored the gaps the page file already holds
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcilePageGaps({
  session,
  walked,
  stored,
  at,
}: {
  session: DrivenSession;
  walked: readonly DrivenPage[];
  stored: readonly SlackAtlasGap[];
  at: string;
}): Result<readonly SlackAtlasGap[]> {
  const observed: SlackAtlasGap[] = [];
  const rechecks: { condition: string; resolved: boolean; scope: string }[] = [];
  for (const page of SLACK_SURFACE_PAGES) {
    const raised = pageGapsFor({ at, outcome: outcomeFor({ page, walked }), page });
    observed.push(...raised.observed);
    rechecks.push(...raised.rechecks);
  }
  for (const page of session.unreachable) {
    observed.push(gapFor({ at, condition: "browser-surface-unreadable", reason: page.reason, scope: page.path }));
  }
  for (const page of walked) {
    rechecks.push({ condition: "browser-surface-unreadable", resolved: true, scope: page.path });
  }
  return reconcileGaps({ at, observed, rechecks, runFailed: false, stored });
}

/**
 * One page gap in this atlas's stored shape.
 *
 * @param condition the gap's own condition, which is what a recheck closes it by
 * @param reason what a reader needs to know about it
 * @param scope the page's provider key
 * @param at this run's ISO timestamp
 * @returns the gap
 */
function gapFor({
  condition,
  reason,
  scope,
  at,
}: {
  condition: string;
  reason: string;
  scope: string;
  at: string;
}): SlackAtlasGap {
  return storedGap({ gap: openGap({ at, condition, fields: [], kind: "page", reason, scope, surfaces: ["browser"] }) });
}
