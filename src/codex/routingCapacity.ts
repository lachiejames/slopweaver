/**
 * How full a Codex destination may read and still be routed new work — the one proactive bar Codex routing
 * has, and the reading-trust rules it shares with the ranker. Pure: a gauge and an instant in, a verdict out.
 *
 * ## The ruling
 *
 * Pausing a Codex plan at about one percent left is right; leaving five percent unused is too early. So a destination stops taking
 * NEW work at the register's `pauseAtPercent` used on either window — 99 unless the owner set another
 * (`../plans/thresholds.ts`; every limit lives in the store or the profile, never fixed in code).
 *
 * Claude's bar is `claude/select.ts`'s `spendCapFor` and is NOT this one: the owner's steer
 * named Codex here, and the two providers' caps are separate decisions, each its own register field.
 *
 * ## What the bar is, and what it is not
 *
 * It is a ROUTING guard, never quota evidence. A destination at 99% has not been refused by its provider, so
 * nothing here records a cap, and `./fleetCap.ts` calls the fleet capped only on positive refusal evidence —
 * `codex status`'s `CAPPED:` and the landing gates' cap witness never rest on a 99% reading. A fleet nothing can
 * route to because its rows sit at this bar is the fleet's `routingPause` instead, and the two fallback verbs
 * take THAT as their ground (`./fallbackCap.ts`), the receipt saying "routing pause, not a provider cap" in its
 * own words: rule 9 says a Codex cap stops nothing, and a bar the owner set one percent short of the cap stopping
 * everything would be the stricter of the two. A window at 100% is the gauge's own positive evidence
 * (`./gaugeAlert.ts`'s `codexHeadroom`).
 *
 * It does not make a pass completion-safe: a pass started at 98.9% can spend more than the 1.1% left, two
 * callers can read the same snapshot, and `used_percent` advances only when a turn writes an event. Its claim
 * is narrower — a destination already observed past the pause bar takes no further new work.
 *
 * `./gaugeAlert.ts`'s alert bar (the register's `alertAtPercent`) is a WARNING that raises a card, and excludes
 * nothing.
 *
 * ## The owner's usage limit lowers the WEEKLY ceiling only
 *
 * A register row's `usageLimitPercent` (`../plans/usageLimit.ts`) is the share of the plan the owner lets Slopweaver
 * take, and it is a share of the WEEK — so the weekly ceiling is the LOWER of this bar and that limit
 * ({@link codexEffectiveUsageCeiling}), while the five-hour window keeps this bar alone. A row reaching its
 * limit — wherever the bar sits, above it or below — is reported by {@link codexUsageLimitReached} and never by
 * {@link codexNearCapWindows}: a local limit
 * is the owner's setting, not a reading near the provider's wall, and relabelling it `near-cap` would let `--force`
 * re-admit it and a monitor read it as capacity.
 */
import { parseIsoMs } from "#lib/date.js";

import type { CodexThresholds } from "../plans/thresholds.js";
import type { UsageLimitPercent } from "../plans/usageLimit.js";
import type { CodexGaugeSource } from "./fleetTypes.js";
import type { CodexGauge, CodexWindowLabel, CodexWindowReading } from "./gauge.js";
import { codexWindowByLabel } from "./gauge.js";

/**
 * The highest `used_percent` a reading may report and still be believed.
 *
 * Codex reports a percentage of one window, so anything outside `0..100` is a reading this code does not
 * understand rather than a very full account — and treating an unparsed number as 0 would rank the
 * destination nobody can read as the emptiest one. Check what a real line carries:
 *
 * ```bash
 * grep -rho '"used_percent":[0-9.]*' "${CODEX_HOME:-$HOME/.codex}/sessions" | sort -t: -k2 -n | tail -1
 * ```
 */
export const MAX_BELIEVABLE_PERCENT = 100;

/** The two windows the bar is judged on, in the order a reason names them. */
export const CODEX_PAUSE_WINDOWS: readonly CodexWindowLabel[] = ["weekly", "five-hour"];

/** One window that has crossed the register's pause bar, with the reset that will lift it. */
export interface CodexNearCapWindow {
  readonly label: CodexWindowLabel;
  readonly usedPercent: number;
  readonly resetAtIso: string;
}

/**
 * One window's `usedPercent` when it is a number this code can act on, or undefined when it is not.
 *
 * @param window the reading, or undefined when the gauge carried no window with that label
 * @returns the percentage, or undefined when there is no usable one
 */
export function usablePercent({ window }: { window: CodexWindowReading | undefined }): number | undefined {
  if (window === undefined) {
    return undefined;
  }
  const { usedPercent } = window;
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > MAX_BELIEVABLE_PERCENT) {
    return undefined;
  }
  return usedPercent;
}

/**
 * The gauge a routing decision may believe, or undefined when its own timestamp disqualifies it.
 *
 * A reading dated in the FUTURE is rejected outright rather than trusted: a clock that disagrees by a week
 * would otherwise let one destination's stale percentage outrank every honest one, and there is no way to
 * tell which of the two numbers is wrong. An unparseable instant is the same answer for the same reason.
 * Age alone never disqualifies a reading — no cutoff is invented here, and the assessment prints the
 * observation's age so a reader judges staleness with the number in front of them.
 *
 * @param gauge the destination's freshest reading, or undefined when its scan found none
 * @param nowIso the instant the whole fleet read was judged against
 * @returns the gauge when its instant is usable, otherwise undefined
 */
export function believableGauge({
  gauge,
  nowIso,
}: {
  gauge: CodexGauge | undefined;
  nowIso: string;
}): CodexGauge | undefined {
  if (gauge === undefined) {
    return undefined;
  }
  const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (observedMs === undefined || nowMs === undefined || observedMs > nowMs) {
    return undefined;
  }
  return gauge;
}

/**
 * Every window of a believable reading that sits at or past the register's pause bar, weekly first. Compared
 * with `>=`, so at the default 99, 98.99 still routes and 99 does not.
 *
 * A window only counts when its reset is PARSEABLE and still ahead of `nowIso`: that proves the window the
 * percentage describes is still the open one, so an undated or already-reopened reading at the bar can never
 * pause a destination indefinitely. Windows are read by LABEL, never by slot (`./gauge.ts` § Which window is which).
 *
 * @param gauge the destination's freshest reading, or undefined when its scan found none
 * @param nowIso the instant the fleet read was judged against, ISO-8601
 * @param thresholds the install's Codex thresholds, whose `pauseAtPercent` is the bar
 * @returns the windows past the bar, empty when the destination may take new work
 */
export function codexNearCapWindows({
  gauge,
  nowIso,
  thresholds,
}: {
  gauge: CodexGauge | undefined;
  nowIso: string;
  thresholds: CodexThresholds;
}): readonly CodexNearCapWindow[] {
  const believed = believableGauge({ gauge, nowIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (believed === undefined || nowMs === undefined) {
    return [];
  }
  return CODEX_PAUSE_WINDOWS.flatMap((label): readonly CodexNearCapWindow[] => {
    const window = codexWindowByLabel({ gauge: believed, label });
    const usedPercent = usablePercent({ window });
    const resetAtIso = window?.resetAtIso;
    if (usedPercent === undefined || resetAtIso === undefined || usedPercent < thresholds.pauseAtPercent) {
      return [];
    }
    const resetMs = parseIsoMs({ tsIso: resetAtIso });
    if (resetMs === undefined || resetMs <= nowMs) {
      return [];
    }
    return [{ label, resetAtIso, usedPercent }];
  });
}

/**
 * The reason a near-cap destination is excluded, naming every window past the bar with its exact reading.
 *
 * @param windows what {@link codexNearCapWindows} found, non-empty
 * @param thresholds the Codex thresholds that judged them, so the sentence names the bar it used
 * @returns the sentence a route read prints
 */
export function nearCapReason({
  windows,
  thresholds,
}: {
  windows: readonly CodexNearCapWindow[];
  thresholds: CodexThresholds;
}): string {
  const parts = windows.map(
    (window) => `${window.label} window at ${String(window.usedPercent)}% used, resets ${window.resetAtIso}`,
  );
  const left = 100 - thresholds.pauseAtPercent;
  return `${parts.join("; ")} — paused for new work at ${String(thresholds.pauseAtPercent)}% (about ${String(left)} percent left)`;
}

/** The used percentage at or above which one window takes no new work, and which rule set it. */
export interface CodexUsageCeiling {
  readonly usedPercent: number;
  /** `routing-bar` when the register's pause bar decides, `usage-limit` when the owner's lower limit does. */
  readonly source: "routing-bar" | "usage-limit";
}

/**
 * The ceiling one window is held to: the weekly window at the lower of the house bar and the row's usage limit,
 * the five-hour window at the house bar alone, since the limit is a share of the week.
 *
 * @param label which window
 * @param usageLimitPercent the register row's own usage limit
 * @param thresholds the install's Codex thresholds, whose `pauseAtPercent` is the house bar
 * @returns the ceiling, and which rule set it — `usage-limit` for any limit below 100 at or under the bar, so a
 * limit equal to the bar is still the owner's and no `--force` crosses it
 */
export function codexEffectiveUsageCeiling({
  label,
  usageLimitPercent,
  thresholds,
}: {
  label: CodexWindowLabel;
  usageLimitPercent: UsageLimitPercent;
  thresholds: CodexThresholds;
}): CodexUsageCeiling {
  if (label === "weekly" && usageLimitPercent < 100 && usageLimitPercent <= thresholds.pauseAtPercent) {
    return { source: "usage-limit", usedPercent: usageLimitPercent };
  }
  return { source: "routing-bar", usedPercent: thresholds.pauseAtPercent };
}

/**
 * Why a limited row is held on its READING alone: its week `at-limit`, with the reset that reopens it when the reading
 * named one; its week `unread`, `usedPercent` undefined; or `rollout-only`, a reading under the limit that came from
 * the rollout log rather than a live read, so nothing current shows the week still under it.
 */
export interface CodexReadingLimitReached {
  readonly evidence: "at-limit" | "unread" | "rollout-only";
  readonly usedPercent: number | undefined;
  readonly usageLimitPercent: UsageLimitPercent;
  readonly resetAtIso: string | undefined;
}

/**
 * Why a Codex PASS is held although the live reading sits under the limit: the points other passes on the same
 * account have already reserved (`./passReservation.ts`), plus the one this pass needs, would carry the week past
 * it. Only ever built off a LIVE `usedPercent`, so it never claims usage nothing measured.
 */
interface CodexReservationLimitReached {
  readonly evidence: "reservation";
  readonly usedPercent: number;
  readonly reservedPercent: number;
  readonly requestedPercent: 1;
  readonly usageLimitPercent: UsageLimitPercent;
  readonly resetAtIso: string | undefined;
}

/** Why a limited row or account takes no new work — on its reading, or on its reading plus the passes reserving it. */
export type CodexUsageLimitReached = CodexReadingLimitReached | CodexReservationLimitReached;

/**
 * The weekly window of a believable reading when it sits at or past the row's own usage limit, or undefined.
 *
 * The raw, unrounded `usedPercent` is compared with `>=` against the limit ITSELF, so 30 stops a 30 row and
 * 29.9999999 does not. It fires for every limit below 100, the pause bar's position notwithstanding — a 100 row is
 * the bar's business, through {@link codexNearCapWindows}. A limit set ABOVE a lowered bar (90 on a bar of 80) is
 * still the owner's number: the bar pauses the row at 80 only when it can date the window and `--force` crosses
 * it, so gating this on the bar let an undated 90% week route and a dated one be forced past the owner's 90. The pass reservation already counts every sub-100 row as limited
 * (`./passReservation.ts`). The direction of failure differs from the bar's on purpose: the bar ignores a
 * window it cannot date, while this keeps an UNDATED reading at the limit out, because the limit is a ceiling the
 * owner set and an unread reset is no evidence the week has reopened. A reset already PAST is that evidence, so
 * that reading no longer counts.
 *
 * A limited row with NO believable weekly reading is kept out too, with `usedPercent` undefined: nothing shows it
 * under the limit, so ranking it `weekly-unmeasured` would let a named `--plan` land on a week already at its limit. That is the Claude rule exactly — `../claude/spawnStoreRefusals.ts`'s
 * `pinnedWithNoGauge` refuses an unread pinned seat below 100 with no hatch.
 *
 * Only a LIVE reading may show a limited row UNDER its limit. A failed live read falls back to the rollout log at
 * any age (`./accountLiveParse.ts` `effectiveGauge`), and a 29% line from last week says nothing about a week
 * another session has since pushed to 30. So a rollout reading under the limit
 * holds the row `rollout-only`. A reading AT the limit holds it `at-limit` from either source: stale evidence that
 * it was spent never reads as headroom.
 *
 * A reset instant that has passed does not reopen a row either. A live response can still carry the spent window
 * for a moment after its nominal reset, through provider rollover lag or a Mac clock running ahead, so the passed
 * instant proves nothing. The row is held `unread` until a
 * fresh live reading shows the new week under the limit.
 *
 * @param gauge the destination's freshest reading, or undefined when there is none
 * @param gaugeSource where that reading came from — a live read, or the rollout log
 * @param nowIso the instant the fleet read was judged against, ISO-8601
 * @param usageLimitPercent the register row's own usage limit
 * @returns why the row is held, or undefined when the row may take new work under its limit
 */
export function codexUsageLimitReached({
  gauge,
  gaugeSource,
  nowIso,
  usageLimitPercent,
}: {
  gauge: CodexGauge | undefined;
  gaugeSource: CodexGaugeSource;
  nowIso: string;
  usageLimitPercent: UsageLimitPercent;
}): CodexReadingLimitReached | undefined {
  const believed = believableGauge({ gauge, nowIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (usageLimitPercent >= 100 || nowMs === undefined) {
    return undefined;
  }
  const unread: CodexReadingLimitReached = {
    evidence: "unread",
    resetAtIso: undefined,
    usageLimitPercent,
    usedPercent: undefined,
  };
  if (believed === undefined) {
    return unread;
  }
  const spent = mostSpentWeekly({ gauge: believed });
  if (spent === undefined) {
    return unread;
  }
  const { usedPercent, window } = spent;
  const live = gaugeSource === "live";
  if (usedPercent < usageLimitPercent) {
    if (live) {
      return undefined;
    }
    return { evidence: "rollout-only", resetAtIso: undefined, usageLimitPercent, usedPercent };
  }
  const resetAtIso = window.resetAtIso;
  const resetMs = resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: resetAtIso });
  if (resetMs !== undefined && resetMs <= nowMs) {
    return unread;
  }
  return { evidence: "at-limit", resetAtIso, usageLimitPercent, usedPercent };
}

/**
 * The most-spent weekly window a reading carries, or undefined when it carries none or any of them is unusable.
 *
 * The live parser labels each slot by its own duration and does not refuse two weekly slots, so asking for the FIRST
 * one could hide a second that is at the limit. A weekly slot whose
 * percentage cannot be believed could be that second one too, so it makes the whole reading unread rather than
 * being skipped.
 *
 * Exported for the pass reservation (`./passReservation.ts`), which holds a whole account to the same reading.
 *
 * @param gauge the believed reading
 * @returns the highest weekly percentage and the window it came from, or undefined
 */
export function mostSpentWeekly({
  gauge,
}: {
  gauge: CodexGauge;
}): { readonly usedPercent: number; readonly window: CodexWindowReading } | undefined {
  const weekly = gauge.windows.filter((window) => window.label === "weekly");
  let most: { readonly usedPercent: number; readonly window: CodexWindowReading } | undefined;
  for (const window of weekly) {
    const usedPercent = usablePercent({ window });
    if (usedPercent === undefined) {
      return undefined;
    }
    if (most === undefined || usedPercent > most.usedPercent) {
      most = { usedPercent, window };
    }
  }
  return most;
}

/**
 * The reason a destination at its usage limit is excluded — saying it is the owner's own setting and no provider evidence.
 *
 * @param reached what {@link codexUsageLimitReached} found
 * @returns the sentence a route read prints
 */
export function usageLimitReason({ reached }: { reached: CodexUsageLimitReached }): string {
  if (reached.evidence === "reservation") {
    return (
      `weekly window read live at ${String(reached.usedPercent)}% used; ${String(reached.reservedPercent)} ` +
      `point(s) are reserved by passes still running and this pass needs ${String(reached.requestedPercent)} more, ` +
      `which would exceed this account's ${String(reached.usageLimitPercent)}% usage limit — the owner's own ` +
      `limit, not provider cap evidence, and no --force crosses it`
    );
  }
  if (reached.evidence === "rollout-only") {
    return (
      `weekly window read only from the rollout log, at ${String(reached.usedPercent)}%, which cannot show it is ` +
      `still under this plan's ${String(reached.usageLimitPercent)}% usage limit — the owner's own limit, and no ` +
      `--force crosses it; a live Codex reading reopens it`
    );
  }
  if (reached.usedPercent === undefined) {
    return (
      `weekly window unread, so nothing shows it under this plan's ${String(reached.usageLimitPercent)}% usage ` +
      `limit — the owner's own limit, and no --force crosses it; a fresh Codex reading reopens it`
    );
  }
  const resets = reached.resetAtIso === undefined ? "its reset is unread" : `it resets ${reached.resetAtIso}`;
  return (
    `weekly window at ${String(reached.usedPercent)}% used, at this plan's ${String(reached.usageLimitPercent)}% ` +
    `usage limit (${resets}) — the owner's own limit, not provider cap evidence, and no --force crosses it`
  );
}
