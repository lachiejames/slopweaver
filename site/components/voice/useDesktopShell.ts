"use client";

/**
 * Which window the console is drawn in (`site/lib/desktopShell.ts`), read after hydration. The server cannot know
 * whether a page will open in a browser or in the shell, so the first render on both sides says `unknown`, and
 * React re-renders with the real role straight after — the same pattern `VoiceWidget` reads `?orb=` with. While
 * the role is unknown nothing that could start a call is drawn, so the shell's console window can never mint a
 * second call before it knows the overlay owns the first.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  type DesktopBridge,
  type DesktopRole,
  desktopBridgeOf,
  desktopRoleOf,
  instanceMarkOf,
  updateBridgeOf,
} from "../../lib/desktopShell";
import { type OverlayStatus, overlayReportOf } from "../../lib/desktopShellOverlay";
import { type UpdateBridge, type UpdateState, updateStateOf } from "../../lib/desktopShellUpdate";
import { shellBuildOf } from "../../lib/desktopShellWire";
import { type ShellReading, shellUnreadable } from "../../lib/shellStanding";

declare global {
  interface Window {
    /** What the shell's preload puts on the page — unchecked until `desktopBridgeOf` reads it. */
    readonly slopweaverDesktop?: unknown;
  }
}

/** The preload sets the object before any page script runs, and never changes it. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The role, on the client. */
function roleNow(): DesktopRole {
  return desktopRoleOf({ bridge: desktopBridge() });
}

/** No role is known while rendering on the server. */
function roleOnServer(): "unknown" {
  return "unknown";
}

/**
 * The shell's object, on the client.
 *
 * @returns the bridge, or `undefined` in a browser or on the server
 */
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return desktopBridgeOf({ value: window.slopweaverDesktop });
}

/**
 * Whose this window is: `e2e` on a window the desktop test instance's shell marked, read whether or not its bridge is
 * kept (`instanceMarkOf`), so a test window's request is never posted as the owner's.
 *
 * @returns `e2e`, or `undefined` on the owner's own app, a browser, or the server
 */
export function windowInstance(): "e2e" | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return instanceMarkOf({ value: window.slopweaverDesktop });
}

/**
 * Where the console is drawn.
 *
 * @returns `unknown` until hydrated, then `browser`, `main` or `overlay`
 */
export function useDesktopRole(): DesktopRole | "unknown" {
  return useSyncExternalStore(subscribeToNothing, roleNow, roleOnServer);
}

/**
 * Where the overlay's voice stands, as the shell tells the console window: every report the overlay makes is
 * forwarded here, and a page loaded after the last one asks once. A report that arrives before that answer wins
 * over it, being the newer word; a malformed one changes nothing (`overlayReportOf`).
 *
 * @returns the overlay's last status; `undefined` while no voice page reports, in a browser, in the overlay itself,
 *   and under a shell built before it forwarded the overlay's status
 */
export function useOverlayStatus(): OverlayStatus | undefined {
  const [status, setStatus] = useState<OverlayStatus | undefined>(undefined);
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge?.role !== "main") {
      return undefined;
    }
    const { onOverlayStatus, overlayStatusNow } = bridge;
    if (onOverlayStatus === undefined || overlayStatusNow === undefined) {
      return undefined;
    }
    let heard = false;
    let mounted = true;
    /** Take one report, when it is one; says whether it was. */
    const take = (value: unknown): boolean => {
      const report = overlayReportOf({ value });
      if (report === undefined) {
        return false;
      }
      setStatus(report.status);
      return true;
    };
    const unsubscribe = onOverlayStatus((value) => {
      if (take(value)) {
        heard = true;
      }
    });
    const ask = async (): Promise<void> => {
      const value = await overlayStatusNow();
      if (mounted && !heard) {
        take(value);
      }
    };
    ask().catch(() => {
      // The shell answers every ask from this window; a refusal leaves the forwarded reports to say it.
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return status;
}

/**
 * The desktop app's word on its own build (`site/lib/shellStanding.ts`), asked once on mount and again every
 * `everyMs`: a relaunch replaces this page, so the running build cannot change under it, but an install from another
 * window can change the installed one at any time.
 *
 * @param everyMs how often to ask again
 * @returns `pending` until hydrated and until the first answer, `browser` outside the console window — the voice's
 *   window included — `no-method` under an app built before it could say, `unreadable` with why for an answer that
 *   is not exactly one, keeping the last build read, else the build
 */
export function useShellBuild({ everyMs }: { everyMs: number }): ShellReading {
  const role = useDesktopRole();
  const [reading, setReading] = useState<ShellReading>({ kind: "pending" });
  useEffect(() => {
    if (role !== "main") {
      return undefined;
    }
    const shellBuild = desktopBridge()?.shellBuild;
    if (shellBuild === undefined) {
      return undefined;
    }
    let mounted = true;
    const ask = async (): Promise<void> => {
      const build = shellBuildOf({ value: await shellBuild() });
      if (!mounted) {
        return;
      }
      if (build === undefined) {
        setReading((was) => shellUnreadable({ was, why: "the app answered with no build the console could read" }));
        return;
      }
      setReading({ build, kind: "read" });
    };
    const askNow = (): void => {
      ask().catch((error: unknown) => {
        if (mounted) {
          const cause = error instanceof Error ? `: ${error.message}` : "";
          setReading((was) => shellUnreadable({ was, why: `the app did not answer${cause}` }));
        }
      });
    };
    askNow();
    const every = setInterval(askNow, everyMs);
    return () => {
      mounted = false;
      clearInterval(every);
    };
  }, [everyMs, role]);
  if (role === "unknown") {
    return { kind: "pending" };
  }
  if (role !== "main") {
    return { kind: "browser" };
  }
  // The preload sets the bridge before any page script runs and never changes it, so this read is stable.
  if (desktopBridge()?.shellBuild === undefined) {
    return { kind: "no-method" };
  }
  return reading;
}

/**
 * The one-click update's half of the shell (`desktop/src/updateShell.ts`), in the console window: its bridge, and
 * whether an update runs and how the last one ended — asked once on mount, then every change the shell sends.
 *
 * @returns the bridge, `undefined` outside the console window or under an app from before it, and the standing
 */
export function useUpdateShell(): { readonly bridge: UpdateBridge | undefined; readonly state: UpdateState } {
  const role = useDesktopRole();
  const [state, setState] = useState<UpdateState>({ outcome: undefined, running: false });
  // One object for the page's life, so the effects that hold it subscribe once.
  const bridge = useMemo((): UpdateBridge | undefined => {
    const whole = desktopBridge();
    if (role !== "main" || whole === undefined) {
      return undefined;
    }
    return updateBridgeOf({ bridge: whole });
  }, [role]);
  useEffect(() => {
    if (bridge === undefined) {
      return undefined;
    }
    let mounted = true;
    const take = (value: unknown): void => {
      const next = updateStateOf({ value });
      if (mounted && next !== undefined) {
        setState(next);
      }
    };
    const unsubscribe = bridge.onUpdateState(take);
    bridge
      .updateState()
      .then(take)
      .catch(() => {
        // The shell answers every ask from this window; the changes it sends say the rest.
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);
  return { bridge, state };
}
