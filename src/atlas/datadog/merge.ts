/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other two alone.
 *
 * Three passes will write here, and they are exactly the three surfaces `descriptor.ts` declares:
 * `sync.ts` fills `compiled-catalogue` from the committed registry, a live pass will fill `api`, and a walk
 * will fill `console`. A kind-scoped merge — one that replaced an entity outright — would let each pass
 * stale every row the others own: the compiled catalogue would go stale the moment a live sync ran, and
 * vice versa. Since the corroboration BETWEEN those channels is what this atlas exists to produce, that
 * would destroy the output rather than merely mis-timestamp it.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and `kit/merge.ts`'s `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 *
 * ## `firstSeenAt` is carried forward, per channel
 *
 * An operation the compiled catalogue has held since the first generation must not claim to have been
 * discovered today just because a later run re-published it. The stamp belongs to the CHANNEL rather than
 * to the entity, because "the catalogue has known this for a month and the API first answered for it this
 * morning" is a fact this atlas should be able to state.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { DatadogChannel, DatadogChannelEntity, DatadogEntity } from "./documents.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: DatadogEntity | undefined;
  observed: DatadogEntity;
}): DatadogEntity["channels"] {
  if (stored == null) {
    return observed.channels;
  }
  return stored.channels;
}

/**
 * Fold one observed entity onto its stored predecessor, replacing only the channel this run refreshed.
 *
 * @param stored the entity as the last generation held it, or `undefined` when it is new
 * @param observed this run's view of it
 * @param channel which channel this run refreshed
 * @returns the merged entity
 *
 * @internal
 */
export function foldDatadogChannel({
  stored,
  observed,
  channel,
}: {
  stored: DatadogEntity | undefined;
  observed: DatadogEntity;
  channel: DatadogChannel;
}): DatadogEntity {
  const merged = mergedChannel({ fresh: observed.channels[channel], previous: previousChannel({ channel, stored }) });
  return {
    ...observed,
    channels: { ...baseChannels({ observed, stored }), [channel]: merged },
  };
}

/** What the stored generation held on one channel: nothing, by design, for an entity this run is first to see. */
function previousChannel({
  stored,
  channel,
}: {
  stored: DatadogEntity | undefined;
  channel: DatadogChannel;
}): DatadogChannelEntity | null {
  if (stored === undefined) {
    return null;
  }
  return stored.channels[channel];
}

/**
 * One channel after this run: the stored view when this run did not look, else the fresh view carrying the
 * first sighting forward — or its own, when no earlier generation had seen it on this channel.
 */
function mergedChannel({
  fresh,
  previous,
}: {
  fresh: DatadogChannelEntity | null;
  previous: DatadogChannelEntity | null;
}): DatadogChannelEntity | null {
  if (fresh === null) {
    return previous;
  }
  return { ...fresh, firstSeenAt: previous === null ? fresh.firstSeenAt : previous.firstSeenAt };
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
export function staleDatadogChannel({
  stored,
  channel,
}: {
  stored: DatadogEntity;
  channel: DatadogChannel;
}): DatadogEntity | null {
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
export function mergeDatadogChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly DatadogEntity[];
  observed: readonly DatadogEntity[];
  channel: DatadogChannel;
  at: string;
}): Result<readonly DatadogEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldDatadogChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleDatadogChannel({ channel, stored: held }),
    stored,
  });
}
