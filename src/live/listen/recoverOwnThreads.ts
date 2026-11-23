/**
 * The bot's OWN threads, registered with recovery so a later reply in one reaches the loop's existing ask detection.
 *
 * The rule is to check in on threads later to see if there have been replies. The scheduled sweep (`./recoverSweep.ts`) already polls a budgeted set of KNOWN threads
 * for replies its history window can no longer see, and already classifies every reply it finds through the same
 * candidate path the live listener uses — so a reply under the bot's message that tags it, or that thread-reply
 * addressing admits, becomes a captured ask exactly as one arriving live would. What it did not have was the list of
 * threads the bot itself spoke in: a root is registered only when the sweep's own history window shows it, so an
 * answer the bot posted under somebody else's question, in a thread whose root scrolled out before the next sweep,
 * was a thread nothing would ever look in again.
 *
 * The placement journal (`../slack/placementJournal.ts`) names every message a guarded post settled, with the thread
 * it sits in, so this reads that and nothing else. Pure: the rows arrive already read.
 *
 * Three choices that are the design rather than a detail:
 *
 * - **The bot's own posts only** (`botId` present on the row). The sweep reads with the bot token, and the loop's ask
 *   detection is about the bot being addressed; a post as the owner in a channel the bot is not in would be a thread the
 *   sweep cannot open.
 * - **The cursor is the bot's FIRST message in the thread**, so what the sweep surfaces is everything a person said
 *   after the bot first spoke there — the replies before it were the conversation the turn already read. Its LATEST
 *   message would skip a reply that landed between two of its own posts (an answer, a person replying, a progress
 *   notice) during an outage: exactly the reply this registration exists to find. A key the inventory already holds keeps its own cursor:
 *   these registrations sit BENEATH everything else, exactly as the sweep's own root registrations do.
 * - **A bounded look-back** ({@link OWN_THREAD_LOOKBACK_DAYS}). The journal grows forever and the sweep retires a
 *   thread it proves deleted; a registration window keeps a retired thread from being re-registered, and re-read, on
 *   every sweep for the rest of time.
 */
import { threadKey } from "../../corpus/slack/threadCursors.js";
import { slackTsToEpochMs } from "../../lib/slackTs.js";
import type { PlacementJournalRow } from "../slack/placementJournal.js";
import type { RecoveryThreadCheckpoint, RecoveryThreadCheckpoints } from "./recoverThreads.js";

/**
 * How far back a settled post's thread is still worth registering. Fourteen days: it is a REGISTRATION window, not a
 * re-read window — a thread registered once stays in the sweep's state until the sweep retires it — so it only has to
 * outlast the gap between two sweeps. The stated loss: a thread no sweep ran for in its first fourteen days is never
 * registered, and `conversations.history` lists roots, never threaded replies, so a later reply there reaches only
 * the live listener.
 */
export const OWN_THREAD_LOOKBACK_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The exact `seconds.micros` shape `RecoverySweepStateV2` (`./recoverSchedule.ts`) validates every stored cursor
 * against — one malformed value would make the whole durable state unreadable on the next boot, so a row whose
 * `ts` is any looser shape is skipped rather than registered.
 */
const EXACT_SLACK_TS = /^\d+\.\d{6}$/;

/**
 * One seed checkpoint per thread the bot posted into within the look-back, keyed as `threadKey` writes it.
 *
 * The look-back decides WHICH threads register; it never moves a cursor. A thread whose first bot post is older than
 * the window but which the bot spoke in again inside it is cursored at that first post, so a person's reply between
 * the two is still found.
 *
 * @param rows the placement journal, in file order
 * @param nowTs the sweep's own clock, as a Slack `ts` — the look-back is measured back from it
 * @returns the registrations; the OLDEST post in a thread wins, so nothing said after the bot first spoke is skipped
 */
export function ownThreadRegistrations({
  rows,
  nowTs,
}: {
  rows: readonly PlacementJournalRow[];
  nowTs: string;
}): RecoveryThreadCheckpoints {
  const nowMs = slackTsToEpochMs({ ts: nowTs });
  if (nowMs === undefined) {
    return {};
  }
  const cutoffMs = nowMs - OWN_THREAD_LOOKBACK_DAYS * DAY_MS;
  const earliest: Record<string, RecoveryThreadCheckpoint> = {};
  const inWindow = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "placement-settled" || row.botId === undefined || row.threadRoot === undefined) {
      continue;
    }
    const postedMs = slackTsToEpochMs({ ts: row.final.ts });
    const exact = EXACT_SLACK_TS.test(row.final.ts) && EXACT_SLACK_TS.test(row.threadRoot);
    // A post settled at or after the sweep's clock is the next sweep's to register, and its cursor with it.
    if (postedMs === undefined || postedMs >= nowMs || !exact) {
      continue;
    }
    const key = threadKey({ channel: row.final.channel, threadTs: row.threadRoot });
    const prior = earliest[key];
    if (prior === undefined || row.final.ts < prior.cursorTs) {
      earliest[key] = { cursorTs: row.final.ts };
    }
    if (postedMs > cutoffMs) {
      inWindow.add(key);
    }
  }
  return Object.fromEntries(Object.entries(earliest).filter(([key]) => inWindow.has(key)));
}
