"use client";

import { type ReactElement, type ReactNode, useMemo } from "react";

import { identityForShell } from "../../lib/desktopPageReading";
import { SIDEBAR_ENTRIES } from "../../lib/sidebarCounts";
import { cn } from "../../lib/utils";
import {
  DEFAULT_SIDEBAR,
  isSidebarMode,
  SIDEBAR_PARAM,
  SIDEBAR_STORAGE_KEY,
  type SidebarMode,
} from "../../lib/workContext";
import { LiveChanges } from "../live/LiveChanges";
import { Button } from "../ui/button";
import type { DesktopVoiceSeam } from "../voice/desktopVoiceSeam";
import { desktopBridge, useDesktopRole, useOverlayStatus } from "../voice/useDesktopShell";
import { VoiceProvider } from "../voice/VoiceProvider";
import { AppearanceSync } from "./AppearanceSync";
import { AlignmentWaitingProvider } from "./alignmentWaitingShared";
import { BuildStatus } from "./BuildStatus";
import { ContextSwitcher } from "./ContextSwitcher";
import { usePreference } from "./preference";
import { SettingsModal } from "./SettingsModal";
import { NavProgress, SidebarRow, usePendingNav } from "./ShellNav";
import { ShellLandingProvider } from "./shellLanding";
import { useShellNavigation } from "./useShellNavigation";
import { VoiceFailureToasts } from "./VoiceFailureToasts";
import { useContextAddress } from "./workContextState";

/**
 * The console shell: a sidebar topped by the Acme/Slopweaver context switcher, the owner's seven pages — Queue,
 * Alignment, Pull requests, Workstreams, Automations, Fleet, Store — the build this page is and whether it is the latest
 * (`BuildStatus.tsx`), small Settings and Docs entries at its foot, and the page beside it. Settings opens as a modal
 * over the page rather than a page of its own (`SettingsModal.tsx`), and holds what the Setup page did, its Models
 * section first. The entries are `SIDEBAR_ENTRIES` (`../../lib/sidebarCounts.ts`), drawn in its order.
 *
 * The two entries whose count waits on the owner's word sit together, Queue on top, then Pull requests, Workstreams,
 * Automations and Fleet. Every element on the UI must earn its place, so Steers live in the Alignment page and the
 * Talk & voice page lives in the call widget. Alignment sits between the Queue and Pull requests, because anywhere
 * lower it is not prominent enough. Every sidebar item has a number badge next to it, so every entry carries the
 * count its registry row decides — Queue and Pull requests hot while nonzero, Alignment, Workstreams, Automations and
 * Fleet neutral — or none, by design, with the reason in the row's hover (Store, Settings, Docs). Settings carries a
 * dot while no plan is connected.
 *
 * The sidebar keeps the pages the owner actually opens (measured over two weeks of visits), and `/` opens the Queue (`next.config.mjs`). Board and
 * Machine keep their routes for a floating note or a page to link to. Workstreams is the owner's outcomes page. Fleet
 * (`/fleet`, each running session and its latest turns) is there because the desktop app carries the sessions page.
 * Store (`/store`) is a read-only view of every table in the store database, through `slopweaver store tables|rows|row`.
 *
 * Above the build line the sidebar carries nothing — no per-source freshness strip, no "N more" notice and no
 * Incidents indicator, all of which are noise — and the build line keeps its Update button but no "Updated to <hash>"
 * line.
 *
 * The top-left corner is the context dropdown with its marks and nothing else — the instance's name does not earn
 * it — and the shell explains nothing, nor does any page's head: no "how this page is derived" link (nobody reads
 * it), and no fold saying how a figure is counted — a reader who wants that asks the voice, and `docs/console`
 * answers it.
 * Each badge polls on the same shared channels as the page beside it. The Queue badge prints the Queue header's
 * waiting count, and the Pull requests badge the cards that page lists under Everything, drafts included, over the
 * shell's own landing refresh (`useLandingAutoRefresh.ts`); each refuses a number
 * on the same grounds as its page over the live reading. A sidebar-only count reads every minute, and a page open
 * beside it that polls faster governs, bar Alignment's: its readings are the page head's, read once per session as the
 * page reads them (`useAlignmentWaiting.ts`). One made from several readings prints nothing until all of them have
 * read, and one taken off an older reading prints with its stale mark beside it (`ShellCount.tsx`).
 *
 * The console voice's provider is mounted here, around everything, for its record and its hand-off, never for a
 * call: the session runs in the desktop app's voice window (`components/voice/`), as the paragraph below says.
 *
 * The sidebar is a normal SaaS width and collapses to an icon rail, with the minimize control at its top (Datadog's
 * shape), and the account-style switcher sits above the pages so the context the owner is looking at is always in
 * view. Both choices are kept in the browser between visits, and the context is also always in the address — every
 * page's and every sidebar link's — so a bookmark pins it (`useContextAddress`).
 *
 * When the voice fails at something it tried for the owner, the failure is a toast at the top middle of this window
 * (`VoiceFailureToasts.tsx`), forwarded by the shell from the voice's window — never beside the orb.
 *
 * The call is never this window's, and no orb is drawn here: the voice floats over the owner's whole desktop in the
 * desktop app's overlay (`DesktopVoiceOverlay.tsx`), its one floating widget, because two calls never run at once.
 * In the app's console window the provider publishes which page the owner is on and hands every start to the overlay; the shell
 * forwards the overlay's status here (`useOverlayStatus`), so while its call is up a start control here reads
 * `callActiveAnywhere` and offers none; `callActive` stays this document's, so a click is never held for a call a
 * reload here would not end. In a browser tab, and until the role is known after hydration, the provider has no
 * start route at all (`site/lib/voiceStart.ts`), so nothing here can start a call.
 *
 * @param children the page
 * @returns the shell
 */
export function Shell({ children }: { children: ReactNode }): ReactElement {
  useContextAddress();
  const sidebar = usePreference<SidebarMode>({
    accept: isSidebarMode,
    fallback: DEFAULT_SIDEBAR,
    key: SIDEBAR_STORAGE_KEY,
    param: SIDEBAR_PARAM,
  });
  const role = useDesktopRole();
  useShellNavigation();
  const callActiveElsewhere = useOverlayStatus()?.callActive === true;
  // Read off the bridge itself on the first client render, never off `role`, which reads `unknown` until after
  // hydration: the page the owner is on reaches the overlay from the first render. The seam renders nothing, so
  // the server's `undefined` is no hydration mismatch.
  const desktop = useMemo((): DesktopVoiceSeam | undefined => {
    const bridge = desktopBridge();
    if (bridge?.role !== "main") {
      return undefined;
    }
    // What this window last handed the shell, so a page re-registering the same reading on every commit sends nothing.
    let lastSent: string | undefined;
    const seam: DesktopVoiceSeam = {
      callActiveElsewhere,
      ...(bridge.carriesPageReading === true ? { carriesPageReading: true } : {}),
      // The voice's window asks this window for the Queue it holds, so a Queue tool reads what the owner sees.
      ...(bridge.onVoiceQueueRequest === undefined ? {} : { serveVoiceQueue: bridge.onVoiceQueueRequest }),
      publishPage: (identity) => {
        const wire = identityForShell({
          carriesOpenCard: bridge.carriesOpenCard,
          carriesOpenTitle: bridge.carriesOpenTitle,
          carriesPageReading: bridge.carriesPageReading,
          identity,
        });
        const sent = JSON.stringify(wire);
        if (sent === lastSent) {
          return;
        }
        lastSent = sent;
        bridge.publishPageIdentity({ identity: wire });
      },
    };
    // The start route waits for the hydrated role, so the server's render and the first client one agree that no
    // start control is drawn; the next render offers the one that hands its start to the overlay.
    if (role !== "main") {
      return seam;
    }
    return {
      ...seam,
      startRoute: {
        kind: "elsewhere",
        run: () => {
          bridge.requestOverlay({ command: "activate" });
        },
      },
    };
  }, [callActiveElsewhere, role]);
  return (
    <VoiceProvider desktop={desktop}>
      <ShellLandingProvider>
        <ConsoleFrame sidebar={sidebar}>{children}</ConsoleFrame>
        <VoiceFailureToasts />
        <LiveChanges />
      </ShellLandingProvider>
    </VoiceProvider>
  );
}

/**
 * The control that collapses the sidebar to its icon rail and back. Drawn in two places: beside the context switcher,
 * and — in the desktop app's window, which has no title strip — at the right of the sidebar's top row, level with the
 * window's own buttons, the way the ChatGPT and Linear apps sit theirs. CSS shows exactly one.
 *
 * @param sidebar the sidebar's width preference and its setter
 * @param className where this copy is shown
 * @returns the button
 */
function SidebarToggle({
  sidebar,
  className,
}: {
  sidebar: { readonly value: SidebarMode; readonly set: (value: SidebarMode) => void };
  className: string;
}): ReactElement {
  const full = sidebar.value === "full";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      className={cn(
        "size-[1.7rem] shrink-0 rounded-[6px] bg-transparent text-[0.85rem] leading-none text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-expanded={full}
      aria-label={full ? "collapse the sidebar to icons" : "expand the sidebar"}
      title={full ? "collapse the sidebar to icons" : "expand the sidebar"}
      onClick={() => {
        sidebar.set(full ? "icons" : "full");
      }}
    >
      {full ? "⟨" : "⟩"}
    </Button>
  );
}

/**
 * The sidebar and the page beside it, inside the voice provider so a stalled click can ask whether a call is up.
 *
 * @param sidebar the sidebar's width preference and its setter
 * @param children the page
 * @returns the grid
 */
function ConsoleFrame({
  sidebar,
  children,
}: {
  sidebar: { readonly value: SidebarMode; readonly set: (value: SidebarMode) => void };
  children: ReactNode;
}): ReactElement {
  const { pending, start } = usePendingNav();
  return (
    <AlignmentWaitingProvider>
      <div
        className="sw-console group/console grid min-h-screen grid-cols-[220px_minmax(0,1fr)] data-[sidebar=icons]:grid-cols-[62px_minmax(0,1fr)] max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:data-[sidebar=icons]:grid-cols-[62px_minmax(0,1fr)]"
        data-sidebar={sidebar.value}
      >
        <NavProgress pending={pending} />
        <aside className="sw-glass sw-glass-sidebar sw-sidebar sticky top-0 z-30 flex h-screen flex-col border-y-0 border-l-0 border-r border-solid px-[0.85rem] py-[1.1rem] group-data-[sidebar=icons]/console:px-[0.45rem] max-[760px]:static max-[760px]:h-auto max-[760px]:border-r-0 max-[760px]:border-b">
          <div
            className="sw-titlebar sw-window-drag h-[44px] shrink-0 items-center justify-end group-data-[sidebar=icons]/console:h-[40px]"
            data-titlebar=""
          >
            <SidebarToggle sidebar={sidebar} className="group-data-[sidebar=icons]/console:hidden" />
          </div>
          <div className="mb-2 flex items-center gap-[0.3rem] group-data-[sidebar=icons]/console:flex-col-reverse group-data-[sidebar=icons]/console:items-center">
            <div className="min-w-0 flex-auto group-data-[sidebar=icons]/console:flex-none">
              <ContextSwitcher />
            </div>
            <SidebarToggle sidebar={sidebar} className="sw-sidebar-toggle-inline" />
          </div>
          <nav aria-label="console">
            <ul className="m-0 list-none p-0 max-[760px]:flex max-[760px]:flex-wrap max-[760px]:gap-[0.2rem]">
              {SIDEBAR_ENTRIES.filter((entry) => entry.place === "main").map((entry) => (
                <SidebarRow key={entry.key} entry={entry} pending={pending} onNavigate={start} />
              ))}
            </ul>
          </nav>
          <div className="mt-auto max-[760px]:mt-[0.4rem]">
            <BuildStatus />
          </div>
          <ul className="m-0 list-none p-0 text-[0.78rem]">
            {SIDEBAR_ENTRIES.filter((entry) => entry.place === "foot").map((entry) => (
              <SidebarRow key={entry.key} entry={entry} pending={pending} onNavigate={start} />
            ))}
          </ul>
        </aside>
        <main className="sw-glass-page min-w-0">{children}</main>
        <SettingsModal />
        <AppearanceSync />
      </div>
    </AlignmentWaitingProvider>
  );
}
