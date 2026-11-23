/**
 * A plan call's wire and lifecycle (`PlanCall`, `./talkPlanCall.ts`): the handshake that opens it, the child's stdout
 * decoded and routed, each JSON-RPC request and its fate, the page's event stream and its absent-stream grace, and
 * the one stop every ending goes through. Methods only — the state is `./talkPlanCallBase.ts`'s.
 */
import { PLAN_CALL_LIMITS, type PlanOpenOutcome, type SequencedEvent } from "./planCallContract";
import { PlanCallBase } from "./talkPlanCallBase";
import type { PlanEmit } from "./talkPlanEventRing";
import { planCallLogLine } from "./talkPlanLog";
import {
  type AppServerInbound,
  decodeAppServerLine,
  type PlanComposition,
  type RpcId,
  type RpcOutcome,
  rpcRequestLine,
} from "./talkPlanProtocol";
import { realtimeOutcome, startPlanThread } from "./talkPlanStart";

/** A plan call's wire and lifecycle, above its state. */
export abstract class PlanCallWire extends PlanCallBase {
  /**
   * Run the handshake: initialize, require a ChatGPT login, start the thread, start realtime with the page's
   * offer, and wait for the answer SDP. Any outcome but `open` has already stopped the call.
   *
   * @param composition what `talk offer` printed
   * @param offerSdp the page's WebRTC offer
   * @returns the answer SDP and thread, or why there is none and whether a plan session may exist
   */
  async open({ composition, offerSdp }: { composition: PlanComposition; offerSdp: string }): Promise<PlanOpenOutcome> {
    // A throw anywhere in the handshake — a composition that will not serialise, say — stops the call like any other
    // failure, so the child it holds never outlives it. Ambiguous, because the throw may have come after the start.
    try {
      return await this.handshake({ composition, offerSdp });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      const reason = `the handshake threw (${why}); a plan session may exist`;
      this.stop({ reason });
      return { kind: "ambiguous", reason };
    }
  }

  /**
   * The handshake itself, for {@link open}: any outcome but `open` has already stopped the call.
   *
   * @param composition what `talk offer` printed
   * @param offerSdp the page's WebRTC offer
   * @returns the answer SDP and thread, or why there is none and whether a plan session may exist
   */
  private async handshake({
    composition,
    offerSdp,
  }: {
    composition: PlanComposition;
    offerSdp: string;
  }): Promise<PlanOpenOutcome> {
    const prepared = await this.prepareThread({ composition });
    if (typeof prepared === "object") {
      this.stop({ reason: prepared.reason });
      return prepared;
    }
    const threadId = prepared;
    this.threadId = threadId;
    const sdp = new Promise<string | undefined>((resolve) => {
      this.sdpWaiter = resolve;
    });
    const started = this.request({
      method: "thread/realtime/start",
      params: { ...composition.realtime, threadId, transport: { sdp: offerSdp, type: "webrtc" } },
      timeoutMs: PLAN_CALL_LIMITS.realtimeStartMs,
    });
    const outcome = await realtimeOutcome({
      sdp,
      started,
      timeoutMs: PLAN_CALL_LIMITS.realtimeStartMs,
      clock: this.clock,
    });
    if (outcome.kind !== "open") {
      this.stop({ reason: outcome.reason });
      return outcome;
    }
    this.realtimeOpen = true;
    // Loaded, never armed: the window starts when the page's connection is up (`reopen-reminder` route).
    this.reopenReminder.load({ reminder: composition.reopenReminder });
    this.armAbsent();
    // A turn started mid-handshake could arm no cue then; it arms now, timed from its own start.
    this.handOff.callSpeaks();
    return { kind: "open", sdp: outcome.sdp, threadId };
  }

  /**
   * Everything before `thread/realtime/start`: every failure here is definitive.
   *
   * @param composition the verb's composition
   * @returns the thread id, or the definitive refusal
   */
  protected async prepareThread({
    composition,
  }: {
    composition: PlanComposition;
  }): Promise<string | { readonly kind: "refused"; readonly reason: string }> {
    const { journal, port, surface } = this;
    return startPlanThread({ composition, journal, port, request: (input) => this.request(input), surface });
  }

  /**
   * Feed a chunk of the child's stdout.
   *
   * @param chunk the text that arrived
   */
  receive({ chunk }: { chunk: string }): void {
    const taken = this.lines.push({ chunk });
    if ("overflow" in taken) {
      this.stop({ reason: `the app-server wrote a line past ${String(taken.overflow)} bytes` });
      return;
    }
    for (const line of taken.lines) {
      const decoded = decodeAppServerLine({ line });
      if ("refused" in decoded) {
        this.stop({ reason: decoded.refused });
        return;
      }
      this.dispatch({ inbound: decoded.inbound });
    }
  }

  /**
   * Route one decoded message.
   *
   * @param inbound the message
   */
  private dispatch({ inbound }: { inbound: AppServerInbound }): void {
    if (inbound.kind === "response" || inbound.kind === "response-error") {
      const settle = this.waiting.get(inbound.id);
      this.waiting.delete(inbound.id);
      settle?.(
        inbound.kind === "response"
          ? { kind: "result", result: inbound.result }
          : { kind: "error", message: inbound.message },
      );
      return;
    }
    if (inbound.kind === "request") {
      this.serverRequest({ id: inbound.id, method: inbound.method, params: inbound.params });
      return;
    }
    this.journal.observe({ method: inbound.method, params: inbound.params });
    this.notification({ method: inbound.method, params: inbound.params });
  }

  /** A request the server made, relayed to the page or refused (`./talkPlanCallTools.ts`). */
  protected abstract serverRequest(input: { id: RpcId; method: string; params: unknown }): void;

  /** A notification from the server (`./talkPlanCallNotifications.ts`). */
  protected abstract notification(input: { method: string; params: unknown }): void;

  /**
   * Listen for events after `after`, replaying what the ring still holds.
   *
   * @param after the last sequence number the stream saw, `0` for none
   * @param listener told each event
   * @returns the replay, and the function that stops listening
   */
  subscribe({ after, listener }: { after: number; listener: (event: SequencedEvent) => void }): {
    readonly replay: readonly SequencedEvent[];
    readonly unsubscribe: () => void;
  } {
    this.cancelAbsent?.();
    this.cancelAbsent = undefined;
    return this.events.listen({ after, listener, onEmpty: this.armAbsent.bind(this) });
  }

  /** Start the absent-stream timer, once. */
  protected armAbsent(): void {
    if (this.ended || this.cancelAbsent !== undefined || this.events.listening()) {
      return;
    }
    this.cancelAbsent = this.clock.after({
      ms: PLAN_CALL_LIMITS.streamAbsentMs,
      run: () => {
        this.stop({ reason: "the console's event stream was gone for 30 seconds" });
      },
    });
  }

  /**
   * Record one event and tell every listener (`PlanEventRing`, `./talkPlanEventRing.ts`).
   *
   * @param event the event
   */
  protected override emit({ event, telemetry = false, replayAs }: PlanEmit): void {
    this.events.push({ event, replayAs, telemetry });
  }

  /**
   * The child exited on its own.
   *
   * @param detail its exit code or signal, and its stderr tail
   */
  exited({ detail }: { detail: string }): void {
    this.stop({ reason: `the app-server exited (${detail})` });
  }

  /**
   * End the call: tell the child to stop realtime, kill it, settle everything waiting, and emit `closed` once.
   *
   * @param reason why, in a sentence the page shows
   */
  override stop({ reason }: { reason: string }): void {
    if (this.ended) {
      return;
    }
    this.endedReason = reason;
    if (this.threadId !== undefined) {
      const params = { threadId: this.threadId };
      this.port.write({ line: rpcRequestLine({ id: this.mintRpcId(), method: "thread/realtime/stop", params }) });
    }
    this.port.kill();
    this.sdpWaiter?.(undefined);
    this.sdpWaiter = undefined;
    this.cancelLifetime();
    this.rolloverAsk.stop();
    this.listNotice.stop();
    this.cancelAbsent?.();
    for (const waiting of this.pending.values()) {
      waiting.cancel();
    }
    this.pending.clear();
    this.runningTurns.clear();
    this.turnStartedMs.clear();
    for (const waiter of Array.from(this.turnWaiters)) {
      waiter(undefined);
    }
    this.turnWaiters.clear();
    this.progressSentMs.clear();
    this.handOff.stop();
    this.heldAnswers.stop();
    this.turnOutcomes.stop();
    this.typedIn.stop();
    this.owedTurns.stop();
    this.reopenReminder.stop();
    for (const settle of this.waiting.values()) {
      settle({ kind: "ended", reason });
    }
    this.waiting.clear();
    this.journal.close();
    this.emit({ event: { kind: "closed", reason } });
    const nowMs = this.clock.nowMs();
    const event = { kind: "ended", livedMs: nowMs - this.madeMs, reason } as const;
    console.info(planCallLogLine({ atIso: new Date(nowMs).toISOString(), event, id: this.id }));
    this.onEnded({ id: this.id });
  }

  /**
   * The next request id — the console's own, never one the server minted.
   *
   * @returns a number no earlier request of this call used
   */
  private mintRpcId(): number {
    this.nextRpcId += 1;
    return this.nextRpcId;
  }

  /**
   * Send one request and wait for its answer, a deadline, or the call ending.
   *
   * @param method the method
   * @param params its params
   * @param timeoutMs how long it may take
   * @returns its fate
   */
  protected override async request({
    method,
    params,
    timeoutMs,
  }: {
    method: string;
    params: unknown;
    timeoutMs: number;
  }): Promise<RpcOutcome> {
    if (this.endedReason !== undefined) {
      return { kind: "ended", reason: this.endedReason };
    }
    const id = this.mintRpcId();
    return new Promise<RpcOutcome>((resolve) => {
      const cancel = this.clock.after({
        ms: timeoutMs,
        run: () => {
          this.waiting.delete(id);
          resolve({ kind: "timeout" });
        },
      });
      this.waiting.set(id, (outcome) => {
        cancel();
        resolve(outcome);
      });
      this.port.write({ line: rpcRequestLine({ id, method, params }) });
    });
  }
}
