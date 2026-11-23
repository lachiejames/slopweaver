/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write this atlas: `sync.ts` fills the `api` channel from Hive's own GraphQL API, and
 * `browserSurface.ts` fills the `browser` channel from a console walk. A kind-scoped merge would let each
 * one stale every row the other owns, and since the corroboration between the two is an OUTPUT of this
 * atlas rather than a build-time check (`docs/atlas-intent/04-corroboration.md`), that would destroy exactly the thing
 * the second surface exists to produce.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { HiveAtlasChannel, HiveAtlasEntity, HiveChannelEntity } from "./model.js";

/** What the stored generation held on one channel of an entity; a new entity has held nothing yet. */
function storedChannel({
  stored,
  channel,
}: {
  stored: HiveAtlasEntity | undefined;
  channel: HiveAtlasChannel;
}): HiveChannelEntity | null {
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
  fresh: HiveChannelEntity;
  previous: HiveChannelEntity | null;
}): HiveChannelEntity {
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
  stored: HiveAtlasEntity | undefined;
  observed: HiveAtlasEntity;
}): HiveAtlasEntity["channels"] {
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
export function foldHiveChannel({
  stored,
  observed,
  channel,
}: {
  stored: HiveAtlasEntity | undefined;
  observed: HiveAtlasEntity;
  channel: HiveAtlasChannel;
}): HiveAtlasEntity {
  const fresh = observed.channels[channel];
  const previous = storedChannel({ channel, stored });
  const merged: HiveChannelEntity | null = fresh === null ? previous : carriedForward({ fresh, previous });
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
export function staleHiveChannel({
  stored,
  channel,
}: {
  stored: HiveAtlasEntity;
  channel: HiveAtlasChannel;
}): HiveAtlasEntity | null {
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
export function mergeHiveChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly HiveAtlasEntity[];
  observed: readonly HiveAtlasEntity[];
  channel: HiveAtlasChannel;
  at: string;
}): Result<readonly HiveAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldHiveChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleHiveChannel({ channel, stored: held }),
    stored,
  });
}

/**
 * Merge one channel's fresh projections WITHOUT staling anything this run did not see.
 *
 * ## Why a partial observation needs its own merge
 *
 * Staling the absent is only correct when a run actually LOOKED at everything the kind holds. The console
 * page map is the case where it is not: with no registry access, a sync can still expand the two
 * root-scope console routes, and it observes nothing whatever about the organisation-, project- and
 * target-scoped pages a previous, credentialled run published. Staling them would report a page as no
 * longer current on the strength of a run that never asked about it — the opposite of "accumulate, never
 * replace".
 *
 * So this is the deliberate second shape rather than a flag on the first: a caller has to choose, and the
 * choice is visible at the call site.
 *
 * @param stored every entity this kind's file already holds
 * @param observed the subset this run genuinely observed
 * @param channel which channel this run refreshed
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeHivePartialChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly HiveAtlasEntity[];
  observed: readonly HiveAtlasEntity[];
  channel: HiveAtlasChannel;
  at: string;
}): Result<readonly HiveAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldHiveChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: () => null,
    stored,
  });
}
