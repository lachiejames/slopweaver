/**
 * Cloudflare's per-kind merge: the kit's lifecycle, plus the two decisions that are Cloudflare's own.
 *
 * The duplicate-id refusal, the stale-the-absent pass, the sort and the `Result` all live in
 * {@link mergeKind} now. What this file adds is the fold itself: a `CloudflareEntity` carries ONE channel's
 * state directly rather than Vanta's per-channel slots, so a fresh observation REPLACES its predecessor
 * outright and only `firstSeenAt` is carried forward. That difference is the whole reason the kit takes a
 * fold callback instead of a shared entity schema — see `kit/merge.ts`'s header.
 *
 * ## What "a complete read" means once there is more than one zone
 *
 * Only ever called on a COMPLETE read: `flatKinds.ts` calls this only when the whole surface succeeded this
 * run, so "a previously-observed entity now absent means stale" is safe to apply. An incomplete read leaves
 * the stored entities exactly as the previous generation had them instead.
 *
 * For a ZONE-scoped kind, complete means complete FOR THE ZONE THAT WAS READ, which is a strictly smaller
 * claim, and the difference is a data-loss bug rather than a nicety. This atlas reads one zone deeply today
 * and an account can hold many; a read of zone A is silent about zone B, so staling every stored entity
 * absent from zone A's array would mark every other zone stale on every run — and a per-zone loop
 * would have each successful zone stale every zone before it. So {@link mergeCloudflareKind} takes the zone
 * this run actually read, and considers only that zone's own entities for staling. `readZoneId` is `null`
 * exactly when the kind is account-scoped, where every stored entity was in fact within the read.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { CloudflareEntity } from "./model.js";

/** Fold one freshly observed entity over its stored predecessor, preserving only when it was first seen. */
function foldObserved({
  stored,
  observed,
  at,
}: {
  stored: CloudflareEntity | undefined;
  observed: CloudflareEntity;
  at: string;
}): Result<CloudflareEntity> {
  if (stored === undefined) {
    return ok({ ...observed, firstSeenAt: at, state: "observed" });
  }
  return ok({ ...observed, firstSeenAt: stored.firstSeenAt, state: "observed" });
}

/**
 * Merge this run's fresh projections for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities
 * @param readZoneId the one zone this run read, for a zone-scoped kind — `null` for an account-scoped kind,
 *   whose read covers every stored entity. A stored entity belonging to any OTHER zone is left exactly as
 *   it stands, because this run did not look at that zone at all
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeCloudflareKind({
  stored,
  observed,
  readZoneId,
  at,
}: {
  stored: readonly CloudflareEntity[];
  observed: readonly CloudflareEntity[];
  readZoneId: string | null;
  at: string;
}): Result<readonly CloudflareEntity[]> {
  const staleEntity = ({ stored: entity }: { stored: CloudflareEntity }): CloudflareEntity | null => {
    if (readZoneId !== null && entity.scope.zoneId !== readZoneId) {
      return null;
    }
    return entity.state === "stale" ? null : { ...entity, state: "stale" };
  };
  return mergeKind({ at, foldEntity: foldObserved, observed, staleEntity, stored });
}

/**
 * The same `firstSeenAt` carry for a NON-FLAT kind, which never merges: its reconciliation builds every
 * entity fresh, stamped with this run's instant, and replaces the stored array outright. Without this a
 * parent read for months reads as first seen today.
 *
 * @param entities this run's reconciled entities, every one stamped first seen now
 * @param stored every entity this kind's file already holds
 * @returns this run's entities, each one already stored carrying the instant it was first seen
 */
export function withStoredFirstSeen({
  entities,
  stored,
}: {
  entities: readonly CloudflareEntity[];
  stored: readonly CloudflareEntity[];
}): CloudflareEntity[] {
  const firstSeenById = new Map(stored.map((entity) => [entity.id, entity.firstSeenAt]));
  return entities.map((entity) => {
    const firstSeenAt = firstSeenById.get(entity.id);
    if (firstSeenAt === undefined) {
      return entity;
    }
    return { ...entity, firstSeenAt };
  });
}
