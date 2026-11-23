/**
 * Resolving a dispatched session key back to the ask and role it was spawned for — the half of the done-chat
 * sweep (`./closeDone.ts`) that reads the ask-lifecycle log and decides which ending belongs to which
 * generation. Pure: it takes parsed events and returns children, with no socket and no disk.
 */
import { type AskDispatchRole, dispatchSessionName, dispatchWorkspaceName } from "../cmux/planNames.js";
import {
  type AskLifecycle,
  type AskLifecycleEvent,
  askLifecycleKey,
  foldAskLifecycle,
  type TerminalAskLifecycleEvent,
  terminalAskEventsByKey,
} from "../live/ask/lifecycle.js";

/** One dispatched session, resolved from its ledger key back to the ask and role it was spawned for. */
export interface DispatchChild {
  readonly lifecycle: AskLifecycle;
  readonly role: AskDispatchRole;
  /** The ask's terminal event, from the RAW history rather than the fold — `undefined` when it never reached one. */
  readonly terminal: TerminalAskLifecycleEvent | undefined;
  /** The cmux workspace name this dispatch was spawned under — the witness a stale ref is checked against. */
  readonly workspaceName: string;
}

/**
 * Whether an ask's recorded terminal ended an EARLIER generation than its latest dispatch. Pure.
 *
 * The LATEST `dispatched` row, never the fold's `activeDispatch`: a recorded `lease-expired` clears that field
 * while the follow-up generation's worker is still in its workspace, and reading the field would hand that
 * worker the earlier generation's answer as its own ending. An unparseable instant on either side keeps the
 * terminal, the direction that already held before this guard: a corrupt row must never make a finished turn
 * read as running.
 *
 * @param latestDispatch the ask's most recent `dispatched` event, or `undefined` when it was never dispatched
 * @param terminal the ask's last terminal event from the raw history
 * @returns whether that dispatch began strictly after the terminal
 */
export function terminalPrecedesDispatch({
  latestDispatch,
  terminal,
}: {
  latestDispatch: { readonly tsIso: string } | undefined;
  terminal: { readonly tsIso: string };
}): boolean {
  if (latestDispatch === undefined) {
    return false;
  }
  const dispatchedAt = Date.parse(latestDispatch.tsIso);
  const endedAt = Date.parse(terminal.tsIso);
  return !Number.isNaN(dispatchedAt) && !Number.isNaN(endedAt) && dispatchedAt > endedAt;
}

/** Both sides of one ask, in the order a report reads best: the worker, then the reviewer of its answer. */
const DISPATCH_ROLES: readonly AskDispatchRole[] = ["ask", "review"];

/**
 * Every dispatched session key the ask-lifecycle log accounts for, mapped to the child it names.
 *
 * Derived FORWARD, one `dispatchSessionName` call per ask per role, because that function sanitises and
 * truncates and is therefore not injective — a key cannot be parsed back into coordinates. A key two asks
 * derive alike maps to BOTH children, and the planner keeps such a row rather than picking one.
 *
 * The ask's terminal event comes from {@link terminalAskEventsByKey} rather than the fold's own `state`: a
 * `captured` event appended after a terminal one (a redelivery, a recovery pass) moves `state` off the
 * terminal while the turn is just as over.
 *
 * **A terminal OLDER than the running dispatch is not this generation's ending**, and is dropped. The raw
 * history is ever-terminal — the last terminal wins with no generation scoping — so a follow-up re-dispatch
 * of an answered ask inherited the earlier answer as its own ending and was reaped mid-turn. Measured:
 * gen-1 `answered`, then gen-2 `dispatched` about three minutes later, gen-2 reaped about sixteen minutes after that. A
 * dispatch that began after an ending is the generation still running ({@link terminalPrecedesDispatch}).
 *
 * @param askEvents every parsed ask-lifecycle event, in file order
 * @returns the children each dispatch session key names, in ask-log order
 */
export function dispatchChildrenBySessionKey({
  askEvents,
}: {
  askEvents: readonly AskLifecycleEvent[];
}): ReadonlyMap<string, readonly DispatchChild[]> {
  const terminals = terminalAskEventsByKey({ events: askEvents });
  const latestDispatches = new Map<string, AskLifecycleEvent>();
  for (const event of askEvents) {
    if (event.kind === "dispatched") {
      latestDispatches.set(askLifecycleKey({ askIdentity: event }), event);
    }
  }
  const byKey = new Map<string, DispatchChild[]>();
  for (const lifecycle of foldAskLifecycle({ events: askEvents }).values()) {
    const { channel, messageTs } = lifecycle;
    const askKey = askLifecycleKey({ askIdentity: lifecycle });
    const recorded = terminals.get(askKey);
    const terminal =
      recorded !== undefined &&
      terminalPrecedesDispatch({ latestDispatch: latestDispatches.get(askKey), terminal: recorded })
        ? undefined
        : recorded;
    for (const role of DISPATCH_ROLES) {
      const key = dispatchSessionName({ askChannel: channel, askMessageTs: messageTs, role });
      const child: DispatchChild = {
        lifecycle,
        role,
        terminal,
        workspaceName: dispatchWorkspaceName({ askChannel: channel, askMessageTs: messageTs, role }),
      };
      const earlier = byKey.get(key);
      byKey.set(key, earlier === undefined ? [child] : [...earlier, child]);
    }
  }
  return byKey;
}
