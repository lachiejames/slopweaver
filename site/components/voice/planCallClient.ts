/**
 * The page's half of a plan call's routes (`PlanLeaf`, in `planCallClientPost.ts`): follow its event stream, claim and answer a tool call,
 * nudge it, have it say it is looking, hand it the frame the owner's look ask took, have it take its turn, hand it a Slack
 * send's outcome, keep a count or a claim the voice said as a grounding it never hears back, stop it. A plan
 * call's tools arrive from the `codex app-server` child this server holds, not over the data channel, so these
 * are the only wires they travel. Its own file so `VoiceProvider.tsx` stays under the line cap.
 */
import type { DriftNotice } from "../../lib/driftNotice";
import type { IsoNudgeNotice } from "../../lib/isoNudgeNotice";
import type { LookAsk } from "../../lib/lookAck";
import { PLAN_CALL_LIMITS, type PlanCallEvent, UNDELIVERED_TOOL_TEXT } from "../../lib/planCallContract";
import type { CheckSend } from "../../lib/relayAnswer";
import type { PlanContentItem } from "../../lib/talkPlanProtocolItems";
import type { ClaimGrounding } from "../../lib/talkSpokenClaims";
import { TOOL_TIMEOUT_MS } from "../../lib/talkToolsList";
import type { CountGrounding, SpokenRecord } from "../../lib/talkVoiceRecord";
import { callPath, PLAN_POST_MS, type PlanPost, postPlan } from "./planCallClientPost";
import { readStream } from "./planCallClientStream";

export { type PlanPost, planPostOf } from "./planCallClientPost";

/** How long to wait before re-opening a stream that dropped without the call ending. */
const RECONNECT_MS = 1_000;

/** How many drops in a row, each with nothing delivered, before the call is treated as gone. */
const RECONNECT_LIMIT = 5;

/**
 * Follow a plan call's events until it closes or `signal` aborts, re-opening a dropped stream from the last
 * event it delivered. A stream that cannot be reopened is reported as the call closing, because a call whose
 * tools can no longer reach this page is one it must stop rather than leave waiting.
 *
 * @param callId the call the offer minted
 * @param signal aborts the stream when the page stops the call
 * @param onEvent each event, in order, exactly once
 */
export async function followPlanCall({
  callId,
  signal,
  onEvent,
}: {
  callId: string;
  signal: AbortSignal;
  onEvent: (event: PlanCallEvent) => void;
}): Promise<void> {
  let after = 0;
  let drops = 0;
  let why = "the call's event stream could not be reopened";
  while (!signal.aborted && drops < RECONNECT_LIMIT) {
    const before = after;
    const read = await readStream({
      after,
      callId,
      onEntry: (entry) => {
        if (entry.kind === "event" && entry.seq > after) {
          after = entry.seq;
          onEvent(entry.event);
        }
      },
      signal,
    });
    if (read.kind === "closed" || read.kind === "stopped") {
      return;
    }
    if (read.kind === "gone") {
      onEvent({ kind: "closed", reason: read.why });
      return;
    }
    why = read.why;
    drops = after > before ? 1 : drops + 1;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
  }
  if (!signal.aborted) {
    onEvent({ kind: "closed", reason: why });
  }
}

/**
 * Claim one tool call before running it, so one the server has already settled is dropped rather than run.
 *
 * @param token the token its `tool` event carried
 * @param claimant the id this page minted for the call, the only one the server then takes its answer from
 * @returns `taken` once it is this page's to run; `refused` when the server says it is not; `lost` when the page
 *   cannot tell, so it settles the call as failed rather than leave it waiting
 */
export async function claimPlanTool({
  callId,
  token,
  claimant,
}: {
  callId: string;
  token: string;
  claimant: string;
}): Promise<PlanPost> {
  return postPlan({ body: { claimant, token }, callId, leaf: "claim" });
}

/**
 * Answer one tool call.
 *
 * @param token the token its `tool` event carried
 * @param contentItems the answer, in the app-server's shape
 * @param success whether the tool did what it was asked
 * @param claimant the id this page claimed it under
 * @param triageVisit the visit a `triage_next` put in front of the owner, so the call times that card's clock and
 *   no other; `undefined` on every other answer, and then the body carries no such field
 * @returns `taken` once the call has it, else why it was refused or lost
 */
export async function answerPlanTool({
  callId,
  token,
  contentItems,
  success,
  claimant,
  triageVisit,
}: {
  callId: string;
  token: string;
  contentItems: readonly PlanContentItem[];
  success: boolean;
  claimant: string;
  triageVisit: string | undefined;
}): Promise<PlanPost> {
  const body = { claimant, contentItems, success, token };
  return postPlan({ body: triageVisit === undefined ? body : { ...body, triageVisit }, callId, leaf: "answer" });
}

/** The pause between failure-answer posts that got no answer. */
const SETTLE_GAP_MS = 1_000;

/**
 * Keep posting a failure answer until one settles the call, one is refused for good, or the deadline passes — no
 * attempt is started at or past it. A 409 settles it too: the answer route's 409 means no tool call waits on the
 * token any more — answered, timed out, or the call ended — or another page claimed it and is running it, so nothing
 * is left stuck on this page's account. Pure over its seams.
 *
 * @param attempt posts the failure answer once
 * @param now a monotonic clock in milliseconds
 * @param pause waits between attempts that got no answer
 * @param deadlineMs the instant, on `now`'s clock, by which the server has timed the call out anyway
 * @returns `undefined` once the call is settled, else why it could not be
 */
export async function settleUntil({
  attempt,
  now,
  pause,
  deadlineMs,
}: {
  attempt: () => Promise<PlanPost>;
  now: () => number;
  pause: (input: { ms: number }) => Promise<void>;
  deadlineMs: number;
}): Promise<string | undefined> {
  let why = "the call's wait had already passed, so no failure answer was sent";
  while (now() < deadlineMs) {
    const post = await attempt();
    if (post.kind === "taken" || (post.kind === "refused" && post.status === 409)) {
      return undefined;
    }
    if (post.kind === "refused") {
      return post.why;
    }
    why = post.why;
    await pause({ ms: SETTLE_GAP_MS });
  }
  return `no failure answer reached the call before its wait ran out: ${why}`;
}

/**
 * Settle a tool call this page could not run or answer — its claim was lost or came back too late, or its real
 * answer was lost — as failed, so the thread goes on and the voice says so instead of waiting out the server's whole
 * window in silence, as a turn never ends while the machine is loaded. Never runs the tool; the
 * server answers an unclaimed call in its own words, and a claimed one with these.
 *
 * @param token the token its `tool` event carried
 * @param deadlineMs when, on `performance.now()`, the server's wait for it has certainly ended
 * @param claimant the id this page claims under, so a call another page claimed meanwhile is refused, never settled
 * @returns `undefined` once the call is settled, else why it could not be
 */
export async function settleFailedPlanTool({
  callId,
  token,
  deadlineMs,
  claimant,
}: {
  callId: string;
  token: string;
  deadlineMs: number;
  claimant: string;
}): Promise<string | undefined> {
  const contentItems = [{ text: UNDELIVERED_TOOL_TEXT, type: "inputText" }];
  const body = { claimant, contentItems, success: false, token };
  return settleUntil({
    attempt: () => postPlan({ body, callId, leaf: "answer" }),
    deadlineMs,
    now: () => performance.now(),
    pause: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  });
}

/**
 * The owner's nudge: ask the server to have the voice answer their last words and stop any Codex turn still running — or, with
 * `promised`, the page's own press over a promise the voice never started, which stops nothing. The page sends no
 * text; what the voice is handed is the server's. Waits out both of the server's steps before calling it lost.
 *
 * @param promised whether the page is pressing it itself over a promise (`promiseDueOf`), rather than the owner is
 * @returns `taken` once the voice was asked to answer; `refused` with the server's reason; `lost` when it cannot tell
 */
export async function nudgePlanCall({ callId, promised }: { callId: string; promised: boolean }): Promise<PlanPost> {
  const timeoutMs = 2 * PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  let body: { promised?: true } = {};
  if (promised) {
    body = { promised: true };
  }
  return postPlan({ body, callId, leaf: "nudge", timeoutMs });
}

/**
 * Ask the server to have the voice take its turn, the owner's words having gone unanswered. The page sends no text; what the
 * voice reads is the server's. Waits out the server's one step before calling it lost.
 *
 * @returns `taken` once the voice was handed the sentence; `refused` with the server's reason; `lost` when it cannot
 *   tell
 */
export async function resumePlanCall({ callId }: { callId: string }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  return postPlan({ body: {}, callId, leaf: "resume", timeoutMs });
}

/**
 * Ask the server to tell the voice a Slack send the owner asked for was held or failed (`../../lib/slackSendWatch.ts`). The
 * page sends only WHICH send; the server reads its outcome itself, refuses one that has gone since, and what the voice
 * reads is the server's. Waits out that read and the server's one step before calling it lost.
 *
 * @param send the send's Slack link and the instant the owner asked, which the server delivers once
 * @returns `taken` once the voice was handed it, now or before; `refused` with the server's reason; `lost` when it
 *   cannot tell
 */
export async function sendOutcomePlanCall({ callId, send }: { callId: string; send: CheckSend }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS + TOOL_TIMEOUT_MS;
  return postPlan({ body: { send }, callId, leaf: "send-outcome", timeoutMs });
}

/**
 * Tell the server a count of the owner's Queue the voice said that the app does not show, which it keeps as the call's
 * provenance and never hands the voice (`../../lib/talkCountGrounding.ts`). The page sends only the structured claim;
 * the entry's words are the server's. The route answers from memory.
 *
 * @param grounding where it was said, the number, what it was said of, the app's labelled figures, and whether the
 *   thread wrote it
 * @returns `taken` once it is kept; `refused` with the server's reason; `lost` when it cannot tell
 */
export async function countGroundingPlanCall({
  callId,
  grounding,
}: {
  callId: string;
  grounding: CountGrounding;
}): Promise<PlanPost> {
  return postPlan({ body: { grounding }, callId, leaf: "count-grounding" });
}

/**
 * Tell the server a done claim or PR number the voice said that nothing on the call said first, fleet work it promised
 * as its own (`../../lib/talkFleetPromises.ts`), or a question it asked again after the owner spoke to it
 * (`../../lib/talkRepeatedAsk.ts`), which it keeps as the call's provenance (`../../lib/talkSpokenClaims.ts`); a done
 * claim and a fleet promise are also owed a fixed correction aloud. The page sends only the closed shape; every word is
 * the server's. The route answers from memory.
 *
 * @param grounding where it was said, and the act, the number, a fleet promise or a repeated ask
 * @returns `taken` once it is kept; `refused` with the server's reason; `lost` when it cannot tell
 */
export async function claimGroundingPlanCall({
  callId,
  grounding,
}: {
  callId: string;
  grounding: ClaimGrounding;
}): Promise<PlanPost> {
  return postPlan({ body: { grounding }, callId, leaf: "claim-grounding" });
}

/**
 * Tell the server a triage card's clock is up, so the voice says so and suggests a call. The page sends only
 * the visit's id; the words are the server's. Waits out the server's one step before calling it lost.
 *
 * @param visitId the page's id for this card's time in front of the owner, which the call says once
 * @returns `taken` once the voice was handed it, or had been; `refused` with the server's reason — a 409 when the floor
 *   was taken and a retry will do; `lost` when it cannot tell
 */
export async function triageDuePlanCall({ callId, visitId }: { callId: string; visitId: string }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  return postPlan({ body: { visitId }, callId, leaf: "triage-due", timeoutMs });
}

/**
 * Tell the server the owner has drifted from what they said they would do, so the voice says one fixed line about it. The page
 * sends the plan's label, the application's name and how long; never a window title. Waits out the server's one step
 * before calling it lost.
 *
 * @param notice the drift, its id minted once and kept through every retry so the line is said once
 * @returns `taken` once the voice was handed it, or had been; `refused` with the server's reason — a 409 when the floor
 *   was taken and a retry will do; `lost` when it cannot tell
 */
export async function driftPlanCall({ callId, notice }: { callId: string; notice: DriftNotice }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  const body = { app: notice.app, minutes: notice.minutes, noticeId: notice.noticeId, plan: notice.plan };
  return postPlan({ body, callId, leaf: "drift", timeoutMs });
}

/**
 * Tell the server the owner has strayed off ISO in work hours, so the voice says one fixed line naming the ISO card waiting.
 * The page sends that one card's key and subject, the stretch's minutes and whether it is the second; never a window
 * title or another row. Waits out the server's one step before calling it lost.
 *
 * @param notice the nudge, its id minted once and kept through every retry so the line is said once
 * @returns `taken` once the voice was handed it, or had been; `refused` with the server's reason — a 409 when the floor
 *   was taken and a retry will do; `lost` when it cannot tell
 */
export async function isoNudgePlanCall({
  callId,
  notice,
}: {
  callId: string;
  notice: IsoNudgeNotice;
}): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  const body = {
    again: notice.again,
    item: { key: notice.item.key, subject: notice.item.subject },
    minutes: notice.minutes,
    noticeId: notice.noticeId,
  };
  return postPlan({ body, callId, leaf: "iso-nudge", timeoutMs });
}

/**
 * Hand the server the call's completed speech a starting turn has not had, and the draft of the card the owner's words began
 * over, to steer into that turn (`../../lib/talkVoiceRecord.ts`). Waits out the server's one step before calling it
 * lost.
 *
 * @param record the Codex turn the page saw start, its lines bounded by `recordToPost`, and the card's draft
 * @returns `taken` once the turn took it; `refused` with the server's reason — a 504 when it may still take it; `lost`
 *   when the page cannot tell
 */
export async function spokenRecordPlanCall({
  callId,
  record,
}: {
  callId: string;
  record: SpokenRecord;
}): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  return postPlan({ body: { record }, callId, leaf: "spoken-record", timeoutMs });
}

/**
 * Ask the server to have the voice say it is looking, or finding it, once a look or a lookup the owner asked for is handed
 * off. The page sends only which; what is said is the server's. Waits out the server's one step before calling it lost.
 *
 * @param ask a look at the owner's screen, or a lookup
 * @returns `taken` once the voice was asked to speak; `refused` with the server's reason; `lost` when it cannot tell
 */
export async function lookPlanCall({ callId, ask }: { callId: string; ask: LookAsk }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  return postPlan({ body: { ask }, callId, leaf: "look", timeoutMs });
}

/**
 * Hand the server the frame the page took for the owner's look ask, to steer into the Codex turn answering it or start that
 * turn with. Only the picture is the page's; the words beside it are the server's. Waits out the server's wait for a
 * turn to start and its one step before calling it lost.
 *
 * @param imageUrl the frame, a `data:image/` URL
 * @returns `taken` once the frame reached a turn; `refused` with the server's reason; `lost` when it cannot tell
 */
export async function framePlanCall({ callId, imageUrl }: { callId: string; imageUrl: string }): Promise<PlanPost> {
  const timeoutMs = PLAN_CALL_LIMITS.lookStartMs + PLAN_CALL_LIMITS.nudgeStepMs + PLAN_POST_MS;
  return postPlan({ body: { imageUrl }, callId, leaf: "frame", timeoutMs });
}

/**
 * Stop the call on the server — the app-server child and its realtime session with it. Idempotent there.
 *
 * @param keepalive whether the request must outlive the page (`pagehide`)
 */
export function stopPlanCall({ callId, keepalive }: { callId: string; keepalive: boolean }): void {
  void fetch(callPath({ callId, leaf: "stop" }), {
    body: "{}",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    keepalive,
    method: "POST",
  }).catch(() => {
    // The server stops an unattended call on its own after its absent-stream grace; nothing here to report to.
  });
}

/**
 * Stop a call the voice window's renderer died under, with the crash as its reason (`lib/overlayCrashRecovery.ts`),
 * and wait for the answer, so a reconnect only follows a call the server has let go.
 *
 * @param why the shell's sentence for the crash, one bounded line
 * @returns `taken` once the server stopped it or already had; `refused` or `lost` otherwise
 */
export async function stopCrashedPlanCall({ callId, why }: { callId: string; why: string }): Promise<PlanPost> {
  return postPlan({ body: { reason: why }, callId, leaf: "stop" });
}
