/**
 * Ceilings readings `fleet-runs-dry`'s tests judge: an open machine, Claude and Codex plans spent until a named
 * reset, and the reading that carries them — each shaped as `buildCeilingsReading` emits it, so the strict schema
 * reads every one back.
 */
import type { Ceiling, CeilingsReading } from "../../../capacity/ceilings.js";
import type { PlanProvider, RegisteredPlan } from "../../../plans/types.js";
import {
  CODEX_MONTHLY_SPEND_NOT_MEASURED,
  type PlanAllowanceKind,
  type UsageLimitPercent,
} from "../../../plans/usageLimit.js";

/** Routing bars below 100, under which a window at its whole `available` is proof it is spent. */
export const ROUTING_BARS = { claudeFiveHour: 95, claudeWeek: 98, codex: 90 } as const;

/** The instant every test judges at. */
export const NOW = "2026-11-05T10:00:00.000Z";

/** Six hours past {@link NOW}: the first plan's reset in {@link dryReading}. */
export const SIX_HOURS = "2026-11-05T16:00:00.000Z";

/** Twenty hours past {@link NOW}: the later plan's reset in {@link dryReading}. */
export const TWENTY_HOURS = "2026-11-06T06:00:00.000Z";

/** The machine, open at half its load hold. */
export const OPEN_MACHINE: Ceiling = {
  account: null,
  freeResets: null,
  headroom: 0.5,
  id: "machine",
  kind: "machine",
  reason: null,
  status: "open",
  windows: [{ available: 22, resetAtIso: null, used: 11, window: "load1" }],
};

/**
 * A Claude plan refused at its spent week, which resets at `resetAtIso`.
 *
 * @param alias the plan's configured alias
 * @param resetAtIso when its week resets
 * @returns the ceiling
 */
export function spentClaude({ alias, resetAtIso }: { alias: string; resetAtIso: string }): Ceiling {
  return {
    account: `${alias} (acme)`,
    freeResets: null,
    headroom: 0,
    id: `claude:${alias}`,
    kind: "claude",
    reason: "seven-day at 100%",
    status: "refusing",
    windows: [
      { available: 100, resetAtIso: "2026-11-05T12:00:00.000Z", used: 40, window: "five-hour" },
      { available: 100, resetAtIso, used: 100, window: "seven-day" },
    ],
  };
}

/**
 * A Codex plan at the owner's usage limit on its weekly window, which resets at `resetAtIso`.
 *
 * @param alias the plan's configured alias
 * @param resetAtIso when its weekly window resets
 * @returns the ceiling
 */
export function cappedCodex({ alias, resetAtIso }: { alias: string; resetAtIso: string }): Ceiling {
  return {
    account: `${alias} (acme)`,
    freeResets: 2,
    headroom: 0,
    id: `codex:${alias}`,
    kind: "codex",
    reason: "weekly at its 30% usage limit",
    status: "at-usage-limit",
    windows: [{ available: 30, resetAtIso, used: 30, window: "weekly" }],
  };
}

/** A Codex plan on monthly spend, which no router takes. */
export const MONTHLY_CODEX: Ceiling = {
  account: "monthly (acme)",
  freeResets: null,
  headroom: null,
  id: "codex:monthly",
  kind: "codex",
  reason: CODEX_MONTHLY_SPEND_NOT_MEASURED,
  status: "unreadable",
  windows: [],
};

/**
 * A reading of `ceilings` observed at `observedAtIso`, with no route and no problem.
 *
 * @param ceilings the machine and every plan, in reading order
 * @param observedAtIso when it was read
 * @returns the reading
 */
export function readingOf({
  ceilings,
  observedAtIso = NOW,
}: {
  ceilings: readonly Ceiling[];
  observedAtIso?: string;
}): CeilingsReading {
  return { ceilings, lowest: null, observedAtIso, problems: [], routes: [], selectedRoute: null };
}

/**
 * One configured plan as the register holds it: a weekly-window subscription unless told otherwise.
 *
 * @param provider which provider serves it
 * @param alias the plan's configured alias
 * @param usageLimitPercent the share of its allowance the owner lets Slopweaver take
 * @param allowance what its allowance is measured in
 * @returns the register row
 */
export function registered({
  provider,
  alias,
  usageLimitPercent = 100,
  allowance = "weekly-window",
}: {
  provider: PlanProvider;
  alias: string;
  usageLimitPercent?: UsageLimitPercent;
  allowance?: PlanAllowanceKind;
}): RegisteredPlan {
  return { alias, allowance: { kind: allowance }, provider, storeDir: `/stores/${alias}`, usageLimitPercent };
}

/** The register {@link dryReading} was taken over: two Claude plans and one Codex plan at its 30% limit. */
export const DRY_REGISTER: readonly RegisteredPlan[] = [
  registered({ alias: "plan-one", provider: "claude" }),
  registered({ alias: "plan-two", provider: "claude" }),
  registered({ alias: "codex-one", provider: "codex", usageLimitPercent: 30 }),
];

/**
 * Every plan spent: Claude's two weeks reset in twenty and six hours, Codex's week in twenty.
 *
 * @returns the reading, observed at {@link NOW}
 */
export function dryReading(): CeilingsReading {
  return readingOf({
    ceilings: [
      OPEN_MACHINE,
      spentClaude({ alias: "plan-one", resetAtIso: TWENTY_HOURS }),
      spentClaude({ alias: "plan-two", resetAtIso: SIX_HOURS }),
      cappedCodex({ alias: "codex-one", resetAtIso: TWENTY_HOURS }),
    ],
  });
}
