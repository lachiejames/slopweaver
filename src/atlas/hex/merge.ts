/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write the `method` kind: `sync.ts` fills the `api` channel from the pinned evidence, and
 * `walk.ts` fills the `browser` channel from what the web client actually calls. A kind-scoped merge would
 * let each one stale every row the other owns — the browser's undocumented operations would go stale the
 * moment a sync ran, and the published endpoints the moment a walk did. Since the disjointness between
 * those two sets is the finding this atlas exists to produce, that would destroy exactly the output.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { HexAtlasChannel, HexAtlasEntity, HexChannelEntity } from "./model.js";

/** What the stored generation held for one channel of an entity; a new entity has held nothing yet. */
function storedChannel({
  stored,
  channel,
}: {
  stored: HexAtlasEntity | undefined;
  channel: HexAtlasChannel;
}): HexChannelEntity | null {
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
  fresh: HexChannelEntity;
  previous: HexChannelEntity | null;
}): HexChannelEntity {
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
  stored: HexAtlasEntity | undefined;
  observed: HexAtlasEntity;
}): HexAtlasEntity["channels"] {
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
 *
 * @internal
 */
export function foldHexChannel({
  stored,
  observed,
  channel,
}: {
  stored: HexAtlasEntity | undefined;
  observed: HexAtlasEntity;
  channel: HexAtlasChannel;
}): HexAtlasEntity {
  const fresh = observed.channels[channel];
  const previous = storedChannel({ channel, stored });
  const merged: HexChannelEntity | null = fresh === null ? previous : carriedForward({ fresh, previous });
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
export function staleHexChannel({
  stored,
  channel,
}: {
  stored: HexAtlasEntity;
  channel: HexAtlasChannel;
}): HexAtlasEntity | null {
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
export function mergeHexChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly HexAtlasEntity[];
  observed: readonly HexAtlasEntity[];
  channel: HexAtlasChannel;
  at: string;
}): Result<readonly HexAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldHexChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleHexChannel({ channel, stored: held }),
    stored,
  });
}
