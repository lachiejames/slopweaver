/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes will write here: the surface sync fills the `api` channel from the pinned document and, once a
 * credential exists, from the live management API, and a console walk fills the `browser` channel. A
 * kind-scoped merge would let each one stale every row the other owns, and since the corroboration between
 * the two channels is an OUTPUT of this atlas rather than a build-time check (`docs/atlas-intent/04-corroboration.md`),
 * that would destroy exactly the thing being produced.
 *
 * On this platform there is a second, sharper reason, and it runs the opposite way from Figma's. Here the
 * API channel is the complete one and the BROWSER channel is the one that can only ever be filled by
 * signing in — the console tells a signed-out client it has two addressable routes. So the browser channel
 * will arrive late, all at once, and against rows the API channel has been maintaining for months. A merge
 * that staled by kind would blank the whole API surface the first time a walk ran.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { PrismaChannelEntity, PrismaDataPlatformAtlasChannel, PrismaDataPlatformEntity } from "./model.js";

/** What the stored generation held for one channel of an entity; a new entity has held nothing yet. */
function storedChannel({
  stored,
  channel,
}: {
  stored: PrismaDataPlatformEntity | undefined;
  channel: PrismaDataPlatformAtlasChannel;
}): PrismaChannelEntity | null {
  if (stored === undefined) {
    return null;
  }
  return stored.channels[channel];
}

/** This run's view of a channel, keeping the `firstSeenAt` of the view it replaces when there was one. */
function carriedForward({
  fresh,
  previous,
}: {
  fresh: PrismaChannelEntity;
  previous: PrismaChannelEntity | null;
}): PrismaChannelEntity {
  if (previous === null) {
    return { ...fresh };
  }
  return { ...fresh, firstSeenAt: previous.firstSeenAt };
}

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: PrismaDataPlatformEntity | undefined;
  observed: PrismaDataPlatformEntity;
}): PrismaDataPlatformEntity["channels"] {
  if (stored == null) {
    return observed.channels;
  }
  return stored.channels;
}

/**
 * Fold one observed entity onto its stored predecessor, replacing only the channel this run refreshed.
 *
 * `firstSeenAt` is carried forward from the stored channel, so an entity that has been observed for weeks
 * does not claim to have been discovered today.
 *
 * @param stored the entity as the last generation held it, or `undefined` when it is new
 * @param observed this run's view of it
 * @param channel which channel this run refreshed
 * @returns the merged entity
 */
export function foldPrismaChannel({
  stored,
  observed,
  channel,
}: {
  stored: PrismaDataPlatformEntity | undefined;
  observed: PrismaDataPlatformEntity;
  channel: PrismaDataPlatformAtlasChannel;
}): PrismaDataPlatformEntity {
  const fresh = observed.channels[channel];
  const previous = storedChannel({ channel, stored });
  const merged: PrismaChannelEntity | null = fresh === null ? previous : carriedForward({ fresh, previous });
  return {
    ...observed,
    channels: { ...baseChannels({ observed, stored }), [channel]: merged },
  };
}

/**
 * Mark one stored entity's channel stale, when this run refreshed that channel and did not see it.
 *
 * @param stored the entity as the last generation held it
 * @param channel which channel this run refreshed
 * @returns the entity with that channel staled, or `null` to leave it exactly as it is
 */
export function stalePrismaChannel({
  stored,
  channel,
}: {
  stored: PrismaDataPlatformEntity;
  channel: PrismaDataPlatformAtlasChannel;
}): PrismaDataPlatformEntity | null {
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
export function mergePrismaChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly PrismaDataPlatformEntity[];
  observed: readonly PrismaDataPlatformEntity[];
  channel: PrismaDataPlatformAtlasChannel;
  at: string;
}): Result<readonly PrismaDataPlatformEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldPrismaChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => stalePrismaChannel({ channel, stored: held }),
    stored,
  });
}
