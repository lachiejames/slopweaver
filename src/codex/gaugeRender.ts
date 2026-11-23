/**
 * The lines `slopweaver codex gauge` prints. Pure: a reading in, text out.
 *
 * ## What every line here has to keep separate
 *
 * `observedAtIso` is when CODEX wrote the reading; the instant this renders is when SLOPWEAVER read it. The
 * two are routinely days apart, because Codex only writes a `rate_limits` object when a turn actually runs
 * (`./gauge.ts` § Why this is not a probe). A renderer that printed one instant would make a week-old
 * budget look like a live one, so every reading prints its own age and nothing here ever substitutes the
 * read time for the observation time.
 *
 * The same gap decides whether a window still binds. An idle home's newest reading can describe a window whose
 * reset has since PASSED, and a 100% recorded then says nothing about the account now, so such a window is
 * printed as unread-since-reset and left out of `spendable` and the react-now lines. `./rank.ts` applies
 * the same reset-against-now test before `codex route` ranks a home.
 */
import { absentAs } from "#lib/absent.js";
import type { CodexThresholds } from "../plans/thresholds.js";
import { type CodexGauge, type CodexWindowReading, gaugeKeepingWindows } from "./gauge.js";
import { codexBudgetAlert, codexHeadroom } from "./gaugeAlert.js";

/** Milliseconds in an hour — the unit an age is reported in, since a Codex reading's age is usually hours. */
const MS_PER_HOUR = 3_600_000;

/**
 * How old a reading is, in whole hours, or undefined when either instant will not parse.
 *
 * Whole hours rather than a friendlier "2 days ago": the number a reader acts on is how stale the budget is,
 * and rounding it into prose loses the difference between four hours and forty.
 *
 * @param observedAtIso when Codex wrote the reading
 * @param nowIso the instant to measure against — injected, never read from a hidden clock
 * @returns the age in whole hours, or undefined when it cannot be computed
 */
export function readingAgeHours({
  nowIso,
  observedAtIso,
}: {
  nowIso: string;
  observedAtIso: string;
}): number | undefined {
  const now = Date.parse(nowIso);
  const observed = Date.parse(observedAtIso);
  if (!Number.isFinite(now) || !Number.isFinite(observed)) {
    return undefined;
  }
  return Math.floor((now - observed) / MS_PER_HOUR);
}

/** Whether a window's reported reset is at or before `nowIso`, so what it recorded no longer binds. */
function resetPassed({ nowIso, window }: { nowIso: string; window: CodexWindowReading }): boolean {
  if (window.resetAtIso === undefined) {
    return false;
  }
  const resetMs = Date.parse(window.resetAtIso);
  const nowMs = Date.parse(nowIso);
  return Number.isFinite(resetMs) && Number.isFinite(nowMs) && resetMs <= nowMs;
}

/** One window as a line: its width, its spend, and when it comes back — or that it already has. */
function windowLine({ nowIso, window }: { nowIso: string; window: CodexWindowReading }): string {
  const width = window.windowMinutes === undefined ? "width unreported" : `${String(window.windowMinutes)}m`;
  const head = `  ${window.label} (${width}, ${window.slot}): `;
  if (resetPassed({ nowIso, window })) {
    return `${head}reset ${String(window.resetAtIso)} has passed, use since then unread (${String(window.usedPercent)}% when read)`;
  }
  const reset = window.resetAtIso === undefined ? "reset unreported" : `resets ${window.resetAtIso}`;
  return `${head}${String(window.usedPercent)}% used, ${reset}`;
}

/** The age clause for the header line, stated as unknown rather than omitted when it cannot be computed. */
function ageClause({ gauge, nowIso }: { gauge: CodexGauge; nowIso: string }): string {
  const hours = readingAgeHours({ nowIso, observedAtIso: gauge.observedAtIso });
  if (hours === undefined) {
    return "age unknown";
  }
  return `${String(hours)}h old`;
}

/**
 * The quota kind a reached type classifies to, as printed beside it. Codex's `rate_limit_reached_type` is free
 * wording, and one this module has never captured classifies to no kind, so the line says it is unclassified.
 */
function reachedClassification({ gauge }: { gauge: CodexGauge }): string {
  const { reached } = gauge;
  if (reached === undefined) {
    return "unclassified";
  }
  return reached;
}

/**
 * Render one Codex budget reading.
 *
 * @param gauge the latest reading, or undefined when no Codex turn has written one recently
 * @param nowIso the instant to measure the reading's age against
 * @param thresholds the install's Codex thresholds, off the plan register
 * @returns the lines to print, in order
 */
export function renderCodexGauge({
  gauge,
  nowIso,
  thresholds,
}: {
  gauge: CodexGauge | undefined;
  nowIso: string;
  thresholds: CodexThresholds;
}): readonly string[] {
  if (gauge === undefined) {
    return [
      "codex gauge: no rate-limit reading found.",
      "  Codex writes one only as a side effect of running a turn — there is no probe to take, so this",
      "  means no recent Codex session left one in $CODEX_HOME/sessions, not that the account is healthy.",
    ];
  }
  const current = gaugeKeepingWindows({ gauge, keep: (window) => !resetPassed({ nowIso, window }) });
  const headroom = codexHeadroom({ gauge: current });
  const windows =
    gauge.windows.length === 0
      ? ["  no window was reported — an exhaustion event nulls both slots"]
      : gauge.windows.map((window) => windowLine({ nowIso, window }));
  const reached =
    current.reachedType === undefined
      ? []
      : [`  reached: ${current.reachedType} (${reachedClassification({ gauge: current })})`];
  const credits =
    gauge.credits === undefined
      ? ["  credits: not reported"]
      : [
          `  credits: ${gauge.credits.hasCredits ? "available" : "NONE"}` +
            `${gauge.credits.unlimited ? ", unlimited" : ""}` +
            `${gauge.credits.balance === null ? "" : `, balance ${String(gauge.credits.balance)}`}`,
        ];
  return [
    `codex gauge: observed ${gauge.observedAtIso} (${ageClause({ gauge, nowIso })}), ` +
      `limit ${absentAs({ value: gauge.limitId, whenAbsent: "unnamed" })}, plan ${absentAs({ value: gauge.planType, whenAbsent: "unnamed" })}`,
    ...windows,
    ...credits,
    ...reached,
    `  spendable: ${headroom.spendable ? "yes" : `NO — ${absentAs({ value: headroom.blockedBy, whenAbsent: "unstated" })}`}`,
    `  react-now threshold: ${String(thresholds.alertAtPercent)}% of a window; paused for new work at ${String(thresholds.pauseAtPercent)}%`,
    ...codexBudgetAlert({ gauge: current, thresholds }).reactNow.map((line) => `  ${line}`),
  ];
}
