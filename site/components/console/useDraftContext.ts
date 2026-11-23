"use client";

/*
 * The conversation one held draft lands in, read once when its card opens, through `app/api/draft-context` —
 * live off Slack, so what the card draws above the draft is what the room says now. Nothing here polls, the
 * same as `./useThread.ts`: opening the card again reads it again, and the card says when it was read.
 */

import { useEffect, useState } from "react";
import { keptOverFailure } from "../../lib/keptReading";
import { type DraftContext, readDraftContext } from "../live/readDraftContext";

/** A conversation read that landed — `stale` when it is an earlier reading kept over a failed re-read. */
type ReadyDraftContext = {
  readonly phase: "ready";
  readonly context: DraftContext;
  readonly stale?: { readonly why: string };
};

/** A conversation read once it answered, either way. */
type SettledDraftContext = { readonly phase: "not-measured"; readonly why: string } | ReadyDraftContext;

/** The card's view of one conversation read. */
export type DraftContextState = { readonly phase: "loading" } | SettledDraftContext;

/** Each draft's last conversation reading this page, so a card re-opened over a failed read still draws it. */
const KEPT = new Map<string, ReadyDraftContext>();

/**
 * Read the route's answer into the card's state, refusing any shape that is not the route's own, and a reading
 * of any draft but the one asked about.
 *
 * @returns the state
 */
export function draftContextStateOf({ body, id }: { body: unknown; id: string }): SettledDraftContext {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: "/api/draft-context answered something that is not a DraftContextResult" };
  }
  if (body.ok !== true) {
    const why = "notMeasured" in body && typeof body.notMeasured === "string" ? body.notMeasured : "no reason given";
    return { phase: "not-measured", why };
  }
  const context = "context" in body ? readDraftContext(body.context) : undefined;
  if (context === undefined) {
    return { phase: "not-measured", why: "slack draft context answered in a shape this card does not read" };
  }
  if (context.id !== id) {
    return { phase: "not-measured", why: `slack draft context answered for ${context.id}, not ${id}` };
  }
  return { context, phase: "ready" };
}

/**
 * Read the conversation a held draft lands in. A reading is kept beside the id it was read for, so when a
 * re-cut card's live cut moves to another draft, the last cut's conversation is never drawn above the new one:
 * the card reads as loading until the new id's own reading lands. A failed read of a draft read before on this page
 * draws that earlier reading, marked stale.
 *
 * @param id the draft's `sd-…` id
 * @param reads whether this draft has a conversation to read at all (`../../lib/draftReads.ts`); one that does not is
 *   never fetched, and stays loading for a caller that draws nothing from it
 * @returns the read as it stands
 */
export function useDraftContext({ id, reads }: { id: string; reads: boolean }): DraftContextState {
  const [reading, setReading] = useState<{ readonly id: string; readonly state: DraftContextState }>({
    id,
    state: { phase: "loading" },
  });
  useEffect(() => {
    if (!reads) {
      return undefined;
    }
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: SettledDraftContext;
      try {
        const response = await fetch(`/api/draft-context?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: control.signal,
        });
        next = draftContextStateOf({ body: await response.json(), id });
      } catch (cause: unknown) {
        next = { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
      }
      if (!control.signal.aborted) {
        setReading({ id, state: keptOverFailure({ id, kept: KEPT, next }) });
      }
    };
    void read();
    return () => {
      control.abort();
    };
  }, [id, reads]);
  if (reading.id !== id) {
    return { phase: "loading" };
  }
  return reading.state;
}
