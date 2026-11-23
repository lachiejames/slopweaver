/**
 * The Codex plans' week, simulated hour by hour at a constant demand and routed the way `./rank.ts` routes: each
 * slice of an hour's demand goes to the plan furthest below its own level line (`./levelLine.ts`), among plans with
 * room under their effective ceiling.
 *
 * ## Free resets are modelled, because ignoring them is a false positive
 *
 * The chair tick runs `codex reset --at-limit` (`./resetFleet.ts`): a plan at its pause bar that holds a free
 * usage-limit reset gets one claimed. Measured in this install's `codex-resets/claims.jsonl`, a claim takes the week
 * to 0% used and moves its reset to the claim instant plus seven days. So a plan reaching its ceiling with a claimable
 * reset is refilled here exactly that way. A claim is claimable only where the ceiling IS the routing bar — a plan
 * capped by the owner's own usage limit is never claimed for (`./routingCapacity.ts`'s `codexEffectiveUsageCeiling`),
 * so the caller says which plans may claim. With every plan at 89–96% and two resets each, ignoring them
 * projects a dry spell the claims would prevent.
 *
 * ## What is not modelled, and which way each one errs
 *
 * - **The five-hour window.** It throttles within an hour and resets inside five; it can strand demand for an hour, but
 *   only the weekly windows run a provider out before a weekly reset. Ignoring it can only miss a spell, never invent
 *   one.
 * - **A free reset's expiry.** A credit that lapses before it would be claimed is read as available, which can only
 *   hide a spell.
 *
 * Pure: plans and a demand in, spells out.
 */
import { CODEX_WEEK_MS, codexLevelLineHeadroom } from "./levelLine.js";

const HOUR_MS = 3_600_000;

/** How many slices one hour's demand is routed in, so one hour can spread across plans the way spawns do. */
const SLICES_PER_HOUR = 12;

/** Demand under this many points is rounding, never a dry hour. */
const EPSILON = 1e-6;

/** One routable Codex plan as the projection starts it. */
export interface CodexWeekPlan {
  /** `codex:<alias>`, as the ceilings reading names it. */
  readonly id: string;
  readonly usedPercent: number;
  readonly resetMs: number;
  /** The effective weekly ceiling: the owner's usage limit, else the routing bar. */
  readonly ceilingPercent: number;
  /** Free resets this plan may claim; 0 where its ceiling is the owner's own limit. */
  readonly claimableResets: number;
}

/** One projected interval with every plan at its ceiling and demand left over. */
interface CodexWeekSpell {
  readonly startMs: number;
  readonly hours: number;
  readonly endMs: number;
  /** The plan whose reset ends the spell. */
  readonly endedById: string;
}

/**
 * What one plan's CURRENT window does in the run — the consumption before its reset the card shows, so the owner can
 * read why a spell is or is not projected (the card must show enough information).
 */
export interface CodexWeekPlanOutcome {
  readonly id: string;
  /** The hour the current window first reached its ceiling, or `undefined` when it never does before it ends. */
  readonly ceilingAtMs: number | undefined;
  /** The share of the current window used when it ended — at its reset, or at the claim that replaced it. */
  readonly usedAtWindowEndPercent: number;
  /** Every free reset the run claims for this plan, in order, inside the run. */
  readonly claimsMs: readonly number[];
}

/** The dry spells, what each plan's current window did, and the demand no plan took. */
export interface CodexWeekRun {
  readonly spells: readonly CodexWeekSpell[];
  readonly plans: readonly CodexWeekPlanOutcome[];
  /** Weekly-window points of demand no plan could take inside the horizon. */
  readonly unmetPoints: number;
}

/** A plan's mutable state through the simulation. */
interface PlanState {
  readonly id: string;
  readonly ceilingPercent: number;
  usedPercent: number;
  resetMs: number;
  claimableResets: number;
  /** Whether the window the run started in is still open. */
  firstWindowOpen: boolean;
  ceilingAtMs: number | undefined;
  usedAtWindowEndPercent: number;
  readonly claimsMs: number[];
}

/** Close the window the run started in, once, recording what it used. */
function closeFirstWindow({ plan }: { plan: PlanState }): void {
  if (plan.firstWindowOpen) {
    plan.firstWindowOpen = false;
    plan.usedAtWindowEndPercent = plan.usedPercent;
  }
}

/** Note the hour the window the run started in first reached its ceiling. */
function noteCeiling({ atMs, plan }: { atMs: number; plan: PlanState }): void {
  if (plan.firstWindowOpen && plan.ceilingAtMs === undefined && plan.ceilingPercent - plan.usedPercent <= EPSILON) {
    plan.ceilingAtMs = atMs;
  }
}

/** Roll every window whose reset has passed, returning the ids that reopened, earliest reset first. */
function rollResets({ atMs, plans }: { atMs: number; plans: readonly PlanState[] }): readonly string[] {
  const rolled: { id: string; resetMs: number }[] = [];
  for (const plan of plans) {
    if (plan.resetMs > atMs) {
      continue;
    }
    rolled.push({ id: plan.id, resetMs: plan.resetMs });
    closeFirstWindow({ plan });
    while (plan.resetMs <= atMs) {
      plan.resetMs += CODEX_WEEK_MS;
    }
    plan.usedPercent = 0;
  }
  return rolled.toSorted((left, right) => left.resetMs - right.resetMs).map((entry) => entry.id);
}

/** The plan a slice goes to: the one furthest behind its level line among those with room, ties by id. */
function nextPlan({ atMs, plans }: { atMs: number; plans: readonly PlanState[] }): PlanState | undefined {
  let best: { plan: PlanState; headroom: number } | undefined;
  for (const plan of plans) {
    if (plan.ceilingPercent - plan.usedPercent <= EPSILON) {
      continue;
    }
    const headroom = codexLevelLineHeadroom({
      ceilingPercent: plan.ceilingPercent,
      nowMs: atMs,
      resetMs: plan.resetMs,
      usedPercent: plan.usedPercent,
    });
    if (best === undefined || headroom > best.headroom) {
      best = { headroom, plan };
    }
  }
  return best?.plan;
}

/** Claim a free reset for a plan at its ceiling that holds one, as the chair tick's `codex reset --at-limit` does. */
function claimAtBar({ atMs, plan }: { atMs: number; plan: PlanState }): void {
  noteCeiling({ atMs, plan });
  if (plan.ceilingPercent - plan.usedPercent <= EPSILON && plan.claimableResets > 0) {
    closeFirstWindow({ plan });
    plan.claimsMs.push(atMs);
    plan.claimableResets -= 1;
    plan.usedPercent = 0;
    plan.resetMs = atMs + CODEX_WEEK_MS;
  }
}

/** Route one hour's demand, claiming a free reset where a plan sits at its ceiling; returns the points left unmet. */
function routeHour({ atMs, demand, plans }: { atMs: number; demand: number; plans: readonly PlanState[] }): number {
  // A plan already at its bar is never routed to, so its claim is made first — else one that STARTS capped would hold
  // its resets unclaimed for ever and read as a spell the chair's next tick prevents.
  for (const plan of plans) {
    claimAtBar({ atMs, plan });
  }
  let unmet = 0;
  for (let slice = 0; slice < SLICES_PER_HOUR; slice += 1) {
    let left = demand / SLICES_PER_HOUR;
    while (left > EPSILON) {
      const plan = nextPlan({ atMs, plans });
      if (plan === undefined) {
        break;
      }
      const taken = Math.min(left, plan.ceilingPercent - plan.usedPercent);
      plan.usedPercent += taken;
      left -= taken;
      claimAtBar({ atMs, plan });
    }
    unmet += Math.max(0, left);
  }
  return unmet;
}

/**
 * Simulate the Codex plans' week: every dry spell that starts inside the horizon, each followed to its end, and what
 * each plan's current window did before it ended.
 *
 * @param plans every routable plan, as the projection starts it
 * @param nowMs the epoch millisecond the projection starts at
 * @param demandPerHour weekly-window points drawn per hour across all plans
 * @param horizonHours how far ahead a spell may start
 * @returns the dry spells, in order — a spell still running a week past the horizon ends there, owned by the plan
 *   with the earliest reset — and one outcome per plan, in the order given; a window still open when the run stops
 *   reads its use at that hour
 */
export function simulateCodexWeek({
  demandPerHour,
  horizonHours,
  nowMs,
  plans,
}: {
  demandPerHour: number;
  horizonHours: number;
  nowMs: number;
  plans: readonly CodexWeekPlan[];
}): CodexWeekRun {
  const states: PlanState[] = plans.map((plan) => ({
    ...plan,
    ceilingAtMs: undefined,
    claimsMs: [],
    firstWindowOpen: true,
    usedAtWindowEndPercent: plan.usedPercent,
  }));
  const { spells, unmetPoints } = drySpellsOf({ demandPerHour, horizonHours, nowMs, states });
  for (const plan of states) {
    closeFirstWindow({ plan });
  }
  return {
    plans: states.map((plan) => ({
      ceilingAtMs: plan.ceilingAtMs,
      claimsMs: [...plan.claimsMs],
      id: plan.id,
      usedAtWindowEndPercent: plan.usedAtWindowEndPercent,
    })),
    spells,
    unmetPoints,
  };
}

/**
 * Run the hours over `states`, mutating them, and return every dry spell and the demand no plan took inside the
 * horizon — hours run past it only to close a spell are never counted.
 */
function drySpellsOf({
  demandPerHour,
  horizonHours,
  nowMs,
  states,
}: {
  demandPerHour: number;
  horizonHours: number;
  nowMs: number;
  states: PlanState[];
}): { readonly spells: readonly CodexWeekSpell[]; readonly unmetPoints: number } {
  const spells: CodexWeekSpell[] = [];
  let unmetPoints = 0;
  let open: OpenSpell | undefined;
  const lastHour = horizonHours + CODEX_WEEK_MS / HOUR_MS;
  for (let hour = 0; hour < lastHour; hour += 1) {
    const atMs = nowMs + hour * HOUR_MS;
    const reopened = rollResets({ atMs, plans: states });
    if (open !== undefined && reopened.length > 0) {
      spells.push({ endMs: atMs, endedById: reopened[0]!, hours: open.hours, startMs: open.startMs });
      open = undefined;
    }
    if (open === undefined && hour >= horizonHours) {
      break;
    }
    const step = stepHour({ atMs, demandPerHour, open, states });
    if (hour < horizonHours) {
      unmetPoints += step.unmet;
    }
    if (step.closed !== undefined) {
      spells.push(step.closed);
    }
    open = step.open;
  }
  if (open !== undefined) {
    spells.push(runningSpell({ endMs: nowMs + lastHour * HOUR_MS, open, states }));
  }
  return { spells, unmetPoints };
}

/** A dry spell still running: when it began and how many hours it has lasted so far. */
interface OpenSpell {
  readonly startMs: number;
  readonly hours: number;
}

/** Route one hour, and say which spell that hour closes, if any, and which is still open after it. */
function stepHour({
  atMs,
  demandPerHour,
  open,
  states,
}: {
  atMs: number;
  demandPerHour: number;
  open: OpenSpell | undefined;
  states: readonly PlanState[];
}): { closed: CodexWeekSpell | undefined; open: OpenSpell | undefined; unmet: number } {
  const unmet = routeHour({ atMs, demand: demandPerHour, plans: states });
  const dry = unmet > EPSILON && states.every((plan) => plan.ceilingPercent - plan.usedPercent <= EPSILON);
  if (dry) {
    const extended =
      open === undefined ? { hours: 1, startMs: atMs } : { hours: open.hours + 1, startMs: open.startMs };
    return { closed: undefined, open: extended, unmet };
  }
  if (open === undefined) {
    return { closed: undefined, open: undefined, unmet };
  }
  // Only a reset gives a capped plan room, so this is demand reaching zero; the spell ends with no plan's reset.
  return {
    closed: { endMs: atMs, endedById: "no reset", hours: open.hours, startMs: open.startMs },
    open: undefined,
    unmet,
  };
}

/** A spell still running past the simulated week, ended there and owned by the plan with the earliest reset. */
function runningSpell({
  endMs,
  open,
  states,
}: {
  endMs: number;
  open: OpenSpell;
  states: readonly PlanState[];
}): CodexWeekSpell {
  const earliest = states.toSorted((left, right) => left.resetMs - right.resetMs)[0];
  return { endMs, endedById: earliest === undefined ? "none" : earliest.id, hours: open.hours, startMs: open.startMs };
}
