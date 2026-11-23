"use client";

/*
 * Whether a Slack token is present, read once through `app/api/slack-connection` — and only when asked, so a Slack
 * thread panel whose corpus read answered never launches the preflight (`../../lib/slackConnection.ts`).
 */

import { useEffect, useState } from "react";

/** The panel's view of the preflight. */
export type SlackConnectionState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly tokenPresent: boolean }
  | { readonly phase: "not-measured"; readonly why: string };

/**
 * Read the route's answer, refusing any shape that is not the route's own.
 *
 * @returns the state
 */
function stateOf({ body }: { body: unknown }): SlackConnectionState {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: "/api/slack-connection answered something that is not its result" };
  }
  if (body.ok === true && "tokenPresent" in body && typeof body.tokenPresent === "boolean") {
    return { phase: "ready", tokenPresent: body.tokenPresent };
  }
  if ("notMeasured" in body && typeof body.notMeasured === "string") {
    return { phase: "not-measured", why: body.notMeasured };
  }
  return { phase: "not-measured", why: "/api/slack-connection answered without a reason" };
}

/**
 * The panel's view of the preflight: `idle` until wanted, `loading` until an answer for THIS key has arrived. Pure.
 *
 * An answer is kept with the key it was fetched for, so one mounted panel moved to another thread never draws the
 * previous thread's answer while its own preflight is still in flight — not even on the render before the hook's
 * cleanup forgets it. The cleanup forgets it whenever the read is abandoned, so a later read of the same key starts
 * at `loading` too.
 *
 * @param wanted whether the panel needs the answer — its thread read failed
 * @param key the thread the answer is wanted for
 * @param answer the last answer that arrived, and the key it was fetched for
 * @returns the state to draw
 */
export function slackConnectionViewOf({
  wanted,
  key,
  answer,
}: {
  wanted: boolean;
  key: string;
  answer: { readonly key: string; readonly state: SlackConnectionState } | undefined;
}): SlackConnectionState {
  if (!wanted) {
    return { phase: "idle" };
  }
  if (answer === undefined || answer.key !== key) {
    return { phase: "loading" };
  }
  return answer.state;
}

/**
 * Whether a Slack token is present, read once when `wanted` turns true for a key.
 *
 * @param wanted whether the panel needs the answer — its thread read failed
 * @param key the thread it is wanted for
 * @returns the read as it stands, `idle` until wanted
 */
export function useSlackConnection({ wanted, key }: { wanted: boolean; key: string }): SlackConnectionState {
  // The answer once one arrives; `loading` is derived from wanting it before it has, never set in the effect.
  const [answer, setAnswer] = useState<{ key: string; state: SlackConnectionState } | undefined>(undefined);
  useEffect(() => {
    if (!wanted) {
      return undefined;
    }
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: SlackConnectionState;
      try {
        const response = await fetch("/api/slack-connection", { cache: "no-store", signal: control.signal });
        next = stateOf({ body: await response.json() });
      } catch (cause: unknown) {
        next = { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
      }
      if (!control.signal.aborted) {
        setAnswer({ key, state: next });
      }
    };
    void read();
    return () => {
      control.abort();
      // Forget the answer with the request: the next time it is wanted, for this key or another, is a new read.
      setAnswer(undefined);
    };
  }, [wanted, key]);
  return slackConnectionViewOf({ answer, key, wanted });
}
