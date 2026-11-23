/**
 * The native Slack status indicator's whole lifecycle for one turn: set, re-assert on a timer, clear.
 *
 * Split out of `./poster.ts`'s `liveTurnPoster` because it is a self-contained state machine (one mutable
 * timer handle) rather than a single request/response call like the poster's other methods.
 */

import type { SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import { logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { ASSISTANT_STATUS_TIMEOUT_MS, assistantStatusArgs } from "../../outbound/assistant/status.js";
import type { TurnChrome } from "../../outbound/slack/types.js";
import type { TurnPoster } from "./run.js";

/**
 * How often a live turn re-asserts its status, so it survives Slack's documented
 * {@link ASSISTANT_STATUS_TIMEOUT_MS} clear.
 *
 * Comfortably under that timeout — a DESIGN CHOICE, not a measurement: nothing here has observed the
 * timeout firing live. The 20-second margin is chosen to absorb ordinary call latency without letting two
 * consecutive misses add up to a visible gap; an indicator that vanishes mid-work looks exactly like a turn
 * that died, which is the failure this whole mechanism exists to prevent.
 */
export const ASSISTANT_STATUS_REASSERT_MS = ASSISTANT_STATUS_TIMEOUT_MS - 20_000;

/** Set or clear the indicator once. NEVER throws — see the body for why that is a contract, not a habit. */
type StatusOutcome = Result<void, string>;

/**
 * Start a repeating timer firing `callback` every `delayMs`, and hand back the one way to stop it.
 *
 * @internal exported so its test can fire the re-assert by hand instead of waiting on a real interval.
 */
export type StatusReassertTimer = (input: { readonly callback: () => void; readonly delayMs: number }) => {
  readonly cancel: () => void;
};

/** The real repeating timer: `setInterval`, stopped by `clearInterval` on the same handle. */
const intervalTimer: StatusReassertTimer = ({ callback, delayMs }) => {
  const handle = setInterval(callback, delayMs);
  return {
    cancel: () => {
      clearInterval(handle);
    },
  };
};

/**
 * One `assistant.threads.setStatus` call, with both failure kinds flattened into an outcome.
 *
 * The transport RETHROWS a genuine transport fault — an ECONNRESET with no `error.data` — and turns only a
 * SLACK refusal into a value. Both are caught here so this function's contract is "never throws", which is
 * what every caller already assumed: the re-assert timer fires it WITHOUT awaiting, so a rejection escaping
 * would be an unhandled one, and Node terminates the process on those by default. A long turn would have
 * died at its first failed re-assert — after the tag, before the answer, and only on the slow questions
 * where the indicator earns its keep. An adversarial review found exactly that.
 *
 * @param transport the Slack write seam
 * @param channel the channel the turn is answering in
 * @param threadTs the thread the indicator belongs to
 * @param turnChrome the bot's display identity
 * @param turnId the id correlating this call with its turn, for the log line
 * @param status the status text, or the empty string to clear it
 * @returns ok, or the reason Slack or the transport gave
 */
async function setStatusOnce({
  transport,
  channel,
  threadTs,
  turnChrome,
  turnId,
  status,
}: {
  transport: SlackWriteTransport;
  channel: string;
  threadTs: string;
  turnChrome: TurnChrome;
  turnId: string;
  status: string;
}): Promise<StatusOutcome> {
  const outcome = await transport
    .setAssistantStatus({
      args: assistantStatusArgs({
        channelId: channel,
        iconEmoji: turnChrome.authorEmoji,
        status,
        threadTs,
        username: turnChrome.authorLabel,
      }),
    })
    .catch((cause: unknown) => err({ error: "", reason: cause instanceof Error ? cause.message : String(cause) }));
  if (outcome.isOk()) {
    return ok(undefined);
  }
  logger.error({ msg: `turn ${turnId}: ${outcome.error.reason}` });
  return err(outcome.error.reason);
}

/**
 * The native status indicator's WHOLE lifecycle for one turn: set, re-assert on a timer, clear.
 *
 * Split out of `liveTurnPoster` because it is a self-contained state machine (one mutable timer handle)
 * rather than a single request/response call like the poster's other methods.
 *
 * It does NOT go through the admit door — same posture as `reactions.add` on the poll ballot lane
 * (`src/cli/commands/slack/pollRun.ts`) and `src/admit/painPoint.ts`'s ledger append: it is a courtesy
 * signal, never content, and the turn must survive losing it. A refusal is reported LOUDLY through the
 * logger rather than swallowed — a `missing_scope` body names the exact fix — but it never throws and
 * never blocks the caller.
 *
 * @param transport the Slack write transport
 * @param channel the channel the mention arrived in
 * @param threadTs the thread the status applies to
 * @param turnChrome the bot's identity, carried through as the status's username/icon
 * @param turnId the id correlating this turn's log lines
 * @param scheduleReassert the repeating timer the re-assert runs on — `setInterval` unless a test drives it
 * @returns the three {@link TurnPoster} methods this lifecycle owns
 */
export function statusLifecycle({
  transport,
  channel,
  threadTs,
  turnChrome,
  turnId,
  scheduleReassert = intervalTimer,
}: {
  transport: SlackWriteTransport;
  channel: string;
  threadTs: string;
  turnChrome: TurnChrome;
  turnId: string;
  scheduleReassert?: StatusReassertTimer;
}): Pick<TurnPoster, "beginStatus" | "endStatus" | "stopStatusReasserting"> {
  let statusTimer: ReturnType<StatusReassertTimer> | undefined;
  const stopReasserting = (): void => {
    if (statusTimer !== undefined) {
      statusTimer.cancel();
      statusTimer = undefined;
    }
  };
  const callStatus = async ({ status }: { status: string }): Promise<StatusOutcome> =>
    setStatusOnce({ channel, status, threadTs, transport, turnChrome, turnId });
  return {
    beginStatus: async ({ status }) => {
      const first = await callStatus({ status });
      stopReasserting();
      // Fire-and-forget re-assert so a turn that outruns Slack's 2-minute clear does not go visibly dark
      // mid-work. A failed tick is reported by `callStatus` itself and must never interrupt the turn.
      statusTimer = scheduleReassert({
        callback: () => {
          // `callStatus` is contractually non-throwing (see its body), and the `.catch` here is the belt to
          // that braces: a `void` on a promise that CAN reject is an unhandled rejection, and this one is
          // fired from a timer where no caller exists to catch it.
          void callStatus({ status }).catch(() => undefined);
        },
        delayMs: ASSISTANT_STATUS_REASSERT_MS,
      });
      return first;
    },
    endStatus: async () => {
      stopReasserting();
      // An empty status is how the wire clears the indicator once the turn has something to show instead.
      return callStatus({ status: "" });
    },
    // The timer alone, no wire call — the turn is not over, so the indicator is still telling the truth.
    stopStatusReasserting: stopReasserting,
  };
}
