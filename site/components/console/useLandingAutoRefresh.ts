"use client";

/**
 * The console's ONE landing-refresh runner, owned by the shell: the POST, the record of what it asked over, and the
 * re-read once a run has recorded its reading. Which run to ask for is `../../lib/landingAutoRefresh.ts`.
 *
 * **This is the owner of the Pull requests count's freshness and its failure recovery**, on every page: it keeps these counts fresh and
 * recovers from a failure rather than showing an error indefinitely. It asks on a reading event — the reading shown is missing, left drafts out, does not reconcile with GitHub's open
 * list, or its census did not read — and when the reading shown comes due against the cadence while the console is in
 * view. It runs no free clock: one timer wakes it at the instant its next decision falls due (the reading coming due,
 * or the backoff over a failed run lapsing — `landingShellWakeAtOf`), and the window coming into view wakes it too.
 * Every ask is judged against one record and refused while a run is in flight, so nothing runs twice over one reading
 * inside the backoff (`syncFreshness.ts`).
 *
 * There is no button, and the Pull requests page's line says "updating…" while a run goes and "failed to sync" with
 * the reason on hover when it could not, since the count always needs to be up to date. A count
 * it withholds says what it is doing next (`landingRefreshPlanOf`), off {@link LandingRefresh.visible} and
 * {@link LandingRefresh.nextAtMs}.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  type LandingAutoAsk,
  landingShellAskOf,
  landingShellWakeAtOf,
  syncShownOf,
} from "../../lib/landingAutoRefresh";
import type { LiveState } from "../../lib/liveState";
import { pageMayAsk } from "../../lib/syncFreshness";
import type { SyncState } from "../live/LandingSync";
import type { LandingReading } from "../live/readLanding";
import { takeReading } from "../live/takeReading";
import { refreshLive } from "../live/useLive";
import { useWorkspacePlacer } from "./organisationState";
import { useWorkContext } from "./workContextState";

/** Where the console's own landing refresh stands, what it asked over, and the one door every ask goes through. */
export interface LandingRefresh {
  readonly sync: SyncState;
  /** When the console last asked over each reading, keyed by reading id — the record every decision is judged by. */
  readonly asked: Readonly<Record<string, number>>;
  /** Run one automatic reading, unless one is in flight or this reading was asked over inside the backoff. */
  readonly ask: (ask: LandingAutoAsk) => void;
  /** Whether the console's window is in view: a hidden one asks nothing at all. */
  readonly visible: boolean;
  /** When the runner next decides by time alone (epoch ms), or `undefined` when nothing is ahead. */
  readonly nextAtMs: number | undefined;
}

/** Subscribe to the document's visibility, the one condition the cadence ask waits on. */
function onVisibility(change: () => void): () => void {
  document.addEventListener("visibilitychange", change);
  return () => {
    document.removeEventListener("visibilitychange", change);
  };
}

/** Whether the document is in view now. */
function visibleNow(): boolean {
  return document.visibilityState === "visible";
}

/** The server render has no document; it is drawn as in view, and the client's first read corrects it. */
function visibleOnServer(): boolean {
  return true;
}

/**
 * Run the console's landing refresh from the shell: ask on a reading event and when the reading comes due while in
 * view, at most once per reading per backoff, wake at the next instant that decision can change, and re-read the
 * ledger the instant a run records.
 *
 * @param state the landing reading as the shell polls it
 * @returns the refresh's state, its record, its door, whether it is in view, and when it next decides
 */
export function useLandingAutoRefresh({ state }: { state: LiveState<LandingReading> }): LandingRefresh {
  const visible = useSyncExternalStore(onVisibility, visibleNow, visibleOnServer);
  // Set only by the wake timer below, so a decision that falls due by time alone is judged again at that instant.
  const [, setWokeMs] = useState(0);
  const { context } = useWorkContext();
  const placer = useWorkspacePlacer();
  const [sync, setSync] = useState<SyncState>({ phase: "idle" });
  // The reading the last run asked over, so a failure stops being shown once a newer reading replaces that one.
  const [syncOver, setSyncOver] = useState<string | undefined>(undefined);
  const [asked, setAsked] = useState<Readonly<Record<string, number>>>({});
  // The same record and the in-flight flag, written synchronously: state lands a render later, and Strict Mode's
  // second effect setup — or the page's ask in the same commit — must already see them.
  const askedNow = useRef<Readonly<Record<string, number>>>({});
  const takingNow = useRef(false);
  const ask = useCallback(({ reason: auto, readingId: forReading }: LandingAutoAsk): void => {
    // Visibility is read again at the moment of asking: the render that judged it in view may have been committed
    // just before the window was hidden, and its effect runs after.
    if (
      takingNow.current ||
      !visibleNow() ||
      !pageMayAsk({ asked: askedNow.current, nowMs: Date.now(), readingId: forReading })
    ) {
      return;
    }
    const startedMs = Date.now();
    // The reading this run replaces is marked asked before it starts, so it is not asked over again while it is still
    // on screen after the run returns (`pageMayAsk`).
    takingNow.current = true;
    askedNow.current = { ...askedNow.current, [forReading]: startedMs };
    setAsked(askedNow.current);
    setSyncOver(forReading);
    setSync({ auto, phase: "taking", startedAtIso: new Date(startedMs).toISOString() });
    const take = async (): Promise<void> => {
      const outcome = await takeReading({ forReading, slug: "landing" });
      takingNow.current = false;
      if (outcome.phase === "refused") {
        // Nothing ran: another ask already took that reading inside the backoff, so the ledger is re-read for what it
        // recorded and the runner reads idle — never "failed", since no read failed.
        refreshLive({ slug: "landing-reading" });
        setSync({ phase: "idle" });
        return;
      }
      if (outcome.phase === "taken") {
        // Before the outcome is shown: the register moved when the run returned, so the channels are marked now, in
        // this turn, and never in a later render's effect where a stale poll could land first.
        refreshLive({ slug: "landing-reading" });
        refreshLive({ slug: "watchers" });
        refreshLive({ slug: "reviewers" });
      }
      setSync({ ...outcome, auto });
    };
    void take();
  }, []);
  // Read at render: the poll, a finished run, the window coming into view or the wake timer re-renders the shell.
  // oxlint-disable-next-line react/purity -- the instant IS the input to the cadence and the backoff
  const nowMs = Date.now();
  const taking = sync.phase === "taking";
  // What it would ask were the window in view: a hidden window's next act is that ask the moment it is seen, so no
  // later instant is named for it; a visible window's ask is the next act now.
  const askable = landingShellAskOf({ asked, context, nowMs, placer, state, taking, visible: true });
  let event: LandingAutoAsk | undefined;
  if (visible) {
    event = askable;
  }
  let nextAtMs: number | undefined;
  if (!taking && askable === undefined) {
    nextAtMs = landingShellWakeAtOf({ asked, context, nowMs, placer, state });
  }
  useEffect(() => {
    if (nextAtMs === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        setWokeMs(Date.now());
      },
      Math.max(0, nextAtMs - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [nextAtMs]);
  let eventReason: string | undefined;
  let eventReading: string | undefined;
  if (event !== undefined) {
    eventReason = event.reason;
    eventReading = event.readingId;
  }
  useEffect(() => {
    if (event !== undefined) {
      ask(event);
    }
    // The event is a fresh object every render; its reason and the reading it is over are what this is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventReason, eventReading]);
  // A failure withholds the badge's and the page's numbers (`landingLatestOf`) only while the reading it was asked over
  // is still the one shown; a later reading clears it.
  return { ask, asked, nextAtMs, sync: syncShownOf({ state, sync, syncOver }), visible };
}
