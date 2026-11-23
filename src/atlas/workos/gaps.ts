/**
 * The WorkOS atlas's own gap vocabulary, over the kit's lifecycle.
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

import type { WorkosAtlasGap, WorkosAtlasKind } from "./model.js";

/**
 * The conditions this atlas raises on its own account.
 *
 * - `content-not-configured` — no API key, so no organisation, user, connection or directory has been
 *   read. The ordinary starting state on an install whose only access is a SaaS-management account record,
 *   and a gap rather than a silence because "the tenant holds none" and "nobody has looked" are different
 *   sentences.
 * - `content-unreadable` — this ONE family's endpoint was asked, with a key, and refused. Distinct from the
 *   row above rather than a synonym for it: since the four families are graded apart (`sync.ts`), a broken
 *   directories endpoint sitting beside three that read perfectly used to raise a gap saying no key was
 *   configured, which is false and sends a reader to fix a credential that is fine.
 * - `content-bounded` — this family's own read filled every page the reader follows, or the membership walk
 *   behind it stopped at its bound, so what is published is a real prefix. "A prefix" and "nothing" are not
 *   the same claim, and neither is "everything".
 * - `route-candidate-absent` — a route this repository's candidate table names is not served under that
 *   method. Raised with the pair, because it is the difference between "we never thought to ask" and "we
 *   asked and WorkOS does not serve it".
 * - `route-denominator-is-local` — the standing, permanent gap: WorkOS publishes no OpenAPI document, so
 *   the set of routes ASKED about is written in this repository. Every verdict is the server's, but a route
 *   nobody here thought of is simply never probed, and that bound is stated rather than left to be
 *   inferred.
 * - `second-origin-unmapped` — a product family the vendor serves from an origin this atlas does not probe.
 *   Measured on Fine-Grained Authorization, which is absent from `api.workos.com` and present on
 *   `fga.workos.com`.
 * - `dashboard-page-unwitnessed` — a dashboard route is declared with its exact URL and no browser has ever
 *   landed on it. This is the browser surface's own honesty: the address is published, the witness is not.
 * - `dashboard-route-unverifiable-without-session` — the dashboard's unauthenticated sign-in redirect is a
 *   catch-all, so the page map cannot be checked at all without a signed-in walk. Distinct from the row
 *   above: that one says nobody has looked, this one says looking is the ONLY way to know.
 * - `dashboard-page-needs-admin` — a walk reached the dashboard and could not open a page its own table
 *   marks admin-only, so a page the account's role does not reach is a declared bound rather than a page
 *   that does not exist.
 * - `dashboard-environment-unresolved` — most of the dashboard hangs off this install's own
 *   `/environment_<id>/` segment (`dashboardPages.ts`) and nothing has resolved it yet, so those addresses
 *   are published at their bare bootstrap paths. Distinct from the two rows above: the page map is not
 *   unwitnessed and not unverifiable here, it is addressed at a path the vendor has moved away from, and
 *   a reader who cannot see that cannot tell a current address from a bootstrap one.
 * - `dashboard-surface-moved-unknown-address` — a surface this atlas knows exists is no longer at the
 *   address it declared, and no walk has witnessed the address that replaced it. The honest third sentence
 *   next to "nobody has looked" and "a walk tried and could not open it": somebody looked, the old address
 *   is gone, and inventing the new one would put a row in the table that no evidence supports.
 *
 * @internal
 */
export const WORKOS_GAP_CONDITIONS = [
  "content-not-configured",
  "content-unreadable",
  "content-bounded",
  "route-candidate-absent",
  "route-denominator-is-local",
  "second-origin-unmapped",
  "dashboard-page-unwitnessed",
  "dashboard-route-unverifiable-without-session",
  "dashboard-page-needs-admin",
  "dashboard-environment-unresolved",
  "dashboard-surface-moved-unknown-address",
] as const;

/**
 * One question this atlas is honest about not having answered.
 *
 * @internal
 */
export type WorkosGapCondition = (typeof WORKOS_GAP_CONDITIONS)[number];

/**
 * Raise one of this atlas's own gaps, in the stored shape.
 *
 * @param condition which question is open
 * @param scope where it is open — a `<METHOD> <path>` pair, a dashboard route, or the platform itself
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; empty when it is channel-independent
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openWorkosGap({
  condition,
  scope,
  kind,
  surfaces,
  reason,
  at,
}: {
  condition: WorkosGapCondition;
  scope: string;
  kind: WorkosAtlasKind | null;
  surfaces: readonly WorkosAtlasGap["surfaces"][number][];
  reason: string;
  at: string;
}): WorkosAtlasGap {
  const gap: AtlasGap = openGap({ at, condition, fields: [], kind, reason, scope, surfaces });
  // The stored schema declares mutable arrays and this atlas's own enums, so narrow rather than alias the
  // kit's widened readonly view.
  return { ...gap, fields: [], kind, surfaces: [...surfaces] };
}
