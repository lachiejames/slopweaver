/**
 * The ceilings reading's shared test builders: a machine reading, a read Claude plan, a Codex destination and the
 * plan inputs holding them, used by the `ceilings/` tests and the other capacity ceilings tests beside them.
 */
import type { ClaudePlanInput, MachineCeilingInput, PlanCeilingInputs } from "../../../capacity/ceilings.js";
import type { CodexPlanInput } from "../../../capacity/codexCeiling.js";
import type { ClaudeWindowStatus } from "../../../claude/contracts.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

export const NOW = "2026-09-28T09:00:00.000Z";

/** A pause whose week the reading before it carried. */
export const pause = {
  sinceIso: "2026-09-28T07:13:00.000Z",
  weekAtPause: {
    available: 100,
    kind: "read",
    readAtIso: "2026-09-28T07:05:00.000Z",
    resetAtIso: "2026-09-29T22:00:00.000Z",
    used: 80,
  },
} as const;

/**
 * A machine reading, free at load 2.2 of 22 with idle unread unless a case says otherwise.
 *
 * @returns the machine ceiling input with the overrides laid over the defaults
 */
export function machine(over: Partial<MachineCeilingInput> = {}): MachineCeilingInput {
  return { hold: false, holdSubjects: [], idlePct: null, load1: 2.2, loadHold: 22, ...over };
}

/**
 * A read Claude plan at these utilisations (0..1).
 *
 * @returns the read Claude plan input
 */
export function claude({
  alias,
  fiveHour,
  sevenDay,
  fable,
  status = "allowed",
  usageLimitPercent = 100,
}: {
  alias: string;
  fiveHour: number;
  sevenDay: number;
  fable?: number;
  status?: ClaudeWindowStatus;
  usageLimitPercent?: UsageLimitPercent;
}): ClaudePlanInput {
  const window = ({ utilization }: { utilization: number }) => ({
    resetAtIso: "2026-10-01T00:00:00.000Z",
    status,
    utilization,
  });
  return {
    account: `${alias}@example.test`,
    gauge: {
      alias,
      allowance: WEEKLY_WINDOW,
      fiveHour: window({ utilization: fiveHour }),
      observedAtIso: NOW,
      sevenDay: window({ utilization: sevenDay }),
      usageLimitPercent,
      ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
    },
    kind: "read",
  };
}

/**
 * A Codex destination with one weekly window at this percentage.
 *
 * @returns the Codex plan input
 */
export function codex({
  alias,
  used,
  usageLimitPercent = 100,
}: {
  alias: string;
  used: number;
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanInput {
  return {
    account: `${alias}@example.test`,
    alias,
    exclusion: null,
    freeResets: null,
    usageLimitPercent,
    windows: [{ label: "weekly", resetAtIso: "2026-10-03T00:00:00.000Z", usedPercent: used }],
  };
}

/**
 * Both providers' inputs, empty unless a case fills them.
 *
 * @returns the plan ceiling inputs with the overrides laid over the empty defaults
 */
export function plans(over: Partial<PlanCeilingInputs> = {}): PlanCeilingInputs {
  return {
    claude: [],
    claudeThresholds: DEFAULT_THRESHOLDS.claude,
    codex: [],
    codexRoutedAlias: null,
    problems: [],
    ...over,
  };
}
