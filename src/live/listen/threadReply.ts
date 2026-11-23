/**
 * The two rollout controls for thread-reply addressing: WHICH conversations it is switched on for, and HOW
 * MANY replies one thread may wake in a day. PURE — a list and a count in, a decision out.
 *
 * `./mention.ts` decides whether a reply IS an address. This file decides whether an address that qualifies
 * is one the operator asked for, and one this thread has budget left for. They are separate because they
 * fail differently: a conversation nobody named is a configuration fact that never changes within a run, and
 * a spent budget is a fact about the last twenty-four hours in one thread.
 *
 * ## Why the budget is in-process rather than under `$SLOPWEAVER_HOME`
 *
 * The counts ride in and out of `consumeMentions` exactly as `DedupeState` does, so a reconnect keeps them
 * and a listener RESTART resets them. That is coherent rather than a hole: AGENTS.md rule 2 makes a Slack
 * address arriving when no visible session is listening a no-op BY DESIGN, so the only window in which any
 * reply can be answered at all is one listener's lifetime — a cap persisted past that would bind a reply
 * that could never have been answered anyway. The trigger for moving it under the home is therefore a queue
 * consumer, which is the shape rule 2 bans; if that ever changes, this decision changes with it.
 */

import { ok, type Result } from "../../lib/result.js";
import { parseConversationList } from "./scope.js";

/**
 * A Slack conversation id a thread reply can be answered in: a public or private channel. A DM (`D…`) is the
 * other addressing path entirely and a group DM is refused at the parse, so neither belongs on this list.
 */
const CHANNEL_ID = /^[CG][A-Z0-9]+$/;

/** How long a `YYYY-MM-DD` date is — what an ISO-8601 instant is cut to for the budget's day key. */
const ISO_DATE_LENGTH = "YYYY-MM-DD".length;

/**
 * How many replies one thread may wake in a UTC day.
 *
 * Four, set against a measurement rather than a hope: before this path existed, 2,576
 * channel and group `message` events had already reached this install's listener and been refused at the
 * parse — the volume this predicate now sits in front of. Repro:
 *
 * ```bash
 * grep -ch "not a direct message" "$SLOPWEAVER_HOME"/live/listener/*.err | paste -sd+ - | bc
 * ```
 *
 * A count per THREAD rather than a rate per channel, because the thread is what the failure is shaped like:
 * a busy alerts post with fifteen people replying under it costs four turns and then goes quiet, and the
 * fifth reader sees the four answers already sitting in the thread. Raising it is a measurement, never a guess.
 */
export const THREAD_REPLY_DAILY_CAP = 4;

/**
 * How many replies each `(conversation, thread, UTC day)` has already woken. Opaque — advance it only with
 * {@link admitThreadReply}, which is what keeps the key's shape a private matter of this file.
 */
export type ThreadReplyCounts = ReadonlyMap<string, number>;

/** No thread has woken anything yet — what a listener starts its first connection with. */
export const NO_THREAD_REPLIES: ThreadReplyCounts = new Map<string, number>();

/** The budget verdict for one reply, carrying the counts to keep whichever way it went. */
export type ThreadReplyBudget =
  | { readonly admitted: true; readonly counts: ThreadReplyCounts; readonly answeredToday: number }
  | { readonly admitted: false; readonly counts: ThreadReplyCounts; readonly why: string };

/**
 * Parse the `--thread-replies` flag into the conversations thread-reply addressing is switched on for.
 *
 * The refusals are `./scope.ts`'s own `parseConversationList`, shared rather than restated — this flag only
 * supplies its name and the narrower set of ids it takes.
 *
 * @param flag the raw flag value, `undefined` when it was not given at all
 * @returns the deduplicated channel ids — empty when the flag is absent, which is what switches the whole
 *   path off — or every rejection
 */
export function parseThreadReplyChannels({ flag }: { flag: unknown }): Result<readonly string[]> {
  if (flag === undefined) {
    return ok([]);
  }
  return parseConversationList({
    // Short on purpose. The shared refusal reads `<flag> takes <accepts>, not <what you typed>`, so an
    // explanation spliced in here lands between the two halves a reader is actually comparing. Why a DM and
    // a group DM are not on this list is the flag's own usage text.
    accepts: "public or private channel ids (C… or G…)",
    flag: "--thread-replies",
    id: CHANNEL_ID,
    value: flag,
  });
}

/**
 * Read the thread-reply channels back off a stored arm record.
 *
 * Mirrors `./scope.ts`'s `scopeFromRecord` deliberately, including its absent case: a record written before
 * this field existed carries none and reads as the empty list, which is the same thing as switched off. That
 * is what keeps an old record READABLE — failing the parse instead would make `listen supervise` treat the
 * whole record as unreadable and re-arm unscoped, which is a larger loss than the one being prevented.
 *
 * Separate from {@link parseThreadReplyChannels}, which takes the comma-joined FLAG a person types. This
 * takes the JSON array the listener wrote about itself, so neither has to tolerate the other's shape.
 *
 * @param raw the record's `threadReplyChannels` field
 * @returns the channels, or `undefined` when the value is present but is not a list of channel ids
 */
export function threadReplyChannelsFromRecord({ raw }: { raw: unknown }): readonly string[] | undefined {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const entries: unknown[] = raw;
  const valid = entries.filter((entry): entry is string => typeof entry === "string" && CHANNEL_ID.test(entry));
  if (valid.length !== entries.length) {
    return undefined;
  }
  return valid;
}

/**
 * The `--thread-replies` arguments for a listener started by something other than a person — today
 * `listen arm`'s own command line.
 *
 * Mirrors `./scope.ts`'s `scopeArgs` and exists for the same reason that one does: a re-arm that dropped
 * the flag would silently take the feature away from the channels an operator had switched it on for, and
 * the only symptom would be replies going unanswered.
 *
 * @param channels the conversations thread-reply addressing is switched on for
 * @returns the arguments to splice onto the listener's command line — empty when nothing is switched on
 */
export function threadReplyArgs({ channels }: { channels: readonly string[] }): readonly string[] {
  if (channels.length === 0) {
    return [];
  }
  return ["--thread-replies", channels.join(",")];
}

/**
 * The budget key for one thread on one UTC day. The DAY is part of the key rather than a timestamp compared
 * against, so an old day's count simply stops being read instead of needing a sweep to expire it.
 */
function budgetKey({ channel, nowIso, threadTs }: { channel: string; nowIso: string; threadTs: string }): string {
  return `${channel}/${threadTs}/${nowIso.slice(0, ISO_DATE_LENGTH)}`;
}

/**
 * Spend one reply of a thread's daily budget, or refuse because it is already spent.
 *
 * Advances the counts on ADMISSION only. A refused reply that still incremented would push a busy thread
 * further past its cap every time somebody typed, so the number in the refusal would keep climbing while the
 * outcome it explains stayed identical.
 *
 * @param cap how many replies one thread may wake in a day — {@link THREAD_REPLY_DAILY_CAP} in the listener
 * @param counts what every thread has already woken today
 * @param nowIso the current instant, ISO-8601; its DATE is what the day is taken from
 * @returns the verdict, and the counts to carry forward either way
 */
export function admitThreadReply({
  cap,
  channel,
  counts,
  nowIso,
  threadTs,
}: {
  cap: number;
  channel: string;
  counts: ThreadReplyCounts;
  nowIso: string;
  threadTs: string;
}): ThreadReplyBudget {
  const key = budgetKey({ channel, nowIso, threadTs });
  // Named with an `if` rather than a `??`/ternary default: a thread this map has never seen has answered
  // nothing, and saying that out loud is what `no-silent-fallback` asks for.
  const spent = counts.get(key);
  let answeredToday = 0;
  if (spent !== undefined) {
    answeredToday = spent;
  }
  if (answeredToday >= cap) {
    return {
      admitted: false,
      counts,
      why:
        `this thread has already woken ${String(answeredToday)} repl${answeredToday === 1 ? "y" : "ies"} today, ` +
        `which is its cap of ${String(cap)} — a reply under one post cannot become an unbounded queue of turns`,
    };
  }
  const advanced = new Map(counts);
  advanced.set(key, answeredToday + 1);
  return { admitted: true, answeredToday: answeredToday + 1, counts: advanced };
}
