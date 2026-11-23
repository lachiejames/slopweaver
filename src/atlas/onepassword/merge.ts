/**
 * This atlas's per-kind merge: the kit's lifecycle, plus the one decision that is this platform's own.
 *
 * An entity here carries THREE independent channel states, and a run over one channel must never touch
 * another's. The roster kinds are only ever observed on `admin-cli` and events only on `events-api`, so in
 * practice one channel moves per kind — but the browser channel is declared and will one day be filled, and
 * an `admin-cli` sync that erased a browser observation would be exactly the corroboration loss the
 * three-channel shape exists to prevent.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import type { OnepasswordChannel, OnepasswordChannelEntity, OnepasswordEntity } from "./model.js";
import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "./syncErrors.js";

/** Every channel other than the one a run is folding, so the fold can carry them across untouched. */
function otherChannels({
  stored,
  channel,
}: {
  stored: OnepasswordEntity | undefined;
  channel: OnepasswordChannel;
}): Record<OnepasswordChannel, OnepasswordChannelEntity | null> {
  if (stored === undefined) {
    // A new entity: no channel has looked at it before this run, so there is nothing to carry across.
    return { "admin-cli": null, browser: null, "events-api": null };
  }
  return {
    "admin-cli": channel === "admin-cli" ? null : stored.channels["admin-cli"],
    browser: channel === "browser" ? null : stored.channels.browser,
    "events-api": channel === "events-api" ? null : stored.channels["events-api"],
  };
}

/**
 * When this channel first saw the entity: its stored first sighting when it has looked before, or this run's
 * instant when the entity is new or this channel has never looked at it.
 */
function channelFirstSeenAt({
  prior,
  channel,
  when,
}: {
  prior: OnepasswordEntity | undefined;
  channel: OnepasswordChannel;
  when: string;
}): string {
  if (prior === undefined) {
    return when;
  }
  const priorChannel = prior.channels[channel];
  if (priorChannel === null) {
    return when;
  }
  return priorChannel.firstSeenAt;
}

/**
 * Merge this run's fresh projections for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities, every one on `channel`
 * @param channel which channel this run observed through
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeOnepasswordKind({
  stored,
  observed,
  channel,
  at,
}: {
  stored: readonly OnepasswordEntity[];
  observed: readonly OnepasswordEntity[];
  channel: OnepasswordChannel;
  at: string;
}): Result<readonly OnepasswordEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: prior, observed: fresh, at: when }): Result<OnepasswordEntity> => {
      const freshChannel = fresh.channels[channel];
      if (freshChannel === null) {
        return err(
          onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.channelEmpty({ channel, entityId: fresh.id }) }),
        );
      }
      const merged: OnepasswordChannelEntity = {
        ...freshChannel,
        firstSeenAt: channelFirstSeenAt({ channel, prior, when }),
      };
      return ok({ ...fresh, channels: { ...otherChannels({ channel, stored: prior }), [channel]: merged } });
    },
    observed,
    staleEntity: ({ stored: entity }): OnepasswordEntity | null => {
      const current = entity.channels[channel];
      if (current === null || current.state === "stale") {
        return null;
      }
      return { ...entity, channels: { ...entity.channels, [channel]: { ...current, state: "stale" } } };
    },
    stored,
  });
}
