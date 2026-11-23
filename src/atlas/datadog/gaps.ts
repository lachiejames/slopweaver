/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's (`kit/gaps.ts`'s `reconcileGaps`) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked, never because some unrelated pass succeeded. What is this atlas's
 * own is the VOCABULARY below.
 *
 * ## A Datadog gap names ONE channel, where a kit gap names a list of surfaces
 *
 * `documents.ts`'s stored gap carries `channel: DatadogChannel | null` rather than the kit's
 * `surfaces: string[]`, so these are built here rather than through `kit/gaps.ts`'s `openGap`. The id is
 * still `stableGapId({ condition, scope })`, which is what makes the reconciliation shared: `reconcileGaps`
 * is generic over anything carrying the six lifecycle fields, and a Datadog gap carries all six.
 *
 * ## Two of these are OPEN BY CONSTRUCTION, and saying so is the point
 *
 * `api-never-called` and `console-never-walked` cannot be closed by anything the compiled sync does: the
 * first is raised on every successful compile, the second on every compile of a kind whose `console` cell
 * records no success (a walk that corroborated the kind closed it, and `sync.ts` keeps that closure). An
 * atlas whose gap list emptied because the only pass that could run had run would be reporting a
 * completeness it does not have — which is the failure `descriptor.ts`'s header calls "reported N, reached
 * one". The eight `console-*` conditions below it are the walk's own, raised and closed by
 * `consoleSurface.ts` on every run.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import type { DatadogChannel, DatadogGap } from "./documents.js";
import { datadogGapId } from "./identity.js";
import type { DatadogKind } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 * @internal
 */
export const DATADOG_GAP_CONDITIONS = [
  /**
   * The compiled catalogue says what Datadog offers for this kind; nothing has asked THIS organisation for
   * any of it. Permanent until a live pass lands, and the single most important thing this atlas can say
   * about itself today — a compiled operation is a declaration, never a capability.
   */
  "api-never-called",
  /**
   * The live pass issued this kind's paging operations ONCE and kept their first page. Datadog walks under
   * eleven different parameter names across its two versions, and `generated/surfaces.ts` now records each
   * operation's own `pagingParameter`, so this gap can NAME what a follow-on walk has to send rather than
   * saying a collection is "incomplete". Closed by that walk, never by re-running the first page.
   */
  "api-first-page-only",
  /**
   * The live pass admitted an answer through a boundary declaring only the specification's field names and
   * kinds (`responseBoundary.ts`'s `spec-names-only`), because no census had measured that operation answering.
   * A renamed key is still refused, but every value under those names went unread. Closed by a fresh census and
   * the boundaries regenerated from it, never by re-running the same pass.
   */
  "api-response-boundary-unmeasured",
  /**
   * This kind carries entity operations that take an identifier in their path, and the fan-out that would
   * supply one from an already-stored entity has not been built. For 16 kinds every entity operation is of
   * this shape, so the kind is reachable through NO call this pass can make — which is a different
   * statement from an empty organisation and has to read as one.
   */
  "api-fanout-unbuilt",
  /**
   * This kind carries shape-index operations and the windowed pass that issues them has not been built.
   * A shape index needs a bounded time window the registry does not carry and folds into a different
   * schema, so it is a separate act rather than this pass with a different projection.
   */
  "api-shape-index-unbuilt",
  /**
   * No console call this kind's operations answer has been observed: either no walk has run, or the walk
   * ran and the console never called an endpoint the registry declares under this kind. Closed per kind by
   * `consoleSurface.ts` the moment a walk observes one.
   */
  "console-never-walked",
  /** A declared console page did not render — redirected, 404, an error code, or a failed visit. */
  "console-page-unreachable",
  /** A page was reached but photographed mid-load, so its capture is a loading frame rather than a picture. */
  "console-page-unphotographed",
  /** A page lost at least one response body, so what the console asked for on it is recorded incompletely. */
  "console-response-body-lost",
  /** A visit settled on a console path `consolePages.ts` does not declare — a defect in that file. */
  "console-route-undeclared",
  /** The live left nav offers pages `consolePages.ts` does not declare, or no longer offers ones it does. */
  "console-nav-drifted",
  /**
   * The command palette's own entity list carries `page` entries whose addresses the left nav never offers.
   * MEASURED: the palette's page entries outnumber the nav's routes. The nav is the accepted denominator;
   * this names what the palette can open beyond it, address by address, so nobody rediscovers the gap.
   */
  "console-palette-page-undeclared",
  /** The nav leg could not be read this run, so the declared list went unchecked against the console. */
  "console-nav-unread",
  /** The command palette could not be opened or its calls could not be captured this run. */
  "console-palette-unread",
  /**
   * The registry's own census no longer matches the SDK pin. Raised nowhere, because the sync REFUSES on it
   * rather than publishing beside it — it is in the vocabulary so a future pass that can carry on past it
   * has a word for what it saw.
   */
  "registry-census-moved",
  /**
   * An operation family Datadog serves that the pinned client does not declare, so this atlas's closed
   * registry cannot reach it at all. `/api/v1/logs-analytics/*` is the known instance, named in
   * `generated/sdkLock.ts`, reachable through `slopweaver datadog raw` and outside the atlas.
   */
  "sdk-undeclared-family",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 * @internal
 */
export type DatadogGapCondition = (typeof DATADOG_GAP_CONDITIONS)[number];

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing — the pair `(condition, scope)` is the gap's whole identity
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param channel which channel this gap concerns, or `null` when it is channel-independent
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openDatadogGap({
  condition,
  scope,
  kind,
  channel,
  reason,
  at,
}: {
  condition: DatadogGapCondition;
  scope: string;
  kind: DatadogKind | null;
  channel: DatadogChannel | null;
  reason: string;
  at: string;
}): DatadogGap {
  return {
    channel,
    condition,
    firstDetectedAt: at,
    id: datadogGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
  };
}

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileDatadogGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly DatadogGap[];
  observed: readonly DatadogGap[];
  rechecks: readonly AtlasGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly DatadogGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 *
 * @internal
 */
export function openDatadogGaps({ gaps }: { gaps: readonly DatadogGap[] }): readonly DatadogGap[] {
  return openGaps({ gaps });
}
