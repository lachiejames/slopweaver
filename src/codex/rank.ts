/**
 * Which registered Codex destination new work should land on. Pure: no clock, no filesystem, no network,
 * no credential — a fleet snapshot and an instant in, an order out.
 *
 * ## The rulings this implements: the home furthest below its own level line
 *
 * Every spawn goes on the plan the owner would choose if they saw all the available usage data: draw down all
 * plans at roughly equal rates, avoid maxing one plan while another sits unused, keep capacity maxed, and leave
 * no plan usage on the table. A plan at eighty percent that resets in an hour is a different story from one at
 * eighty percent that reset an hour ago. Codex has no Fable-style model class, so the budget
 * those rulings weigh is the WEEKLY window — the one shared allowance every Codex pass and seat spends.
 *
 * So the primary key is the weekly window's {@link weeklyHeadroom}: how many points it sits below the line an
 * evenly drawn week would have reached by now, the same measure `claude/headroom.ts`'s `headroomToReset`
 * ranks Claude plans on. It refines the lowest-level-first rule (a spawn goes on the plan with the lowest usage) rather than reversing it — on two homes
 * resetting together the lower level is the one further behind. On two resetting on different days it weighs
 * the reset: a home at 60% reopening in an hour is 38 points behind its line and takes the spawn from one at 5%
 * a week out, which is 5 ahead of its own; ranked on level alone those 38 points stranded at the reset.
 *
 * **Three of Claude's keys have no Codex analogue and are deliberately absent**: Fable utilization, the
 * Fable-versus-plan-wide gap, and the 429 asymmetry that sets `claude/loadBalance.ts`'s second key. Codex's
 * spend bar is its OWN, the register's Codex `pauseAtPercent` (`../plans/thresholds.ts`, 99 by default),
 * never Claude's route bar copied across — and so is its level line, which runs to the row's
 * EFFECTIVE weekly ceiling at the reset with no spend-out lift to model: the pause bar for a row with no usage
 * limit, 30 for a row whose limit is 30. A line running to the pause bar on a 30 row would
 * read it as far behind all week and send it every spawn until the limit itself caught it.
 *
 * ## Every eligible destination is drawn down alike
 *
 * Claude routing draws down usage from all its plans at an equal rate, and Codex does too. So every eligible destination ranks in ONE pool on
 * one key. There is no reserved destination: a register row's `pinned` decides nothing for Codex, and the
 * ambient home is drawn down exactly like every other.
 *
 * ## The line is judged NOW, not at the reading's own instant
 *
 * Claude's line is judged at the gauge's own timestamp, because a Claude gauge is a fleet-wide probe taken at
 * one moment. A Codex reading is written only when a turn runs on that home, so the stalest reading belongs to
 * the home nobody has been spending — exactly the one whose line has moved furthest past it. Judged at its own
 * instant it would read as level and keep losing the spawn to the busy home. Its stated residue: two registered
 * homes signed into one account can spend each other's week unseen.
 *
 * ## Only NEW work is placed here
 *
 * Codex homes belong to individual sessions and there is no shared active slot to rotate, so a Codex spawn is
 * only ever asking "where does NEW work go". Nothing here moves a running session, and there is deliberately no
 * `selectCodexAccount`.
 *
 * ## Absent is NOT MEASURED, and it never sorts as zero
 *
 * A Codex home writes a rate-limit reading only when a turn runs there, so a freshly registered destination
 * has none — the ordinary state, not an error. Ranking that as `0%` would send every spawn to the account
 * nobody has ever read. Unmeasured destinations are DEFERRED behind measured ones and the degradation is
 * reported through {@link CodexFleetTypes.CodexRankBasis} rather than hidden. A weekly percentage with no
 * usable reset is measured but has no line, so it ranks behind every destination that has one and ahead of
 * every unmeasured one, on its level alone.
 *
 * Missingness is carried as its OWN leading key element rather than by shortening the tuple: a key schema
 * that varies per pair is not a total order, and a sort over a non-transitive comparator produces an
 * arbitrary result that looks deterministic (`../plans/rankKeys.ts` § Missingness).
 */
import { parseIsoMs } from "#lib/date.js";

import { codexLoginCommand } from "../plans/login.js";
import { rankBy, type SortKey } from "../plans/rankKeys.js";
import type { CodexThresholds } from "../plans/thresholds.js";
import { CODEX_MONTHLY_SPEND_NOT_MEASURED } from "../plans/usageLimit.js";
import type { CodexDestination } from "./destinations.js";
import type { CodexPlanObservation, CodexPlanRanking, CodexRankBasis, CodexRouteExclusion } from "./fleetTypes.js";
import type { CodexWindowLabel } from "./gauge.js";
import { codexWindowByLabel } from "./gauge.js";
import { codexLevelLineHeadroom } from "./levelLine.js";
import {
  believableGauge,
  codexEffectiveUsageCeiling,
  codexNearCapWindows,
  codexUsageLimitReached,
  nearCapReason,
  usablePercent,
  usageLimitReason,
} from "./routingCapacity.js";

/** A sort-key element ordering a destination that HAS the reading ahead of one that does not. */
const MEASURED = 0;
/** Its partner: no usable reading, so this destination is deferred behind every measured one. */
const UNMEASURED = 1;

/**
 * One labelled window's usable percentage for a destination, or undefined at any break in the chain.
 *
 * A window whose own reset is already PAST has reopened, so its percentage describes a window that no longer
 * exists: it is unmeasured, never `0%` and never the stale number. This matters more since `./gaugeScan.ts`
 * reaches past an empty post-cap reading to the last informative one — a capped account's 100% weekly reading
 * would otherwise keep it at the back of the queue after the window refilled.
 *
 * @param observation the destination's whole evidence set
 * @param label which window to read — never a SLOT, which says nothing about which window sits in it
 * @param nowIso the instant the read was judged against
 * @returns the percentage, or undefined when nothing usable was found
 */
function windowPercent({
  label,
  nowIso,
  observation,
}: {
  label: CodexWindowLabel;
  nowIso: string;
  observation: CodexPlanObservation;
}): number | undefined {
  const gauge = believableGauge({ gauge: observation.gauge, nowIso });
  if (gauge === undefined) {
    return undefined;
  }
  const window = codexWindowByLabel({ gauge, label });
  const resetMs = window?.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (resetMs !== undefined && nowMs !== undefined && resetMs <= nowMs) {
    return undefined;
  }
  return usablePercent({ window });
}

/**
 * When a destination's weekly window next reopens, as an instant, or undefined when that is not knowable.
 *
 * A reset already in the PAST is discarded: the window has reopened and the percentage beside it describes
 * a window that no longer exists, so ordering by it would rank on a number that has already been refilled.
 * The instants are PARSED, never compared as text — an offset-bearing ISO string sorts above a `Z` one
 * while being the earlier instant, which is the defect `./gaugeScan.ts`'s `latestGauge` carries measured.
 *
 * @param nowIso the instant the read was judged against
 * @param observation the destination's whole evidence set
 * @returns the reset in epoch milliseconds, or undefined when there is no usable one
 */
function weeklyResetMs({
  nowIso,
  observation,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
}): number | undefined {
  const gauge = believableGauge({ gauge: observation.gauge, nowIso });
  if (gauge === undefined) {
    return undefined;
  }
  const resetAtIso = codexWindowByLabel({ gauge, label: "weekly" })?.resetAtIso;
  if (resetAtIso === undefined) {
    return undefined;
  }
  const resetMs = parseIsoMs({ tsIso: resetAtIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (resetMs === undefined || nowMs === undefined || resetMs <= nowMs) {
    return undefined;
  }
  return resetMs;
}

/**
 * How many points a destination's weekly window sits BELOW its own level line — the line running from 0 at the
 * reset that opened the week to the row's effective weekly ceiling (`./routingCapacity.ts`'s
 * `codexEffectiveUsageCeiling`) at the reset that closes it. Positive is behind, so it is spent first; negative is
 * ahead, and loses to every destination that is behind.
 *
 * It is POINTS, never points per hour: dividing by the hours left piles every spawn onto the home nearest its
 * wall, the defect `claude/headroom.ts`'s `headroomToReset` carries measured.
 *
 * @param nowIso the instant the line is judged at — see this module's header for why it is not the reading's
 * @param observation the destination's whole evidence set
 * @param thresholds the register's Codex bars, whose pause bar caps the line's end
 * @returns the points behind the line, or undefined when there is no usable weekly percentage or future reset
 */
function weeklyHeadroom({
  nowIso,
  observation,
  thresholds,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
  thresholds: CodexThresholds;
}): number | undefined {
  const weekly = windowPercent({ label: "weekly", nowIso, observation });
  const resetMs = weeklyResetMs({ nowIso, observation });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (weekly === undefined || resetMs === undefined || nowMs === undefined) {
    return undefined;
  }
  const ceiling = codexEffectiveUsageCeiling({
    label: "weekly",
    thresholds,
    usageLimitPercent: observation.plan.usageLimitPercent,
  });
  return codexLevelLineHeadroom({ ceilingPercent: ceiling.usedPercent, nowMs, resetMs, usedPercent: weekly });
}

/**
 * One element PAIR — whether the value is there, then the value — so an absent reading is ordered
 * explicitly rather than by a hole in the tuple.
 *
 * The value defaults to `0` when absent, and that is safe ONLY because the flag beside it has already
 * decided every comparison between a present and an absent reading. Two absent readings compare `0` to
 * `0`, which is a tie the next key resolves.
 *
 * @param value the usable reading, or undefined
 * @returns the two elements to splice into a sort key
 */
function presenceThenValue({ value }: { value: number | undefined }): readonly [number, number] {
  if (value === undefined) {
    return [UNMEASURED, 0];
  }
  return [MEASURED, value];
}

/**
 * The key one destination ranks on, in the order stated in this module's header: a weekly reading before
 * none, then the furthest behind its level line (a lined reading before an unlined one), then the lower weekly
 * level, then the five-hour pair, then the earlier weekly reset. Register order is the final tie-break.
 *
 * @param nowIso the instant the read was judged against
 * @param observation the destination's whole evidence set
 * @param thresholds the register's Codex bars
 * @returns the sort key, lowest first
 */
function codexKey({
  nowIso,
  observation,
  thresholds,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
  thresholds: CodexThresholds;
}): SortKey {
  const weekly = windowPercent({ label: "weekly", nowIso, observation });
  const headroom = weeklyHeadroom({ nowIso, observation, thresholds });
  const fiveHour = windowPercent({ label: "five-hour", nowIso, observation });
  const reset = weeklyResetMs({ nowIso, observation });
  const [weeklyPresence, weeklyLevel] = presenceThenValue({ value: weekly });
  return [
    weeklyPresence,
    ...presenceThenValue({ value: headroom === undefined ? undefined : -headroom }),
    weeklyLevel,
    ...presenceThenValue({ value: fiveHour }),
    ...presenceThenValue({ value: reset }),
  ];
}

/**
 * The exclusion a `monthly-spend` row always carries: nothing here reads a per-plan spend, so it is NOT
 * MEASURED and takes no autonomous work — never ranked, and never deferred as if a reading might arrive.
 *
 * @param observation the destination's whole evidence set
 * @returns the `not-measured` exclusion, or undefined for a `weekly-window` row
 */
function notMeasuredExclusion({ observation }: { observation: CodexPlanObservation }): CodexRouteExclusion | undefined {
  if (observation.plan.allowance.kind !== "monthly-spend") {
    return undefined;
  }
  return { destination: observation.destination, kind: "not-measured", reason: CODEX_MONTHLY_SPEND_NOT_MEASURED };
}

/**
 * The exclusion a `weekly-window` row carries once its week reaches the owner's usage limit.
 *
 * @param nowIso the instant the read was judged against
 * @param observation the destination's whole evidence set
 * @returns the `usage-limit` exclusion, or undefined while the row is under its limit
 */
function usageLimitExclusion({
  nowIso,
  observation,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
}): CodexRouteExclusion | undefined {
  const reached = codexUsageLimitReached({
    gauge: observation.gauge,
    gaugeSource: observation.gaugeSource,
    nowIso,
    usageLimitPercent: observation.plan.usageLimitPercent,
  });
  if (reached === undefined) {
    return undefined;
  }
  return { destination: observation.destination, kind: "usage-limit", reason: usageLimitReason({ reached }) };
}

/**
 * The owner's own usage policy for one destination — `not-measured` for a monthly-spend row, `usage-limit` for a
 * week at its limit — or undefined when the policy lets it take work.
 *
 * Exported for the seat preflight (`./seatDecision.ts`), which asks it BEFORE `--force` may bypass anything, so a
 * named `--plan` or a future route change can never reopen what the ranking excluded.
 *
 * @param nowIso the instant the read was judged against
 * @param observation the destination's whole evidence set
 * @returns the policy exclusion, or undefined when there is none
 */
export function codexUsagePolicyExclusion({
  nowIso,
  observation,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
}): CodexRouteExclusion | undefined {
  const notMeasured = notMeasuredExclusion({ observation });
  if (notMeasured !== undefined) {
    return notMeasured;
  }
  return usageLimitExclusion({ nowIso, observation });
}

/**
 * Why this destination takes no part in the ordering, or undefined when it is eligible.
 *
 * Paused is checked FIRST: the owner's own standing decision is the more informative answer when a paused
 * destination also happens to be refusing, and a reader told only "capped" would go looking for a reset
 * that was never the reason. Not-measured is next, being the owner's declared allowance: a monthly-spend row never
 * enters the numeric ranker, whatever its store says. Signed-out follows, for the same reason one step down: a
 * store nothing is signed into answers every pass `401`, measured on `~/.codex-one`, which ranked
 * FIRST because it had never been capped — and the fix is a login, never a wait, so its reason IS the command.
 *
 * The usage limit precedes near-cap and quota-refused, so a row at its own limit is reported against the owner's
 * setting rather than as provider evidence; near-cap comes BEFORE quota-refused, so a destination reading 100%
 * is reported against the bar it crossed first. `observation.quota` is untouched throughout.
 *
 * @param nowIso the instant the read was judged against
 * @param observation the destination's whole evidence set
 * @param thresholds the register's Codex bars, whose pause bar decides near-cap
 * @returns the exclusion, or undefined when the destination can take work
 */
function codexExcludedBy({
  nowIso,
  observation,
  thresholds,
}: {
  nowIso: string;
  observation: CodexPlanObservation;
  thresholds: CodexThresholds;
}): CodexRouteExclusion | undefined {
  const { paused } = observation.plan;
  if (paused !== undefined) {
    return {
      destination: observation.destination,
      kind: "paused",
      // The owner's own words alone. `kind` already says "paused" and every renderer prints it beside the
      // reason (`cmux/seatRouteErrors.ts`, `codex/fleetAssessment.ts`), so repeating it here produced
      // `paused: paused: card expired` on both of them.
      reason: paused.reason,
    };
  }
  const notMeasured = notMeasuredExclusion({ observation });
  if (notMeasured !== undefined) {
    return notMeasured;
  }
  const { live } = observation;
  if (live.kind === "signed-out" || live.kind === "store-missing") {
    const state = live.kind === "signed-out" ? "nothing is signed in there" : "its store directory does not exist";
    return {
      destination: observation.destination,
      kind: "signed-out",
      reason: `${state} — run ${codexLoginCommand({ codexHome: observation.destination.codexHome })}`,
    };
  }
  const limited = usageLimitExclusion({ nowIso, observation });
  if (limited !== undefined) {
    return limited;
  }
  const nearCap = codexNearCapWindows({ gauge: observation.gauge, nowIso, thresholds });
  if (nearCap.length > 0) {
    return {
      destination: observation.destination,
      kind: "near-cap",
      reason: nearCapReason({ thresholds, windows: nearCap }),
    };
  }
  if (observation.quota.refuse) {
    return { destination: observation.destination, kind: "quota-refused", reason: observation.quota.reason };
  }
  return undefined;
}

/**
 * Which basis a set of eligible destinations was ranked on, given how many carried a weekly reading.
 *
 * @param eligible how many destinations took part
 * @param measured how many of those carried a usable weekly reading
 * @returns the basis to report
 */
function basisFor({ eligible, measured }: { eligible: number; measured: number }): CodexRankBasis {
  if (eligible === 0) {
    return "no-eligible-destination";
  }
  if (measured === 0) {
    return "weekly-unmeasured";
  }
  if (measured === eligible) {
    return "weekly";
  }
  return "weekly-partial";
}

/**
 * Rank every registered Codex destination for new work.
 *
 * @param observations every Codex row's evidence, in REGISTER order, which survives as the final tie-break
 * @param nowIso the instant a reset and a reading's own date are judged against, ISO-8601
 * @param thresholds the register's Codex bars (`../plans/thresholds.ts`), read with the same register the rows were
 * @returns the eligible destinations best first, what was excluded and why, what was deferred for want of
 *   a reading, and which key schema decided the order
 */
export function rankCodexPlans({
  nowIso,
  observations,
  thresholds,
}: {
  nowIso: string;
  observations: readonly CodexPlanObservation[];
  thresholds: CodexThresholds;
}): CodexPlanRanking {
  const excluded = observations
    .map((observation) => codexExcludedBy({ nowIso, observation, thresholds }))
    .filter((exclusion): exclusion is CodexRouteExclusion => exclusion !== undefined);
  const barred = new Set(excluded.map((exclusion) => exclusion.destination.alias));
  const eligible = observations.filter((observation) => !barred.has(observation.destination.alias));
  const ordered = rankBy({ key: (observation) => codexKey({ nowIso, observation, thresholds }), pool: eligible });
  const unmeasured = eligible.filter(
    (observation) => windowPercent({ label: "weekly", nowIso, observation }) === undefined,
  );
  return {
    basis: basisFor({ eligible: eligible.length, measured: eligible.length - unmeasured.length }),
    deferredUnmeasured: unmeasured.map((observation) => observation.destination.alias),
    excluded,
    ranked: ordered.map((observation): CodexDestination => observation.destination),
  };
}
