/**
 * The control plane's memory of the sessions it hosts, as a pure reducer: an event in, the next registry and the
 * instructions to send each worker out. No Electron, no process, no clock — `sessionControl.ts` applies the effects.
 * The registry's types and its addressing are `sessionRegistryShape.ts`.
 *
 * Delivery is decided here, because it is the one place that knows whether a turn is running:
 *
 * - an idle session takes any message at once;
 * - a starting one holds every message until it reports ready;
 * - a running one holds a `later` message until the turn ends, and a `now` message cancels the turn first and is
 *   delivered when the cancelled turn reports its end — never sent over a turn still running;
 * - `turn` (land between a running turn's tool calls) is REFUSED on a running session until a vendor's own steer
 *   is wired, per the seam's rule that an implementation refuses a delivery it cannot honour rather than degrading
 *   it.
 */
import { EMPTY_SESSION_FACTS, withToolActivity } from "./sessionFacts";
import {
  appHandleOf,
  type RegistryEntry,
  type RegistryEvent,
  type RegistryStep,
  type SessionRegistry,
  withEntry,
} from "./sessionRegistryShape";
import { usageOfSpec, usageOnPrompt, usageOnReady, usageOnTurn, usageOnTurnClosed } from "./sessionUsage";
import type { FromWorker } from "./sessionWorker/workerWire";
import type { AppSessionState } from "./wireBasics";

/** How much of the agent's last words a snapshot keeps, in characters: the card shows a tail, never a transcript. */
export const AGENT_TEXT_TAIL = 2_000;

/** States a message can no longer reach: ended, or on the way out. */
const ENDED: ReadonlySet<AppSessionState> = new Set(["closed", "failed", "stopping"]);

function withState({ entry, state }: { entry: RegistryEntry; state: AppSessionState }): RegistryEntry {
  return { ...entry, snapshot: { ...entry.snapshot, state } };
}

/** A message sent opens a new turn, so the agent text shown starts again: the card shows this turn's words alone. */
function submitted({ entry, text, atIso }: { entry: RegistryEntry; text: string; atIso: string }): RegistryEntry {
  const { lastAgentText: _previousTurn, ...snapshot } = entry.snapshot;
  return {
    ...entry,
    snapshot: { ...snapshot, lastSubmittedAtIso: atIso, lastSubmittedText: text, state: "running" },
    usage: usageOnPrompt({ usage: entry.usage }),
  };
}

/** A turn is over, however it ended: one that never reported its usage is counted missing. */
function closedTurn({ entry, atIso }: { entry: RegistryEntry; atIso: string }): RegistryEntry {
  return { ...entry, usage: usageOnTurnClosed({ atIso, usage: entry.usage }) };
}

function onMessage({
  registry,
  event,
}: {
  registry: SessionRegistry;
  event: Extract<RegistryEvent, { kind: "message" }>;
}): RegistryStep {
  const entry = registry.get(event.sessionId);
  if (entry === undefined || ENDED.has(entry.snapshot.state)) {
    return {
      refusal: { code: "SESSION_NOT_FOUND", message: `no live app session ${event.sessionId}` },
      registry,
      sends: [],
    };
  }
  const { sessionId, text, atIso } = event;
  // An idle session has no turn to land between, so every delivery is the same act there: send it now.
  if (entry.snapshot.state === "idle") {
    return {
      interrupted: false,
      queued: false,
      registry: withEntry({ change: (held) => submitted({ atIso, entry: held, text }), registry, sessionId }),
      sends: [{ instruction: { kind: "prompt", text }, sessionId }],
    };
  }
  // A starting session has no turn either: a `turn` message waits for ready exactly as a `later` one does.
  if (event.delivery === "turn" && entry.snapshot.state === "running") {
    return {
      refusal: {
        code: "DELIVERY_UNSUPPORTED",
        message:
          "the app harness cannot land a message between a running turn's tool calls yet, so send it with --delivery now or later",
      },
      registry,
      sends: [],
    };
  }
  // A `now` message jumps every `later` one already held (measured on the installed app: queued then interrupted, the
  // agent answered the queued line first), but stays behind any earlier `now`, so two interrupts keep their order.
  const queued = withEntry({
    change: (held) =>
      event.delivery === "now"
        ? {
            ...held,
            pending: [...held.pending.slice(0, held.urgent), text, ...held.pending.slice(held.urgent)],
            urgent: held.urgent + 1,
          }
        : { ...held, pending: [...held.pending, text] },
    registry,
    sessionId,
  });
  const cancels = event.delivery === "now" && entry.snapshot.state === "running";
  // A cancelling `now` with no earlier one held is the very next turn, so it is not waiting behind any; one behind an
  // earlier interrupt is (measured on the installed app: reporting the first as queued sent `cmux send` to say it sat
  // behind a turn that did not exist).
  const nextTurn = cancels && entry.urgent === 0;
  return {
    interrupted: cancels,
    queued: !nextTurn,
    registry: queued,
    sends: cancels ? [{ instruction: { kind: "cancel" }, sessionId }] : [],
  };
}

function onTurnEnded({
  registry,
  sessionId,
  atIso,
}: {
  registry: SessionRegistry;
  sessionId: string;
  atIso: string;
}): RegistryStep {
  const entry = registry.get(sessionId);
  if (entry === undefined) {
    return { registry, sends: [] };
  }
  const [next, ...rest] = entry.pending;
  if (next === undefined) {
    return {
      registry: withEntry({
        change: (held) => withState({ entry: closedTurn({ atIso, entry: held }), state: "idle" }),
        registry,
        sessionId,
      }),
      sends: [],
    };
  }
  return {
    registry: withEntry({
      change: (held) => ({
        ...submitted({ atIso, entry: closedTurn({ atIso, entry: held }), text: next }),
        pending: rest,
        urgent: Math.max(0, held.urgent - 1),
      }),
      registry,
      sessionId,
    }),
    sends: [{ instruction: { kind: "prompt", text: next }, sessionId }],
  };
}

function onWorker({
  registry,
  report,
  atIso,
}: {
  registry: SessionRegistry;
  report: FromWorker;
  atIso: string;
}): RegistryStep {
  const { sessionId } = report;
  const state = registry.get(sessionId)?.snapshot.state;
  switch (report.kind) {
    // A message that arrived while the session was starting was held, and goes now, exactly as at a turn's end. Only a
    // STARTING session is released by ready: a repeated one must never release what a running turn holds.
    // The vendor's own id is kept beside the snapshot, never on it, for a `session.origin` claim to be compared with.
    case "ready": {
      const { vendorSessionId } = report;
      const up = withEntry({
        change: (held) => ({ ...held, usage: usageOnReady({ atIso, usage: held.usage }), vendorSessionId }),
        registry,
        sessionId,
      });
      return state === "starting" ? onTurnEnded({ atIso, registry: up, sessionId }) : { registry: up, sends: [] };
    }
    // The three usage reports and a tool activity are observations: none moves a turn or releases a held message.
    case "model-resolved": {
      const { model } = report;
      return {
        registry: withEntry({
          change: (held) => ({ ...held, usage: { ...held.usage, resolvedModel: model } }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    case "turn-usage": {
      const turn = report.usage;
      return {
        registry: withEntry({
          change: (held) => ({
            ...held,
            usage: usageOnTurn({ atIso, turn, usage: held.usage, vendor: held.snapshot.vendor }),
          }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    case "context-occupancy": {
      const { usedTokens, sizeTokens } = report;
      return {
        registry: withEntry({
          change: (held) => ({ ...held, usage: { ...held.usage, context: { atIso, sizeTokens, usedTokens } } }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    case "tool-activity": {
      return { registry: withToolActivity({ activity: report.activity, atIso, registry, sessionId }), sends: [] };
    }
    case "agent-text": {
      const tail = (said: string | undefined): string =>
        (said === undefined ? report.text : `${said}${report.text}`).slice(-AGENT_TEXT_TAIL);
      return {
        registry: withEntry({
          change: (held) => ({
            ...held,
            snapshot: { ...held.snapshot, lastAgentText: tail(held.snapshot.lastAgentText) },
          }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    // Only a running turn can end: one reported to a starting session must not release what waits for ready.
    // Not closed, stated: a report carries no turn identity. The worker sends exactly one per prompt over Node's
    // ordered IPC, so a stale duplicate needs a forged report; a per-prompt sequence number echoed back would close it.
    case "turn-ended": {
      return state === "running" ? onTurnEnded({ atIso, registry, sessionId }) : { registry, sends: [] };
    }
    case "failed": {
      return {
        registry: withEntry({
          change: (held) => withState({ entry: closedTurn({ atIso, entry: held }), state: "failed" }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    case "closed": {
      return {
        registry: withEntry({
          change: (held) => withState({ entry: closedTurn({ atIso, entry: held }), state: "closed" }),
          registry,
          sessionId,
        }),
        sends: [],
      };
    }
    default: {
      const never: never = report;
      return never;
    }
  }
}

/**
 * Apply one event.
 *
 * @param registry the sessions before it
 * @param event what happened
 * @returns the sessions after it, the instructions to send, and a refused message's reason
 */
export function reduceRegistry({ registry, event }: { registry: SessionRegistry; event: RegistryEvent }): RegistryStep {
  switch (event.kind) {
    case "prepared": {
      const { sessionId, spec } = event;
      const next = new Map(registry);
      next.set(sessionId, {
        launchToken: event.launchToken,
        pending: [],
        snapshot: {
          directory: spec.directory,
          handle: appHandleOf({ sessionId }),
          ledgerKey: spec.ledgerKey,
          openedAtIso: event.atIso,
          sessionId,
          state: "starting",
          title: spec.title,
          vendor: spec.vendor,
        },
        facts: EMPTY_SESSION_FACTS,
        urgent: 0,
        usage: usageOfSpec({ spec }),
        vendorSessionId: undefined,
      });
      return { registry: next, sends: [] };
    }
    case "launch-settled": {
      return {
        registry: withEntry({
          change: (held) => ({ ...held, launchToken: undefined }),
          registry,
          sessionId: event.sessionId,
        }),
        sends: [],
      };
    }
    case "message": {
      return onMessage({ event, registry });
    }
    case "interrupt": {
      const running = registry.get(event.sessionId)?.snapshot.state === "running";
      return { registry, sends: running ? [{ instruction: { kind: "cancel" }, sessionId: event.sessionId }] : [] };
    }
    case "stopping": {
      return {
        registry: withEntry({
          change: (held) => ({ ...withState({ entry: held, state: "stopping" }), pending: [], urgent: 0 }),
          registry,
          sessionId: event.sessionId,
        }),
        sends: [],
      };
    }
    case "worker": {
      return onWorker({ atIso: event.atIso, registry, report: event.report });
    }
    case "gone": {
      const state: AppSessionState = event.failed ? "failed" : "closed";
      // A session that is gone has no launch left to settle, so its token is spent here: a failed prepare never
      // answered with it, and nothing may deliver to or abort a session through it afterwards.
      return {
        registry: withEntry({
          change: (held) => ({
            ...withState({ entry: closedTurn({ atIso: event.atIso, entry: held }), state }),
            launchToken: undefined,
          }),
          registry,
          sessionId: event.sessionId,
        }),
        sends: [],
      };
    }
    default: {
      const never: never = event;
      return never;
    }
  }
}
