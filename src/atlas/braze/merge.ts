/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channels alone.
 *
 * Four passes will eventually write here: `sync.ts` fills `docs` and `collection` in one run, a future REST
 * client fills `api`, and a walk fills `browser`. A kind-scoped merge would let each one stale every row the
 * others own — the reference channel would go stale the moment a live sync ran, and vice versa. Since the
 * corroboration BETWEEN those channels is what this atlas exists to produce, that would destroy the output
 * rather than merely mis-timestamp it.
 *
 * So a run declares WHICH channel it is refreshing, once per channel. An entity it did not observe has that
 * one channel marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the
 * rest: the duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { BrazeAtlasEntity, BrazeChannel, BrazeChannelEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: BrazeAtlasEntity | undefined;
  observed: BrazeAtlasEntity;
}): BrazeAtlasEntity["channels"] {
  if (stored == null) {
    return observed.channels;
  }
  return stored.channels;
}

/** What one channel held for an entity last generation; an operation no earlier run mapped held nothing. */
function previousView({
  stored,
  channel,
}: {
  stored: BrazeAtlasEntity | undefined;
  channel: BrazeChannel;
}): BrazeChannelEntity | null {
  if (stored === undefined) {
    return null;
  }
  return stored.channels[channel];
}

/** This run's view of one channel, keeping the discovery date of the view it replaces, when there was one. */
function withDiscoveryDate({
  fresh,
  previous,
}: {
  fresh: BrazeChannelEntity;
  previous: BrazeChannelEntity | null;
}): BrazeChannelEntity {
  if (previous === null) {
    return { ...fresh };
  }
  return { ...fresh, firstSeenAt: previous.firstSeenAt };
}

/**
 * Fold one observed entity onto its stored predecessor, replacing only the channel this run refreshed.
 *
 * `firstSeenAt` is carried forward from the stored channel, so an operation that has been mapped for weeks
 * does not claim to have been discovered today.
 *
 * @param stored the entity as the last generation held it, or `undefined` when it is new
 * @param observed this run's view of it
 * @param channel which channel this run refreshed
 * @returns the merged entity
 *
 * @internal
 */
export function foldBrazeChannel({
  stored,
  observed,
  channel,
}: {
  stored: BrazeAtlasEntity | undefined;
  observed: BrazeAtlasEntity;
  channel: BrazeChannel;
}): BrazeAtlasEntity {
  const fresh = observed.channels[channel];
  const previous = previousView({ channel, stored });
  const merged: BrazeChannelEntity | null = fresh === null ? previous : withDiscoveryDate({ fresh, previous });
  return { ...observed, channels: { ...baseChannels({ observed, stored }), [channel]: merged } };
}

/**
 * Mark one stored entity's channel stale, when this run refreshed that channel and did not see it.
 *
 * @param stored the entity as the last generation held it
 * @param channel which channel this run refreshed
 * @returns the entity with that channel staled, or `null` to leave it exactly as it is
 *
 * @internal
 */
export function staleBrazeChannel({
  stored,
  channel,
}: {
  stored: BrazeAtlasEntity;
  channel: BrazeChannel;
}): BrazeAtlasEntity | null {
  const held = stored.channels[channel];
  if (held === null || held.state === "stale") {
    return null;
  }
  return { ...stored, channels: { ...stored.channels, [channel]: { ...held, state: "stale" } } };
}

/**
 * Merge one channel's fresh projections for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities, each carrying only the refreshed channel
 * @param channel which channel this run refreshed
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeBrazeChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly BrazeAtlasEntity[];
  observed: readonly BrazeAtlasEntity[];
  channel: BrazeChannel;
  at: string;
}): Result<readonly BrazeAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldBrazeChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleBrazeChannel({ channel, stored: held }),
    stored,
  });
}
