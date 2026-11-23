/**
 * The fleet session view's read: what it holds, how a failed read keeps the turn already drawn, and the one-shot read of
 * one session's turns.
 */
import { useEffect, useRef, useState } from "react";

import { isBag } from "@/lib/bag";
import { carryTurnId, readSessionTurn, type SessionTurn } from "@/lib/sessionTurn";

/**
 * What the view holds: nothing yet, a turn, or the one reason there is none. A turn drawn when a later read failed
 * stays drawn and carries that read's reason as `stale`.
 */
export type SessionTurnViewState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly turn: SessionTurn; readonly observedAtIso: string; readonly stale?: string }
  | { readonly phase: "not-measured"; readonly why: string };

/**
 * The state after a failed read: the turn already drawn, marked stale with the failure's reason, else the failure.
 *
 * @param previous what the view held before the read
 * @param failed the read that failed
 * @returns what the view holds now
 */
function afterFailedRead({
  previous,
  failed,
}: {
  previous: SessionTurnViewState;
  failed: Extract<SessionTurnViewState, { phase: "not-measured" }>;
}): SessionTurnViewState {
  if (previous.phase !== "ready") {
    return failed;
  }
  return { ...previous, stale: failed.why };
}

/**
 * Narrow the route's answer into the view's state, refusing a shape it does not know.
 *
 * @returns the state the answer comes to
 */
function stateOf({ body }: { body: unknown }): Exclude<SessionTurnViewState, { phase: "loading" }> {
  if (!isBag(body) || typeof body.observedAtIso !== "string") {
    return { phase: "not-measured", why: "the session-turn route answered with a shape this page does not read" };
  }
  if (body.ok !== true) {
    const why = typeof body.notMeasured === "string" ? body.notMeasured : "the route gave no reason";
    return { phase: "not-measured", why };
  }
  const turn = readSessionTurn({ payload: body.payload });
  if (turn === undefined) {
    return { phase: "not-measured", why: "`transcripts last-turn --json` printed a shape this page does not read" };
  }
  return { observedAtIso: body.observedAtIso, phase: "ready", turn };
}

/**
 * Read one session's turn once, and as many turns before it as the reader asked for — again only when they ask for
 * more. Never on a timer: the view opens on the newest activity and holds still while it is read: no live-follow. Asking for more keeps the turns already drawn on screen until the wider read
 * answers, and an answer to a narrower read that lands late is dropped rather than shown.
 *
 * @param turns how many turns to read, the latest included
 * @returns the view's current state
 */
export function useSessionTurn({ id, turns }: { id: string; turns: number }): SessionTurnViewState {
  const [state, setState] = useState<SessionTurnViewState>({ phase: "loading" });
  const lastTurn = useRef<SessionTurn | undefined>(undefined);
  useEffect(() => {
    let live = true;
    // A read whose view is gone is cancelled in the browser, not just ignored. The route does not pass the abort on, so
    // development's Strict Mode still runs the verb twice for one opening; a production build mounts once.
    const cancel = new AbortController();
    const read = async (): Promise<void> => {
      try {
        const url = `/api/session-turn?id=${encodeURIComponent(id)}&turns=${String(turns)}`;
        const response = await fetch(url, { cache: "no-store", signal: cancel.signal });
        const body: unknown = await response.json();
        if (live) {
          const next = stateOf({ body });
          if (next.phase !== "ready") {
            setState((previous) => afterFailedRead({ failed: next, previous }));
            return;
          }
          // The last turn DRAWN, not the last state: a failed read between two good ones must not lose the id.
          const turn = carryTurnId({ next: next.turn, previous: lastTurn.current });
          lastTurn.current = turn;
          setState({ ...next, turn });
        }
      } catch (cause) {
        if (live) {
          const failed = {
            phase: "not-measured",
            why: `the session-turn route did not answer: ${String(cause)}`,
          } as const;
          setState((previous) => afterFailedRead({ failed, previous }));
        }
      }
    };
    void read();
    return () => {
      live = false;
      cancel.abort();
    };
  }, [id, turns]);
  return state;
}
