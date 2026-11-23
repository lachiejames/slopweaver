/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channel alone.
 *
 * ## Why the merge is channel-scoped rather than kind-scoped
 *
 * Two passes write here: the surface sync fills the `api` channel from the two pinned documents and, once a
 * credential exists, from the live APIs, and a dashboard walk fills the `browser` channel. A kind-scoped
 * merge would let each one stale every row the other owns, and since the corroboration between the two
 * channels is an OUTPUT of this atlas rather than a build-time check (`docs/atlas-intent/04-corroboration.md`), that
 * would destroy exactly the thing being produced.
 *
 * On this platform there is a second, sharper reason. The two channels overlap on ONE kind and on one kind
 * only: `dashboard-route`, where the API channel knows what the application declares and the browser
 * channel knows what it actually rendered. A kind-scoped merge would make a walk that reached only some
 * pages blank the declaration of every route it did not reach — turning the atlas's own route table into a report of
 * where the browser happened to go.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel
 * marked stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the
 * duplicate-id refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { KnockAtlasChannel, KnockChannelEntity, KnockEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: KnockEntity | undefined;
  observed: KnockEntity;
}): KnockEntity["channels"] {
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
export function foldKnockChannel({
  stored,
  observed,
  channel,
}: {
  stored: KnockEntity | undefined;
  observed: KnockEntity;
  channel: KnockAtlasChannel;
}): KnockEntity {
  const merged = mergedChannel({ fresh: observed.channels[channel], previous: storedChannel({ channel, stored }) });
  return { ...observed, channels: { ...baseChannels({ observed, stored }), [channel]: merged } };
}

/** One channel of the stored entity, or `null` when the entity is new and so was never stored at all. */
function storedChannel({
  stored,
  channel,
}: {
  stored: KnockEntity | undefined;
  channel: KnockAtlasChannel;
}): KnockChannelEntity | null {
  if (stored === undefined) {
    return null;
  }
  return stored.channels[channel];
}

/**
 * One channel after this run: the stored view where this run saw nothing on it, else this run's view with
 * the stored first sighting kept — and this run's own `firstSeenAt` where the channel had none.
 */
function mergedChannel({
  fresh,
  previous,
}: {
  fresh: KnockChannelEntity | null;
  previous: KnockChannelEntity | null;
}): KnockChannelEntity | null {
  if (fresh === null) {
    return previous;
  }
  if (previous === null) {
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
export function staleKnockChannel({
  stored,
  channel,
}: {
  stored: KnockEntity;
  channel: KnockAtlasChannel;
}): KnockEntity | null {
  const held = stored.channels[channel];
  if (held === null || held.state === "stale") {
    return null;
  }
  return { ...stored, channels: { ...stored.channels, [channel]: { ...held, state: "stale" } } };
}

/**
 * Merge one channel's fresh projections for one kind into what the store already holds.
 *
 * ## `staleAbsent: false` is what a run that COULD NOT LOOK passes, and it is not an optimisation
 *
 * MEASURED, and the bug it fixes was real rather than hypothetical. A dashboard walk lost its
 * session on the FIRST page and attempted no other; every other declared page was therefore absent from
 * its observations, and a merge that staled the absent marked every one of them stale although an earlier
 * walk had genuinely reached and photographed them. Nothing was lost — a stale channel
 * keeps its detail — but the atlas would have been reporting a session failure as though it were evidence
 * about the pages.
 *
 * "Absent from this run's observations" means two different things and the caller is the only one that
 * knows which: a page this run LOOKED for and did not find is stale, and a page this run never got to is
 * unobserved. `sync.ts` stales, because a compiled projection sees every row there is; a walk stales only
 * when it ran to completion.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities, each carrying only the refreshed channel
 * @param channel which channel this run refreshed
 * @param staleAbsent whether an entity this run did not observe should have its channel marked stale
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeKnockChannel({
  stored,
  observed,
  channel,
  staleAbsent,
  at,
}: {
  stored: readonly KnockEntity[];
  observed: readonly KnockEntity[];
  channel: KnockAtlasChannel;
  staleAbsent: boolean;
  at: string;
}): Result<readonly KnockEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldKnockChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => (staleAbsent ? staleKnockChannel({ channel, stored: held }) : null),
    stored,
  });
}
