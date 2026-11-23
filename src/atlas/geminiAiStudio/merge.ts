/**
 * Folding one CHANNEL's fresh observations into the stored generation, leaving the other channels alone.
 *
 * Three passes will eventually write here: `sync.ts` fills the `compiled` channel from the published
 * discovery documents, a future client would fill `api`, and a walk fills `browser`. A kind-scoped merge
 * would let each one stale every row the others own — the compiled surface would go stale the moment a walk
 * ran, and vice versa. Since the corroboration BETWEEN those channels is what an atlas exists to produce,
 * that would destroy the output rather than merely mis-timestamp it.
 *
 * So a run declares WHICH channel it is refreshing. An entity it did not observe has that one channel marked
 * stale and keeps everything else it knew, and the kit's own `mergeKind` supplies the rest: the duplicate-id
 * refusal, the stale-the-absent pass, the sort and the `Result`.
 */
import { ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { GeminiAiStudioAtlasEntity, GeminiAiStudioChannel, GeminiAiStudioChannelEntity } from "./model.js";

/** The channels an entity starts from: the stored generation's when there is one, else this run's. */
function baseChannels({
  stored,
  observed,
}: {
  stored: GeminiAiStudioAtlasEntity | undefined;
  observed: GeminiAiStudioAtlasEntity;
}): GeminiAiStudioAtlasEntity["channels"] {
  if (stored == null) {
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
export function foldGeminiAiStudioChannel({
  stored,
  observed,
  channel,
}: {
  stored: GeminiAiStudioAtlasEntity | undefined;
  observed: GeminiAiStudioAtlasEntity;
  channel: GeminiAiStudioChannel;
}): GeminiAiStudioAtlasEntity {
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
  stored: GeminiAiStudioAtlasEntity | undefined;
  channel: GeminiAiStudioChannel;
}): GeminiAiStudioChannelEntity | null {
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
  fresh: GeminiAiStudioChannelEntity | null;
  previous: GeminiAiStudioChannelEntity | null;
}): GeminiAiStudioChannelEntity | null {
  if (fresh === null) {
    return previous;
  }
  if (previous === null) {
    // This channel's first look at the operation, so its own sighting is the first one.
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
 *
 * @internal
 */
export function staleGeminiAiStudioChannel({
  stored,
  channel,
}: {
  stored: GeminiAiStudioAtlasEntity;
  channel: GeminiAiStudioChannel;
}): GeminiAiStudioAtlasEntity | null {
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
export function mergeGeminiAiStudioChannel({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly GeminiAiStudioAtlasEntity[];
  observed: readonly GeminiAiStudioAtlasEntity[];
  channel: GeminiAiStudioChannel;
  at: string;
}): Result<readonly GeminiAiStudioAtlasEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) =>
      ok(foldGeminiAiStudioChannel({ channel, observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleGeminiAiStudioChannel({ channel, stored: held }),
    stored,
  });
}
