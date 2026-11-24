/**
 * How the change stream (`./LiveChanges.tsx`) steers the shared polls `./useLive.ts` holds: which signals are up, the
 * interval each channel arms under them, and the re-read one change notice starts.
 */
import { QUEUE_CHANGE_HEALTH_DOWN, type QueueChangeHealth, queuePollMs } from "../../lib/queueLiveChanges";
import { channels, intervals } from "./useLiveChannels";
import { fetchInto, rearm } from "./useLiveFetch";
import { keyOf, type Subscriber, urlOfKey } from "./useLiveWire";

/**
 * Which change signals are up on this page now. Down until the change stream says otherwise, so a page with no
 * stream polls as it always did — bar a Queue register read once, which keeps its safety poll.
 */
let changeHealth: QueueChangeHealth = QUEUE_CHANGE_HEALTH_DOWN;

/**
 * The intervals one channel's subscribers asked for, as the channel should arm them under the current change health:
 * a live Queue register whose every signal is up polls only as a safety net (`queuePollMs`). A fixture channel is a
 * frozen reading nothing pushes a change for, so it keeps what was asked.
 *
 * @param key the channel's key, its slug then `|` then any fixture
 * @param asked each subscriber's requested interval, `undefined` for a one-time read
 * @returns the intervals to arm the channel with
 */
export function wantedOf({
  key,
  asked,
}: {
  key: string;
  asked: ReadonlyMap<Subscriber, number | undefined>;
}): number[] {
  const bar = key.indexOf("|");
  const slug = key.slice(0, bar);
  const live = bar === key.length - 1;
  return [...asked.values()].flatMap((askedMs) => {
    const ms = live ? queuePollMs({ askedMs, health: changeHealth, slug }) : askedMs;
    return ms === undefined ? [] : [ms];
  });
}

/**
 * Record which change signals are up, and re-arm every channel's poll for it: slowed to the safety poll when a
 * register's signals came up, back to its old cadence the moment one went down.
 *
 * @param health the signals the change stream reports up, or every one down when the stream itself is
 */
export function setLiveChangeHealth({ health }: { health: QueueChangeHealth }): void {
  changeHealth = health;
  for (const [key, channel] of channels) {
    const asked = intervals.get(key);
    if (asked !== undefined) {
      rearm({ channel, url: urlOfKey({ key }), wanted: wantedOf({ asked, key }) });
    }
  }
}

/**
 * Re-read one register for every component showing it, because the change stream said it moved. Unlike
 * `refreshLive` it keeps the drawn reading on screen until the new one lands: a change somebody else made is
 * news, not a write this page must hide the old reading for. A read already in flight may have left before the change,
 * so it owes one more read when it lands rather than starting a second process now.
 *
 * @param slug the register's live slug
 * @returns whether a read was started or owed — false when nothing on the page reads it
 */
export function refreshSubscribedLive({ slug }: { slug: string }): boolean {
  const key = keyOf({ fixture: undefined, slug });
  const channel = channels.get(key);
  if (channel === undefined || channel.subscribers.size === 0) {
    // Nothing reads it, so nothing is re-read. A reading kept from an earlier visit stays: a mount draws it marked
    // refreshing and reads again at once, so it is never shown as current.
    return false;
  }
  if (channel.inflight) {
    channel.owed = true;
    return true;
  }
  void fetchInto({ cause: "catch-up", channel, url: urlOfKey({ key }) });
  return true;
}
