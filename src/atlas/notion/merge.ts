/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write the `method` kind: `sync.ts` fills the `api` channel from the installed SDK, and
 * `browserSurface.ts` fills the `browser` channel from a walk. A kind-scoped merge would let each one stale
 * every row the other owns — the browser's undocumented operations would go stale the moment a sync ran,
 * and the SDK's declared endpoints would go stale the moment a walk did. Since the disjointness between
 * those two sets is the finding this atlas exists to produce, that would destroy exactly the output.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { NotionAtlasChannel, NotionAtlasEntity, NotionChannelEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: NotionAtlasEntity | undefined;
  observed: NotionAtlasEntity;
}): NotionAtlasEntity["channels"] {
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
export function foldNotionChannel({
  stored,
  observed,
  channel,
}: {
  stored: NotionAtlasEntity | undefined;
  observed: NotionAtlasEntity;
  channel: NotionAtlasChannel;
}): NotionAtlasEntity {
  const merged = refreshedChannel({ fresh: observed.channels[channel], stored, which: channel });
  return {
    ...observed,
    channels: { ...baseChannels({ observed, stored }), [channel]: merged },
  };
}

/** The refreshed channel's slot after this run: a slot is null exactly when that channel has not observed it. */
function refreshedChannel({
  fresh,
  stored,
  which,
}: {
  fresh: NotionChannelEntity | null;
  stored: NotionAtlasEntity | undefined;
  which: NotionAtlasChannel;
}): NotionChannelEntity | null {
  if (stored === undefined) {
    // A new entity: this run's reading is all there is.
    return fresh;
  }
  const previous = stored.channels[which];
  if (fresh === null) {
    // This channel did not see the entity this run, so its stored slot stands exactly as it was.
    return previous;
  }
  if (previous === null) {
    // The first sighting on this channel: it was first seen now.
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
export function staleNotionChannel({
  stored,
  channel,
}: {
  stored: NotionAtlasEntity;
  channel: NotionAtlasChannel;
}): NotionAtlasEntity | null {
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
export function mergeNotionChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly NotionAtlasEntity[];
  observed: readonly NotionAtlasEntity[];
  channel: NotionAtlasChannel;
  at: string;
}): Result<readonly NotionAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldNotionChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleNotionChannel({ channel, stored: held }),
    stored,
  });
}
