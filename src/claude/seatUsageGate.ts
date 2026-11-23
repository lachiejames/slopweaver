/**
 * The per-turn usage gate on a seat ALREADY RUNNING on a limited plan — what the `UserPromptSubmit` seat check
 * (`../cli/commands/claude/seatRun.ts`) asks before a prompt reaches the model. Pure: the decision table and the hold
 * it prints. The routing gates (`./select.ts`) stop NEW work at the owner's usage limit; this stops a seat that was
 * booted under it from carrying on past it.
 *
 * ## Why it fails closed, and only for a limited plan
 *
 * A limit the owner sets is respected even if it means taking the fleet down. So a plan with a usage limit below 100 is judged on its last RECORDED reading, and a plan
 * with no reading young enough to be evidence is NOT MEASURED and refused too: a plan that could have spent anything
 * since is not one the fleet may keep spending. A plan at 100 never reaches this module, so an install that set no
 * limit behaves exactly as before it existed.
 *
 * A reading stays evidence for {@link CLAUDE_USAGE_READING_FRESH_MS}, the same hour `./spendPolicy.ts` holds a spend
 * reading to — a validity bound on a measurement, not an owner bar, so it is a constant and not a register threshold.
 *
 * ## What it refuses, and what it lets a running seat finish through
 *
 * Only the owner's limit, compared on its own and never through the routing ceiling, whatever the house bar is set
 * to. A window past the house routing bar, or one the provider refused, stops NEW work in `./select.ts` and is no
 * reason to strand a turn already under way. The five-hour window never carries the limit
 * (`claudeEffectiveUsageCeiling`), so it is never read here.
 *
 * ## Residue, stated
 *
 * The judgement is relative to the last recorded reading, never live usage: a seat can spend past the limit between
 * two readings, and a turn already in flight finishes. The hook's 15 s budget (`scripts/hook.sh`) releases a prompt
 * whose check overran, so a timed-out check fails open.
 */
import { parseIsoMs } from "#lib/date.js";

import { type PlanAllowance, USAGE_LIMIT_PERCENTS, type UsageLimitPercent } from "../plans/usageLimit.js";
import type { ClaudeAccountAlias, ClaudeWindowReading } from "./contracts.js";
import type { ClaudePlanUsageSnapshot } from "./planUsageSnapshot.js";
import type { ClaudeCapWindow } from "./select.js";
import { type ClaudeSpendReading, claudeSpendVerdict } from "./spendPolicy.js";

/** How long a recorded weekly reading stays evidence — the same hour a spend reading is held to. */
export const CLAUDE_USAGE_READING_FRESH_MS = 60 * 60 * 1000;

/**
 * The whole epoch seconds a cached pass may stand across: from the second it was judged — about when its marker is
 * written — until the first instant the reading stops being evidence. The lower bound is the judgement's, not the
 * reading's: a wall clock stepped back behind the marker would let a newer snapshot land with an OLDER mtime than the
 * marker, which the reader's `-nt` would then miss. Equal bounds are an empty window, which the
 * writer refuses to cache.
 *
 * @internal — the type of {@link ClaudeSeatUsageOpen}'s `cacheWindow`; a caller reads it off the verdict.
 */
export interface ClaudeSeatUsageCacheWindow {
  readonly fromEpochSeconds: number;
  readonly untilEpochSeconds: number;
}

/**
 * The prompt may go ahead; `cacheWindow`, when present, is when a cached pass may stand for it.
 *
 * @internal — one arm of the usage verdict union; a caller narrows the union by `kind`.
 */
export interface ClaudeSeatUsageOpen {
  readonly kind: "open";
  readonly alias: ClaudeAccountAlias;
  readonly reason: string;
  /** Absent when nothing bounds the pass — such a verdict is never cached. */
  readonly cacheWindow?: ClaudeSeatUsageCacheWindow;
}

/** The prompt is held: the plan is at the owner's limit, or nothing recorded says it is not. */
export interface ClaudeSeatUsageRefusal {
  readonly kind: "usage-limit" | "not-measured";
  readonly alias: ClaudeAccountAlias;
  readonly reason: string;
}

/** What the usage gate says about one prompt on a limited plan. */
export type ClaudeSeatUsageVerdict = ClaudeSeatUsageOpen | ClaudeSeatUsageRefusal;

/**
 * A NOT MEASURED refusal — exported so the shell maps a snapshot it could not read into the same verdict an absent
 * one gets, never into an open one.
 *
 * @param alias the plan
 * @param reason what is missing or unreadable, named in the hold
 * @returns the refusal
 */
export function seatUsageNotMeasured({
  alias,
  reason,
}: {
  alias: ClaudeAccountAlias;
  reason: string;
}): ClaudeSeatUsageRefusal {
  return { alias, kind: "not-measured", reason };
}

/** One weekly window the limit governs, labelled as `./select.ts` labels it. */
interface JudgedWindow {
  readonly claim: ClaudeCapWindow;
  readonly window: ClaudeWindowReading;
}

/**
 * The weekly windows a snapshot carries — plan-wide always, Fable only when the probe read one.
 *
 * @param snapshot the recorded reading
 * @returns the windows to judge
 */
function weeklyWindows({ snapshot }: { snapshot: ClaudePlanUsageSnapshot }): readonly JudgedWindow[] {
  const plan: JudgedWindow = { claim: "seven_day", window: snapshot.sevenDay };
  if (snapshot.sevenDayFable === undefined) {
    return [plan];
  }
  return [plan, { claim: "seven_day_fable", window: snapshot.sevenDayFable }];
}

/**
 * Why a snapshot is not evidence at `nowMs`, or undefined when it is. Exactly the hour old is still evidence; a
 * reading dated after now is a clock that cannot be trusted.
 *
 * @param nowMs the instant judged at
 * @param observedMs when the reading was taken
 * @param observedAtIso the same instant as recorded, named in the reason
 * @returns the NOT MEASURED reason, or undefined
 */
function snapshotStaleness({
  nowMs,
  observedAtIso,
  observedMs,
}: {
  nowMs: number;
  observedAtIso: string;
  observedMs: number;
}): string | undefined {
  if (observedMs > nowMs) {
    return `its usage reading is dated ${observedAtIso}, after now`;
  }
  if (nowMs - observedMs > CLAUDE_USAGE_READING_FRESH_MS) {
    return `its usage reading from ${observedAtIso} is over an hour old`;
  }
  return undefined;
}

/**
 * What a limited weekly-window plan's last recorded reading says about one more prompt on a seat already running on
 * it, at `nowIso`.
 *
 * @param alias the plan the seat runs on
 * @param nowIso the instant of the prompt
 * @param snapshot the plan's last recorded reading, or undefined when none is recorded
 * @param usageLimitPercent the plan's usage limit — a 100 is open by construction, never a new wall
 * @returns the verdict, with a cache window on an open one whenever something bounds it
 */
export function weeklySeatUsageVerdict({
  alias,
  nowIso,
  snapshot,
  usageLimitPercent,
}: {
  alias: ClaudeAccountAlias;
  nowIso: string;
  snapshot: ClaudePlanUsageSnapshot | undefined;
  usageLimitPercent: UsageLimitPercent;
}): ClaudeSeatUsageVerdict {
  if (usageLimitPercent === 100) {
    return { alias, kind: "open", reason: `${alias} has no usage limit` };
  }
  if (snapshot === undefined) {
    return seatUsageNotMeasured({ alias, reason: `${alias} has no usage reading recorded` });
  }
  const nowMs = parseIsoMs({ tsIso: nowIso });
  const observedMs = parseIsoMs({ tsIso: snapshot.observedAtIso });
  if (nowMs === undefined || observedMs === undefined) {
    return seatUsageNotMeasured({ alias, reason: `${alias}: the instant ${nowIso} or its reading's does not parse` });
  }
  const stale = snapshotStaleness({ nowMs, observedAtIso: snapshot.observedAtIso, observedMs });
  if (stale !== undefined) {
    return seatUsageNotMeasured({ alias, reason: `${alias}: ${stale}` });
  }
  const resetBounds: number[] = [];
  for (const { claim, window } of weeklyWindows({ snapshot })) {
    const resetMs = parseIsoMs({ tsIso: window.resetAtIso })!;
    if (resetMs <= nowMs) {
      continue;
    }
    // The owner's limit alone, on the provider's raw fraction with `>=` exactly as `./select.ts` compares it. Never
    // through the routing ceiling: that one is the LOWER of the owner's limit and the house bar, and labels a limit above the
    // bar `routing-bar`, which this gate lets through — so an 80% limit over a 70% bar would never be held.
    if (window.utilization >= usageLimitPercent / 100) {
      const spent = `${claim} at ${String(Math.round(window.utilization * 100))}%`;
      return {
        alias,
        kind: "usage-limit",
        reason: `${alias}: ${spent}, at its usage limit of ${String(usageLimitPercent)}%`,
      };
    }
    resetBounds.push(resetMs);
  }
  if (resetBounds.length === 0) {
    return { alias, kind: "open", reason: `${alias}: every recorded weekly window has reset since its reading` };
  }
  const validUntilMs = Math.min(observedMs + CLAUDE_USAGE_READING_FRESH_MS, ...resetBounds);
  return {
    alias,
    cacheWindow: {
      fromEpochSeconds: Math.floor(nowMs / 1000),
      untilEpochSeconds: Math.floor(validUntilMs / 1000),
    },
    kind: "open",
    reason: `${alias}: under its usage limit of ${String(usageLimitPercent)}%`,
  };
}

/**
 * What a limited monthly-spend plan's last recorded spend reading says about one more prompt — `claudeSpendVerdict`'s
 * own judgement, so the dollar arithmetic lives in one place. A provider refusal is the provider's wall, not the
 * owner's limit, and lets a running seat carry on exactly as a weekly one does — once the same figures are under the owner's
 * limit too. Never cached: nothing on disk lets the bash fast path see a newer spend reading land.
 *
 * @param alias the plan the seat runs on
 * @param nowIso the instant of the prompt
 * @param reading the plan's newest recorded spend reading, or undefined when none is recorded
 * @param usageLimitPercent the plan's usage limit
 * @returns the verdict, never carrying a cache expiry
 */
export function monthlySeatUsageVerdict({
  alias,
  nowIso,
  reading,
  usageLimitPercent,
}: {
  alias: ClaudeAccountAlias;
  nowIso: string;
  reading: ClaudeSpendReading | undefined;
  usageLimitPercent: UsageLimitPercent;
}): ClaudeSeatUsageVerdict {
  // `claudeSpendVerdict` names the figures, never the plan; the hold line reads its reason bare, so it names it here.
  const verdict = claudeSpendVerdict({ alias, nowIso, reading, usageLimitPercent });
  switch (verdict.kind) {
    case "usage-limit":
    case "not-measured":
      return { alias, kind: verdict.kind, reason: `${alias}: ${verdict.reason}` };
    case "open":
      return { alias, kind: "open", reason: `${alias}: ${verdict.reason}` };
    case "provider-refused": {
      // `claudeSpendVerdict` answers the provider's own wall BEFORE the owner's limit, so a reading the provider
      // refused has not yet been held to the owner's number. Judge the same figures again with the provider's flags set
      // aside: over the limit, or with nothing to measure, the hold stands.
      const owner = claudeSpendVerdict({
        alias,
        nowIso,
        reading: { ...reading!, isEnabled: true, spendLimitReached: false },
        usageLimitPercent,
      });
      if (owner.kind === "open") {
        return { alias, kind: "open", reason: `${alias}: ${verdict.reason}` };
      }
      const held = owner.kind === "usage-limit" ? "usage-limit" : "not-measured";
      return { alias, kind: held, reason: `${alias}: ${owner.reason}` };
    }
    default: {
      const unreachable: never = verdict;
      return unreachable;
    }
  }
}

/**
 * The next usage limit up from `usageLimitPercent` — what the hold offers as the one way past it.
 *
 * @param usageLimitPercent the plan's current limit, below 100 on every path that reaches a hold
 * @returns the next step of ten
 */
function nextUsageLimit({ usageLimitPercent }: { usageLimitPercent: UsageLimitPercent }): UsageLimitPercent {
  const next = USAGE_LIMIT_PERCENTS.find((each) => each > usageLimitPercent);
  if (next === undefined) {
    return usageLimitPercent;
  }
  return next;
}

/**
 * The hold a refused prompt prints. A HOLD, not an escape-hatch refusal: the owner's limit has no override, so the
 * lines say so rather than leaving the absence to read as a forgotten hatch, and name the one thing that changes it.
 *
 * @param allowance the plan's allowance, which decides which verb records a fresh reading
 * @param usageLimitPercent the plan's usage limit
 * @param verdict the refusal
 * @returns the hold's lines
 */
export function seatUsageHoldLines({
  allowance,
  usageLimitPercent,
  verdict,
}: {
  allowance: PlanAllowance;
  usageLimitPercent: UsageLimitPercent;
  verdict: ClaudeSeatUsageRefusal;
}): readonly string[] {
  const { alias } = verdict;
  const relative = "This is judged relative to the last RECORDED reading, not live usage.";
  const noHatch = "This hold has no escape hatch: the owner's usage limit is a ceiling nothing overrides.";
  if (verdict.kind === "not-measured") {
    const verb = allowance.kind === "monthly-spend" ? "spend" : "gauge";
    return [
      `claude seat: NOT MEASURED — this prompt is held because ${verdict.reason}, and ${alias} has a usage limit of ${String(usageLimitPercent)}%.`,
      relative,
      `Record a fresh reading with \`slopweaver claude ${verb} --plan ${alias}\`, then send the prompt again.`,
      noHatch,
    ];
  }
  const next = nextUsageLimit({ usageLimitPercent });
  return [
    `claude seat: USAGE LIMIT — this prompt is held because ${verdict.reason}.`,
    relative,
    "It clears when the window resets, or when the owner raises the limit: " +
      `\`slopweaver plans set-usage-limit --provider claude --plan ${alias} --percent ${String(next)} --allowance ${allowance.kind}\`.`,
    noHatch,
  ];
}
