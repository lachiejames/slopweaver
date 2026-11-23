/**
 * `slopweaver turn answer` — the checks that run immediately before the first Slack write: the live thread
 * freshness re-read, the `--read-through` and `--accounted-for-ts` flags, and the reviewer's verdict.
 *
 * Split out of `./postAnswer.js`, which gates the answer's inputs and posts it. Everything here must finish
 * BEFORE the first write, so none of it can have already spoken in the thread it decides whether to speak in.
 */
import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import { readReviewVerdict } from "../../../admit/reviewVerdictFile.js";
import { logger } from "../../../lib/logger.js";
import { ok, type Result } from "../../../lib/result.js";
import type { Mention } from "../../../live/listen/mention.js";
import { parseAccountedForTs } from "../../../live/turn/accountedForTs.js";
import type { ThreadBoundaryError } from "../../../live/turn/threadBoundaryErrors.js";
import {
  type ThreadDeltaDecision,
  threadDeltaEffect,
  threadDeltaFromMessages,
} from "../../../live/turn/threadFreshness.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { str } from "./core.js";
import { readLiveThread } from "./liveThreadRead.js";
import { refuse } from "./loadInputs.js";
import { readThroughTs } from "./threadFreshnessArgs.js";

/**
 * The thread's messages read LIVE, or `undefined` when no read was possible — no read token, or a failed
 * read — which the caller treats as "post without a re-check", each logged loudly here.
 *
 * @param home the state home the read token is resolved from
 * @param mention the mention whose thread is re-read
 * @returns the thread's raw messages, or `undefined` when the freshness check cannot run
 */
async function liveThreadMessages({
  home,
  mention,
}: {
  home: string;
  mention: Mention;
}): Promise<readonly unknown[] | undefined> {
  const read = await readLiveThread({ home, target: mention });
  if (read.isErr()) {
    // The send FAILS OPEN on either failure, and says which one loudly — see this function's own doc.
    logger.error({ msg: `turn answer: ${read.error.message} — posting without a freshness re-check` });
    return undefined;
  }
  if (read.value.warning !== undefined) {
    logger.error({ msg: `turn answer: ${read.value.warning}` });
  }
  return read.value.rawMessages;
}

/**
 * Re-read the thread LIVE, right before posting, and decide what the messages that landed since this answer
 * read it mean. A network hiccup or a missing read token is NOT the same failure: that degrades to a loud
 * log and a post that goes ahead anyway, because the alternative (never posting when a read token happens to
 * be missing) would make a configuration gap silently break every answer. Finding genuinely new messages IS
 * authoritative — this is the one thing this check exists to catch, and it never gets to fail open.
 *
 * What it does about them is the fix: a delta somebody has read and cleared is a composed
 * one-line note on the answer, not a refusal that costs another 14-21 minute review round. See
 * `threadFreshness.ts`'s own header for the incident.
 *
 * @param cleared whether the caller passed `--delta-cleared`
 * @param home the state home the read token is resolved from
 * @param mention the mention this answer replies to
 * @param nowIso the instant of this send, which the note names
 * @param accountedForTs specific later message timestamps this answer already accounts for — see
 *   `threadFreshness.ts`'s own header for why (the compound-instruction case); defaults to none
 * @param readThrough the ts this answer read up to, absent when the caller named none
 * @returns what the door does about the delta, or the typed refusal of the named `--read-through`
 */
export async function threadDeltaAtSend({
  cleared,
  home,
  mention,
  nowIso,
  accountedForTs = [],
  readThrough,
}: {
  cleared: boolean;
  home: string;
  mention: Mention;
  nowIso: string;
  accountedForTs?: readonly string[];
  readThrough: string | undefined;
}): Promise<Result<ThreadDeltaDecision, ThreadBoundaryError>> {
  const rawMessages = await liveThreadMessages({ home, mention });
  if (rawMessages === undefined) {
    return ok({ kind: "post" });
  }
  return threadDeltaFromMessages({
    accountedForTs,
    addressedTs: mention.messageTs,
    cleared,
    nowIso,
    rawMessages,
    readThrough,
  });
}

/**
 * The reviewing session's verdict, when `--verdict` names one.
 *
 * Absent is a legitimate value here, not a usage error, and that is deliberate: the refusal for an
 * unreviewed answer must come from the admit door — which names the finding and the correction — rather
 * than from arg parsing, so the loop learns the gate as a trust boundary and not as a CLI quirk.
 *
 * @param values the parsed flags
 * @returns the verdict, `undefined` when no `--verdict` was given, or why the named file was unusable
 */
function optionalVerdict({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<ReviewVerdict | undefined> {
  const path = str({ key: "verdict", values });
  if (path === undefined) {
    return ok(undefined);
  }
  return readReviewVerdict({ path });
}

/**
 * The checks that must pass before anything is posted, and the reviewer's verdict if one was supplied.
 *
 * Grouped because they share one shape — each either refuses with an exit code or contributes a value — and
 * because they must all run BEFORE the first Slack write. A freshness check that ran after the working
 * message would already have spoken in the thread it was deciding whether to speak in.
 *
 * @param home the resolved state home
 * @param mention the mention this turn answers
 * @param nowIso the instant of this send, which a freshness note names
 * @param values the parsed flags
 * @returns the verdict to carry to the door and the freshness note to prepend, or the exit code to refuse
 *   with
 */
export async function answerPreflight({
  home,
  mention,
  nowIso,
  values,
}: {
  home: string;
  mention: Mention;
  nowIso: string;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<{ code: number } | { verdict: ReviewVerdict | undefined; freshnessNote: string | undefined }> {
  const accountedForTs = parseAccountedForTs({ raw: str({ key: "accounted-for-ts", values }) });
  if (accountedForTs.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: accountedForTs.error, usage: false }) };
  }
  const readThrough = readThroughTs({ values });
  if (readThrough.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: [readThrough.error.message], usage: false }) };
  }
  const delta = await threadDeltaAtSend({
    accountedForTs: accountedForTs.value,
    cleared: values["delta-cleared"] === true,
    home,
    mention,
    nowIso,
    readThrough: readThrough.value,
  });
  if (delta.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: [delta.error.message], usage: false }) };
  }
  const effect = threadDeltaEffect({ decision: delta.value });
  if (effect.refusal !== undefined) {
    return { code: refuse({ code: EXIT_ERROR, errors: effect.refusal, usage: false }) };
  }
  const verdict = optionalVerdict({ values });
  if (verdict.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: verdict.error, usage: false }) };
  }
  return { freshnessNote: effect.note, verdict: verdict.value };
}
