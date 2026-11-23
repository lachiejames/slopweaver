"use client";

/*
 * The steers this browser collapsed a card on, kept across windows and reloads.
 *
 * The call runs in the desktop shell's overlay window while the Queue sits in the console window — two documents
 * of one origin — so the steer the voice sends has to reach a page it is not drawn in, the instant it is sent. The
 * store is `localStorage`, whose `storage` event is how the other window hears of a write; a module-scoped
 * snapshot read through `useSyncExternalStore` is how every component in one window shares it, as
 * `./settling.tsx` and `./preference.ts` do.
 *
 * Storage that refuses a write keeps the steer in this window only: a steer only one window knows of collapses
 * nothing in the other, and comes back in neither if the window that held it closes. Storage that cannot be read on
 * load holds nothing, so each card falls back to its landings. What is judged, and when a card comes back, is
 * `../../lib/steeredCards.ts`.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  keptSteers,
  type LocalSteer,
  mergedSteers,
  mutationBase,
  parseStoredSteers,
  relayInFlightOf,
  type SteerLine,
  type SteerOverlay,
  steerOverlay,
  steersWithLine,
} from "../../lib/steeredCards";
import type { CardLandings } from "../live/readCardLandings";
import { readSteeredCards, type SteeredCardsReading } from "../live/readSteeredCards";
import { type LiveState, refreshLive, useLive } from "../live/useLive";

/** The storage key. */
const STORAGE_KEY = "sw-steered";

/** The same twenty seconds every page polls on, restated as the voice restates it so this file imports no page. */
const STEERS_POLL_MS = 20_000;

/** Where the held steers live: in storage every window reads, or in this window alone because storage refused. */
export type SteerKeeping = "shared" | "this-window";

interface SteerSnapshot {
  readonly steers: readonly LocalSteer[];
  readonly keeping: SteerKeeping;
}

const SERVER: SteerSnapshot = { keeping: "shared", steers: [] };
let current: SteerSnapshot | undefined;
const listeners = new Set<() => void>();

/**
 * What storage holds, or `undefined` when it cannot be read or does not parse.
 *
 * @returns the stored steers
 */
function readStored(): readonly LocalSteer[] | undefined {
  try {
    return parseStoredSteers({ raw: window.localStorage.getItem(STORAGE_KEY) });
  } catch {
    return undefined;
  }
}

/**
 * The snapshot, read from storage on first use.
 *
 * @returns the held steers and where they are kept
 */
function snapshot(): SteerSnapshot {
  if (current === undefined) {
    // A read that throws is as unknown as one that does not parse: what it held cannot be judged, so none is held.
    const stored = readStored();
    if (stored === undefined) {
      current = { keeping: "shared", steers: [] };
    } else {
      current = { keeping: "shared", steers: stored };
    }
  }
  return current;
}

/** Tell every subscriber in this window. */
function publish(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Change the held steers: read fresh from storage first, so a write made in the other window a moment ago is not
 * overwritten by this window's older copy, then write back and publish.
 *
 * @param change what to do to the steers
 */
function mutate({ change }: { change: (held: readonly LocalSteer[]) => readonly LocalSteer[] }): void {
  const before = snapshot();
  const base = mutationBase({ keeping: before.keeping, mine: before.steers, stored: readStored() });
  const steers = change(base);
  if (steers === base && before.steers === base) {
    return;
  }
  current = { ...before, keeping: persist({ steers }), steers };
  publish();
}

/**
 * Write the steers to storage and read them back.
 *
 * @param steers what to store
 * @returns `shared` when storage holds exactly what was written, else `this-window`
 */
function persist({ steers }: { steers: readonly LocalSteer[] }): SteerKeeping {
  try {
    const text = JSON.stringify(steers);
    window.localStorage.setItem(STORAGE_KEY, text);
    if (window.localStorage.getItem(STORAGE_KEY) === text) {
      return "shared";
    }
  } catch {
    // Storage that refuses keeps nothing; this window still holds the steer, and says it is the only one.
  }
  return "this-window";
}

/**
 * Listen for a write in another window, and for this window's own changes.
 *
 * @returns the unsubscribe
 */
function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) {
      return;
    }
    const stored = readStored();
    if (stored === undefined) {
      return;
    }
    // A window whose storage refused holds steers the other window never saw, so it merges rather than adopting
    // a write that would drop them. Storage cleared from outside — another document's `clear()` or a removed key —
    // is never a decision about a steer, so this window keeps what it holds and writes it back: dropping it would
    // leave its card hidden by a landing with nothing left to bring it back.
    const before = snapshot();
    const cleared = event.key === null || event.newValue === null;
    if (before.keeping === "shared" && !cleared) {
      current = { ...before, steers: stored };
    } else {
      const steers = mergedSteers({ mine: before.steers, stored });
      current = { ...before, keeping: cleared && steers.length > 0 ? persist({ steers }) : before.keeping, steers };
    }
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Fold one relay line the voice recorded into the held steers — a new steer only from the line that starts a relay
 * about the card open as it was sent — and, once the relay has an answer, read its verdict and the landings again
 * now rather than at the next poll.
 *
 * @param line the relay line
 * @param openCard the card open on the page as it was recorded
 */
export function recordSteerLine({ line, openCard }: { line: SteerLine; openCard: string | undefined }): void {
  const atIso = new Date().toISOString();
  mutate({ change: (held) => steersWithLine({ atIso, held, line, openCard }) });
  if (line.outcome !== "sending" && line.turnId !== undefined) {
    refreshLive({ slug: "talk-steers" });
    refreshLive({ slug: "talk-cards" });
  }
}

/**
 * The steers this window holds now, for a reader that judges them over a fresh record rather than the page's
 * (`../voice/recordReadings.ts`).
 *
 * @returns the held steers
 */
export function heldSteersNow(): readonly LocalSteer[] {
  return snapshot().steers;
}

/** The steers' overlay, and the reading behind it. */
export interface SteerState {
  readonly overlay: SteerOverlay;
  readonly reading: LiveState<SteeredCardsReading>;
  /** Whether a relay this page sent is still waiting on its answer, its card collapsed on a guess (`relayInFlightOf`). */
  readonly relaying: boolean;
}

/**
 * What the steers this browser collapsed do to the Queue now, read once for every surface that filters by it — the
 * Queue, the badge and the voice's `action_items` and triage pass — so none of them can disagree on which card is out.
 *
 * @param spoken the `talk cards` reading, which decides whether a card a steer gave back is held by another
 * @param primary set where the overlay decides what the page holds (the Queue), so its read goes ahead of the shell's
 * @returns the overlay and the `talk steers` reading
 */
export function useSteerOverlay({ spoken, primary }: { spoken: LiveState<CardLandings>; primary?: true }): SteerState {
  const held = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const reading = useLive<SteeredCardsReading>({
    everyMs: STEERS_POLL_MS,
    ...(primary === undefined ? {} : { primary }),
    read: readSteeredCards,
    slug: "talk-steers",
  });
  const overlay = useMemo(() => steerOverlay({ held: held.steers, reading, spoken }), [held.steers, reading, spoken]);
  // A steer something acted on is forgotten, and so is one that came back once no landing holds its card.
  useEffect(() => {
    if (keptSteers({ forgotten: overlay.forgotten, held: held.steers }).length === held.steers.length) {
      return;
    }
    mutate({ change: (steers) => keptSteers({ forgotten: overlay.forgotten, held: steers }) });
  }, [held.steers, overlay.forgotten]);
  return { overlay, reading, relaying: relayInFlightOf({ held: held.steers, overlay }) };
}
