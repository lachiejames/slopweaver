"use client";

/*
 * The mail an inbox-triage card pinned, read through `app/api/card-mail` from the copy stored beside the pin — never
 * Gmail live. Two reads, so a card never holds every body at once: the headers when the card mounts, and one message's
 * body only when the reader opens that message.
 *
 * Both are kept in a small page-lifetime cache keyed by what was read, because the copy only changes when a session
 * runs `gmail card-mail --fetch`: the Queue's polls re-render the card, and closing and re-opening a row must not
 * re-read and re-sanitise half a megabyte of HTML each time. A failed read is never cached, so opening again retries.
 */

import { useCallback, useEffect, useState } from "react";
import {
  type CardMailBody,
  type CardMailIndexAnswer,
  readCardMailBody,
  readCardMailIndexAnswer,
} from "../live/readCardMail";

/** What one read stands at. */
export type CardMailState<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | { readonly phase: "ready"; readonly value: T };

/** The most bodies kept at once; the oldest read is dropped past it. Headers are small, and kept per card. */
const MAX_CACHED_BODIES = 8;

const indexCache = new Map<string, CardMailIndexAnswer>();
const bodyCache = new Map<string, CardMailBody>();

/**
 * Whether an index answer may be kept for the page's life: stored mail only, since the copy changes only on a
 * `--fetch`, while a card that pinned nothing may be pinned before the page reloads.
 *
 * @returns true for stored mail, false for an unpinned answer, which is read again on the next mount
 */
export function keepStoredIndex({ answer }: { answer: CardMailIndexAnswer }): boolean {
  return answer.kind === "stored";
}

/** The index keeper, stable so the read's effect does not re-run on every render. */
const keepIndex: (answer: CardMailIndexAnswer) => boolean = (answer) => keepStoredIndex({ answer });

/** A body is kept whatever it holds: it is read off a stored copy that only a `--fetch` replaces. */
const keepAnyBody = (): boolean => true;

/**
 * Read the route's answer into a state, refusing any shape that is not the route's own.
 *
 * @param body the route's parsed answer
 * @param read the strict reader for what the verb printed
 * @returns the state
 */
export function cardMailStateOf<T>({
  body,
  read,
}: {
  body: unknown;
  read: (payload: unknown) => T | undefined;
}): CardMailState<T> {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: "/api/card-mail answered something that is not a CardMailResult" };
  }
  if (body.ok !== true) {
    let why = "no reason given";
    if ("notMeasured" in body && typeof body.notMeasured === "string") {
      why = body.notMeasured;
    }
    return { phase: "not-measured", why };
  }
  let value: T | undefined;
  if ("read" in body) {
    value = read(body.read);
  }
  if (value === undefined) {
    return { phase: "not-measured", why: "gmail card-mail answered in a shape this card does not read" };
  }
  return { phase: "ready", value };
}

/**
 * Keep one value under `key`, dropping the oldest entry once the map holds more than `max`.
 *
 * @returns nothing; the map is changed in place
 */
export function remember<T>({
  cache,
  key,
  value,
  max,
}: {
  cache: Map<string, T>;
  key: string;
  value: T;
  max: number;
}): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next();
    if (oldest.done === true) {
      return;
    }
    cache.delete(oldest.value);
  }
}

/** One route read, kept beside the key it was read for so a card re-opened on another row never draws the last one's. */
function useCardMailRead<T>({
  key,
  query,
  read,
  cache,
  max,
  keep,
}: {
  key: string;
  query: string;
  read: (payload: unknown) => T | undefined;
  cache: Map<string, T>;
  max: number;
  /** Whether a ready value may be kept for the page's life; one that is not is read again on the next mount. */
  keep: (value: T) => boolean;
}): CardMailState<T> {
  const [reading, setReading] = useState<{ readonly key: string; readonly state: CardMailState<T> } | undefined>();
  useEffect(() => {
    if (cache.has(key)) {
      return undefined;
    }
    const control = new AbortController();
    const load = async (): Promise<void> => {
      let next: CardMailState<T>;
      try {
        const response = await fetch(`/api/card-mail?${query}`, { cache: "no-store", signal: control.signal });
        next = cardMailStateOf({ body: await response.json(), read });
      } catch (cause: unknown) {
        next = { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
      }
      if (control.signal.aborted) {
        return;
      }
      if (next.phase === "ready" && keep(next.value)) {
        remember({ cache, key, max, value: next.value });
      }
      setReading({ key, state: next });
    };
    void load();
    return () => {
      control.abort();
    };
  }, [cache, keep, key, max, query, read]);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return { phase: "ready", value: cached };
  }
  if (reading === undefined || reading.key !== key) {
    return { phase: "loading" };
  }
  return reading.state;
}

/**
 * Every pinned message's headers for one card, or that it pinned nothing.
 *
 * @param slug the inbox-triage card's board slug
 * @returns the read as it stands
 */
export function useCardMailIndex({ slug }: { slug: string }): CardMailState<CardMailIndexAnswer> {
  const readIndex = useCallback((payload: unknown) => readCardMailIndexAnswer({ payload, slug }), [slug]);
  return useCardMailRead({
    cache: indexCache,
    keep: keepIndex,
    key: slug,
    max: Number.POSITIVE_INFINITY,
    query: `slug=${encodeURIComponent(slug)}`,
    read: readIndex,
  });
}

/**
 * One message's body. Called only by a row that is OPEN (`./CardMail.tsx` mounts the reader then), so a closed row
 * costs nothing.
 *
 * @param slug the card's board slug
 * @param id the Gmail id of the message
 * @returns the read as it stands
 */
export function useCardMailBody({ slug, id }: { slug: string; id: string }): CardMailState<CardMailBody> {
  const readBody = useCallback((payload: unknown) => readCardMailBody({ id, payload }), [id]);
  return useCardMailRead({
    cache: bodyCache,
    key: `${slug}#${id}`,
    keep: keepAnyBody,
    max: MAX_CACHED_BODIES,
    query: `slug=${encodeURIComponent(slug)}&message=${encodeURIComponent(id)}`,
    read: readBody,
  });
}
