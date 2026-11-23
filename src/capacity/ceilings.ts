/**
 * ONE reading of what is unused right now on every ceiling a seat spends — the machine's load against its hold,
 * each Claude plan's five-hour and seven-day windows, each Codex plan's windows — and which of them binds.
 *
 * The owner wants capacity maxed: no plan usage left on the table across Claude, Codex and machine
 * resources. The fill step used to read the machine alone, so a sweep could stop at a free machine with four
 * Claude weeks at 35% and never say which ceiling it stopped at.
 *
 * ## Plans are ROUTES, not a conjunction
 *
 * A seat needs the machine AND one plan the router would send it to — never every plan. Taking the minimum
 * over every plan would let one spent plan stop the fleet while another sits at 35%. So each provider
 * contributes ONE route, through the plan its own ranker picks (`rankClaudeBudgets` for an all-models spawn,
 * `assessCodexFleet`'s ranking for Codex), and a route's headroom is the smaller of the machine's and that
 * plan's. The selected route is the one with the most headroom; its limiting ceiling is the LOWEST unused
 * ceiling — the one the sweep fills to. Every threshold is the ranker's own, off the plan register
 * (`../plans/thresholds.ts`): nothing here re-derives Claude's spend cap or Codex's pause bar.
 *
 * ## Units, and what zero and null mean
 *
 * A plan window is `used` of `available = 100`, both providers alike (Claude's 0..1 fraction is scaled here,
 * once) — except a WEEKLY window on a plan the owner set a usage limit on, whose `available` is that limit, so its
 * headroom is what is left of the share the owner lets Slopweaver take rather than of the provider's whole week. A
 * five-hour window is never lowered: the usage limit is a weekly allowance. The machine is `load1` of its load hold. `headroom` is 0..1: ZERO is measured exhaustion — a hold, a
 * paused or refusing plan — and NULL is no claim at all, a plan whose reading failed. An unreadable plan never
 * reads as a spent one, and never as a free one.
 *
 * Pure: provider readings in, one reading out. `./readCeilings.ts` takes them; `./ceilingsRender.ts` prints them;
 * `./admission.ts` judges the routes, the lowest ceiling and whether a seat may start; `./ceilingsSchema.ts` reads a
 * recorded one back.
 */
import type { ClaudeAccountGauge, ClaudeExclusionKind, ClaudePlanGauge } from "../claude/contracts.js";
import { rankClaudeBudgets } from "../claude/loadBalance.js";
import type { ClaudeSpendVerdict } from "../claude/spendPolicy.js";
import { IDLE_HOLD_FLOOR_PCT } from "../live/machine/capacityHolds.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { judgedRoutes, routeThrough } from "./admission.js";
import { type CodexPlanInput, codexCeiling } from "./codexCeiling.js";
import { OPEN_EDGE_HEADROOM, share, usedOf, windowsHeadroom } from "./windowArithmetic.js";

/** Which spend a ceiling bounds. */
type CeilingKind = "machine" | "claude" | "codex";

/**
 * A ceiling's state. `held` is the machine's own hold; `paused` a plan taken out on purpose; `at-usage-limit` one
 * whose weekly window reached the usage limit the owner set on it — the owner's own policy, never provider evidence;
 * `refusing` one its router will not send a seat to now for any other reason; `unreadable` one whose reading failed
 * or, for a monthly-spend plan, whose spend has no fresh reading (Claude) or no reader at all (Codex).
 */
type CeilingStatus = "open" | "held" | "paused" | "at-usage-limit" | "refusing" | "unreadable";

/** One window of one ceiling, as used of available. */
export interface CeilingWindow {
  /** `load1` for the machine; the provider's own name for a plan window. */
  readonly window: string;
  readonly used: number;
  readonly available: number;
  /** When the window resets; `null` for the machine, which has no reset, and a window that named none. */
  readonly resetAtIso: string | null;
}

/** One ceiling, read now. */
export interface Ceiling {
  /** `machine`, `claude:<alias>` or `codex:<alias>`. */
  readonly id: string;
  readonly kind: CeilingKind;
  readonly status: CeilingStatus;
  readonly windows: readonly CeilingWindow[];
  /** Unused share after routing policy, 0..1; `null` when unknown, never zero by default. */
  readonly headroom: number | null;
  /** Why it is not open, in the reader's own words; `null` when it is. */
  readonly reason: string | null;
  /**
   * Whose plan this is, as the provider's account cell renders it (`renderAccountCell`, `codexLiveAccountText`) —
   * `null` for the machine. Absent only on a capture recorded before the field existed.
   */
  readonly account?: string | null | undefined;
  /**
   * Free usage-limit resets the plan holds unused; `null` when this reading does not read them (the machine, and
   * every Claude plan — the gauge never calls the reset endpoint). Absent only on an older capture.
   */
  readonly freeResets?: number | null | undefined;
  /**
   * A paused Claude plan's pause: since when, and its week as the last reading before the pause saw it — the plan is
   * never probed while paused, so that is the only reset anybody measured. Absent on every other ceiling, and on a
   * capture recorded before the field.
   */
  readonly pause?: ClaudePauseEvidence | undefined;
}

/**
 * A paused plan's seven-day window as the `machine capacity` reading in force at the pause instant recorded it, or
 * why there is none to show.
 */
export type PausedWeekAtPause =
  | {
      readonly kind: "read";
      readonly used: number;
      readonly available: number;
      readonly resetAtIso: string | null;
      /** The instant that earlier reading was observed. */
      readonly readAtIso: string;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** Since when a Claude plan has been paused, and what its week looked like going in. */
interface ClaudePauseEvidence {
  readonly sinceIso: string;
  readonly weekAtPause: PausedWeekAtPause;
}

/** One way a seat could start now: the machine plus the plan one provider's router picks. */
export interface CeilingRoute {
  readonly driver: "claude" | "codex";
  readonly planCeilingId: string;
  /** Whichever of the machine and that plan has less headroom — the machine on a tie. */
  readonly limitingCeilingId: string;
  readonly headroom: number;
}

/** The whole reading. */
export interface CeilingsReading {
  readonly observedAtIso: string;
  readonly ceilings: readonly Ceiling[];
  readonly routes: readonly CeilingRoute[];
  /** The route with the most headroom above zero, Claude first on a tie; `null` when none has any. */
  readonly selectedRoute: CeilingRoute | null;
  /** The ceiling the sweep fills to — see `./admission.ts`; `null` when nothing can be named. */
  readonly lowest: string | null;
  /** What the readers could not see, verbatim. */
  readonly problems: readonly string[];
}

/** The machine's side, off the capacity report. */
export interface MachineCeilingInput {
  /** `null` when the load could not be read. */
  readonly load1: number | null;
  readonly loadHold: number;
  /** `top`'s idle percentage, `null` when it could not be read — it clears a load over its hold. */
  readonly idlePct: number | null;
  readonly hold: boolean;
  readonly holdSubjects: readonly string[];
}

/**
 * One configured Claude plan: its reading, its monthly spend verdict, its declared pause, or why no reading came back
 * — each with its account cell already rendered, so no organisation id reaches this module.
 */
export type ClaudePlanInput =
  | { readonly kind: "read"; readonly gauge: ClaudePlanGauge; readonly account: string }
  | { readonly kind: "spend"; readonly alias: string; readonly verdict: ClaudeSpendVerdict; readonly account: string }
  | {
      readonly kind: "paused";
      readonly alias: string;
      readonly reason: string;
      readonly account: string;
      readonly pause: ClaudePauseEvidence;
    }
  | { readonly kind: "unreadable"; readonly alias: string; readonly problem: string; readonly account: string };

/** Both providers' readings, which `./readCeilings.ts` takes in one pass. */
export interface PlanCeilingInputs {
  readonly claude: readonly ClaudePlanInput[];
  /** The register's Claude thresholds, off the same read as `claude`, which the all-models ranker judges by. */
  readonly claudeThresholds: ClaudeThresholds;
  readonly codex: readonly CodexPlanInput[];
  /** The destination `assessCodexFleet` would send new work to, or `null` when it would send none. */
  readonly codexRoutedAlias: string | null;
  readonly problems: readonly string[];
}

/** Whether a new seat may start now, and which ceiling binds it — the idle-capacity gate's question. */
export type CeilingsAdmission =
  /** The machine holds: nothing may start, whatever the plans say. */
  | { readonly kind: "held" }
  /** The machine could not be read, so admission is unknown. */
  | { readonly kind: "unreadable" }
  /** Every route is measured spent. `binding` names the lowest one when one can be named. */
  | { readonly kind: "capped"; readonly binding: string | null }
  /** A seat could start now; `binding` is the ceiling it would fill. */
  | { readonly kind: "free"; readonly binding: string };

/**
 * The machine's ceiling: a hold is zero whatever the load says, because a memory, cpu, boots or disk hold holds
 * every discretionary spawn.
 */
function machineCeiling({ machine }: { machine: MachineCeilingInput }): Ceiling {
  const windows: CeilingWindow[] = [];
  if (machine.load1 !== null) {
    windows.push({ available: machine.loadHold, resetAtIso: null, used: machine.load1, window: "load1" });
  }
  const unowned = { account: null, freeResets: null } as const;
  if (machine.hold) {
    const reason = `hold on ${machine.holdSubjects.join(" and ")}`;
    return { ...unowned, headroom: 0, id: "machine", kind: "machine", reason, status: "held", windows };
  }
  if (machine.load1 === null) {
    const reason = "the 1-minute load could not be read";
    return { ...unowned, headroom: null, id: "machine", kind: "machine", reason, status: "unreadable", windows };
  }
  // The load hold clears on idle (`../live/machine/capacityHolds.ts`'s `cpuLoadHolding`), so an un-held machine
  // has the headroom of whichever CPU reading has more left: a load past its hold at 40% idle is not zero seats.
  const loadHeadroom = 1 - machine.load1 / machine.loadHold;
  let idleHeadroom = 0;
  if (machine.idlePct !== null) {
    idleHeadroom = (machine.idlePct - IDLE_HOLD_FLOOR_PCT) / (100 - IDLE_HOLD_FLOOR_PCT);
  }
  // Zero is a hold, so an open machine at the edge (load at its hold, idle at the floor exactly) keeps the
  // smallest share there is rather than reading as one.
  return {
    ...unowned,
    headroom: Math.max(OPEN_EDGE_HEADROOM, share({ value: Math.max(loadHeadroom, idleHeadroom) })),
    id: "machine",
    kind: "machine",
    reason: null,
    status: "open",
    windows,
  };
}

/**
 * A Claude gauge's windows as used of their available share — 100, or a weekly window's usage limit (§ Units); the
 * Fable week is shown but never counted in an all-models headroom.
 */
function claudeWindows({ gauge }: { gauge: ClaudePlanGauge }): {
  readonly all: readonly CeilingWindow[];
  readonly allModels: readonly CeilingWindow[];
} {
  const of = ({
    window,
    name,
    available,
  }: {
    window: ClaudeAccountGauge["sevenDay"];
    name: string;
    available: number;
  }): CeilingWindow => ({
    available,
    resetAtIso: window.resetAtIso,
    used: usedOf({ available, raw: window.utilization * 100 }),
    window: name,
  });
  const weekly = gauge.usageLimitPercent;
  // A plan with no five-hour limit (the Ultra shape, `src/claude/contracts.ts`) carries the week alone.
  const allModels = [
    ...(gauge.fiveHour === undefined ? [] : [of({ available: 100, name: "five-hour", window: gauge.fiveHour })]),
    of({ available: weekly, name: "seven-day", window: gauge.sevenDay }),
  ];
  if (gauge.sevenDayFable === undefined) {
    return { all: allModels, allModels };
  }
  const fable = of({ available: weekly, name: "fable-seven-day", window: gauge.sevenDayFable });
  return { all: [...allModels, fable], allModels };
}

/**
 * The ceiling status a ranker's exclusion maps to: the owner's usage limit is its own status, a plan nothing here
 * measures is unreadable, and every other exclusion — a provider refusal, the routing bar — is `refusing`.
 */
function excludedStatus({ kind }: { kind: ClaudeExclusionKind }): "at-usage-limit" | "refusing" | "unreadable" {
  if (kind === "usage-limit") {
    return "at-usage-limit";
  }
  if (kind === "not-measured") {
    return "unreadable";
  }
  return "refusing";
}

/**
 * A monthly-spend plan's one window: the share of its permitted spend already used, of 100 — no reset, since the
 * reading does not say when the month turns over. Only an open verdict carries a figure.
 */
function monthlySpendWindows({ verdict }: { verdict: ClaudeSpendVerdict }): readonly CeilingWindow[] {
  if (verdict.kind !== "open") {
    return [];
  }
  return [
    {
      available: 100,
      resetAtIso: null,
      used: usedOf({ available: 100, raw: verdict.usedFraction * 100 }),
      window: "monthly-spend",
    },
  ];
}

/**
 * Every Claude plan's ceiling, graded by the all-models ranker over both lanes (`rankClaudeBudgets`), and the plan
 * that ranker routes to — a monthly-spend plan when no weekly one is eligible.
 */
function claudeCeilings({ plans, thresholds }: { plans: readonly ClaudePlanInput[]; thresholds: ClaudeThresholds }): {
  readonly ceilings: readonly Ceiling[];
  readonly routedId: string | null;
} {
  const gauges = plans.flatMap((plan) => (plan.kind === "read" ? [plan.gauge] : []));
  const spends = plans.flatMap((plan) => (plan.kind === "spend" ? [{ alias: plan.alias, verdict: plan.verdict }] : []));
  const ranking = rankClaudeBudgets({ gauges, modelClass: "all-models", spends, thresholds });
  const excluded = new Map(ranking.excluded.map((exclusion) => [exclusion.alias, exclusion]));
  const ceilings = plans.map((plan): Ceiling => {
    // The gauge never reads Claude's reset offer (`../claude/resetStatus.ts`), so a Claude plan's is always unread.
    const owned = { account: plan.account, freeResets: null };
    if (plan.kind === "spend") {
      const id = `claude:${plan.alias}`;
      const windows = monthlySpendWindows({ verdict: plan.verdict });
      const refusal = excluded.get(plan.alias);
      if (refusal !== undefined) {
        const status = excludedStatus({ kind: refusal.kind });
        const headroom = status === "unreadable" ? null : 0;
        return { ...owned, headroom, id, kind: "claude", reason: refusal.reason, status, windows };
      }
      const headroom = windowsHeadroom({ windows });
      return { ...owned, headroom, id, kind: "claude", reason: null, status: "open", windows };
    }
    if (plan.kind === "paused") {
      const reason = `paused: ${plan.reason}`;
      const id = `claude:${plan.alias}`;
      return { ...owned, headroom: 0, id, kind: "claude", pause: plan.pause, reason, status: "paused", windows: [] };
    }
    if (plan.kind === "unreadable") {
      const { problem: reason } = plan;
      const id = `claude:${plan.alias}`;
      return { ...owned, headroom: null, id, kind: "claude", reason, status: "unreadable", windows: [] };
    }
    const { all, allModels } = claudeWindows({ gauge: plan.gauge });
    const id = `claude:${plan.gauge.alias}`;
    const refusal = excluded.get(plan.gauge.alias);
    if (refusal !== undefined) {
      const status = excludedStatus({ kind: refusal.kind });
      // A plan nothing measures is NO claim, never measured exhaustion (§ Units).
      const headroom = status === "unreadable" ? null : 0;
      return { ...owned, headroom, id, kind: "claude", reason: refusal.reason, status, windows: all };
    }
    return {
      ...owned,
      headroom: windowsHeadroom({ windows: allModels }),
      id,
      kind: "claude",
      reason: null,
      status: "open",
      windows: all,
    };
  });
  const top = ranking.ranked[0];
  return { ceilings, routedId: top === undefined ? null : `claude:${top.alias}` };
}

/**
 * Build the reading from the machine's report and both providers' plan readings.
 *
 * @param observedAtIso when the readings were taken
 * @param machine the machine's load, hold and hold subjects
 * @param plans every configured plan of both providers, in configured order, and the Codex routed alias
 * @returns every ceiling, the routes a seat could take, the selected one and the lowest ceiling
 */
export function buildCeilingsReading({
  observedAtIso,
  machine,
  plans,
}: {
  observedAtIso: string;
  machine: MachineCeilingInput;
  plans: PlanCeilingInputs;
}): CeilingsReading {
  const machineOne = machineCeiling({ machine });
  const claude = claudeCeilings({ plans: plans.claude, thresholds: plans.claudeThresholds });
  const codex = plans.codex.map((plan) => codexCeiling({ plan }));
  const codexRouted =
    plans.codexRoutedAlias === null
      ? undefined
      : codex.find((ceiling) => ceiling.id === `codex:${plans.codexRoutedAlias}`);
  const routes = [
    routeThrough({
      driver: "claude",
      machine: machineOne,
      plan: claude.ceilings.find((ceiling) => ceiling.id === claude.routedId),
    }),
    routeThrough({ driver: "codex", machine: machineOne, plan: codexRouted }),
  ];
  return {
    ceilings: [machineOne, ...claude.ceilings, ...codex],
    observedAtIso,
    problems: plans.problems,
    ...judgedRoutes({
      machine: machineOne,
      plans: [...claude.ceilings, ...codex],
      problems: plans.problems,
      routes,
    }),
  };
}
