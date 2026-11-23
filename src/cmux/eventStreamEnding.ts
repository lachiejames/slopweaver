/**
 * The pure half of `./eventStream.ts`: what one chunk of frames does, and how a stream that stopped ends.
 * Split out so the refusal-before-reset ordering is unit-tested rather than reachable only through a socket.
 */
import { type CmuxError, CmuxErrors } from "./errors.js";
import { type CmuxEventHandlers } from "./eventStream.js";
import { parseAckFrame, parseEventFrame } from "./events.js";
import { redactCapability, refusalError, socketRefusalOf } from "./socketFrames.js";

/**
 * Hand each complete frame to its handler, stopping at a `cmuxOnly` refusal.
 *
 * @returns cmux's refusal text when a frame was one, else `undefined` once every frame is handled
 */
export function dispatchFrames({
  capability,
  frames,
  handlers,
}: {
  capability: string | undefined;
  frames: readonly string[];
  handlers: CmuxEventHandlers;
}): string | undefined {
  for (const sent of frames) {
    // Redacted once, as the call socket does, so neither an ack nor an event can carry the presented token on.
    const frame = redactCapability({ capability, text: sent });
    const refusal = socketRefusalOf({ capability, line: frame });
    if (refusal !== undefined) {
      return refusal;
    }
    const ack = parseAckFrame({ line: frame });
    if (ack !== undefined) {
      handlers.onAck({ ack });
      continue;
    }
    const event = parseEventFrame({ line: frame });
    if (event !== undefined) {
      handlers.onEvent({ event });
    }
  }
  return undefined;
}

/**
 * cmux's `cmuxOnly` refusal, in its own words.
 *
 * @returns SOCKET_UNAVAILABLE carrying cmux's refusal text, typed `access-denied` when it is that refusal
 */
export function refusedError({ refusal, socketPath }: { refusal: string; socketPath: string }): CmuxError {
  return refusalError({ refusal, socketPath });
}

/**
 * How a stream that stopped ends. A refusal written without its final newline is still in the buffer, and it
 * outranks both a clean close and a reset that follows it.
 *
 * @returns the refusal, else the socket's own error, else `undefined` for a clean end
 */
export function endingOf({
  buffer,
  capability,
  cause,
  socketPath,
}: {
  buffer: string;
  capability: string | undefined;
  cause: Error | undefined;
  socketPath: string;
}): CmuxError | undefined {
  const refusal = socketRefusalOf({ capability, line: buffer });
  if (refusal !== undefined) {
    return refusedError({ refusal, socketPath });
  }
  if (cause === undefined) {
    return undefined;
  }
  return CmuxErrors.socketUnavailable({ cause, detail: cause.message, socketPath });
}
