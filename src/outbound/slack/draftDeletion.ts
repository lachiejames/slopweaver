/**
 * Which released rows a `slack delete` of one message has to journal as deleted.
 *
 * A finding the owner shared earns one follow-up card while its message stands (`./sharedFindings.ts`), and the register
 * is the only place a finding is read from — so a deletion the register never hears of leaves a finding owed a chase
 * on a message nobody can see. MEASURED: `slack finding-followups` listed `sd-dd932464` 228h quiet while
 * `slack read-thread C0SYN000001 1791764888.080129` answered that the message was deleted. `slack delete` therefore
 * journals a `deleted` event on every row whose release landed at the deleted coordinate.
 *
 * Pure: no clock, no filesystem.
 */
import type { SlackDraftEvent } from "./draftRegister.js";

/**
 * The ids whose release landed at `channel`/`ts` and carry no `deleted` event for that same coordinate yet.
 *
 * Deduplicated on the whole `(id, channel, ts)` tuple, the key `sharedFindingsOf` drops a finding on, so a retry after a
 * partial append journals only what is still missing.
 *
 * @param events the register's events, in append order
 * @param channel the deleted message's channel
 * @param ts the deleted message's own Slack `ts`
 * @returns each matching id once, in first-release order; empty when no row released there or all are journalled
 */
export function draftDeletionIds({
  events,
  channel,
  ts,
}: {
  events: readonly SlackDraftEvent[];
  channel: string;
  ts: string;
}): readonly string[] {
  const journalled = new Set(
    events.flatMap((event) =>
      event.kind === "deleted" && event.channel === channel && event.ts === ts ? [event.id] : [],
    ),
  );
  const released = events.flatMap((event) =>
    event.kind === "released" && event.channel === channel && event.ts === ts ? [event.id] : [],
  );
  return [...new Set(released)].filter((id) => !journalled.has(id));
}
