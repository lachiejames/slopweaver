/**
 * The menu bar's plan lines, applied to Electron: ask the console's `plan-usage` read now and every
 * {@link PLAN_USAGE_INTERVAL_MS} after, never two at once, and hand the answer to the tray. What an answer means is
 * `planUsage.ts`'s and `planUsageTray.ts`'s; this module only asks and keeps the last one.
 *
 * It asks the CONSOLE rather than running the verb itself, so the console's one allowlist stays the only place this
 * read is declared, and a console that is down reads as "unavailable" here rather than as a second process on the
 * machine. The read asks no model host anything (`site/lib/liveVerbs.ts`, slug `plan-usage`). The console's live route
 * keeps its own behaviour for this read as for every other: an opt-in saved reading and the talk-pack keeper, both
 * local (`desktop/docs/plan-usage.md`).
 */
import type { MenuItemConstructorOptions } from "electron";

import { parsePlanUsageLiveResult } from "./planUsage";
import {
  PLAN_USAGE_INTERVAL_MS,
  type PlanUsageTrayLines,
  type PlanUsageTrayState,
  planUsageTrayLines,
} from "./planUsageTray";

/** What the shell reads from, and tells, the rest of the app. */
export interface PlanUsageHost {
  /** The console's origin, once it is serving. */
  readonly consoleOrigin: () => string | undefined;
  /** An answer arrived: draw the menu again. */
  readonly redrawTray: () => void;
}

/** The route answers inside its fast lane's twenty seconds; this is that plus the server's own overhead. */
const FETCH_TIMEOUT_MS = 30_000;

/** How often the menu is drawn again with no new answer, so the lines' own clock moves. */
const REDRAW_INTERVAL_MS = 30_000;

let host: PlanUsageHost | undefined;
let state: PlanUsageTrayState = { kind: "reading" };
let asking = false;
let polling = false;

/** The host, once `startPlanUsage` has run. */
function hostOf(): PlanUsageHost {
  if (host === undefined) {
    throw new Error("the plan usage shell was used before startPlanUsage");
  }
  return host;
}

/** Ask the console once, unless an ask is already running or the console is not serving yet. */
function askConsole(): void {
  const origin = hostOf().consoleOrigin();
  if (asking || origin === undefined) {
    return;
  }
  asking = true;
  void (async () => {
    try {
      // `redirect: "error"`: the console answers this route itself, so a redirect is refused rather than followed —
      // followed, one could take the request off loopback to any host.
      const response = await fetch(`${origin}/api/live/plan-usage`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body: unknown = await response.json();
      const read = parsePlanUsageLiveResult({ value: body });
      state = read.isOk()
        ? { kind: "available", reading: read.value, receivedAtMs: Date.now() }
        : { kind: "unavailable", reason: read.error };
    } catch (cause) {
      state = {
        kind: "unavailable",
        reason: `the console did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    } finally {
      asking = false;
    }
    hostOf().redrawTray();
  })();
}

/** Start asking: now, and every interval after. Runs once, on the first menu drawn. */
function startAsking(): void {
  polling = true;
  setInterval(askConsole, PLAN_USAGE_INTERVAL_MS);
  // The menu is a snapshot taken when it is drawn, and the lines are judged at that instant (`planUsageTray.ts`), so it
  // is drawn again between asks: a reset passing at 12:01 reads as reopened by 12:01:30, never as the old percentage
  // until the next ask. A redraw reads nothing.
  setInterval(() => {
    hostOf().redrawTray();
  }, REDRAW_INTERVAL_MS);
}

/**
 * The plan lines for the menu being drawn now, as its items: a headline, and one line per plan behind it.
 *
 * Only a drawn menu asks, so an app with no tray never runs the read. Until a first answer lands every draw asks again,
 * because the first ask waits for the console to serve, and the draw that follows it becoming ready is what sends it.
 *
 * @returns the headline item, carrying the per-plan lines as its submenu when there are any
 */
export function planUsageTray(): MenuItemConstructorOptions[] {
  if (host === undefined) {
    return [];
  }
  if (!polling) {
    startAsking();
  }
  if (state.kind === "reading") {
    askConsole();
  }
  const lines: PlanUsageTrayLines = planUsageTrayLines({ nowMs: Date.now(), state, timeZone: undefined });
  if (lines.rows.length === 0) {
    return [{ enabled: false, label: lines.headline }];
  }
  return [{ label: lines.headline, submenu: lines.rows.map((label) => ({ enabled: false, label })) }];
}

/**
 * Hand the shell what it reads from the rest of the app. Nothing is asked until {@link planUsageTray} first draws.
 *
 * @param planUsageHost what the shell reads from the rest of the app
 */
export function startPlanUsage({ planUsageHost }: { planUsageHost: PlanUsageHost }): void {
  host = planUsageHost;
}
