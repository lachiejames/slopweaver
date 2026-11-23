/**
 * The GraphQL Hive atlas's own gap vocabulary, over the kit's lifecycle.
 *
 * A gap here is a live question this atlas is honest about not having answered — "the gap list is a
 * deliverable", in the owner's own words. The lifecycle (raise, recheck, close) is `kit/gaps.ts`; what is
 * genuinely this atlas's is which conditions it can raise, and each one names a question a reader could
 * otherwise only discover by noticing an absence.
 *
 * `api-browser-disagreement` and `browser-surface-unreadable` come from the kit and are deliberately not
 * restated here: corroboration between two surfaces is part of the definition of an atlas, so two atlases
 * describing it in two different words would be two atlases with no comparable output.
 */
import { type AtlasGap, openGap } from "../kit/gaps.js";

import type { HiveAtlasGap, HiveAtlasKind } from "./model.js";

/**
 * The conditions this atlas raises on its own account.
 *
 * - `registry-not-configured` — no access token, so the registry's content has never been read. The
 *   ordinary starting state on an install whose only access is an SSO assignment, and a gap rather than a
 *   silence because "the atlas holds no target" and "nobody has looked" are different sentences.
 * - `registry-query-unsupported` — the introspected schema does not declare the root field the content
 *   query names, so Hive has reshaped its API under this atlas. Raised with the fields the schema DOES
 *   declare, which is what makes it actionable rather than a bare failure.
 * - `console-page-unwitnessed` — a console route is declared with its exact URL and no browser has ever
 *   landed on it. This is the browser surface's own honesty: the address is published, the witness is not.
 * - `console-page-needs-admin` — a walk reached the console and could not open a page its own table marks
 *   admin-only. The owner's access is an SSO assignment and says nothing about their organisation role, so a
 *   page they cannot see is a declared bound rather than a page that does not exist.
 *
 * @internal
 */
export const HIVE_GAP_CONDITIONS = [
  "registry-not-configured",
  "registry-query-unsupported",
  "console-page-unwitnessed",
  "console-page-needs-admin",
] as const;

/**
 *
 *
 * @internal
 */
export type HiveGapCondition = (typeof HIVE_GAP_CONDITIONS)[number];

/**
 * Raise one of this atlas's own gaps, in the stored shape.
 *
 * @param condition which question is open
 * @param scope where it is open — a slug path, a route template, or the platform itself
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; empty when it is channel-independent
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openHiveGap({
  condition,
  scope,
  kind,
  surfaces,
  reason,
  at,
}: {
  condition: HiveGapCondition;
  scope: string;
  kind: HiveAtlasKind | null;
  surfaces: readonly HiveAtlasGap["surfaces"][number][];
  reason: string;
  at: string;
}): HiveAtlasGap {
  const gap: AtlasGap = openGap({ at, condition, fields: [], kind, reason, scope, surfaces });
  // The stored schema declares mutable arrays and this atlas's own enums, so narrow rather than alias the
  // kit's widened readonly view.
  return { ...gap, fields: [], kind, surfaces: [...surfaces] };
}
