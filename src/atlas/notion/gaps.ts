/**
 * The Notion atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below. The kit's two
 * corroboration conditions are included because corroboration between surfaces is part of what an atlas IS,
 * and here `api-browser-disagreement` is the point rather than an edge case: Notion's public REST surface and
 * the surface its own web client calls are largely disjoint, so it is expected to fire in volume.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { notionGapId } from "./identity.js";
import type { NotionAtlasChannel, NotionAtlasGap, NotionAtlasKind } from "./model.js";

/** Every condition a Notion atlas gap can carry. A closed vocabulary, so closure can match exactly. */
export const NOTION_GAP_CONDITIONS = [
  "sdk-declarations-unreadable",
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
  // Permanent, and open by construction: Notion publishes no manifest of its own settings surface, so the
  // declared inventory is a hand list and a page Notion ships tomorrow is absent from it until someone
  // notices. An atlas that cannot close a gap should still be the thing that says the gap is there.
  "provider-publishes-no-browser-inventory",
  // A settings TAB is not a route, so none of the page conditions above describes one. A tab that did not
  // render was clicked for and not shown — a different fact from an address the client does not have, and
  // the route gaps stay the measured evidence that the surface has no address at all (`settingsGaps.ts`).
  "settings-tab-not-rendered",
  "settings-tab-not-attempted",
  "settings-tab-screenshot-missing",
  // Permanent: the rail's first Account tab is labelled with the signed-in person's own name, which is
  // per-install state and so is never declared in `settingsTabs.ts`.
  "settings-tab-undeclared-per-install",
  ...KIT_GAP_CONDITIONS,
] as const;

export type NotionGapCondition = (typeof NOTION_GAP_CONDITIONS)[number];

/**
 * A Notion atlas gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the two surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openNotionGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: NotionGapCondition;
  scope: string;
  kind: NotionAtlasKind | null;
  surfaces: readonly NotionAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): NotionAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: notionGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/** A condition and scope that were genuinely rechecked, and what the recheck found. */
export type NotionGapRecheck = AtlasGapRecheck;

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
export function reconcileNotionGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly NotionAtlasGap[];
  observed: readonly NotionAtlasGap[];
  rechecks: readonly NotionGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly NotionAtlasGap[]> {
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
export function openNotionGaps({ gaps }: { gaps: readonly NotionAtlasGap[] }): readonly NotionAtlasGap[] {
  return openGaps({ gaps });
}
