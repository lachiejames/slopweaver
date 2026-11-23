/**
 * The chair-cadence decision table's shared inputs: the tick's instant, a fresh canon reading, a chair session on a
 * named plan, and a gauge built from `[alias, weekPct, fablePct]` rows. Shared by the sibling test files that each
 * hold one family of the table's rows, so every family judges against the very same chair.
 */
import { DEFAULT_THRESHOLD_FIELDS } from "../../../plans/thresholds.js";
import type {
  ChairCadenceGauge,
  ChairCadenceReason,
  ChairCadenceSession,
  ChairCadenceVerdict,
} from "../../../supervisor/chairCadence.js";
import type { ChairCadenceThresholds } from "../../../supervisor/chairCadenceThresholds.js";
import type { ChairCanonReading } from "../../../supervisor/chairCanon.js";

/** The alert and drifting bars an install that set none judges by. */
export const DEFAULT_CADENCE_THRESHOLDS: ChairCadenceThresholds = {
  alertAtPercent: DEFAULT_THRESHOLD_FIELDS.claude.alertAtPercent,
  driftingSpreadPercent: DEFAULT_THRESHOLD_FIELDS.claude.driftingSpreadPercent,
  routeAtPercent: DEFAULT_THRESHOLD_FIELDS.claude.routeAtPercent,
};

type Reason<K extends ChairCadenceReason["kind"]> = Extract<ChairCadenceReason, { kind: K }>;

/** The hand-off reasons a case expects, judged at the {@link DEFAULT_CADENCE_THRESHOLDS} bars. */
export const atDefaultBars = {
  asymmetric: (fields: Omit<Reason<"plan-asymmetric">, "kind" | "thresholdPoints">): Reason<"plan-asymmetric"> => ({
    ...fields,
    kind: "plan-asymmetric",
    thresholdPoints: DEFAULT_CADENCE_THRESHOLDS.driftingSpreadPercent,
  }),
  near: (fields: Omit<Reason<"plan-window-near">, "kind" | "thresholdPercent">): Reason<"plan-window-near"> => ({
    ...fields,
    kind: "plan-window-near",
    thresholdPercent: DEFAULT_CADENCE_THRESHOLDS.alertAtPercent,
  }),
};

/** The tick's own instant every case judges age against. */
export const NOW = "2026-10-01T12:00:00.000Z";

/**
 * A chair booted an hour before {@link NOW}, on canon main has not changed since. Typed as the MEASURED arm, so a
 * case can spread it with its own `changed` list.
 */
export const FRESH: Extract<ChairCanonReading, { kind: "measured" }> = {
  bootedIso: "2026-10-01T11:00:00.000Z",
  changed: [],
  kind: "measured",
};

/** The boot and installed versions, both current. */
export const CURRENT = { kind: "measured", version: "2.1.283" } as const;

/**
 * A chair session booted on a named plan's setup token, on a Claude Code version.
 *
 * @param plan the alias of the plan the session booted on
 * @param version the Claude Code version the session runs
 * @param canon what the session's loaded canon reads as, fresh unless a case says otherwise
 * @returns the session
 */
export function session({
  plan,
  version,
  canon = FRESH,
}: {
  plan: string;
  version: string;
  canon?: ChairCanonReading;
}): ChairCadenceSession {
  return {
    canon,
    claudeCode: { kind: "measured", version },
    pid: 38858,
    plan: { alias: plan, kind: "token" },
    sessionId: "a0000032",
  };
}

/**
 * A gauge over plans as `[alias, weekPct, fablePct]`, routing the next Fable spawn to `nextChair`.
 *
 * @param plans each plan's row as `[alias, weekPct, fablePct]`
 * @param nextChair where routing sends the next Fable spawn, null when nowhere
 * @param thresholds the alert and drifting bars the gauge was judged under, the install defaults unless a case says
 * @param gap what a PARTIAL read could not see; absent, the gauge is complete
 * @returns the gauge, read
 */
export function gauge({
  plans,
  nextChair,
  thresholds = DEFAULT_CADENCE_THRESHOLDS,
  gap,
  weekOnly,
  usageLimits = {},
}: {
  plans: readonly (readonly [string, number, number])[];
  nextChair: string | null;
  thresholds?: ChairCadenceThresholds;
  gap?: string;
  weekOnly?: readonly { plan: string; weekPct: number; usageLimitPercent?: number }[];
  /** The owner's usage limit per plan alias, for a row whose reading carried one. */
  usageLimits?: Readonly<Record<string, number>>;
}): ChairCadenceGauge {
  return {
    kind: "read",
    nextChair,
    plans: plans.map(([plan, weekPct, fablePct]) => {
      const usageLimitPercent = usageLimits[plan];
      return { fablePct, plan, weekPct, ...(usageLimitPercent === undefined ? {} : { usageLimitPercent }) };
    }),
    thresholds,
    ...(gap === undefined ? {} : { gap }),
    ...(weekOnly === undefined ? {} : { weekOnly }),
  };
}

/** A verdict that said hand off. */
export type HandOffVerdict = Extract<ChairCadenceVerdict, { kind: "hand-off" }>;

/**
 * A verdict a case has just asserted said hand off, narrowed so its lines can be printed. Throws otherwise, so a
 * case that reaches it on a stay fails loudly rather than printing nothing.
 *
 * @param verdict the judged verdict
 * @returns the same verdict, as a hand-off
 */
export function handOffOf({ verdict }: { verdict: ChairCadenceVerdict }): HandOffVerdict {
  if (verdict.kind !== "hand-off") {
    throw new Error(`expected a hand-off verdict, got ${verdict.kind}`);
  }
  return verdict;
}

/**
 * A hand-off whose one reason is a chair one Claude Code behind, with the route the case names.
 *
 * @param route which plan routing picks for the next Fable spawn
 * @returns the verdict
 */
export function behindOne({ route }: { route: HandOffVerdict["route"] }): HandOffVerdict {
  return {
    kind: "hand-off",
    notes: [],
    reasons: [{ boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" }],
    route,
  };
}
