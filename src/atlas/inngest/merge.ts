/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channels alone.
 *
 * Two passes write here and a third will: `sync.ts` fills the `compiled` channel from Inngest's published
 * catalogue and its own route table, `walk.ts` fills `browser` from the owner's Chrome, and a REST client
 * would fill `api`. A kind-scoped merge would let each one stale every row the others own — the compiled
 * surface would go stale the moment a walk ran, and vice versa. Since the corroboration BETWEEN those
 * channels is what an atlas exists to produce, that would destroy the output rather than merely mis-timestamp
 * it.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel marked
 * stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the duplicate-id
 * refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { InngestAtlasEntity, InngestChannel, InngestChannelEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: InngestAtlasEntity | undefined;
  observed: InngestAtlasEntity;
}): InngestAtlasEntity["channels"] {
  if (stored == null) {
    return observed.channels;
  }
  return stored.channels;
}

/** The view the stored generation held through one channel; an entity this run is first to see held none. */
function heldThrough({
  stored,
  channel,
}: {
  stored: InngestAtlasEntity | undefined;
  channel: InngestChannel;
}): InngestChannelEntity | null {
  if (stored === undefined) {
    return null;
  }
  return stored.channels[channel];
}

/** This run's view of one channel, dated from the view it replaces when that channel had seen it before. */
function refreshedView({
  fresh,
  previous,
}: {
  fresh: InngestChannelEntity;
  previous: InngestChannelEntity | null;
}): InngestChannelEntity {
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
export function foldInngestChannel({
  stored,
  observed,
  channel,
}: {
  stored: InngestAtlasEntity | undefined;
  observed: InngestAtlasEntity;
  channel: InngestChannel;
}): InngestAtlasEntity {
  const fresh = observed.channels[channel];
  const previous = heldThrough({ channel, stored });
  const merged: InngestChannelEntity | null = fresh === null ? previous : refreshedView({ fresh, previous });
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
 *
 * @internal
 */
export function staleInngestChannel({
  stored,
  channel,
}: {
  stored: InngestAtlasEntity;
  channel: InngestChannel;
}): InngestAtlasEntity | null {
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
export function mergeInngestChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly InngestAtlasEntity[];
  observed: readonly InngestAtlasEntity[];
  channel: InngestChannel;
  at: string;
}): Result<readonly InngestAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldInngestChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleInngestChannel({ channel, stored: held }),
    stored,
  });
}
