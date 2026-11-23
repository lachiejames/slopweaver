/**
 * Vanta's per-kind merge: the kit's lifecycle, plus the one decision that is Vanta's own.
 *
 * `VantaEntity` carries TWO independent channel states — a browser channel and the `manage-api` channel can
 * each be observed or stale on their own, and a `manage-api` sync must never touch the browser channel's
 * state at all. That is the whole of what this file adds to {@link mergeKind}; the duplicate-id refusal,
 * the stale-the-absent pass, the sort and the `Result` all live in the kit now.
 *
 * The BROWSER direction is {@link mergeVantaBrowserChannel}, and it is the mirror image: a control shot
 * writes what it photographed into a control's browser channel and must leave that control's `manage-api`
 * channel — its whole Vanta-side detail — exactly where the last sync left it.
 *
 * A browser entity is only ever merged on exact provider-id equality: `VantaEntity.id` is a digest of
 * `{kind, providerId}`, so a browser-observed risk and an API-observed risk never collide unless their
 * provider ids genuinely match. For risk specifically that equivalence has never been proven, so the two
 * stay separate entities and `syncRunners.ts` records the open question as a `stable-identity-unverified` gap.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { VantaChannelEntity, VantaEntity } from "./model.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";

/** Fold one freshly observed entity into the accumulator, preserving its prior browser channel and firstSeenAt. */
function foldObserved({
  stored,
  observed,
  at,
}: {
  stored: VantaEntity | undefined;
  observed: VantaEntity;
  at: string;
}): Result<VantaEntity> {
  const freshChannel = observed.channels["manage-api"];
  if (freshChannel === null) {
    // Unreachable in practice — every projection populates this channel — but stated rather than silently
    // coerced, since a null here would otherwise erase whatever `manage-api` history already existed.
    return err(vantaSyncErrorLines({ error: VantaSyncErrors.entityWithoutApiChannel({ entityId: observed.id }) }));
  }
  // An entity no earlier generation held is first seen by this run and has no browser history, by design.
  if (stored === undefined) {
    return ok({ ...observed, channels: { browser: null, "manage-api": { ...freshChannel, firstSeenAt: at } } });
  }
  const priorApiChannel = stored.channels["manage-api"];
  const mergedChannel: VantaChannelEntity = {
    ...freshChannel,
    firstSeenAt: priorApiChannel === null ? at : priorApiChannel.firstSeenAt,
  };
  return ok({
    ...observed,
    channels: { browser: stored.channels.browser, "manage-api": mergedChannel },
  });
}

/** Mark stale one stored entity whose `manage-api` channel was previously observed and is now absent. */
function staleApiChannel({ stored }: { stored: VantaEntity }): VantaEntity | null {
  const apiChannel = stored.channels["manage-api"];
  if (apiChannel === null || apiChannel.state === "stale") {
    return null;
  }
  return { ...stored, channels: { ...stored.channels, "manage-api": { ...apiChannel, state: "stale" } } };
}

/**
 * Merge this run's fresh `manage-api` projections for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected `manage-api` entities — `channels.browser` must be `null`
 *   on every one, since that channel belongs to a different capture entirely
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeVantaKind({
  stored,
  observed,
  at,
}: {
  stored: readonly VantaEntity[];
  observed: readonly VantaEntity[];
  at: string;
}): Result<readonly VantaEntity[]> {
  return mergeKind({ at, foldEntity: foldObserved, observed, staleEntity: staleApiChannel, stored });
}

/**
 * Fold this run's freshly OBSERVED browser channels into what the store already holds for one kind.
 *
 * The mirror of {@link mergeVantaKind}: there, a Manage API sync must not touch the browser channel; here,
 * a browser capture must not touch the Manage API channel. An entity the store does not hold yet is added
 * with a null `manage-api` channel, and every entity this run did not observe is carried through untouched
 * — deliberately NOT staled, because a shot names the two or three controls it was asked for and every other
 * control was never looked at. Staling them would report a capture of three controls as evidence that every
 * other control had gone missing.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly captured browser entities — `channels["manage-api"]` must be `null`
 * @param at this run's ISO timestamp, used as `firstSeenAt` for a browser channel that had none
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeVantaBrowserChannel({
  stored,
  observed,
  at,
}: {
  stored: readonly VantaEntity[];
  observed: readonly VantaEntity[];
  at: string;
}): Result<readonly VantaEntity[]> {
  const byId = new Map(stored.map((entity) => [entity.id, entity]));
  for (const fresh of observed) {
    const freshChannel = fresh.channels.browser;
    if (freshChannel === null) {
      return err(vantaSyncErrorLines({ error: VantaSyncErrors.entityWithoutBrowserChannel({ entityId: fresh.id }) }));
    }
    const prior = byId.get(fresh.id);
    if (prior === undefined) {
      // Nothing stored under this id, so there is no earlier sighting to carry and no `manage-api` channel
      // to preserve: this run IS the first one, and saying so is the whole point of a named branch here.
      byId.set(fresh.id, { ...fresh, channels: { browser: { ...freshChannel, firstSeenAt: at }, "manage-api": null } });
      continue;
    }
    const priorBrowser = prior.channels.browser;
    const merged: VantaChannelEntity = {
      ...freshChannel,
      firstSeenAt: priorBrowser === null ? at : priorBrowser.firstSeenAt,
    };
    byId.set(fresh.id, { ...prior, channels: { browser: merged, "manage-api": prior.channels["manage-api"] } });
  }
  return ok([...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id)));
}
