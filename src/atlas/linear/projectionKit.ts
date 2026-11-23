/**
 * What both channel projections share: this atlas's gap vocabulary, its two surface names, and the four
 * tiny constructors that narrow the kit's generic shapes to this atlas's own enums. PURE.
 *
 * A file of small things rather than a paragraph duplicated into `projectApi.ts` and `projectBrowser.ts`,
 * because every one of them must be IDENTICAL across the two channels — a coverage cell that spelled its
 * visibility scope differently on one side would make a coverage fraction stop meaning one thing across
 * the atlas.
 */
import type { AtlasCoverageCell as KitCoverageCell } from "../kit/coverage.js";
import type { AtlasGap as KitGap } from "../kit/gaps.js";

import type { LinearBrowserObservations } from "./graphqlObservations.js";
import {
  LINEAR_ATLAS_KINDS,
  LINEAR_ATLAS_VISIBILITY_SCOPE,
  type LinearAtlasEntity,
  type LinearAtlasGap,
  type LinearAtlasKind,
  type LinearChannelEntity,
  type LinearCoverageCell,
  type LinearSource,
} from "./model.js";
import type { LinearPageObservation } from "./walk.js";

/** What one channel's projection produced for every kind. */
export interface ChannelProjection {
  readonly entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  readonly coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  readonly gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
}

/**
 * This atlas's own gap vocabulary, beside the kit's two.
 *
 * Closed and exported so a test can assert the set rather than a string, and so a reader of a stored
 * generation can look up every condition in one place.
 * @internal
 */
export const LINEAR_GAP_CONDITIONS = [
  /** A configuration read this account's entitlements refused. Carries the provider's own sentence. */
  "settings-surface-refused",
  /** A settings route that answered by sending the browser somewhere else. */
  "settings-page-unreachable",
  /** The walk stopped partway, so these routes were never attempted. */
  "settings-walk-incomplete",
  /** A page was reached but at least one response body was lost, so its call census understates. */
  "settings-page-capture-incomplete",
  /** The route table is declared here rather than published by Linear — a permanent provenance gap. */
  "page-inventory-is-declared",
  /** A captured GraphQL request carried no readable document, so nothing was attributed from it. */
  "request-shape-unresolved",
  /** A response key no captured document explains — a client-only field, or a document we never saw. */
  "browser-response-key-unexplained",
  /** A page the browser opened but could not photograph, so it does not count toward a filled surface. */
  "settings-page-unphotographed",
  /** A root field nothing in rootFieldCensus.ts places: neither read nor deliberately excluded. */
  "unclassified-root-field",
  /** A configuration connection hit the paging bound before the provider said there was no more. */
  "settings-paging-bound-reached",
] as const;

/** @internal */
export type LinearGapCondition = (typeof LINEAR_GAP_CONDITIONS)[number];

/** The two surface names this atlas declares, matching `descriptor.ts`. */
export const API_SURFACE = "graphql-api";
export const BROWSER_SURFACE = "settings-browser";

/** What the browser channel contributed to one run. */
export interface LinearBrowserReading {
  readonly pages: readonly LinearPageObservation[];
  readonly observations: LinearBrowserObservations;
  /**
   * Whether this run was bounded by `--limit`.
   *
   * Carried separately from the page outcomes because a bound equal to or larger than the current plan
   * leaves no `not-attempted` row at all — and a Codex review pass produced exactly that counterexample:
   * a workspace that had lost a team plans fewer pages, so a `--limit` equal to that smaller plan's
   * page count looked complete and staled a page a bigger earlier walk had found. A bounded run is never complete, whatever
   * its outcomes happen to look like.
   */
  readonly limited: boolean;
  /** Why the browser surface produced nothing this run, when it did not run at all. */
  readonly unavailableBecause: string | null;
}

/**
 * Everything one run projects into.
 * @internal
 */
export interface LinearProjection {
  readonly entities: Readonly<Record<LinearAtlasKind, readonly LinearAtlasEntity[]>>;
  readonly coverage: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
  readonly gaps: Readonly<Record<LinearAtlasKind, readonly LinearAtlasGap[]>>;
  /**
   * The condition-and-scope pairs this run genuinely RECHECKED, and whether each is now answered.
   *
   * Without these a gap never closes: `kit/gaps.ts` closes one only when a run says it looked at that exact
   * condition and scope and found it resolved, which is the right contract — a run that did not look must
   * not be able to close anything. Measured, a file that supplied none left a
   * `browser-surface-unreadable` gap raised by a `--skip-browser` run stayed open through the next run that
   * filled the browser surface completely.
   */
  readonly rechecks: readonly { readonly condition: string; readonly scope: string; readonly resolved: boolean }[];
}

/** An empty record with every kind present, so no consumer has to handle a missing key.  * @returns a record with every kind present, each holding a fresh value
 */
export function byKind<TValue>({ make }: { make: () => TValue }): Record<LinearAtlasKind, TValue> {
  // `as`: built from the exhaustive kind list, so the narrower key type is sound.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(LINEAR_ATLAS_KINDS.map((kind) => [kind, make()])) as Record<LinearAtlasKind, TValue>;
}

/** One channel's record of having seen one thing, at one moment.  * @returns the channel record, stamped as observed at this moment
 * @internal
 */
export function channelEntity({
  channel,
  detail,
  source,
  at,
}: {
  channel: "api" | "browser";
  detail: unknown;
  source: LinearSource;
  at: string;
}): LinearChannelEntity {
  return { channel, detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/** An entity with exactly one channel filled — the other is left for its own reading to fill.  * @returns the entity, with only the named channel filled
 */
export function oneChannelEntity({
  kind,
  providerId,
  channel,
  detail,
  source,
  at,
}: {
  kind: LinearAtlasKind;
  providerId: string;
  channel: "api" | "browser";
  detail: unknown;
  source: LinearSource;
  at: string;
}): LinearAtlasEntity {
  const filled = channelEntity({ at, channel, detail, source });
  return {
    channels: { api: channel === "api" ? filled : null, browser: channel === "browser" ? filled : null },
    id: `${kind}:${providerId}`,
    kind,
    providerId,
  };
}

/** The kit's cell shape, narrowed to this atlas's own literal visibility scope.  * @returns the coverage cell, carrying this atlas's own channel and visibility scope
 */
export function cell({ built, channel }: { built: KitCoverageCell; channel: "api" | "browser" }): LinearCoverageCell {
  return { ...built, artifacts: [...built.artifacts], channel, visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE };
}

/**
 * The stored cell a failed look keeps, or `null` when the stored generation holds none for it.
 *
 * Named rather than coalesced because the two cases are different facts — "this look has succeeded before"
 * and "this look has never been made" — and the kit's `failedCoverageCell` carries a prior success forward
 * only in the first.
 *
 * @param cells the coverage cells the stored generation holds for one kind
 * @param matches which stored cell is this look's own
 * @returns the stored cell, or `null` when this look has never been graded
 */
export function priorCoverageCell({
  cells,
  matches,
}: {
  cells: readonly LinearCoverageCell[];
  matches: (held: LinearCoverageCell) => boolean;
}): LinearCoverageCell | null {
  const held = cells.find(matches);
  if (held === undefined) {
    return null;
  }
  return held;
}

/** The kit's gap shape, narrowed to this atlas's own kind and channel enums.  * @returns the gap, narrowed to this atlas's own kind and channel enums
 */
export function gap({ built, kind }: { built: KitGap; kind: LinearAtlasKind | null }): LinearAtlasGap {
  return {
    ...built,
    fields: [...built.fields],
    kind,
    surfaces: built.surfaces.filter(
      (surface): surface is "api" | "browser" => surface === "api" || surface === "browser",
    ),
  };
}
