/**
 * WHICH ASKS a turn-ledger run is about, and nothing about how long any of them took.
 *
 * Its own module beside `./ledger.ts` because the two halves are read at different moments and by
 * different callers: this one runs FIRST, over two whole logs, and narrows the set before
 * `../../cli/commands/turn/ledger.ts` walks a single checkpoint directory off disk. Keeping the narrowing
 * here is what makes a one-day `--since` cost a one-day read rather than a whole home.
 *
 * Pure, like `./ledger.ts`: no filesystem, no clock beyond comparing two instants a caller handed in.
 */
import { parseIsoMs } from "../../lib/date.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import type { AskIdentity } from "../ask/identity.js";
import { askLifecycleKey } from "../ask/lifecycle.js";
import { type AskLifecycleEvent, type CapturedEvent } from "../ask/lifecycleEvents.js";
import type { TurnCompletion, TurnCompletionEvent } from "./envelope.js";

/** One ask's lifecycle events, gathered under the key every record set shares. */
export interface TurnLedgerAskGroup {
  readonly key: string;
  readonly askIdentity: AskIdentity;
  /**
   * The instant the window filter and the ordering both use: the tag's own Slack instant, falling back to
   * the capture instant when a `messageTs` will not convert. Named rather than recomputed so the filter and
   * the sort can never disagree about which one a row was judged by.
   */
  readonly anchorIso: string;
  readonly events: readonly AskLifecycleEvent[];
}

/** The instant a group is filtered and sorted by — the tag's own, or the capture that stood in for it. */
function anchorIsoOf({ captured }: { captured: CapturedEvent }): string {
  const taggedIso = slackTsToIso({ ts: captured.messageTs });
  if (taggedIso === undefined) {
    return captured.tsIso;
  }
  return taggedIso;
}

/**
 * Gather a whole lifecycle log into one group per ask, in file order within each group.
 *
 * A group with no `captured` event is DROPPED, the same rule `foldAskLifecycle` applies: an entry with no
 * capture behind it carries no identity, no surface and no asker, so there is no row to print for it.
 *
 * @param events every event the log parsed, in file order
 * @returns one group per captured ask, newest anchor first
 */
export function turnLedgerGroups({ events }: { events: readonly AskLifecycleEvent[] }): readonly TurnLedgerAskGroup[] {
  const byKey = new Map<string, AskLifecycleEvent[]>();
  for (const event of events) {
    const key = askLifecycleKey({ askIdentity: event });
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, [event]);
      continue;
    }
    existing.push(event);
  }
  const groups: TurnLedgerAskGroup[] = [];
  for (const [key, grouped] of byKey) {
    const captured = grouped.find((event): event is CapturedEvent => event.kind === "captured");
    if (captured === undefined) {
      continue;
    }
    groups.push({
      anchorIso: anchorIsoOf({ captured }),
      askIdentity: { channel: captured.channel, messageTs: captured.messageTs, threadTs: captured.threadTs },
      events: grouped,
      key,
    });
  }
  return groups.toSorted((left, right) => Date.parse(right.anchorIso) - Date.parse(left.anchorIso));
}

/**
 * Narrow the groups to the window a caller asked for, before anything reads a checkpoint directory off disk.
 *
 * @param channel keep only this channel id, when one was given
 * @param groups every group, newest first
 * @param sinceIso keep groups anchored at or after this instant, when one was given
 * @returns the surviving groups, still newest first
 */
export function turnLedgerWindow({
  channel,
  groups,
  sinceIso,
}: {
  channel: string | undefined;
  groups: readonly TurnLedgerAskGroup[];
  sinceIso: string | undefined;
}): readonly TurnLedgerAskGroup[] {
  let floor = Number.NEGATIVE_INFINITY;
  if (sinceIso !== undefined) {
    const parsed = parseIsoMs({ tsIso: sinceIso });
    if (parsed !== undefined) {
      floor = parsed;
    }
  }
  return groups.filter((group) => {
    if (channel !== undefined && group.askIdentity.channel !== channel) {
      return false;
    }
    const anchor = parseIsoMs({ tsIso: group.anchorIso });
    return anchor !== undefined && anchor >= floor;
  });
}

/**
 * Gather a whole completion log by ask, in file order — a re-dispatched ask legitimately carries more than
 * one, which is why this is a list per key rather than a single value.
 *
 * @param events every completion event the ledger parsed, in file order
 * @returns the completions for each ask key
 */
export function turnLedgerCompletions({
  events,
}: {
  events: readonly TurnCompletionEvent[];
}): ReadonlyMap<string, readonly TurnCompletion[]> {
  const byKey = new Map<string, TurnCompletion[]>();
  for (const event of events) {
    const key = askLifecycleKey({ askIdentity: event.completion.askIdentity });
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, [event.completion]);
      continue;
    }
    existing.push(event.completion);
  }
  return byKey;
}
