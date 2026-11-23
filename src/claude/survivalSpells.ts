/**
 * Dry spells: which simulated hours run together as one stretch with no plan left, and what ended each.
 * `./survivalSimulate.ts` steps the fleet hour by hour and hands each hour's verdict here.
 *
 * A spell only ends two ways, because a plan's cap only moves two ways: its week resets, or it enters that
 * week's final hours and `spendCapFor` lifts its cap from the register's route bar to its spend-out bar. The
 * second is a REPRIEVE, not an end — see {@link DrySpell} — so a spell that lift closes is held until the lifted
 * plan resets, and dry hours resuming before then rejoin it.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * What gave a plan room again: its week reset, or its last-five-hours cap lift. `unended` is a spell still dry a
 * whole week past the horizon — demand beyond what the fleet can ever hold.
 *
 * @internal
 */
export type SpellEnd = "reset" | "final-hours" | "unended";

/**
 * One run of dry hours, and the plan that ended it.
 *
 * A spell that a plan's last-five-hours cap lift interrupts is ONE spell, not two: the lift frees only 0.05 of
 * one week, for at most five hours before that same plan resets, so dry hours resuming before that reset are
 * the same trough. MEASURED by replaying a journal: split, one spell read as 7h ending early in the day and
 * 4h ending later, and a card keyed on the end flipped between the two as the first half crossed the threshold.
 */
export interface DrySpell {
  readonly startIso: string;
  /** Dry hours, the reprieve excluded. */
  readonly hours: number;
  /** Hours inside the spell in which a last-five-hours cap lift let seats run. */
  readonly reliefHours: number;
  /** The plan that took demand in the first hour that was not dry; for an `unended` spell, the next to reset. */
  readonly endedByAlias: string;
  /** When that plan gained room — its reset, or its last-five-hours mark; for `unended`, where following stopped. */
  readonly endedAtIso: string;
  readonly endedBy: SpellEnd;
}

/** What the tracker reads of a simulated plan after an hour's routing. */
interface SpellPlan {
  readonly alias: string;
  readonly takenThisHour: number;
  /** The hour this plan's week last rolled over. */
  readonly rolledAtMs: number | undefined;
  readonly resetMs: number;
}

/** The dry spell running now, not yet ended. */
interface OpenSpell {
  readonly startMs: number;
  hours: number;
  reliefHours: number;
}

/** A spell a last-five-hours lift ended, held until the lifted plan resets in case dry hours resume first. */
interface ReprievedSpell {
  readonly open: OpenSpell;
  readonly closed: DrySpell;
  readonly closedAtMs: number;
  /** The lifted plan's reset: a dry hour before it resumes the spell, none by it settles the spell as closed. */
  readonly untilMs: number;
}

/** The spell tracker between hours: at most one open spell, or one reprieved spell waiting on its plan's reset. */
interface SpellTracker {
  open: OpenSpell | undefined;
  reprieved: ReprievedSpell | undefined;
  readonly spells: DrySpell[];
  /** How long before its reset a plan's spend-out lift opens, off the register the simulation runs under. */
  readonly spendOutBeforeResetMs: number;
}

/** An epoch instant as ISO-8601. */
function isoAt({ ms }: { ms: number }): string {
  return new Date(ms).toISOString();
}

/**
 * A tracker that has seen no hour yet.
 *
 * @param spendOutBeforeResetMs how long before its reset a plan's spend-out lift opens, so a spell that lift ends
 *   names the instant it really opened
 * @returns an empty tracker, for {@link trackHour} to advance
 */
export function newSpellTracker({ spendOutBeforeResetMs }: { spendOutBeforeResetMs: number }): SpellTracker {
  return { open: undefined, reprieved: undefined, spells: [], spendOutBeforeResetMs };
}

/**
 * Whether a spell is still being followed — open, or reprieved and waiting on its plan's reset.
 *
 * @param tracker the tracker to ask
 * @returns true while the simulation must keep stepping to learn how a spell ends
 */
export function spellRunning({ tracker }: { tracker: SpellTracker }): boolean {
  return tracker.open !== undefined || tracker.reprieved !== undefined;
}

/**
 * Close a spell at the first hour that was not dry: the plan that took the most of that hour is the one that
 * regained room, and whether its week rolled this hour says which way.
 */
function closeSpell({
  open,
  plans,
  atMs,
  spendOutBeforeResetMs,
}: {
  open: OpenSpell;
  plans: readonly SpellPlan[];
  atMs: number;
  spendOutBeforeResetMs: number;
}): DrySpell {
  const ender = plans.toSorted((left, right) => right.takenThisHour - left.takenThisHour)[0]!;
  const reset = ender.rolledAtMs === atMs;
  // The instant the plan gained room, not this hour's step: the simulation steps from `nowIso`, off the hour.
  const roomAtMs = reset ? ender.resetMs - WEEK_MS : ender.resetMs - spendOutBeforeResetMs;
  return {
    endedAtIso: isoAt({ ms: roomAtMs }),
    endedBy: reset ? "reset" : "final-hours",
    endedByAlias: ender.alias,
    hours: open.hours,
    reliefHours: open.reliefHours,
    startIso: isoAt({ ms: open.startMs }),
  };
}

/**
 * Advance the spell tracker by one hour.
 *
 * @param tracker the tracker, mutated in place
 * @param dry whether this hour was dry
 * @param mayOpen whether a NEW spell may start this hour — false past the horizon, where only a running one is followed
 * @param plans the fleet after this hour's routing
 * @param atMs this hour's instant
 */
export function trackHour({
  tracker,
  dry,
  mayOpen,
  plans,
  atMs,
}: {
  tracker: SpellTracker;
  dry: boolean;
  mayOpen: boolean;
  plans: readonly SpellPlan[];
  atMs: number;
}): void {
  settleReprieve({ atMs, dry, tracker });
  if (!dry) {
    closeOpenSpell({ atMs, plans, tracker });
    return;
  }
  if (tracker.open !== undefined) {
    tracker.open.hours += 1;
    return;
  }
  if (mayOpen) {
    tracker.open = { hours: 1, reliefHours: 0, startMs: atMs };
  }
}

/**
 * Resolve a reprieve by this hour: a dry hour before the lifted plan resets resumes the spell, with the reprieve's
 * hours counted as relief; reaching that reset with none settles it as closed; anything else leaves it waiting.
 */
function settleReprieve({ tracker, dry, atMs }: { tracker: SpellTracker; dry: boolean; atMs: number }): void {
  const { reprieved } = tracker;
  if (reprieved === undefined) {
    return;
  }
  if (dry && atMs < reprieved.untilMs) {
    tracker.reprieved = undefined;
    tracker.open = reprieved.open;
    tracker.open.reliefHours += (atMs - reprieved.closedAtMs) / HOUR_MS;
    return;
  }
  if (atMs >= reprieved.untilMs) {
    tracker.reprieved = undefined;
    tracker.spells.push(reprieved.closed);
  }
}

/** End the open spell at an hour that was not dry: recorded when a reset ended it, reprieved when a lift did. */
function closeOpenSpell({
  tracker,
  plans,
  atMs,
}: {
  tracker: SpellTracker;
  plans: readonly SpellPlan[];
  atMs: number;
}): void {
  const { open } = tracker;
  if (open === undefined) {
    return;
  }
  tracker.open = undefined;
  const closed = closeSpell({ atMs, open, plans, spendOutBeforeResetMs: tracker.spendOutBeforeResetMs });
  if (closed.endedBy !== "final-hours") {
    tracker.spells.push(closed);
    return;
  }
  const lifted = plans.find((plan) => plan.alias === closed.endedByAlias)!;
  tracker.reprieved = { closed, closedAtMs: atMs, open, untilMs: lifted.resetMs };
}

/**
 * Every spell the tracker saw, once the simulation stops following: a reprieve still waiting stands as closed,
 * and a spell still open is `unended` at the instant following stopped.
 *
 * @param tracker the tracker after the last hour
 * @param plans the fleet at the end, whose next reset an `unended` spell names
 * @param stoppedAtMs where the simulation stopped following
 * @returns every dry spell, in the order each started
 */
export function finishSpells({
  tracker,
  plans,
  stoppedAtMs,
}: {
  tracker: SpellTracker;
  plans: readonly SpellPlan[];
  stoppedAtMs: number;
}): readonly DrySpell[] {
  const spells = [...tracker.spells];
  if (tracker.reprieved !== undefined) {
    spells.push(tracker.reprieved.closed);
  }
  if (tracker.open !== undefined) {
    spells.push({
      endedAtIso: isoAt({ ms: stoppedAtMs }),
      endedBy: "unended",
      endedByAlias: plans.toSorted((left, right) => left.resetMs - right.resetMs)[0]!.alias,
      hours: tracker.open.hours,
      reliefHours: tracker.open.reliefHours,
      startIso: isoAt({ ms: tracker.open.startMs }),
    });
  }
  return spells;
}

/**
 * How a dry spell ended, as the clause after "until".
 *
 * @param spell one dry spell
 * @param thresholds the Claude thresholds the forecast ran under, whose route bar a final-hours lift spends past
 * @returns e.g. `plan-five resets at <reset instant>`
 */
export function spellEndClause({ spell, thresholds }: { spell: DrySpell; thresholds: ClaudeThresholds }): string {
  const at = `${spell.endedAtIso.slice(0, 16)}Z`;
  switch (spell.endedBy) {
    case "reset":
      return `${spell.endedByAlias} resets at ${at}`;
    case "final-hours":
      return `${spell.endedByAlias} enters its week's final hours at ${at} and may spend past ${String(Math.round(thresholds.routeAt * 100))}%`;
    case "unended":
      return `past ${at}: demand the fleet cannot hold at any reset`;
    default: {
      const unreachable: never = spell.endedBy;
      return unreachable;
    }
  }
}
