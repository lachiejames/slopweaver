/**
 * What a tick has to say about Codex's budget: which window binds, whether a pass can be spent at all, and
 * the one react-now line worth interrupting the owner for. The Codex twin of `src/claude/fleetAlert.ts`,
 * and deliberately not a copy of it.
 *
 * ## The Claude alert ranks plans. This one cannot, and says so instead
 *
 * `fleetBudgetAlert` exists to answer "move these spawns to that plan". This module reads exactly ONE Codex
 * home, by construction — a gauge is a property of the `$CODEX_HOME` it was scanned from — so it cannot
 * answer that question and must not pretend to. `slopweaver codex route` is the verb that ranks every
 * registered destination; a react-now line here names what closed on THIS one and points there.
 *
 * The honest local substitute is {@link CodexHeadroom}: which window is closest to closing, when it reopens,
 * and therefore what a caller can still spend against this destination right now.
 *
 * ## The threshold is the register's `alertAtPercent`, 75 by default — the same rung as the Claude ladder's first
 *
 * Both are register fields (`../plans/thresholds.ts`; every rule that holds for Claude holds for Codex), and both default to the same rung on purpose: the alert fires while acting is still a
 * choice, before anything refuses. It sits below any refusal — routing pauses a destination at the register's
 * `pauseAtPercent` and `./quotaGate.ts` refuses once Codex itself reports an exhaustion, the walls rather than the
 * warning — so the register refuses an alert bar at or above the pause bar. Codex reports a 0..100 percentage
 * where Claude reports a 0..1 fraction; see `./gauge.ts`'s header for why neither is normalised to the other.
 *
 * Pure: a reading in, lines out.
 */
import { absentAs } from "#lib/absent.js";
import type { CodexThresholds } from "../plans/thresholds.js";
import { type CodexGauge, type CodexWindowReading, codexWindowByLabel } from "./gauge.js";

/**
 * The percent at which Codex's own window has nothing left to spend. A fact of the provider's 0..100 scale, not a
 * bar the fleet chooses, so like every exhaustion check it is NOT a register threshold: setting it lower would
 * not make a window spent, only make `codex gauge` call a spendable one spent. The fleet's own choice to stop
 * earlier is `pauseAtPercent`, which routing reads.
 */
const WINDOW_EXHAUSTED_PERCENT = 100;

/** What a caller can still spend, and what stops it when it cannot. */
export interface CodexHeadroom {
  /**
   * Whether a pass can be spent right now, as far as the reading can tell.
   *
   * False only on POSITIVE evidence — a classified `rate_limit_reached_type`, credits reported absent, or a
   * window at 100%. An absent or unreadable gauge leaves this true, matching `./quotaGate.ts`'s standing
   * rule that no evidence reads as healthy rather than as a refusal.
   */
  readonly spendable: boolean;
  /** The window closest to closing, or undefined when the reading carried none. */
  readonly binding: CodexWindowReading | undefined;
  /** Why spending is blocked, or undefined when it is not. */
  readonly blockedBy: string | undefined;
}

/** How a window is named in a line. */
function labelText({ window }: { window: CodexWindowReading }): string {
  if (window.label === "five-hour") {
    return "5h";
  }
  if (window.label === "weekly") {
    return "week";
  }
  return window.windowMinutes === undefined ? "window (width unreported)" : `${String(window.windowMinutes)}m window`;
}

/** A window's spend as a whole-percent string, on the provider's own 0..100 scale. */
function percent({ window }: { window: CodexWindowReading }): string {
  return `${String(Math.round(window.usedPercent))}%`;
}

/** The reset clause for a window, or nothing when the event carried no `resets_at`. */
function resetClause({ window }: { window: CodexWindowReading }): string {
  return window.resetAtIso === undefined ? "" : `, resets ${window.resetAtIso}`;
}

/**
 * What the reading says a caller can still spend.
 *
 * @param gauge the latest reading, or undefined when no Codex turn has written one recently
 * @returns whether a pass is spendable, the window closest to closing, and what blocks it if anything does
 */
export function codexHeadroom({ gauge }: { gauge: CodexGauge | undefined }): CodexHeadroom {
  if (gauge === undefined) {
    return { binding: undefined, blockedBy: undefined, spendable: true };
  }
  const binding = gauge.windows.reduce<CodexWindowReading | undefined>(
    (tightest, window) => (tightest === undefined || window.usedPercent > tightest.usedPercent ? window : tightest),
    undefined,
  );
  if (gauge.reached !== undefined) {
    return {
      binding,
      blockedBy: `Codex reported ${absentAs({ value: gauge.reachedType, whenAbsent: gauge.reached })} at ${gauge.observedAtIso}`,
      spendable: false,
    };
  }
  // The BALANCE, never the `has_credits` flag — the same rule `./quotaLog.ts`'s `evidenceFromGauge` carries,
  // and it belongs in both places or in neither. A Codex review found the flag fixed there and still standing
  // here, which made `codex gauge` and `codex route` report a real healthy reading (both windows at 0%, null
  // reached type) as unspendable while the exhaustion reader correctly called it healthy. 1,011 readings on
  // this machine carry `has_credits: false` beside a null reached type; the census is in `evidenceFromGauge`.
  const balance = gauge.credits?.balance;
  if (balance !== undefined && balance !== null && balance <= 0) {
    return { binding, blockedBy: `Codex reported a spent credit balance at ${gauge.observedAtIso}`, spendable: false };
  }
  if (binding !== undefined && binding.usedPercent >= WINDOW_EXHAUSTED_PERCENT) {
    return {
      binding,
      blockedBy: `the ${labelText({ window: binding })} window is at ${percent({ window: binding })}${resetClause({ window: binding })}`,
      spendable: false,
    };
  }
  return { binding, blockedBy: undefined, spendable: true };
}

/**
 * The budget lines a tick publishes for Codex: one fold line always, and a react-now line per window that
 * has crossed the register's alert bar or that a reached type has already closed.
 *
 * @param gauge the latest reading, or undefined when none is available
 * @param thresholds the install's Codex thresholds, whose `alertAtPercent` earns a window its line
 * @returns the fold line, and the react-now lines when any window warrants one
 */
export function codexBudgetAlert({
  gauge,
  thresholds,
}: {
  gauge: CodexGauge | undefined;
  thresholds: CodexThresholds;
}): {
  readonly fold: string;
  readonly reactNow: readonly string[];
} {
  if (gauge === undefined) {
    return {
      fold: "codex budget: no rate-limit reading — Codex writes one only when a turn runs, so nothing has run recently",
      reactNow: [],
    };
  }
  const weekly = codexWindowByLabel({ gauge, label: "weekly" });
  const fiveHour = codexWindowByLabel({ gauge, label: "five-hour" });
  // The week is the window every ChatGPT plan carries, so its absence is named. A five-hour window is printed only
  // when the reading carries one: measured, Codex now writes the weekly window alone (`slopweaver codex gauge`), so
  // a standing `5h unread` would name a window that does not exist as one nobody looked at.
  const parts = [
    weekly === undefined ? "week unread" : `${percent({ window: weekly })} week`,
    ...(fiveHour === undefined ? [] : [`${percent({ window: fiveHour })} 5h`]),
  ];
  const fold = `codex budget: ${parts.join(" / ")}, read ${gauge.observedAtIso}`;
  const reachedLines =
    gauge.reached === undefined
      ? []
      : [
          `REACT NOW — Codex reported ${absentAs({ value: gauge.reachedType, whenAbsent: gauge.reached })} at ${gauge.observedAtIso}: ` +
            "it stops every Codex pass on THAT destination — `slopweaver codex route` names where else one can go",
        ];
  const windowLines = gauge.windows
    .filter((window) => window.usedPercent >= thresholds.alertAtPercent)
    .map(
      (window) =>
        `REACT NOW — Codex ${labelText({ window })} at ${percent({ window })}${resetClause({ window })}: ` +
        "it stops every Codex pass on THAT destination — `slopweaver codex route` names where else one can go",
    );
  return { fold, reactNow: [...reachedLines, ...windowLines] };
}
