"use client";

/*
 * One pull request, read live when its page opens, through `app/api/pull` — the by-id read `useLive` has no shape
 * for, exactly as `./useThread.ts` is for a Slack thread. Nothing here polls: a stale diff is worse than a link, so
 * the page says when it was read and re-reads only when the reader asks (`reread`) or opens it again.
 */

import { useCallback, useEffect, useState } from "react";

import { keptOverFailure } from "../../lib/keptReading";
import { type PullView, readPullDocument } from "../../lib/pullView";
import { type Avatars, readAvatars } from "../live/readPeople";

/** A pull-request read that landed — `stale` when it is an earlier reading kept over a failed re-read. */
type ReadyPull = {
  readonly phase: "ready";
  /** The address this reading is of. */
  readonly url: string;
  readonly observedAtIso: string;
  readonly view: PullView;
  /** The people's pictures and names, or why the roster could not be read — the page draws initials then. */
  readonly people: { readonly ok: true; readonly avatars: Avatars } | { readonly ok: false; readonly why: string };
  /** Why the latest re-read failed, when this reading is the earlier one kept over it. */
  readonly stale?: { readonly why: string };
};

/** A pull-request read once it answered, either way. */
type SettledPull = { readonly phase: "not-measured"; readonly why: string } | ReadyPull;

/** The page's view of one pull-request read. */
export type PullState = { readonly phase: "loading" } | SettledPull;

/**
 * Each pull request's last reading this page, by address: a failed re-read — pressed, or on opening the page again —
 * draws it marked stale with the failure's reason, so the pull request never blanks (`../../lib/keptReading.ts`).
 */
const KEPT = new Map<string, ReadyPull>();

/**
 * Read the route's answer into the page's state, refusing any shape that is not the route's own.
 *
 * @returns the state
 */
function stateOf({ body, url }: { body: unknown; url: string }): SettledPull {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: `/api/pull answered something that is not a PullResult for ${url}` };
  }
  if (body.ok !== true) {
    const why = "notMeasured" in body && typeof body.notMeasured === "string" ? body.notMeasured : "no reason given";
    return { phase: "not-measured", why };
  }
  if (!("document" in body) || !("people" in body) || !("observedAtIso" in body)) {
    return { phase: "not-measured", why: "/api/pull answered without a document, people or instant" };
  }
  const { observedAtIso } = body;
  if (typeof observedAtIso !== "string") {
    return { phase: "not-measured", why: "/api/pull answered an instant that is not one" };
  }
  const view = readPullDocument({ payload: body.document });
  if (view === undefined) {
    return { phase: "not-measured", why: "github read answered in a shape this page does not read" };
  }
  const people: unknown = body.people;
  if (typeof people !== "object" || people === null || !("ok" in people)) {
    return { phase: "not-measured", why: "/api/pull answered without a people half" };
  }
  if (people.ok !== true) {
    const why = "why" in people && typeof people.why === "string" ? people.why : "no reason given";
    return { observedAtIso, people: { ok: false, why }, phase: "ready", url, view };
  }
  const avatars = "payload" in people ? readAvatars(people.payload) : undefined;
  if (avatars === undefined) {
    return {
      observedAtIso,
      people: { ok: false, why: "identity avatars answered in a shape this page does not read" },
      phase: "ready",
      url,
      view,
    };
  }
  return { observedAtIso, people: { avatars, ok: true }, phase: "ready", url, view };
}

/**
 * Read one pull request by its GitHub address, and re-read it on demand.
 *
 * @param url the pull request's canonical address
 * @returns the read as it stands, whether a re-read is in flight, and the press that starts one
 */
export function usePull({ url }: { url: string }): {
  readonly state: PullState;
  readonly rereading: boolean;
  readonly reread: () => void;
} {
  const [state, setState] = useState<PullState>({ phase: "loading" });
  const [asked, setAsked] = useState(0);
  const [rereading, setRereading] = useState(false);
  useEffect(() => {
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: SettledPull;
      try {
        // `read` numbers the press, so every re-read is a request of its own that nothing between here and GitHub
        // can answer from a cache; the route reads only `url`.
        const query = new URLSearchParams({ read: String(asked), url });
        const response = await fetch(`/api/pull?${query.toString()}`, {
          cache: "no-store",
          signal: control.signal,
        });
        next = stateOf({ body: await response.json(), url });
      } catch (cause: unknown) {
        next = { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
      }
      if (!control.signal.aborted) {
        setState(keptOverFailure({ id: url, kept: KEPT, next }));
        setRereading(false);
      }
    };
    void read();
    return () => {
      control.abort();
    };
  }, [url, asked]);
  const reread = useCallback(() => {
    setRereading(true);
    setAsked((count) => count + 1);
  }, []);
  return { rereading, reread, state };
}
