/**
 * The listener loop's fakes: a connection that is a plain async generator rather than a mock, plus recording
 * handlers for the mention, the refusal and the narration.
 */
import type { Mention, MentionHandler } from "../../../../../live/listen/mention.js";
import type { ResponderRefusalHandler, SocketConnection } from "../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";

/** The neutral fixture every test that is not ABOUT the whitelist supplies: `U0HUMAN` is on it. */
export const ADMITS_U0HUMAN: ResponderWhitelist = { identities: ["U0HUMAN"], kind: "list" };

/** A refusal handler that never fires, for every test that is not about a refusal's own effects. */
export const noRefusal: ResponderRefusalHandler = async () => {};

/**
 * A refusal handler that records every call it received.
 *
 * @returns the handler, and the array each call is pushed onto
 */
export function recordingRefusal(): {
  refuseResponder: ResponderRefusalHandler;
  calls: { mention: Mention; why: string }[];
} {
  const calls: { mention: Mention; why: string }[] = [];
  const refuseResponder: ResponderRefusalHandler = async ({ mention, why }) => {
    calls.push({ mention, why });
  };
  return { calls, refuseResponder };
}

/** What a fake connection recorded while the loop drained it. */
interface FakeConnection {
  readonly connection: SocketConnection;
  readonly acked: readonly string[];
  readonly closed: readonly string[];
  readonly cancelled: readonly string[];
}

/**
 * A connection that yields fixed frames and then ends, recording every ack, close and cancel.
 *
 * `close` drains whatever is left in `texts` (graceful, matching the real queue's buffered-drain rule);
 * `cancel` discards it instead, counting it through `discarded()` — the same distinction
 * `createFrameQueue`'s own `end`/`cancel` pair makes, modelled here without a real queue underneath.
 *
 * @param texts the raw frames yielded in order, until the connection ends
 * @returns the connection, and the acks, closes and cancels it recorded
 */
export function fakeConnection({ texts }: { texts: readonly string[] }): FakeConnection {
  const acked: string[] = [];
  const closed: string[] = [];
  const cancelled: string[] = [];
  let ended: string | undefined;
  // First reason wins: a later close, cancel or exhaustion never rewrites why the connection ended.
  const endWith = ({ why }: { why: string }): void => {
    if (ended !== undefined) {
      return;
    }
    ended = why;
  };
  // Models the real queue's ONE lossy edge: a frame that arrives after the close is thrown away, and is
  // counted rather than vanishing. Without this the fixture would be kinder than production, and the
  // `abandoned` counter would have nothing to prove. `close` and `cancel` are recorded into separate arrays
  // so a test can assert WHICH one fired without this array-based fixture needing to model the
  // drain-vs-discard buffering nuance itself — that distinction is covered directly in frameQueue.test.ts.
  let lost = 0;
  const connection: SocketConnection = {
    acknowledge: ({ envelopeId }) => {
      acked.push(envelopeId);
    },
    cancel: async ({ why }) => {
      cancelled.push(why);
      endWith({ why });
    },
    close: async ({ why }) => {
      closed.push(why);
      endWith({ why });
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
      endWith({ why: "the fixture ran out of frames" });
    },
  };
  return { acked, cancelled, closed, connection };
}

/**
 * A handler that records what it was given, plus the recording array.
 *
 * @returns the handler, and every mention it was handed in order
 */
export function recordingHandler(): { handler: MentionHandler; seen: Mention[] } {
  const seen: Mention[] = [];
  const handler: MentionHandler = async (mention) => {
    seen.push(mention);
  };
  return { handler, seen };
}

/**
 * Collect the loop's narration.
 *
 * @returns the log sink, and every line it was given in order
 */
export function recordingLog(): { log: (args: { line: string }) => void; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: ({ line }) => {
      lines.push(line);
    },
  };
}
