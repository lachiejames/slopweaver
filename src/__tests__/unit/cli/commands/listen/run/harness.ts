/**
 * The connect → drain → reconnect loop's injected seams, every one a plain fake: no socket, no clock, no token. A
 * script names each connection attempt in order — the frames it yields, or which of the two ways it fails — and the
 * harness records what the loop logged, waited, handled and reported, so a case asserts the behaviour a live
 * listener is judged on.
 */
import type { ListenDeps, ListenLoopResult } from "../../../../../../cli/commands/listen/loop.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { type SocketTicketError, SocketTicketErrors } from "../../../../../../live/listen/errors.js";
import type { MentionHandler } from "../../../../../../live/listen/mention.js";
import { RECONNECT_MAX_FAILURES, SLACK_LINK_DISABLED } from "../../../../../../live/listen/reconnect.js";
import { UNSCOPED } from "../../../../../../live/listen/scope.js";
import type { ResponderRefusalHandler, SocketConnection } from "../../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../../live/listen/whitelist.js";

/**
 * Unwrap an ordinary (no-deadline) `runListenLoop` result down to its exit code, or fail loudly.
 *
 * @param result the loop's outcome, which must be an `exit` in a scenario with no deadline
 * @returns the exit code the loop reported
 */
export function exitCodeOf({ result }: { result: ListenLoopResult }): number {
  if (result.kind !== "exit") {
    throw new Error(`expected an "exit" result in this no-deadline scenario, got "${result.kind}"`);
  }
  return result.code;
}

/** One scripted connection attempt: the frames it yields, or which of the two ways it fails. */
export type Step = readonly string[] | "no-ticket" | "no-socket";

/** What a connection yields once the script is exhausted, so a fake can never loop forever. */
export const STOP_FRAME = JSON.stringify({ reason: SLACK_LINK_DISABLED, type: "disconnect" });

/**
 * An `events_api` frame carrying one `app_mention`.
 *
 * @param envelopeId the Socket Mode envelope the frame is acknowledged by
 * @param eventId Slack's event id, the key a redelivery is deduplicated on
 * @param retryAttempt Slack's redelivery counter, omitted from the frame when absent
 * @param ts the mention's message timestamp
 * @returns the frame's JSON text
 */
export function mentionFrame({
  envelopeId,
  eventId,
  retryAttempt,
  ts = "1785114398.557099",
}: {
  envelopeId: string;
  eventId: string;
  retryAttempt?: number;
  ts?: string;
}): string {
  return JSON.stringify({
    envelope_id: envelopeId,
    payload: {
      event: {
        channel: "C0LISTEN",
        text: "<@U0BOT> status?",
        ts,
        type: "app_mention",
        user: "U0HUMAN",
      },
      event_id: eventId,
      type: "event_callback",
    },
    ...(retryAttempt === undefined ? {} : { retry_attempt: retryAttempt }),
    type: "events_api",
  });
}

/** A connection that yields fixed frames and then ends. */
function connectionOf({ texts }: { texts: readonly string[] }): SocketConnection {
  let ended: string | undefined;
  let lost = 0;
  return {
    acknowledge: () => undefined,
    cancel: async ({ why }) => {
      // First reason wins: a cancel after the connection already ended changes nothing.
      if (ended !== undefined) {
        return;
      }
      ended = why;
    },
    close: async ({ why }) => {
      ended = why;
    },
    discarded: () => lost,
    endedBecause: () => ended,
    frames: async function* frames() {
      for (const text of texts) {
        if (ended !== undefined) {
          lost += 1;
          continue;
        }
        yield text;
      }
      if (ended !== undefined) {
        return;
      }
      ended = "the fixture ran out of frames";
    },
  };
}

/** The neutral fixture every test that is not ABOUT the whitelist supplies: `U0HUMAN` is on it. */
export const ADMITS_U0HUMAN: ResponderWhitelist = { identities: ["U0HUMAN"], kind: "list" };

/** A refusal handler that never fires, for every test that is not about a refusal's own effects. */
export const noRefusal: ResponderRefusalHandler = async () => {};

/** What a scripted run recorded. */
interface Harness {
  readonly deps: ListenDeps;
  readonly lines: readonly string[];
  readonly waits: readonly number[];
  readonly handled: readonly string[];
  /** Every socket state the loop reported, in order — the supervision heartbeat's only source of truth. */
  readonly socketStates: readonly string[];
  /** How many frames the loop reported, `ping`s included. */
  readonly frames: () => number;
}

/**
 * Build the injected seams from a script — one entry per connection attempt, consumed in order.
 *
 * @param script one step per connection attempt; once it runs out, the next connection yields {@link STOP_FRAME}
 * @returns the seams, plus what the loop logged, waited, handled and reported through them
 */
export function harness({ script }: { script: readonly Step[] }): Harness {
  const lines: string[] = [];
  const waits: number[] = [];
  const handled: string[] = [];
  const socketStates: string[] = [];
  let frames = 0;
  let attempt = 0;
  let pending: readonly string[] = [];
  const handler: MentionHandler = async (mention) => {
    handled.push(mention.messageTs);
  };
  const deps: ListenDeps = {
    allowMultipleConnections: false,
    handler,
    log: ({ line }) => {
      lines.push(line);
    },
    nowMs: () => 0,
    openConnection: async ({ url }) => (url === "wss://no-socket" ? undefined : connectionOf({ texts: pending })),
    openTicket: async (): Promise<Result<string, SocketTicketError>> => {
      const step = script[attempt];
      attempt += 1;
      if (step === undefined) {
        // The script ran out: tell the listener to stop, so a fake can never spin.
        pending = [STOP_FRAME];
        return ok("wss://fake");
      }
      if (step === "no-ticket") {
        return err(SocketTicketErrors.refused({ slackErrorCode: "invalid_auth" }));
      }
      if (step === "no-socket") {
        return ok("wss://no-socket");
      }
      pending = step;
      return ok("wss://fake");
    },
    onSocketFrame: () => {
      frames += 1;
    },
    onSocketState: ({ state }) => {
      socketStates.push(state);
    },
    refuseResponder: noRefusal,
    responderHatchOpen: () => false,
    scope: UNSCOPED,
    threadReplyChannels: [],
    responderWhitelist: () => ADMITS_U0HUMAN,
    wait: async ({ ms }) => {
      waits.push(ms);
      return "elapsed";
    },
  };
  return { deps, frames: () => frames, handled, lines, socketStates, waits };
}

/** Slack's `hello` reporting one connection — the permitted case. */
export const HELLO_ONE = JSON.stringify({ num_connections: 1, type: "hello" });

/** Slack's `hello` reporting two connections — refused at the socket, retried by the loop inside its grace. */
export const HELLO_TWO = JSON.stringify({ num_connections: 2, type: "hello" });

/**
 * Seams whose clock advances by exactly what each wait waited, so a grace window is crossed with no timer.
 *
 * @param deps the seams whose `wait` is still the one that records
 * @returns the same seams, with `nowMs` reading the summed waits
 */
export function advancingClock({ deps }: { deps: ListenDeps }): ListenDeps {
  let now = 0;
  return {
    ...deps,
    nowMs: () => now,
    wait: async (args) => {
      now += args.ms;
      return deps.wait(args);
    },
  };
}

/** The eight consecutive ticket failures the budget allows. */
export const EIGHT_FAILURES: readonly Step[] = Array.from(
  { length: RECONNECT_MAX_FAILURES + 1 },
  () => "no-ticket" as const,
);
