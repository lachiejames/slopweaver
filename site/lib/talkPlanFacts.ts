/**
 * The three plan facts the call widget's plan settings state at a glance (`components/voice/CallPlanSettings.tsx`): which model the owner is using, how much of their plan is left, and how
 * many talk minutes they get. Each is derived from something
 * the console already reads and never estimated:
 *
 * - the MODEL is what the open call was minted as (`voice.live`), so with no call open it is unknown, not a guess
 *   at what the next mint will pick;
 * - the PLAN LEFT is `slopweaver codex quota show --routed`'s live account read of the register row a call spends,
 *   routed by the same decision `talk offer` launches on (`src/talk/talkSeat.ts`) — one row per metered window;
 * - the TALK MINUTES are not recorded anywhere: no verb measures how much of the plan a call minute draws, so the
 *   row says so and names where the number would come from.
 *
 * Pure, so the words are a unit test rather than a property of the page.
 */
import { type Bag, bags, bool, isBag, num, str, sub } from "./bag";
import { dateTimeFormatOf } from "./dateTimeFormat";

/** One metered window of the plan, as left rather than used. */
export interface PlanWindowLeft {
  /** Which allowance it meters — `codex` is the ordinary one. */
  readonly limitId: string;
  /** The window's own label, `weekly` or `5h`. */
  readonly label: string;
  /** Whole percent left, `100 - usedPercent` rounded, never below zero. */
  readonly leftPercent: number;
  readonly resetAtIso: string;
}

/** What `codex quota show` said about the plan a call runs on. */
export type PlanLeft =
  | {
      readonly kind: "read";
      readonly planType: string | undefined;
      /** `false` is the backend refusing ordinary usage, whatever the percentages say; `undefined` is not reported. */
      readonly allowed: boolean | undefined;
      readonly windows: readonly PlanWindowLeft[];
    }
  | { readonly kind: "not-read"; readonly why: string };

/** Why a store that is not `signed-in` could not be read, in the page's words. */
const NOT_READ_WORDS: Readonly<Record<string, string>> = {
  "signed-out": "Codex is signed out on this machine",
  "store-missing": "no Codex store on this machine",
};

/**
 * One window off the wire.
 *
 * @param limitId the allowance the window's gauge meters
 * @returns the window as left, or `undefined` when a field is missing
 */
function windowOf({ window, limitId }: { window: Bag; limitId: string }): PlanWindowLeft | undefined {
  const label = str({ bag: window, key: "label" });
  const usedPercent = num({ bag: window, key: "usedPercent" });
  const resetAtIso = str({ bag: window, key: "resetAtIso" });
  if (label === undefined || usedPercent === undefined || resetAtIso === undefined) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(resetAtIso))) {
    return undefined;
  }
  return { label, leftPercent: Math.max(0, Math.round(100 - usedPercent)), limitId, resetAtIso };
}

/**
 * Every window of every gauge a signed-in read carried.
 *
 * @param live the `live` member of the quota document
 * @returns the windows, or `undefined` when one is unreadable
 */
function windowsOf({ live }: { live: Bag }): readonly PlanWindowLeft[] | undefined {
  const gauges = bags({ bag: live, key: "gauges" });
  if (gauges === undefined) {
    return undefined;
  }
  const rows: PlanWindowLeft[] = [];
  for (const gauge of gauges) {
    const limitId = str({ bag: gauge, key: "limitId" });
    const windows = bags({ bag: gauge, key: "windows" });
    if (limitId === undefined || windows === undefined) {
      return undefined;
    }
    for (const window of windows) {
      const row = windowOf({ limitId, window });
      if (row === undefined) {
        return undefined;
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Project `codex quota show` into the plan-left row: the live read only, never the cached refusal beside it, which is
 * routing's memory of an old event rather than the plan's state now.
 *
 * @param payload the verb's whole document
 * @returns the plan as left, why it could not be read, or `undefined` when the document is malformed
 */
export function readPlanLeft({ payload }: { payload: unknown }): PlanLeft | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const live = sub({ bag: payload, key: "live" });
  if (live === undefined) {
    return undefined;
  }
  const kind = str({ bag: live, key: "kind" });
  if (kind === "unreadable") {
    const reason = str({ bag: live, key: "reason" });
    if (reason === undefined) {
      return undefined;
    }
    return { kind: "not-read", why: reason };
  }
  if (kind !== "signed-in") {
    const words = kind === undefined ? undefined : NOT_READ_WORDS[kind];
    if (words === undefined) {
      return undefined;
    }
    return { kind: "not-read", why: words };
  }
  const windows = windowsOf({ live });
  if (windows === undefined) {
    return undefined;
  }
  return {
    allowed: bool({ bag: live, key: "ordinaryUsageAllowed" }),
    kind: "read",
    planType: str({ bag: live, key: "planType" }),
    windows,
  };
}

/**
 * One window as a line: how much is left and when it fills again, in the owner's own time zone.
 *
 * @param window the window as left
 * @param timeZone the IANA zone the reset is drawn in
 * @returns `49% of weekly left · resets <weekday day month, h:mm am/pm>`, the allowance named when it is not the ordinary one
 */
export function planWindowWords({ window, timeZone }: { window: PlanWindowLeft; timeZone: string }): string {
  const resets = dateTimeFormatOf({
    locale: "en-AU",
    options: { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone, weekday: "short" },
  }).format(new Date(window.resetAtIso));
  let allowance = window.label;
  if (window.limitId !== "codex") {
    allowance = `${window.limitId} ${window.label}`;
  }
  return `${String(window.leftPercent)}% of ${allowance} left · resets ${resets}`;
}

/**
 * When the plan was read, so a figure a call has since spent from never passes for a fresh one. A read under way, or
 * one that failed, is the mark drawn beside these words (`../components/live/LiveMarks.tsx`), never more words.
 *
 * @param observedAtIso the instant the route read the verb
 * @param timeZone the IANA zone the clock is drawn in
 * @returns `read <h:mm am/pm>`
 */
export function planReadWords({ observedAtIso, timeZone }: { observedAtIso: string; timeZone: string }): string {
  const clock = dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", minute: "2-digit", timeZone } }).format(
    new Date(observedAtIso),
  );
  return `read ${clock}`;
}

/**
 * The model row: what the open call was minted as, or that no call names one yet.
 *
 * @param live the open call's two models, `undefined` with no call open
 * @returns the words, and whether they are a known fact
 */
export function planModelWords({ live }: { live: { model: string; backendModel: string } | undefined }): {
  readonly known: boolean;
  readonly words: string;
} {
  if (live === undefined) {
    return { known: false, words: "unknown until a call opens; the call names its model when it is minted" };
  }
  return { known: true, words: `${live.model}, thinking on ${live.backendModel}` };
}

/** The talk-minutes row: nothing measures a call minute's draw on the plan, so it is unknown, and says from where. */
export const TALK_MINUTES_UNKNOWN =
  "unknown: not measured yet. Source: codex quota show before and after each call, against its length.";
