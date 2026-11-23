"use client";

/*
 * One thread, read once when its panel opens, through `app/api/thread` — the by-id read `useLive` has no
 * shape for, because every live row is a whole register. Nothing here polls: a thread is re-read when the
 * panel is opened again, and the panel says when it was read.
 */

import { useEffect, useState } from "react";
import { keptOverFailure } from "../../lib/keptReading";
import { type Avatars, readAvatars } from "../live/readPeople";
import { readThread, type Thread } from "../live/readThread";

/** A thread read that landed — `stale` when it is an earlier reading kept over a failed re-read. */
type ReadyThread = {
  readonly phase: "ready";
  readonly observedAtIso: string;
  readonly thread: Thread;
  /** The authors' pictures, or why the roster could not be read — the panel draws initials then. */
  readonly people: { readonly ok: true; readonly avatars: Avatars } | { readonly ok: false; readonly why: string };
  readonly stale?: { readonly why: string };
};

/** A thread read once it answered, either way. */
type SettledThread = { readonly phase: "not-measured"; readonly why: string } | ReadyThread;

/** The panel's view of one thread read. */
export type ThreadState = { readonly phase: "loading" } | SettledThread;

/** Each thread's last reading this page, so a panel re-opened over a failed read still draws it (`keptReading`). */
const KEPT = new Map<string, ReadyThread>();

/**
 * Read the route's answer into the panel's state, refusing any shape that is not the route's own.
 *
 * @returns the state
 */
function stateOf({ body, id }: { body: unknown; id: string }): SettledThread {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: `/api/thread answered something that is not a ThreadResult for ${id}` };
  }
  if (body.ok !== true) {
    const why = "notMeasured" in body && typeof body.notMeasured === "string" ? body.notMeasured : "no reason given";
    return { phase: "not-measured", why };
  }
  if (
    !("thread" in body) ||
    !("people" in body) ||
    !("observedAtIso" in body) ||
    typeof body.observedAtIso !== "string"
  ) {
    return { phase: "not-measured", why: "/api/thread answered without a thread, people or instant" };
  }
  const thread = readThread(body.thread);
  if (thread === undefined) {
    return { phase: "not-measured", why: "store around answered in a shape this panel does not read" };
  }
  const people: unknown = body.people;
  if (typeof people !== "object" || people === null || !("ok" in people)) {
    return { phase: "not-measured", why: "/api/thread answered without a people half" };
  }
  if (people.ok !== true) {
    const why = "why" in people && typeof people.why === "string" ? people.why : "no reason given";
    return { observedAtIso: body.observedAtIso, people: { ok: false, why }, phase: "ready", thread };
  }
  const avatars = "payload" in people ? readAvatars(people.payload) : undefined;
  if (avatars === undefined) {
    return {
      observedAtIso: body.observedAtIso,
      people: { ok: false, why: "identity avatars answered in a shape this panel does not read" },
      phase: "ready",
      thread,
    };
  }
  return { observedAtIso: body.observedAtIso, people: { avatars, ok: true }, phase: "ready", thread };
}

/**
 * Read one thread by permalink or `<channel>:<ts>` id. A reading is kept beside the id it was read for, so a panel
 * moved to another thread reads as loading until that thread's own reading lands, and a failed read of a thread read
 * before on this page draws that earlier reading, marked stale.
 *
 * @param id what the row carried
 * @returns the read as it stands
 */
export function useThread({ id }: { id: string }): ThreadState {
  const [reading, setReading] = useState<{ readonly id: string; readonly state: ThreadState }>({
    id,
    state: { phase: "loading" },
  });
  useEffect(() => {
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: SettledThread;
      try {
        const response = await fetch(`/api/thread?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: control.signal,
        });
        next = stateOf({ body: await response.json(), id });
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
