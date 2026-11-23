/**
 * A plan call's two starts (`./talkPlanCallWire.ts`'s handshake): the thread — initialize, a ChatGPT plan login, then
 * `thread/start`, journalled — and how the realtime start is classified, the request's answer and its SDP in either
 * order against one deadline. Its own file so the call's class stays under the line cap; `CallClock` lives here
 * because the classification needs it, and `./talkPlanCall.ts` re-exports it.
 */
import { PLAN_CALL_LIMITS, type PlanOpenOutcome } from "./planCallContract";
import type { CallThreadTap } from "./talkCallThreadJournal";
import {
  fateOf,
  type PlanComposition,
  planAccountRefusal,
  type RpcOutcome,
  rpcNotificationLine,
  threadIdOf,
} from "./talkPlanProtocol";

/** The client this console names itself as to the app-server. */
const CLIENT_INFO = { name: "slopweaver-console", title: "Slopweaver console", version: "1" };

/**
 * Everything before `thread/realtime/start`: every failure here is definitive. The `thread/start` request is
 * journalled before it is sent and the thread bound once it answers, so the journal holds what the thread was told
 * even when it never started.
 *
 * @param composition the verb's composition, whose `thread` is exactly what the thread is told
 * @param request sends one request and waits for its fate
 * @param port writes the `initialized` notification
 * @param journal the call's thread journal
 * @param surface the call's surface, which the journal records
 * @returns the thread id, or the definitive refusal
 */
export async function startPlanThread({
  composition,
  request,
  port,
  journal,
  surface,
}: {
  composition: PlanComposition;
  request: (input: { method: string; params: unknown; timeoutMs: number }) => Promise<RpcOutcome>;
  port: { readonly write: (input: { readonly line: string }) => void };
  journal: CallThreadTap;
  surface: "voice" | "typed";
}): Promise<string | { readonly kind: "refused"; readonly reason: string }> {
  const step = PLAN_CALL_LIMITS.handshakeStepMs;
  const initParams = { capabilities: { experimentalApi: true }, clientInfo: CLIENT_INFO };
  const init = await request({ method: "initialize", params: initParams, timeoutMs: step });
  if (init.kind !== "result") {
    return { kind: "refused", reason: `the app-server did not initialize: ${fateOf({ outcome: init })}` };
  }
  port.write({ line: rpcNotificationLine({ method: "initialized" }) });
  const account = await request({ method: "account/read", params: { refreshToken: false }, timeoutMs: step });
  if (account.kind !== "result") {
    return { kind: "refused", reason: `the app-server could not read its login: ${fateOf({ outcome: account })}` };
  }
  const notPlan = planAccountRefusal({ result: account.result });
  if (notPlan !== undefined) {
    return { kind: "refused", reason: notPlan };
  }
  journal.threadStarting({ params: composition.thread, surface });
  const thread = await request({ method: "thread/start", params: composition.thread, timeoutMs: step });
  const threadId = thread.kind === "result" ? threadIdOf({ result: thread.result }) : undefined;
  if (threadId === undefined) {
    journal.threadNeverStarted();
    return { kind: "refused", reason: `the app-server did not start a thread: ${fateOf({ outcome: thread })}` };
  }
  journal.threadStarted({ threadId });
  return threadId;
}

/** Time, handed in. */
export interface CallClock {
  readonly nowMs: () => number;
  /** Run `run` after `ms`; the returned function cancels it. */
  readonly after: (input: { readonly ms: number; readonly run: () => void }) => () => void;
}

/** A call's clock, with the elapsed time its timers run on. */
export interface PlanCallClock extends CallClock {
  /**
   * Milliseconds on a clock that is never stepped and runs through a Mac's sleep, the one `after`'s timers measure
   * (`performance.now()` in Node, libuv's `mach_continuous_time` on darwin): what a timer that fired late measures the
   * time left by (`./talkPlanRolloverAsk.ts`).
   */
  readonly elapsedMs: () => number;
}

/**
 * Wait for `thread/realtime/start`'s answer AND its SDP, in either order, and classify what happened.
 *
 * @param started the request's fate
 * @param sdp resolves with the SDP notification
 * @param timeoutMs the deadline for both
 * @param clock time
 * @returns open, a definitive refusal (an error answer), or ambiguous (anything else)
 */
export async function realtimeOutcome({
  started,
  sdp,
  timeoutMs,
  clock,
}: {
  started: Promise<RpcOutcome>;
  sdp: Promise<string | undefined>;
  timeoutMs: number;
  clock: CallClock;
}): Promise<{ readonly kind: "open"; readonly sdp: string } | Exclude<PlanOpenOutcome, { kind: "open" }>> {
  let cancel: () => void = () => undefined;
  const deadline = new Promise<undefined>((resolve) => {
    cancel = clock.after({
      ms: timeoutMs,
      run: () => {
        resolve(undefined);
      },
    });
  });
  const answer = await started;
  if (answer.kind === "error") {
    cancel();
    return { kind: "refused", reason: `Codex refused the realtime session: ${answer.message}` };
  }
  if (answer.kind !== "result") {
    cancel();
    return {
      kind: "ambiguous",
      reason: `the realtime start got ${fateOf({ outcome: answer })}; a plan session may exist`,
    };
  }
  const got = await Promise.race([sdp, deadline]);
  cancel();
  if (got === undefined) {
    return {
      kind: "ambiguous",
      reason: "Codex accepted the realtime start but no answer SDP arrived; a plan session may exist",
    };
  }
  return { kind: "open", sdp: got };
}
