/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write this atlas: `sync.ts` fills the `api` channel from the route probe and, when a key
 * exists, the content reads; `browserSurface.ts` fills the `browser` channel from a dashboard walk. A
 * kind-scoped merge would let each one stale every row the other owns, and since the corroboration between
 * the two is an OUTPUT of this atlas rather than a build-time check (`docs/atlas-intent/04-corroboration.md`), that would
 * destroy exactly the thing the second surface exists to produce.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import { isWorkosContentKind } from "./contentAcquire.js";
import type { WorkosAtlasChannel, WorkosAtlasEntity, WorkosAtlasKind, WorkosChannelEntity } from "./model.js";
import type { WorkosAcquisition } from "./syncGaps.js";

/** What the stored generation held on one channel of an entity; a new entity has held nothing yet. */
function storedChannel({
  stored,
  channel,
}: {
  stored: WorkosAtlasEntity | undefined;
  channel: WorkosAtlasChannel;
}): WorkosChannelEntity | null {
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
  fresh: WorkosChannelEntity;
  previous: WorkosChannelEntity | null;
}): WorkosChannelEntity {
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
  stored: WorkosAtlasEntity | undefined;
  observed: WorkosAtlasEntity;
}): WorkosAtlasEntity["channels"] {
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
export function foldWorkosChannel({
  stored,
  observed,
  channel,
}: {
  stored: WorkosAtlasEntity | undefined;
  observed: WorkosAtlasEntity;
  channel: WorkosAtlasChannel;
}): WorkosAtlasEntity {
  const fresh = observed.channels[channel];
  const previous = storedChannel({ channel, stored });
  const merged: WorkosChannelEntity | null = fresh === null ? previous : carriedForward({ fresh, previous });
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
export function staleWorkosChannel({
  stored,
  channel,
}: {
  stored: WorkosAtlasEntity;
  channel: WorkosAtlasChannel;
}): WorkosAtlasEntity | null {
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
export function mergeWorkosChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly WorkosAtlasEntity[];
  observed: readonly WorkosAtlasEntity[];
  channel: WorkosAtlasChannel;
  at: string;
}): Result<readonly WorkosAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldWorkosChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleWorkosChannel({ channel, stored: held }),
    stored,
  });
}

/**
 * Merge one channel's fresh projections WITHOUT staling anything this run did not see.
 *
 * ## Why a partial observation needs its own merge
 *
 * Staling the absent is only correct when a run actually LOOKED at everything the kind holds. The content
 * kinds are the case where it is not: with no API key, a sync still publishes the route map and observes
 * nothing whatever about the organisations and users a previous, credentialled run may have read. Staling
 * them would report an organisation as no longer current on the strength of a run that never asked about
 * it — the opposite of "accumulate, never replace".
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
export function mergeWorkosPartialChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly WorkosAtlasEntity[];
  observed: readonly WorkosAtlasEntity[];
  channel: WorkosAtlasChannel;
  at: string;
}): Result<readonly WorkosAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldWorkosChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: () => null,
    stored,
  });
}

/**
 * Merge one kind, choosing whether this run saw enough of it to stale what it did not.
 *
 * Three cases, and they are genuinely different rather than three spellings of one. The route map and the
 * page map are fully observed on EVERY run, credential or not, because neither needs one. A content kind
 * whose OWN family synced is fully observed too. A content kind whose own family failed or was never
 * attempted is left exactly as it stands — staling it would report an organisation as no longer current on
 * the strength of a run that never asked.
 *
 * The grade read here is the FAMILY's, never the rollup: a directories read that broke must not stale an
 * organisation the same run read perfectly well.
 *
 * @param acquisition what both halves produced
 * @param kind the kind being merged
 * @param observed this run's projection for it
 * @param stored what the generation already holds
 * @param at this run's ISO timestamp
 * @returns the merged entities, or the reason the merge was refused
 */
export function mergeFor({
  acquisition,
  kind,
  observed,
  stored,
  at,
}: {
  acquisition: WorkosAcquisition;
  kind: WorkosAtlasKind;
  observed: readonly WorkosAtlasEntity[];
  stored: readonly WorkosAtlasEntity[];
  at: string;
}): Result<readonly WorkosAtlasEntity[]> {
  if (!isWorkosContentKind(kind)) {
    return mergeWorkosChannel({ at, channel: "api", observed, stored });
  }
  const outcome = acquisition.families[kind].outcome;
  if (outcome === "synced") {
    return mergeWorkosChannel({ at, channel: "api", observed, stored });
  }
  if (outcome === "truncated") {
    // A truncated read saw a real prefix of this family. Merging it partially keeps what it found without
    // staling the tail it never reached, which is exactly what a bounded read is entitled to claim.
    return mergeWorkosPartialChannel({ at, channel: "api", observed, stored });
  }
  return ok(stored);
}
