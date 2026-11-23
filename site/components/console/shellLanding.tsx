"use client";

/*
 * The landing reading the shell polls, handed to everything under it rather than read again, and the shell's own
 * refresh of it.
 *
 * The sidebar's Pull requests badge has always polled `landing-reading` on every console page. A citation chip's
 * hover card draws a pull request's checks, next act and review off the same row (`./CitedDetail.tsx`), and a
 * `useLive` subscription opened per hover would spawn `reading last` again each time: a new subscriber reads at
 * once whatever the channel holds (`../live/useLiveFetch.ts` `fetchInto`). So the shell reads it ONCE and this context
 * hands that state down — the badge, the Pull requests page and every chip see the same reading at the same instant.
 *
 * The shell also owns the console's one landing-refresh runner (`./useLandingAutoRefresh.ts`), and with it the Pull
 * requests count's freshness and failure recovery on every page: the badge counts the page's population, drafts
 * included, on whichever page the owner is on, so neither the refresh on a reading EVENT nor the cadence refresh can
 * live on the one page that lists it (else the badge sits on a warning all day on the Queue while the cadence refresh
 * runs only on the Pull requests page).
 */

import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react";

import { type LandingReading, readLandingReading } from "../live/readLanding";
import { type LiveState, useLive } from "../live/useLive";
import { type LandingRefresh, useLandingAutoRefresh } from "./useLandingAutoRefresh";
import { FAST_POLL_MS } from "./useQueueRows";

/** The shell's landing reading, and its one refresh runner: where it stands, what it asked over, and its door. */
export interface ShellLanding extends LandingRefresh {
  readonly state: LiveState<LandingReading>;
}

/** `undefined` outside the shell — a page drawn without it has no landing reading to join. */
const ShellLandingContext = createContext<ShellLanding | undefined>(undefined);

/**
 * Poll the landing reading once for the whole console, keep it current, and hand it down.
 *
 * @param children the shell's contents
 * @returns the provider
 */
export function ShellLandingProvider({ children }: { children: ReactNode }): ReactElement {
  const state = useLive<LandingReading>({ everyMs: FAST_POLL_MS, read: readLandingReading, slug: "landing-reading" });
  const { ask, asked, sync, visible, nextAtMs } = useLandingAutoRefresh({ state });
  const value = useMemo(
    (): ShellLanding => ({ ask, asked, nextAtMs, state, sync, visible }),
    [ask, asked, nextAtMs, state, sync, visible],
  );
  return <ShellLandingContext.Provider value={value}>{children}</ShellLandingContext.Provider>;
}

/**
 * The shell's landing reading, as it stands.
 *
 * @returns the reading's live state, or `undefined` when nothing above this component polls it
 */
export function useShellLanding(): LiveState<LandingReading> | undefined {
  return useContext(ShellLandingContext)?.state;
}

/**
 * The shell's landing reading with its refresh runner, for the two that count it: the Pull requests page and its
 * badge. Both are only ever drawn inside {@link ShellLandingProvider}, so its absence is a wiring defect, said as one
 * rather than drawn as a reading that never arrives.
 *
 * @param who the component asking, named in the defect
 * @returns the reading and its refresh runner
 */
export function useShellLandingRefresh({ who }: { who: string }): ShellLanding {
  const shell = useContext(ShellLandingContext);
  if (shell === undefined) {
    throw new Error(`${who} is drawn outside ShellLandingProvider`);
  }
  return shell;
}
