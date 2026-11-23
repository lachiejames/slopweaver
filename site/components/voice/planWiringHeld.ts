/**
 * The plan call this page holds: the type, following and releasing it, claiming, answering and failing its tool calls,
 * and the speech shower that writes a stretch of the call's speech. Split from `planWiring.ts` to keep it under the
 * line cap.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";
import type { Dispatch, SetStateAction } from "react";

import { clauseAfter } from "../../lib/clauseJoin";
import { PLAN_CALL_LIMITS, type PlanCallEvent } from "../../lib/planCallContract";
import type { GateEntry } from "../../lib/relayGate";
import { planContentOf } from "../../lib/talkPlanEvents";
import type { HeardStamp } from "../../lib/transcriptSinkContract";
import { type HeardSegment, shownSegmentOf, withHeardSegment } from "../../lib/voiceTranscript";
import {
  answerPlanTool,
  claimPlanTool,
  followPlanCall,
  type PlanPost,
  settleFailedPlanTool,
  stopPlanCall,
} from "./planCallClient";
import type { CallTranscript } from "./useCallTranscript";
import type { LiveMeta, Segment } from "./voiceContext";

/**
 * Claim one tool call on the plan call this page holds.
 *
 * @param held the plan call, when there is one
 * @param token the tool call's token
 * @returns `taken` once it is this page's to run, else why it is not
 */
export async function claimOnHeld({
  held,
  token,
}: {
  held: HeldPlanCall | undefined;
  token: string;
}): Promise<PlanPost> {
  if (held === undefined) {
    return { kind: "refused", status: 0, why: "this page holds no plan call" };
  }
  return claimPlanTool({ callId: held.callId, claimant: held.claimant, token });
}

/**
 * Put one stretch of speech — open or closed — in the call's written transcript and the shown segments: a v3 turn
 * as the call's data channel builds it.
 *
 * @param transcript the call's written record
 * @param call the call's id in that record
 * @param openNow the key of the card open as a stretch is heard, whether the voice opened it, which its line carries,
 *   and the console the owner is on, which a relay over no card is placed by
 * @param setSegments the shown segments' setter
 * @param kept how many shown segments are kept
 * @returns the shower
 */
export function speechShower({
  transcript,
  call,
  openNow,
  setSegments,
  kept,
}: {
  transcript: Pick<CallTranscript, "speaking" | "spoke">;
  call: string;
  openNow: () => HeardStamp;
  setSegments: Dispatch<SetStateAction<readonly HeardSegment[]>>;
  kept: number;
}): (input: { speech: Segment; final: boolean }) => void {
  return ({ speech, final }) => {
    const { open, openBy, context } = openNow();
    if (final) {
      transcript.spoke({ call, context, open, openBy, speech });
    } else {
      transcript.speaking({ call, context, open, openBy, speech });
    }
    // The shown segment keeps whether its turn is done, so the history can draw a turn still being said.
    setSegments((held) => withHeardSegment({ heard: shownSegmentOf({ call, final, speech }), held, kept }));
  };
}

/**
 * Hand one tool's answer to a plan call. A read is recorded BEFORE the post rather than after it: a post whose
 * answer is lost may still have reached the model, and a read the gate over-counts only sends the owner's words alone,
 * never a reading it should not.
 *
 * @param held the plan call, and the id this page claimed the tool call under
 * @param token the tool call's token
 * @param output the answer, as the page builds it
 * @param refused whether the tool refused
 * @param readText whether the answer hands the model third-party text
 * @param tool the tool's name, for the gate's record
 * @param gateLog the relay gate's record
 * @param triageVisit the visit a `triage_next` put in front of the owner, `undefined` on every other answer
 * @param deadlineMs when, on `performance.now()`, the server's wait for the call has certainly ended — a whole
 *   pending-tool window from now unless a test passes one
 * @param post posts the answer, the real route unless a test passes a seam
 * @param settle settles the call as failed when the answer was lost, the real route unless a test passes a seam
 * @returns `undefined` once the call has the answer, else why it did not take it — and, when the answer was lost,
 *   whether the call was settled as failed instead
 */
export async function deliverPlanAnswer({
  held: { callId, claimant },
  token,
  output,
  refused,
  readText,
  tool,
  gateLog,
  triageVisit,
  deadlineMs = performance.now() + PLAN_CALL_LIMITS.pendingToolMs,
  post = answerPlanTool,
  settle = settleFailedPlanTool,
}: {
  held: Pick<HeldPlanCall, "callId" | "claimant">;
  token: string;
  output: string | ResponseFunctionCallOutputItemList;
  refused: boolean;
  readText: boolean;
  tool: string;
  gateLog: { current: GateEntry[] };
  triageVisit: string | undefined;
  deadlineMs?: number;
  post?: typeof answerPlanTool;
  settle?: typeof settleFailedPlanTool;
}): Promise<string | undefined> {
  if (readText) {
    gateLog.current.push({ kind: "read", tool });
  }
  const contentItems = planContentOf({ output });
  const posted = await post({ callId, claimant, contentItems, success: !refused, token, triageVisit });
  if (posted.kind === "taken") {
    return undefined;
  }
  if (posted.kind === "refused") {
    return posted.why;
  }
  // Lost: the thread may still be waiting on it, so it is answered as failed rather than left the whole window.
  const unsettled = await settle({ callId, claimant, deadlineMs, token });
  if (unsettled === undefined) {
    return `the answer was lost: ${clauseAfter({ clause: "the call was told the tool could not run", joint: ";", reason: posted.why })}`;
  }
  return `the answer was lost: ${clauseAfter({ clause: `and ${unsettled}`, joint: ",", reason: posted.why })}`;
}

/**
 * Tell a plan call a tool that finished after the owner hung up will not be answered, in case the stop did not arrive; a
 * call that did stop refuses it.
 *
 * @param held the plan call the tool was claimed on
 * @param token the tool call's token
 */
export function failLateRun({ held, token }: { held: HeldPlanCall | undefined; token: string }): void {
  void failOnHeld({ deadlineMs: performance.now() + PLAN_CALL_LIMITS.pendingToolMs, held, token });
}

/**
 * Settle a tool call on the plan call this page holds as failed.
 *
 * @param held the plan call, when there is one
 * @param token the tool call's token
 * @param deadlineMs when, on `performance.now()`, the server's wait for it has certainly ended
 * @returns `undefined` once it is settled, else why it could not be
 */
export async function failOnHeld({
  held,
  token,
  deadlineMs,
}: {
  held: HeldPlanCall | undefined;
  token: string;
  deadlineMs: number;
}): Promise<string | undefined> {
  if (held === undefined) {
    return undefined;
  }
  return settleFailedPlanTool({ callId: held.callId, claimant: held.claimant, deadlineMs, token });
}

/**
 * A plan call this page is riding: its id on the server, the id this page claims its tool calls under, and what
 * stops following its events.
 */
export interface HeldPlanCall {
  readonly callId: string;
  readonly claimant: string;
  readonly follow: AbortController;
}

/**
 * Start following the plan call just minted. It is followed from the moment it exists, so its absent-stream grace
 * never runs while the page connects; a tool call made before the channel opens waits in the call's ring. A mint
 * that answered after its call was stopped is stopped too, and refused.
 *
 * @param minted what the offer minted
 * @param current whether the call that asked for it is still this page's current one
 * @param onEvent the stream's handler
 * @returns the held plan call
 */
export function followMinted({
  minted,
  current,
  onEvent,
}: {
  minted: LiveMeta;
  current: boolean;
  onEvent: (event: PlanCallEvent) => void;
}): HeldPlanCall {
  const { callId } = minted;
  if (!current) {
    stopPlanCall({ callId, keepalive: false });
    throw new Error("the call was stopped while it was being minted");
  }
  const follow = new AbortController();
  void followPlanCall({ callId, onEvent, signal: follow.signal });
  return { callId, claimant: crypto.randomUUID(), follow };
}

/**
 * Let go of a plan call: stop following it, and stop it on the server — its app-server child and its realtime
 * session with it. Keepalive, so a leaving page's stop still arrives.
 *
 * @param held the call, when there is one
 */
export function releasePlanCall({ held }: { held: HeldPlanCall | undefined }): void {
  if (held === undefined) {
    return;
  }
  held.follow.abort();
  stopPlanCall({ callId: held.callId, keepalive: true });
}
