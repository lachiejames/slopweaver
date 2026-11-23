/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channels alone.
 *
 * Three passes will eventually write here: `sync.ts` fills the `compiled` channel from the pinned
 * specification, a future Graph client fills `api`, and a walk fills `browser`. A kind-scoped merge would let
 * each one stale every row the others own — the compiled surface would go stale the moment a live sync ran,
 * and vice versa. Since the corroboration BETWEEN those channels is what an atlas exists to produce, that
 * would destroy the output rather than merely mis-timestamp it.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel marked
 * stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the duplicate-id
 * refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { Microsoft365AtlasEntity, Microsoft365Channel, Microsoft365ChannelEntity } from "./model.js";

/**
 * The channel this run refreshed, after the fold: the stored view when this run saw nothing on it, else the
 * fresh view keeping the stored `firstSeenAt`. An entity or channel the store never held has no stamp to keep,
 * so this run's sighting is its first.
 */
function refreshedChannel({
  fresh,
  stored,
  channel,
}: {
  fresh: Microsoft365ChannelEntity | null;
  stored: Microsoft365AtlasEntity | undefined;
  channel: Microsoft365Channel;
}): Microsoft365ChannelEntity | null {
  if (stored === undefined) {
    return fresh === null ? null : { ...fresh };
  }
  const previous = stored.channels[channel];
  if (fresh === null) {
    return previous;
  }
  if (previous === null) {
    return { ...fresh };
  }
  return { ...fresh, firstSeenAt: previous.firstSeenAt };
}

/** Every channel an entity carries before this run's one is written: the stored set, or this run's for a new one. */
function channelsBefore({
  stored,
  observed,
}: {
  stored: Microsoft365AtlasEntity | undefined;
  observed: Microsoft365AtlasEntity;
}): Microsoft365AtlasEntity["channels"] {
  if (stored === undefined) {
    return observed.channels;
  }
  return stored.channels;
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
export function foldMicrosoft365Channel({
  stored,
  observed,
  channel,
}: {
  stored: Microsoft365AtlasEntity | undefined;
  observed: Microsoft365AtlasEntity;
  channel: Microsoft365Channel;
}): Microsoft365AtlasEntity {
  const merged = refreshedChannel({ channel, fresh: observed.channels[channel], stored });
  return {
    ...observed,
    channels: { ...channelsBefore({ observed, stored }), [channel]: merged },
  };
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
export function staleMicrosoft365Channel({
  stored,
  channel,
}: {
  stored: Microsoft365AtlasEntity;
  channel: Microsoft365Channel;
}): Microsoft365AtlasEntity | null {
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
export function mergeMicrosoft365Channel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly Microsoft365AtlasEntity[];
  observed: readonly Microsoft365AtlasEntity[];
  channel: Microsoft365Channel;
  at: string;
}): Result<readonly Microsoft365AtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldMicrosoft365Channel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleMicrosoft365Channel({ channel, stored: held }),
    stored,
  });
}
