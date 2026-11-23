/**
 * The effectful half of `slopweaver slack post|reply --as me` — the ordered drip loop.
 *
 * The loop is short and every line of it is a decision that was made deliberately:
 *
 *  1. **ONE `throughDoor` around the whole sequence.** The operator approves "send this thread", not each
 *     line. Nothing is sent unless the door passes.
 *  2. **Each message is reserved, sent and CONFIRMED individually.** The reservation is the resume: a
 *     re-run skips what it can prove landed.
 *  3. **Sends are awaited one at a time and paced.** Concurrency would be faster and would also deliver
 *     the sentences out of order, which the owner named as the actual risk — *"if you try and do it too
 *     fast you can end up having things arrive out of order which is worse"*. Pacing goes through the
 *     shared `createRateScheduler` (p-throttle), never a hand-rolled sleep (D21).
 *  4. **The loop HALTS at the first thing it cannot resolve** and reports every message's fate.
 *
 * The unconfirmed case is the one worth reading twice. A reservation is taken BEFORE a send, so a message
 * that reserved and then failed leaves a reservation with no `ts`. On the card lane that only ever
 * over-warns. On a drip it would make the resume SKIP a line that never landed, so this loop refuses to
 * guess: it stops, names the message, and tells the operator to look at the channel. `--resend-unconfirmed`
 * is how they answer "I looked, it is not there".
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorGate } from "../../../admit/types.js";
import { type VoiceGateInput, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import type { SlackWriteApi } from "../../../corpus/slack/writeApi.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { createRateScheduler, type RateScheduler } from "../../../lib/resilience.js";
import {
  destinationLabel,
  duplicateSendGate,
  priorSendFrom,
  RESEND_UNCONFIRMED_REMEDY,
} from "../../../outbound/slack/duplicateGate.js";
import { slackPermalink, storedRenderIssues } from "../../../outbound/slack/renderCheck.js";
import {
  claimSend,
  confirmSend,
  DUPLICATE_WINDOW_HOURS,
  peekSend,
  type ResendPolicy,
  type SendClaim,
  settleFailedSend,
} from "../../../outbound/slack/sendReservation.js";
import type { DripOutcome, PlannedDripMessage, SlackDripPlan } from "./dripCore.js";
import { withUnattempted } from "./dripCore.js";

/** Everything the drip loop needs from the world, injected so the flow is testable with plain fakes. */
export interface DripSendDeps {
  readonly api: SlackWriteApi;
  readonly home: string;
  /** The clock, injected so a test asserts exact reservation contents without a real one. */
  readonly nowIso: () => string;
  /** The pacing seam. Production passes `createRateScheduler`; a test passes a pass-through. */
  readonly pace: <T>(task: () => Promise<T>) => Promise<T>;
  /**
   * The already-loaded bytes for every media path in the plan, keyed by the path the caller typed.
   *
   * Loaded by the SHELL before the door, never lazily here: an unreadable path must fail before the first
   * message is published, not between messages 2 and 3 where the drip is already half out under their name.
   */
  readonly uploads: ReadonlyMap<string, SlackUpload>;
  /**
   * Read one of OUR OWN just-posted messages back, for the receipt — the permalink and the render check.
   *
   * `undefined` when the read could not answer, which is reported as "not checked" and never as a failed
   * send. Injected rather than reached for so the whole receipt is testable with a plain fake.
   */
  readonly readBack: (args: {
    channel: string;
    ts: string;
  }) => Promise<
    { readonly blocks?: readonly unknown[] | undefined; readonly workspaceUrl?: string | undefined } | undefined
  >;
}

/**
 * Decide one message's fate from its reservation, taking the reservation as a side effect when fresh. The
 * verdict itself is {@link claimSend}'s — shared with the card lane, so the two cannot disagree about what
 * `--resend-unconfirmed` or the override permit.
 *
 * KNOWN LIMITATION, measured rather than assumed: a resume only works inside
 * {@link DUPLICATE_WINDOW_HOURS}. Past it the reservation has aged out, `reserveSend` reports `fresh`, and
 * re-running a half-sent drip REPOSTS the lines that already landed. The door does not catch it either —
 * its ledger lookback is the same window.
 *
 * It is left this way on purpose, because the obvious fix is worse. Making a confirmed send durable
 * forever would mean deliberately saying the same sentence again next week is silently SKIPPED, and a
 * silent omission is a worse failure than a visible repeat. One window, consistent with the card lane, and
 * no second invented constant. If resuming a day-old drip turns out to be a real workflow, the honest fix
 * is a separate resume horizon owned by PR5.2 alongside edit/delete — not a quietly widened number here.
 */
function claimMessage({
  message,
  deps,
  nowIso,
  resend,
}: {
  message: PlannedDripMessage;
  deps: DripSendDeps;
  nowIso: string;
  resend: ResendPolicy;
}): SendClaim {
  return claimSend({
    duplicateKey: message.duplicateKey,
    home: deps.home,
    nowIso,
    resend,
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
}

/**
 * Which parent a message threads under.
 *
 * `top-level` never threads. `thread` threads under the caller's `--thread-ts` when there is one (a reply
 * drip: every message goes into the thread that was named), and otherwise under the FIRST message of this
 * drip, which becomes the parent — that is what `post --shape thread` means.
 */
function threadFor({
  shape,
  parentTs,
}: {
  shape: SlackDripPlan["shape"];
  parentTs: string | undefined;
}): string | undefined {
  return shape === "top-level" ? undefined : parentTs;
}

/**
 * The loaded bytes for one message's media, in the caller's order.
 *
 * A path the shell did not load is a programming error rather than a user one — the shell loads exactly
 * the plan's paths — so it throws here, where the drip loop turns it into that message's `failed` outcome
 * and halts, instead of silently posting the words with fewer files than were asked for.
 */
function uploadsFor({ deps, message }: { deps: DripSendDeps; message: PlannedDripMessage }): readonly SlackUpload[] {
  return message.media.map((path) => {
    const upload = deps.uploads.get(path);
    if (upload === undefined) {
      throw new Error(`no loaded bytes for media path "${path}"`);
    }
    return upload;
  });
}

/** The error text recorded for a failed message. Never the stack — the report is read by a human. */
function failureText({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** The thread parent after one message lands: the plan's own parent when it has one, else that first message's `ts`. */
function threadParentAfter({ parentTs, ts }: { parentTs: string | undefined; ts: string }): string {
  if (parentTs !== undefined) {
    return parentTs;
  }
  // No parent yet: this is the first message, so it becomes the thread every later reply hangs under.
  return ts;
}

/**
 * Run the drip: send each message in order, pacing between them, and stop at anything unresolved.
 *
 * Returns one outcome per message, always — including for messages it never reached. Callers report the
 * whole list rather than a success flag, because "which ones landed?" is the only useful question after a
 * partial send.
 *
 * @param plan the fully-decided drip
 * @param deps the injected world
 * @param resend which prior sends this run may send again
 * @returns one outcome per message, in index order
 */
export async function runDripSequence({
  plan,
  deps,
  resend,
}: {
  plan: SlackDripPlan;
  deps: DripSendDeps;
  resend: ResendPolicy;
}): Promise<readonly DripOutcome[]> {
  const outcomes: DripOutcome[] = [];
  let parentTs = plan.threadTs;
  for (const message of plan.messages) {
    const nowIso = deps.nowIso();
    const verdict = claimMessage({ deps, message, nowIso, resend });
    if (verdict.kind === "unconfirmed") {
      outcomes.push({ index: message.index, reservedIso: verdict.reservedIso, state: "unconfirmed" });
      return withUnattempted({ outcomes, reason: "unconfirmed-prior", total: plan.messages.length });
    }
    if (verdict.kind === "already-sent") {
      // A skipped FIRST message still supplies the thread parent, which is the whole reason its `ts` is
      // recorded: without it a resumed `--shape thread` drip would orphan every remaining reply.
      parentTs = threadParentAfter({ parentTs, ts: verdict.ts });
      outcomes.push({ index: message.index, state: "already-sent", ts: verdict.ts });
      continue;
    }
    const sent = await sendOne({ deps, message, parentTs, plan });
    if (sent.state === "failed") {
      outcomes.push(sent);
      return withUnattempted({ outcomes, reason: "earlier-failure", total: plan.messages.length });
    }
    parentTs = threadParentAfter({ parentTs, ts: sent.ts });
    outcomes.push(sent);
  }
  return outcomes;
}

/** Send one message through the paced seam, and confirm its reservation only once Slack has answered. */
async function sendOne({
  plan,
  message,
  parentTs,
  deps,
}: {
  plan: SlackDripPlan;
  message: PlannedDripMessage;
  parentTs: string | undefined;
  deps: DripSendDeps;
}): Promise<Extract<DripOutcome, { state: "sent" | "failed" }>> {
  const threadTs = threadFor({ parentTs, shape: plan.shape });
  try {
    const result = await deps.pace(async () =>
      deps.api.sendDripMessage({
        channel: plan.channel,
        payload: message.payload,
        uploads: uploadsFor({ deps, message }),
        ...(threadTs !== undefined ? { threadTs } : {}),
      }),
    );
    // AFTER the wire, never before: a reservation carrying a `ts` is the proof a resume trusts.
    confirmSend({
      duplicateKey: message.duplicateKey,
      home: deps.home,
      nowIso: deps.nowIso(),
      sentTs: result.ts,
    });
    const receipt = await receiptFor({ channel: plan.channel, deps, threadTs, ts: result.ts });
    return {
      fileIds: result.fileIds,
      index: message.index,
      state: "sent",
      ts: result.ts,
      ...receipt,
      ...(result.placement === undefined ? {} : { placement: result.placement }),
    };
  } catch (error) {
    // The reservation is settled by what the failure PROVES. Slack answered `ok: false` ⇒ nothing landed, and
    // the reservation is released so a resume sends this line without being asked to vouch for it. Anything
    // unread — a lost response, a timeout — leaves it in place, unconfirmed: releasing THAT is how a
    // timed-out-but-delivered message gets posted twice on the retry, and the next run says so out loud.
    settleFailedSend({ duplicateKey: message.duplicateKey, error, home: deps.home, nowIso: deps.nowIso() });
    return { error: failureText({ error }), index: message.index, state: "failed" };
  }
}

/**
 * The receipt for one published message: where to find it, and what a reader will actually see in it.
 *
 * FAILS OPEN, always, and that is the whole contract. The message is on the wire before this runs, so a
 * read-back that throws, times out or comes back empty leaves the outcome carrying neither field, which the
 * report prints as "not checked". Turning a lost read into a failed send would retract nothing and would
 * mislead about a message that is published and probably fine.
 *
 * @param deps the injected world, for the read-back seam
 * @param channel the channel the message landed in
 * @param ts the message's own timestamp
 * @param threadTs the thread root, when this message is a reply
 * @returns the permalink and render issues to merge into the outcome, or nothing when the read could not answer
 */
async function receiptFor({
  deps,
  channel,
  ts,
  threadTs,
}: {
  deps: DripSendDeps;
  channel: string;
  ts: string;
  threadTs: string | undefined;
}): Promise<{ permalink?: string; renderIssues?: readonly string[] }> {
  let stored;
  try {
    stored = await deps.readBack({ channel, ts });
  } catch {
    return {};
  }
  if (stored === undefined) {
    return {};
  }
  return {
    ...(stored.workspaceUrl === undefined
      ? {}
      : { permalink: slackPermalink({ channel, threadTs, ts, workspaceUrl: stored.workspaceUrl }) }),
    ...(stored.blocks === undefined ? {} : { renderIssues: storedRenderIssues({ blocks: stored.blocks }) }),
  };
}

/**
 * Which messages of this drip a previous run already CONFIRMED, read without reserving anything.
 *
 * Used to build the door gate and to keep `--dry-run` traceless: peeking leaves no record, so previewing a
 * drip can never poison the real send that follows it.
 *
 * @param plan the drip plan
 * @param home the state home
 * @param nowIso the reference instant
 * @returns the indices already known to have landed
 */
function alreadyLandedIndices({
  plan,
  home,
  nowIso,
}: {
  plan: SlackDripPlan;
  home: string;
  nowIso: string;
}): readonly number[] {
  return plan.messages
    .filter((message) => {
      const prior = peekSend({
        duplicateKey: message.duplicateKey,
        home,
        nowIso,
        windowHours: DUPLICATE_WINDOW_HOURS,
      });
      return prior.kind === "duplicate" && prior.sentTs !== undefined;
    })
    .map((message) => message.index);
}

/**
 * The production pacing seam: `p-throttle` at one message per `intervalMs`.
 *
 * An interval of zero means "no pacing at all" rather than "an infinite rate", because `1000 / 0` is not a
 * rate a scheduler can be built from. Ordering does not depend on this — every send is awaited — so a zero
 * interval is safe, just fast.
 *
 * @param intervalMs the operator's configured gap between messages
 * @returns a scheduler that paces each task
 */
export function dripPacer({ intervalMs }: { intervalMs: number }): RateScheduler {
  if (intervalMs <= 0) {
    // The type is INHERITED from the declared `RateScheduler` return, not restated — so the compiler checks
    // the pass-through still matches the seam it stands in for.
    return async (task) => task();
  }
  return createRateScheduler({ ratePerSec: 1000 / intervalMs });
}

/**
 * The gate list for one drip.
 *
 * The sequence counts as a duplicate only when EVERY message is already confirmed on the wire. A
 * half-sent drip being re-run is a RESUME, not a repeat, and warning about it would train the operator
 * to override the very warning that protects them from an actual double-post.
 *
 * It lives beside the loop rather than in `./run.ts` because the question it answers — how much of this
 * sequence is already on the wire — is the reservation knowledge this file owns, and it is the one gate
 * whose verdict depends on it.
 *
 * @param plan the fully-built drip
 * @param home the state home holding the send reservations
 * @param nowIso the injected instant the reservation window is measured against
 * @param voice the operator's rules, this drip's authored prose and whether the named hatch is open
 * @returns the door gates this send is judged by
 */
export function dripGatesFor({
  plan,
  home,
  nowIso,
  voice,
}: {
  plan: SlackDripPlan;
  home: string;
  nowIso: string;
  voice: VoiceGateInput;
}): readonly DoorGate[] {
  const landed = alreadyLandedIndices({ home, nowIso, plan });
  const allLanded = landed.length === plan.messages.length && plan.messages.length > 0;
  const lastMessage = plan.messages.at(-1);
  // Dated and stamped by the LAST message's own reservation, which is the moment the drip finished. Every
  // message is confirmed on the wire in this branch (that is what `allLanded` means), so the warning can
  // honestly say the sequence landed. A half-sent drip is a RESUME, not a repeat: it never reaches here,
  // stays `fresh`, and `priorSendFrom` turns that into the `null` that passes the gate.
  const lastLanded =
    allLanded && lastMessage !== undefined
      ? peekSend({ duplicateKey: lastMessage.duplicateKey, home, nowIso, windowHours: DUPLICATE_WINDOW_HOURS })
      : { kind: "fresh" as const };
  return [
    ...DEFAULT_GATES,
    voiceProfileGate(voice),
    duplicateSendGate({
      prior: priorSendFrom({
        destination: destinationLabel({ channel: plan.channel, threadTs: plan.threadTs }),
        duplicateKey: plan.duplicateKey,
        reservation: lastLanded,
      }),
      unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY,
      windowHours: DUPLICATE_WINDOW_HOURS,
    }),
  ];
}
