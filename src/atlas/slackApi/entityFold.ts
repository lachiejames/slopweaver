/**
 * The two per-entity callbacks `kit/merge.ts` takes for the Slack atlas: the fold of a fresh observation onto
 * its stored predecessor, and the stale mark for an entity this run did not see. Pure.
 *
 * Split out of `atlasSync.ts` because they are the whole of what one ENTITY's lifetime looks like across
 * runs, while that module assembles a generation. {@link foldSlackEntity} writes only the channels this run
 * actually observed: a run that drove the browser and did not re-read the SDK leaves the `api` channel exactly
 * as it was, with its own `firstSeenAt` intact. One surface succeeding must never erase what the other knew.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { SlackAtlasEntity, SlackChannelEntity } from "./atlasModel.js";
import { SlackAtlasErrors, slackAtlasErrorLines } from "./errors.js";

/**
 * One channel after this run: the stored slot when this run did not observe it, else the fresh view keeping
 * the stored `firstSeenAt` — a channel never seen before has none to keep, so the fresh one is first sight.
 */
function refreshedChannel({
  fresh,
  held,
}: {
  fresh: SlackChannelEntity | null;
  held: SlackChannelEntity | null;
}): SlackChannelEntity | null {
  if (fresh === null) {
    return held;
  }
  if (held === null) {
    return { ...fresh };
  }
  return { ...fresh, firstSeenAt: held.firstSeenAt };
}

/**
 * Fold one freshly observed entity onto its stored predecessor, per channel.
 *
 * @param stored what the store already holds for this id, or `undefined` when it is new
 * @param observed what this run saw
 * @returns the folded entity, or the reason the two cannot be the same thing
 */
export function foldSlackEntity({
  stored,
  observed,
}: {
  stored: SlackAtlasEntity | undefined;
  observed: SlackAtlasEntity;
}): Result<SlackAtlasEntity> {
  if (stored === undefined) {
    return ok(observed);
  }
  if (stored.kind !== observed.kind || stored.providerId !== observed.providerId) {
    return err(slackAtlasErrorLines({ error: SlackAtlasErrors.identityClash({ observed, stored }) }));
  }
  return ok({
    ...stored,
    channels: {
      api: refreshedChannel({ fresh: observed.channels.api, held: stored.channels.api }),
      browser: refreshedChannel({ fresh: observed.channels.browser, held: stored.channels.browser }),
    },
  });
}

/**
 * Mark every channel of a stored entity this run did not see as stale.
 *
 * @param stored the entity nothing observed this run
 * @returns the staled entity, or `null` when every channel is already stale
 */
export function staleSlackEntity({ stored }: { stored: SlackAtlasEntity }): SlackAtlasEntity | null {
  const alreadyStale =
    (stored.channels.api === null || stored.channels.api.state === "stale") &&
    (stored.channels.browser === null || stored.channels.browser.state === "stale");
  if (alreadyStale) {
    return null;
  }
  return {
    ...stored,
    channels: {
      api: stored.channels.api === null ? null : { ...stored.channels.api, state: "stale" },
      browser: stored.channels.browser === null ? null : { ...stored.channels.browser, state: "stale" },
    },
  };
}
