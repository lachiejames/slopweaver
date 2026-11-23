/**
 * A plan call's tool relay (`PlanCall`, `./talkPlanCall.ts`): a dynamic tool call the thread makes reaches the page
 * as an opaque token, the page claims it before running it and answers it once, and one left unclaimed or unanswered
 * is answered with a fixed failure of this server's own. Methods only — the state is `./talkPlanCallBase.ts`'s.
 */
import {
  PLAN_CALL_LIMITS,
  type PlanAnswerOutcome,
  type PlanClaimOutcome,
  UNDELIVERED_TOOL_TEXT,
} from "./planCallContract";
import { coverageLine, readCoverageOf, toolArgsOf } from "./readCoverage";
import { PlanCallNotifications } from "./talkPlanCallNotifications";
import { type RpcId, rpcErrorLine, rpcResultLine } from "./talkPlanProtocol";
import { type PlanContentItem, type PlanToolCall, planToolCallOf } from "./talkPlanProtocolItems";

/** What a tool the page did not answer in time answers with. */
const TOOL_TIMEOUT_TEXT = "The console did not answer this tool call in time.";

/** Why a token no longer stands for a tool call the page may claim or answer. */
const NOT_WAITING = "no tool call is waiting on that token: answered already, timed out, or never made";

/** A plan call's tool relay, above its notifications. */
export abstract class PlanCallTools extends PlanCallNotifications {
  /**
   * A request the server made: a dynamic tool call is relayed to the page; anything else is refused.
   *
   * @param id its id
   * @param method its method
   * @param params its params
   */
  protected override serverRequest({ id, method, params }: { id: RpcId; method: string; params: unknown }): void {
    const call = method === "item/tool/call" ? planToolCallOf({ params }) : undefined;
    // A request reusing a waiting call's RPC id is dropped unanswered: that id is still owed exactly one response,
    // and the waiting call's own answer or timeout gives it. Answering the reuse instead would settle the id under a
    // call the page may already hold a claim for, and then run.
    if ([...this.pending.values()].some((waiting) => waiting.rpcId === id)) {
      return;
    }
    if (call === undefined || this.ended || this.takenCallIds.has(call.callId) || call.threadId !== this.threadId) {
      this.port.write({ line: rpcErrorLine({ id, message: `the console does not answer ${method}` }) });
      return;
    }
    this.takenCallIds.add(call.callId);
    // The owner's typed words still being written may be what this call acts on, so the page hears them before it runs it.
    this.typedIn.toolCallArrived({ args: call.arguments, tool: call.tool });
    // Suffixed with this call's own count of tool calls, so a token is never issued twice in one call whatever the
    // minter returns: a late answer to a settled call can then never land on a later one.
    const token = `${this.mintToken()}.${String(this.takenCallIds.size)}`;
    const cancel = this.timeTool({ ms: PLAN_CALL_LIMITS.unclaimedToolMs, text: UNDELIVERED_TOOL_TEXT, token });
    this.pending.set(token, { call, cancel, claimant: undefined, claimed: false, rpcId: id });
    this.emit({ event: { arguments: call.arguments, kind: "tool", token, tool: call.tool, turnId: call.turnId } });
  }

  /**
   * Answer a pending tool call the page claimed and ran — or, with `success: false`, one it could not run whether
   * or not its claim arrived. That failure is the page's way out when a claim or an answer got no answer: without it
   * the thread waits out {@link PLAN_CALL_LIMITS.unclaimedToolMs}, or {@link PLAN_CALL_LIMITS.pendingToolMs} once
   * claimed, with the voice silent (a turn that never ends while the machine is loaded).
   *
   * @param token the opaque token the page received
   * @param contentItems what the tool answered with
   * @param success whether the tool succeeded
   * @param claimant the id the answering page minted, which must be the claimant's once the call is claimed
   * @returns whether the answer reached the child, and the tool it settled, which the triage clock reads
   *   (`./triagePresented.ts`)
   */
  answer({
    token,
    contentItems,
    success,
    claimant,
  }: {
    token: string;
    contentItems: readonly PlanContentItem[];
    success: boolean;
    claimant: string;
  }): PlanAnswerOutcome {
    if (this.ended) {
      return { kind: "refused", reason: `the call has ended: ${String(this.endedReason)}` };
    }
    const waiting = this.pending.get(token);
    if (waiting === undefined) {
      return { kind: "refused", reason: NOT_WAITING };
    }
    // Only a claimed call is ever run, so only a claimed call is answered with what it did: an answer that skipped the
    // claim did not come through the page's run path, and its text would reach the model with no read recorded
    // against it. A failure is the exception, and carries this server's words, never the page's.
    if (!waiting.claimed) {
      if (success) {
        return { kind: "refused", reason: "that tool call was never claimed; a page claims it before running it" };
      }
      this.settleTool({ contentItems: [{ text: UNDELIVERED_TOOL_TEXT, type: "inputText" }], success: false, token });
      return { arguments: waiting.call.arguments, kind: "answered", tool: waiting.call.tool };
    }
    if (waiting.claimant !== claimant) {
      return { kind: "refused", reason: "that tool call is another page's; the page that claimed it answers it" };
    }
    if (success && waiting.call.tool === "offer_copy") this.heldAnswers.offerLanded({ turnId: waiting.call.turnId });
    // A failed answer is read the same way: its content still reaches the model, so a cut in it still stands.
    // It never closes one, since a read that failed read nothing on.
    this.settleTool({ contentItems: this.covered({ call: waiting.call, contentItems, success }), success, token });
    return { arguments: waiting.call.arguments, kind: "answered", tool: waiting.call.tool };
  }

  /**
   * Claim a pending tool call for the page to run. The page claims before it runs anything, so an event that
   * reached it after the call was settled — timed out while the stream sat in a buffer, or replayed to a reloaded
   * page after it was answered — is refused here rather than run; and the claim swaps the short
   * {@link PLAN_CALL_LIMITS.unclaimedToolMs} wait for a fresh {@link PLAN_CALL_LIMITS.pendingToolMs} one, so a tool
   * the page began inside the window is not timed out under it by the time it took to arrive.
   *
   * @param token the opaque token the page received
   * @param claimant the id the claiming page minted, the only one its answer is then taken from
   * @returns whether the page may run it
   */
  claim({ token, claimant }: { token: string; claimant: string }): PlanClaimOutcome {
    if (this.ended) {
      return { kind: "refused", reason: `the call has ended: ${String(this.endedReason)}` };
    }
    const waiting = this.pending.get(token);
    if (waiting === undefined) {
      return { kind: "refused", reason: NOT_WAITING };
    }
    if (waiting.claimed) {
      return { kind: "refused", reason: "that tool call is already claimed; it is run once" };
    }
    waiting.cancel();
    const cancel = this.timeTool({ ms: PLAN_CALL_LIMITS.pendingToolMs, text: TOOL_TIMEOUT_TEXT, token });
    this.pending.set(token, { ...waiting, cancel, claimant, claimed: true });
    return { arguments: waiting.call.arguments, kind: "claimed", tool: waiting.call.tool, turnId: waiting.call.turnId };
  }

  /**
   * A tool's answer with how much of its source it carried, read the one way for every tool (`./readCoverage.ts`):
   * the cut reads are noted for the hold on the answer (`./coverageHold.ts`), and a cut answer goes to the model with
   * the server's line naming each cut and the call that reads on. A whole answer goes as it came, costing nothing.
   *
   * @param call the tool call answered
   * @param contentItems what the page answered it with
   * @param success whether the page ran it, so only a read that ran can close a cut
   * @returns the items the model reads
   */
  private covered({
    call,
    contentItems,
    success,
  }: {
    call: PlanToolCall;
    contentItems: readonly PlanContentItem[];
    success: boolean;
  }): readonly PlanContentItem[] {
    const args = toolArgsOf({ text: call.arguments });
    const coverage = readCoverageOf({ args, contentItems, tool: call.tool });
    this.coverage.answered({ args, coverage, succeeded: success, turnId: call.turnId });
    if (coverage.kind === "whole") {
      return contentItems;
    }
    return [...contentItems, { text: coverageLine({ gaps: coverage.gaps }), type: "inputText" }];
  }

  /**
   * Arm a tool call's wait: unanswered for `ms`, it is answered as a failure carrying `text`.
   *
   * @param token its token
   * @param ms how long it waits — {@link PLAN_CALL_LIMITS.unclaimedToolMs} unclaimed, `pendingToolMs` once claimed
   * @param text the fixed server-owned answer the model reads when the wait runs out
   * @returns the cancel
   */
  private timeTool({ token, ms, text }: { token: string; ms: number; text: string }): () => void {
    return this.clock.after({
      ms,
      run: () => {
        this.settleTool({ contentItems: [{ text, type: "inputText" }], success: false, token });
      },
    });
  }

  /**
   * Write one tool call's response and forget it.
   *
   * @param token its token
   * @param contentItems the answer
   * @param success whether it succeeded
   */
  private settleTool({
    token,
    contentItems,
    success,
  }: {
    token: string;
    contentItems: readonly PlanContentItem[];
    success: boolean;
  }): void {
    const waiting = this.pending.get(token);
    if (waiting === undefined) {
      return;
    }
    this.pending.delete(token);
    waiting.cancel();
    this.journal.toolAnswered({ call: waiting.call, contentItems, success });
    this.port.write({ line: rpcResultLine({ id: waiting.rpcId, result: { contentItems, success } }) });
  }
}
