"use client";

/*
 * The mail thread an email-born ask was born from, read once when its card opens, through `app/api/mail-thread` —
 * live off Gmail, so what the card draws is what the thread holds now, the owner's draft included. Nothing here polls, the
 * same as `./useDraftContext.ts`: opening the card again reads it again, and the card says when it was read.
 */

import { useEffect, useState } from "react";
import { keptOverFailure } from "../../lib/keptReading";
import { type MailThread, readMailThread } from "../live/readMailThread";

/** A thread read that landed — `stale` when it is an earlier reading kept over a failed re-read. */
type ReadyMailThread = {
  readonly phase: "ready";
  readonly thread: MailThread;
  readonly stale?: { readonly why: string };
};

/** The card's view of one thread read. */
export type MailThreadState =
  { readonly phase: "loading" } | { readonly phase: "not-measured"; readonly why: string } | ReadyMailThread;

/** Each thread's last reading this page, so a card re-opened over a failed read still draws it (`keptReading`). */
const KEPT = new Map<string, ReadyMailThread>();

/**
 * Read the route's answer into the card's state, refusing any shape that is not the route's own.
 *
 * @param body the route's parsed answer
 * @returns the state
 */
export function mailThreadStateOf({
  body,
}: {
  body: unknown;
}): Exclude<MailThreadState, { readonly phase: "loading" }> {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: "/api/mail-thread answered something that is not a MailThreadResult" };
  }
  if (body.ok !== true) {
    let why = "no reason given";
    if ("notMeasured" in body && typeof body.notMeasured === "string") {
      why = body.notMeasured;
    }
    return { phase: "not-measured", why };
  }
  let thread: MailThread | undefined;
  if ("read" in body) {
    thread = readMailThread({ payload: body.read });
  }
  if (thread === undefined) {
    return { phase: "not-measured", why: "gmail read answered in a shape this card does not read" };
  }
  return { phase: "ready", thread };
}

/**
 * Read the mail thread an ask names. A reading is kept beside the id it was read for, so a card re-opened on another
 * row never draws the last row's thread: it reads as loading until the new id's own reading lands. A failed read of a
 * thread read before on this page draws that earlier reading, marked stale.
 *
 * @param id the Gmail thread or message id
 * @returns the read as it stands
 */
export function useMailThread({ id }: { id: string }): MailThreadState {
  const [reading, setReading] = useState<{ readonly id: string; readonly state: MailThreadState }>({
    id,
    state: { phase: "loading" },
  });
  useEffect(() => {
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: Exclude<MailThreadState, { readonly phase: "loading" }>;
      try {
        const response = await fetch(`/api/mail-thread?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: control.signal,
        });
        next = mailThreadStateOf({ body: await response.json() });
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
  }, [id]);
  if (reading.id !== id) {
    return { phase: "loading" };
  }
  return reading.state;
}
