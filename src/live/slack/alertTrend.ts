/**
 * The Slack half of an alert card's trend: cut ONE wide crawl into the window the card reports and the
 * baseline behind it. Pure.
 *
 * The judgement those two halves derive — on fire, up, steady, down — is `../../outbound/artifact/trend.ts`,
 * which knows nothing about a Slack timestamp. Split because the two fail differently: a crawl that stopped
 * early is a read problem, and a baseline of zero is a rendering decision.
 *
 * ## One wider read, split on the timestamp — not a banked number
 *
 * The verb reads `window × (1 + priorWindows)` of the channel in one crawl and hands every message here.
 * {@link splitAlertSpan} cuts them on `ts`: the newest `window` is the card's own, unchanged in every number it
 * reports, and the rest is the baseline.
 *
 * The alternative was banking each firing's total on its recipe run record. It costs no extra read at all, and
 * three things sank it, each on its own decisive: it works only on the scheduled path, so a session running
 * `slack alert-summary` by hand would see no trend; a row re-created for any reason is silent forever after,
 * not only on day one; and it puts a number the card REPORTS into mutable state outside the window that number
 * describes, which is the shape `../../outbound/artifact/alertSummary.ts` refuses when it declines to accept a
 * total.
 */

import { slackTsToEpochMs } from "../../lib/slackTs.js";

/** The message slice this module reads — a raw Slack message, structurally. */
export interface SpanMessage {
  readonly ts?: string;
}

/** One span cut in two: the window the card reports, and the windows it is compared against. */
export interface AlertSpan<T extends SpanMessage> {
  /** The messages inside the newest window. These, and only these, are what the card tallies. */
  readonly current: readonly T[];
  /** The messages in the windows before it — the baseline, never rendered as rows. */
  readonly prior: readonly T[];
  /** How many whole prior windows the span was cut for. */
  readonly priorWindows: number;
}

/**
 * The epoch milliseconds one message carries, or nothing when it carries no usable timestamp.
 *
 * Through `slackTsToEpochMs` rather than by hand: the `epoch-arithmetic` gate exists because four hand-rolled
 * copies of that conversion once stood in this tree at once and a Slack `ts` read 80 minutes wrong reached a
 * board row and two supervisors' deadman deadlines.
 */
function instantOf({ message }: { message: SpanMessage }): number | undefined {
  if (message.ts === undefined) {
    return undefined;
  }
  return slackTsToEpochMs({ ts: message.ts });
}

/**
 * Cut one wide crawl into the card's own window and the baseline behind it.
 *
 * A message with no readable timestamp lands in `current`, which is the conservative half: the card's counts
 * are what a reader checks against the channel they are looking at, so an unplaceable message is better counted
 * in what is being REPORTED than folded silently into a baseline nobody sees.
 *
 * @param messages every message the wide crawl returned, in any order
 * @param nowMs the instant the newest window ends at
 * @param windowMs the card's own window
 * @param priorWindows how many windows of baseline were asked for
 * @returns the two halves, and how many whole prior windows the span was cut for
 */
export function splitAlertSpan<T extends SpanMessage>({
  messages,
  nowMs,
  windowMs,
  priorWindows,
}: {
  messages: readonly T[];
  nowMs: number;
  windowMs: number;
  priorWindows: number;
}): AlertSpan<T> {
  const currentFrom = nowMs - windowMs;
  const priorFrom = currentFrom - windowMs * priorWindows;
  const current: T[] = [];
  const prior: T[] = [];
  for (const message of messages) {
    const instant = instantOf({ message });
    if (instant === undefined || instant >= currentFrom) {
      current.push(message);
      continue;
    }
    if (instant >= priorFrom) {
      prior.push(message);
    }
  }
  return { current, prior, priorWindows };
}

/**
 * How far back the wide crawl has to read for a given card window.
 *
 * @param windowMs the card's own window
 * @param priorWindows how many windows of baseline to read behind it
 * @returns the whole span, in milliseconds
 */
export function spanMs({ windowMs, priorWindows }: { windowMs: number; priorWindows: number }): number {
  return windowMs * (1 + priorWindows);
}
