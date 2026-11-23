/**
 * ROUND 1 DOES NOT OPEN OVER A THREAD THE DRAFT HAS NOT READ — `turn review` re-reads the ask's thread live before
 * it boots the first reviewer, and refuses while a human message newer than the draft's own read is unread.
 *
 * ## Why, and why only round 1
 *
 * `the thread has not already answered or contradicted this` is one of the reviewer's two standing claims
 * (`../../../live/turn/reviewObligations.ts`), and every first round on record came back broken, 7 of 7. Whether
 * a message ANSWERS or CONTRADICTS the draft is judgement and stays the worker's and then the reviewer's; that a
 * human wrote something the draft never read is a fact, and code can say so before twelve minutes of reviewer
 * are spent on it. Later rounds are not gated: their reviewer re-reads the tail itself every round, and
 * `turn answer` re-reads it again before the send, so a second worker-side clearance per round on a fast thread
 * would rebuild the latency this exists to remove.
 *
 * ## A moved thread is never, by itself, a reason to rewrite
 *
 * The release incident (`../../../live/turn/threadFreshness.ts`'s header) cost five rounds and 156
 * minutes because "the thread moved" was treated as "the answer is wrong". So the refusal names two routes and
 * the cheap one comes first: read the messages, and when none touches a claim, re-run with `--delta-cleared` —
 * which opens the round at once. Only a message that does touch a claim costs a rewrite.
 *
 * ## A read that could not happen is a fact refusal, never a pass
 *
 * `turn answer` fails OPEN on a missing token, because refusing would break every send. Here a failed read
 * refuses, because the only cost is a re-run and a check reported as run when it was not is the worse lie.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { type ThreadDeltaDecision, threadDeltaFromMessages } from "../../../live/turn/threadFreshness.js";
import { readLiveThread } from "./liveThreadRead.js";

/**
 * The read-through round 1 measures from. The ask's own `ts` means "I read the ask and nothing followed it",
 * which is exactly the default boundary — so it is accepted as no claimed read rather than refused the way
 * `deltaBoundary` refuses a send-time read-through that does not move past the ask.
 *
 * @param addressedTs the ask's own `ts`
 * @param readThrough what `--read-through` named, absent when nothing
 * @returns the read-through to measure from, `undefined` meaning the ask itself
 */
export function roundOneReadThrough({
  addressedTs,
  readThrough,
}: {
  addressedTs: string;
  readThrough: string | undefined;
}): string | undefined {
  if (readThrough === addressedTs) {
    return undefined;
  }
  return readThrough;
}

/**
 * The refusal lines for a thread delta at round-1 open — empty when the round may open.
 *
 * Only `reconsider` refuses. A `note` (cleared, or a claimed read with nothing after it) and a `post` both open
 * the round: the freshness note itself belongs to the SEND, which re-reads the thread again and composes it.
 *
 * @param decision what the shared delta judgement decided over the thread just read
 * @returns the lines to refuse with, empty when the round may open
 */
export function roundOneThreadRefusalLines({ decision }: { decision: ThreadDeltaDecision }): readonly string[] {
  if (decision.kind !== "reconsider") {
    return [];
  }
  const heard = decision.since.map((message) => {
    const from = message.userId === undefined ? "" : ` from ${message.userId}`;
    return `  ${message.ts}${from}`;
  });
  return [
    `review round 1 not opened: ${String(decision.since.length)} human message(s) landed in the thread after this draft's read:`,
    ...heard,
    ...hatchRefusalLines({
      detail: `${String(decision.since.length)} unread, newest ${decision.since.at(-1)!.ts}`,
      hatch: hatchFor({ id: "review-thread-delta" }),
    }),
  ];
}

/**
 * Re-read the ask's thread live and say whether review round 1 may open over this draft.
 *
 * @param askIdentity the ask whose thread is read
 * @param cleared whether the caller passed `--delta-cleared`
 * @param home the state home the read token is resolved from
 * @param nowIso the instant of this check
 * @param readThrough what `--read-through` named, absent when nothing
 * @returns the refusal lines, empty when the round may open
 */
export async function roundOneThreadRefusals({
  askIdentity,
  cleared,
  home,
  nowIso,
  readThrough,
}: {
  askIdentity: AskIdentity;
  cleared: boolean;
  home: string;
  nowIso: string;
  readThrough: string | undefined;
}): Promise<readonly string[]> {
  const read = await readLiveThread({ home, target: askIdentity });
  if (read.isErr()) {
    return [`review round 1 not opened: ${read.error.message}`];
  }
  const decision = threadDeltaFromMessages({
    addressedTs: askIdentity.messageTs,
    cleared,
    nowIso,
    rawMessages: read.value.rawMessages,
    readThrough: roundOneReadThrough({ addressedTs: askIdentity.messageTs, readThrough }),
  });
  if (decision.isErr()) {
    return [`review round 1 not opened: ${decision.error.message}`];
  }
  return roundOneThreadRefusalLines({ decision: decision.value });
}
