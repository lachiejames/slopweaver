/**
 * The detector: which `(app, channel)` pairs LOOK like pure alert traffic, so nobody has to notice by hand.
 *
 * ## Why a detector rather than a longer hand-written list
 *
 * The owner was invited to a Nightfall DLP channel and found out it was junk by reading it; the Datadog
 * channel had been half the corpus for months before anyone measured it. The detector takes the
 * generalisation deliberately: a rule that finds the NEXT one is worth more than a list of the two we know.
 *
 * ## The criterion, and why these two numbers
 *
 * A pair qualifies when one app wrote at least {@link DETECTOR_MIN_APP_ROWS} rows in a channel AND those
 * rows are at least {@link DETECTOR_MIN_SHARE_PERCENT} percent of everything stored for that channel. The
 * share is the whole idea: measured over a store of a couple of million rows, the SAME Datadog app
 * is **nearly all** of `#monitor-feed` and **a small minority** of `#sync-alerts`, where over a
 * thousand human rows are the actual conversation. One number separates them, so neither channel needs naming.
 *
 * The threshold is not a tuning surface, which is the evidence it is the right shape rather than a fitted
 * one. Holding the share at 95% and moving only the row floor: raising it from 100 to 500 to 2,000 sheds
 * pairs a few at a time while the rows they cover barely move, staying within one percent of a million.
 * There is no cliff anywhere in that range.
 * Repro: the pair-share query in the spam-exclusion heuristic's run journal.
 *
 * ## Detection never changes policy, and that is the whole safety property
 *
 * This module PROPOSES. A proposal becomes a denial only when somebody writes it into
 * `$SLOPWEAVER_HOME/sync-author-denylist.txt`, and once written it stays written however the channel's
 * share drifts afterwards. The alternative — recomputing the rule on every sync — means a channel that
 * gets busy silently starts being indexed again, and a quiet week silently stops: policy that moves on its
 * own is policy nobody can reason about. So there is no expiry here, no sync-time detector call, and
 * nothing in the sync path imports this file.
 */

/** The fewest rows one app must have written in a channel before a pair is worth proposing. */
export const DETECTOR_MIN_APP_ROWS = 500;

/** The share of a channel's rows one app must hold, as a percentage, before its traffic reads as alerts. */
export const DETECTOR_MIN_SHARE_PERCENT = 95;

/** One app's footprint in one channel, as the store counts it. */
export interface AppChannelCount {
  /** The Slack app id that wrote {@link appRows}. */
  readonly appId: string;
  readonly channelId: string;
  /** The channel's human-readable name, when the store has one. */
  readonly channelName: string | null;
  /** How many rows this app wrote in this channel. */
  readonly appRows: number;
  /** How many rows the channel holds in total — every author, bot and human alike. */
  readonly channelRows: number;
}

/** A pair the detector says looks like pure alert traffic. */
export interface SyncExclusionProposal extends AppChannelCount {
  /** What fraction of the channel this app wrote, as a percentage rounded to one decimal place. */
  readonly share: number;
  /** The line an operator would add to the denylist to act on this. */
  readonly denylistLine: string;
}

/**
 * How a proposed denylist line names the channel. A direct message has no name in Slack, so the store holds
 * none for it, and its id is the only thing that line can name.
 */
function denylistChannel({ count }: { count: AppChannelCount }): string {
  const { channelName } = count;
  if (channelName == null) {
    return count.channelId;
  }
  return channelName;
}

/**
 * Every pair that clears both thresholds, largest first.
 *
 * Ordered by row count rather than by share so the one worth reading is first; ties break on the pair's own
 * ids so the output is the same on every run and a diff of two proposals means something.
 *
 * A channel with no rows is skipped rather than dividing by zero — it cannot happen in a store read, and a
 * detector that threw on an empty count would fail at exactly the moment an operator was trying to find out
 * why the store looked wrong.
 *
 * @param counts one row per `(app, channel)` pair the store holds
 * @returns the qualifying pairs, largest first
 */
export function proposeSyncExclusions({
  counts,
}: {
  counts: readonly AppChannelCount[];
}): readonly SyncExclusionProposal[] {
  return counts
    .filter((count) => qualifies({ count }))
    .map((count) => ({
      ...count,
      denylistLine: `${count.appId} @ ${denylistChannel({ count })}`,
      share: Math.round((count.appRows * 1000) / count.channelRows) / 10,
    }))
    .toSorted(
      (a, b) => b.appRows - a.appRows || a.appId.localeCompare(b.appId) || a.channelId.localeCompare(b.channelId),
    );
}

/**
 * Whether one pair clears both thresholds.
 *
 * The share is tested by cross-multiplication rather than by dividing, so a pair sitting exactly on 95%
 * qualifies rather than depending on how a float rounded.
 *
 * @param count the pair to judge
 * @returns true when the app is both big enough and dominant enough
 */
function qualifies({ count }: { count: AppChannelCount }): boolean {
  if (count.channelRows <= 0 || count.appRows < DETECTOR_MIN_APP_ROWS) {
    return false;
  }
  return count.appRows * 100 >= count.channelRows * DETECTOR_MIN_SHARE_PERCENT;
}
