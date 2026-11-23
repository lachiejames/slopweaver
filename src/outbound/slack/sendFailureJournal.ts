/**
 * The as-me send failure journal: one line per Slack post or reply under the owner's name that did NOT go out, with where it
 * was aimed and the words that stopped it — the "failed with the error" half of what the console voice says about a
 * send (`../../talk/slackSendOutcome.ts`).
 *
 * The case it came from: the owner approved a reply to Seth, the voice said "Got it", and nothing was sent. The chair's later attempt was refused by
 * the as-me gates, and the only trace of a refusal was that session's own stderr: the door ledger keeps no target, the
 * send reservation is keyed by content and released on a refusal, and a drip's outcome lives only in process output.
 * So a voice asked "did it go?" could say sent (Slack) or held (a parked draft) but never failed, and why.
 *
 * Narrow on purpose: as-me only, channel, thread, instant and the refusal's own words — never the message, which
 * stays where it already is (a parked draft, or nowhere). A failure that later became a parked draft is superseded by
 * that draft, the newer of the two winning (`../../talk/slackSendOutcome.ts`). Pure: the file is `../../admit/`'s.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../../lib/parsers.js";

/** The most of a refusal's words one line keeps, in code points: a door refusal is four lines and a hatch. */
export const SEND_FAILURE_ERROR_MAX = 800;

/** One as-me send that did not go out. */
export interface SlackSendFailure {
  readonly atIso: string;
  /** The conversation it was aimed at, as the send named it: a channel id once resolved, else what was typed. */
  readonly channel: string;
  /** The thread root it would have replied under, or `null` for a top-level post. */
  readonly threadTs: string | null;
  /** The gate's or Slack's own words, cut at {@link SEND_FAILURE_ERROR_MAX}. */
  readonly error: string;
}

/**
 * A refusal's words, whitespace folded to one line and cut at {@link SEND_FAILURE_ERROR_MAX} code points.
 *
 * @param error the refusal as the lane printed it, one or many lines
 * @returns the one line a journal row carries
 */
export function boundedSendError({ error }: { error: string }): string {
  const folded = error.replaceAll(/\s+/gu, " ").trim();
  const chars = Array.from(folded);
  if (chars.length <= SEND_FAILURE_ERROR_MAX) {
    return folded;
  }
  return `${chars.slice(0, SEND_FAILURE_ERROR_MAX).join("")}…`;
}

/**
 * Encode one failure as a JSONL line.
 *
 * @param failure the failure to append
 * @returns the JSON line, with no trailing newline
 */
export function sendFailureLine({ failure }: { failure: SlackSendFailure }): string {
  return JSON.stringify({ ...failure, error: boundedSendError({ error: failure.error }) });
}

/**
 * Decode one journal line, or `undefined` for a line that is not a failure row — a torn write or another shape is
 * skipped, never a reason to refuse the whole read.
 *
 * @param line one line of the journal
 * @returns the failure, or `undefined`
 */
export function parseSendFailure({ line }: { line: string }): SlackSendFailure | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { atIso, channel, threadTs, error } = parsed;
  if (typeof atIso !== "string" || typeof channel !== "string" || typeof error !== "string") {
    return undefined;
  }
  if (threadTs !== null && typeof threadTs !== "string") {
    return undefined;
  }
  // Strict, so a value `Date.parse` would guess at (`"0"`, a date alone) is a torn line rather than an old failure;
  // canonical, so every comparison below is instant against instant: an offset spelling would sort as text.
  const atMs = parseStrictIsoInstantMs({ text: atIso });
  if (atMs === undefined) {
    return undefined;
  }
  return { atIso: new Date(atMs).toISOString(), channel, error, threadTs };
}

/** A Slack conversation id, as against a channel name typed in its place. */
const CONVERSATION_ID = /^[CGD][A-Z0-9]+$/u;

/**
 * Whether one failure was aimed at this thread. A channel typed by NAME and refused before it resolved is journalled
 * under that name, so its thread root alone names the thread: a Slack `ts` is unique to the microsecond.
 */
function aimedAt({
  failure,
  channel,
  threadTs,
  topLevelCounts,
}: {
  failure: SlackSendFailure;
  channel: string;
  threadTs: string;
  topLevelCounts: boolean;
}): boolean {
  if (failure.channel !== channel) {
    return !CONVERSATION_ID.test(failure.channel) && failure.threadTs === threadTs;
  }
  return failure.threadTs === threadTs || (topLevelCounts && failure.threadTs === null);
}

/**
 * The newest failure aimed at one thread at or after an instant, or `undefined` when there is none.
 *
 * @param failures every failure the journal holds, in any order
 * @param channel the channel id the send was aimed at
 * @param threadTs the thread root it would have replied under
 * @param sinceIso the earliest instant that counts: the moment the owner asked for the send, compared as an instant
 * @param topLevelCounts whether a top-level send in the channel counts too — a DM, where the owner answers outside threads
 * @returns the newest matching failure
 */
export function latestFailureForThread({
  failures,
  channel,
  threadTs,
  sinceIso,
  topLevelCounts,
}: {
  failures: readonly SlackSendFailure[];
  channel: string;
  threadTs: string;
  sinceIso: string;
  topLevelCounts: boolean;
}): SlackSendFailure | undefined {
  const sinceMs = Date.parse(sinceIso);
  return failures
    .filter(
      (failure) => aimedAt({ channel, failure, threadTs, topLevelCounts }) && Date.parse(failure.atIso) >= sinceMs,
    )
    .reduce<SlackSendFailure | undefined>(
      // The journal is appended in order, so of two rows at one millisecond the later line is the newer.
      (newest, failure) =>
        newest === undefined || Date.parse(failure.atIso) >= Date.parse(newest.atIso) ? failure : newest,
      undefined,
    );
}
