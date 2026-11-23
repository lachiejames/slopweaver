/**
 * The live event subscription a spawn's witness chain reads from.
 *
 * Deliberately tiny and deliberately separate from `spawn.ts`: everything in `witness.ts` is pure and
 * everything in `spawn.ts` is injected, so this is the one place that actually opens a socket for the sake of
 * a spawn — so a test reaches it only through the injected opener, never a real socket.
 *
 * It is also deliberately FORGIVING. If the subscription cannot be opened, `observedEvents` simply stays
 * empty and the witness chain falls through to cmux's delivery record and then the screen. An event witness
 * that could fail a spawn by being unavailable would have made dispatch strictly less reliable than the
 * screen read it was brought in to shore up.
 */
import { logger } from "../lib/logger.js";
import { type CmuxEventStream, openCmuxEventStream } from "./eventStream.js";
import type { CmuxEvent } from "./events.js";

/** The hook firings a spawn's witnesses ask about — every other event is dropped rather than accumulated. */
const WITNESSED_EVENT_NAMES = [
  "agent.hook.SessionStart",
  "agent.hook.UserPromptSubmit",
  "agent.hook.PreToolUse",
] as const;

/** How many events to retain. A spawn watches for seconds; an unbounded buffer would be a leak, not a feature. */
const MAX_RETAINED_EVENTS = 512;

/** How the witness opens its subscription — the real socket in production, a fake in a test. */
export type OpenSpawnEventStream = typeof openCmuxEventStream;

/** A running spawn witness. */
export interface SpawnEventWitness {
  /** Every witnessed event seen since this was opened, oldest first. */
  readonly observedEvents: () => readonly CmuxEvent[];
  /** Hang up. */
  readonly close: () => void;
}

/**
 * Subscribe to the boot/prompt-submit events a spawn watches for, from the live edge.
 *
 * @param socketPath the socket to subscribe on, defaulting to the resolved live one
 * @param openEventStream how the subscription is opened; omitted, the real cmux socket
 * @returns the running witness
 */
export function openSpawnEventWitness({
  socketPath,
  openEventStream = openCmuxEventStream,
}: {
  socketPath?: string;
  openEventStream?: OpenSpawnEventStream;
} = {}): SpawnEventWitness {
  const events: CmuxEvent[] = [];
  let stream: CmuxEventStream | undefined;
  try {
    stream = openEventStream({
      handlers: {
        onAck: () => undefined,
        onEnd: () => undefined,
        onEvent: ({ event }) => {
          events.push(event);
          if (events.length > MAX_RETAINED_EVENTS) {
            events.splice(0, events.length - MAX_RETAINED_EVENTS);
          }
        },
      },
      subscription: { names: [...WITNESSED_EVENT_NAMES] },
      ...(socketPath === undefined ? {} : { socketPath }),
    });
  } catch (error) {
    logger.error({
      msg: `cmux spawn: the event witness could not subscribe (${error instanceof Error ? error.message : String(error)}) — falling back to cmux's delivery record and the screen`,
    });
  }
  return {
    close: () => stream?.close(),
    observedEvents: () => events,
  };
}
