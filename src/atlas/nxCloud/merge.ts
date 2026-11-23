/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write the `endpoint` kind: `sync.ts` fills the `web-data` channel with the operations it
 * CALLED, and `browserSurface.ts` fills the `browser` channel with the operations a page was seen to call.
 * A kind-scoped merge would let each stale every row the other owns — the operations only the rendered
 * client fires would go stale the moment a sync ran, and the operations only a direct read makes would go
 * stale the moment a walk did. Since the difference between those two sets is the corroboration this atlas
 * exists to produce, a kind-scoped merge would destroy the output.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { NxCloudAtlasChannel, NxCloudAtlasEntity, NxCloudChannelEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: NxCloudAtlasEntity | undefined;
  observed: NxCloudAtlasEntity;
}): NxCloudAtlasEntity["channels"] {
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
export function foldNxCloudChannel({
  stored,
  observed,
  channel,
}: {
  stored: NxCloudAtlasEntity | undefined;
  observed: NxCloudAtlasEntity;
  channel: NxCloudAtlasChannel;
}): NxCloudAtlasEntity {
  const merged = mergedChannel({
    fresh: observed.channels[channel],
    previous: previousChannel({ channel, stored }),
  });
  return {
    ...observed,
    channels: { ...baseChannels({ observed, stored }), [channel]: merged },
  };
}

/** What the refreshed channel held before this run: nothing for a new entity, else the stored channel as it stands. */
function previousChannel({
  stored,
  channel,
}: {
  stored: NxCloudAtlasEntity | undefined;
  channel: NxCloudAtlasChannel;
}): NxCloudChannelEntity | null {
  if (stored === undefined) {
    // A new entity: no channel has looked at it before this run.
    return null;
  }
  return stored.channels[channel];
}

/**
 * The refreshed channel after this run: the stored look when this run saw nothing, this run's own look when the
 * channel never looked before, else this run's look carrying the stored first sighting.
 */
function mergedChannel({
  fresh,
  previous,
}: {
  fresh: NxCloudChannelEntity | null;
  previous: NxCloudChannelEntity | null;
}): NxCloudChannelEntity | null {
  if (fresh === null) {
    return previous;
  }
  if (previous === null) {
    // This channel's first look at the entity, so its own sighting is the first one.
    return fresh;
  }
  return { ...fresh, firstSeenAt: previous.firstSeenAt };
}

/**
 * Mark one stored entity's channel stale, when this run refreshed that channel and did not see it.
 *
 * @param stored the entity as the last generation held it
 * @param channel which channel this run refreshed
 * @returns the entity with that channel staled, or `null` to leave it exactly as it is
 */
export function staleNxCloudChannel({
  stored,
  channel,
}: {
  stored: NxCloudAtlasEntity;
  channel: NxCloudAtlasChannel;
}): NxCloudAtlasEntity | null {
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
export function mergeNxCloudChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly NxCloudAtlasEntity[];
  observed: readonly NxCloudAtlasEntity[];
  channel: NxCloudAtlasChannel;
  at: string;
}): Result<readonly NxCloudAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldNxCloudChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleNxCloudChannel({ channel, stored: held }),
    stored,
  });
}
