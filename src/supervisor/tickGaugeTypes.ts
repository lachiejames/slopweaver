/**
 * The plan gauge as one sweep tick carries it: each plan's standing, and where the next spawn of each class goes.
 *
 * Pure types, split out of `./tickTypes.ts` along the gauge's own seam. The draft that fills them is
 * `./tickGaugeDraft.ts`, the schema that reads them back `./tickGaugeSchema.ts`.
 */

import type { ClaudeThresholdFields } from "../plans/thresholds.js";

/**
 * One plan's standing in the Claude gauge, which is what decides where a spawn may go.
 *
 * @internal — read by the tick ledger and its own tests; nothing outside it names it.
 */
export interface GaugePlanFacts {
  readonly plan: string;
  readonly weekPct: number;
  readonly fablePct: number;
  /** When the Fable week resets, on its own clock. Absent on a row recorded before each window carried its own. */
  readonly fableResetsIso?: string | undefined;
  /** Absent on a plan with no five-hour limit — the Ultra shape (`src/claude/contracts.ts`). */
  readonly fiveHourPct?: number | undefined;
  /** When the five-hour window resets; absent with {@link fiveHourPct}, or on a row recorded before. */
  readonly fiveHourResetsIso?: string | undefined;
  /** When the ALL-MODELS seven-day window resets. Each window resets on its own clock, so each carries its own. */
  readonly resetsIso: string;
  /**
   * The owner's usage limit on this plan, which lowers the bar a spawn is refused at below the routing bar.
   * Absent on a reading that carried no usage policy, or on a row recorded before the gauge carried it.
   */
  readonly usageLimitPercent?: number | undefined;
}

/**
 * A fresh plan with no Fable week, by its all-models week alone — that week alone can put a chair at the
 * routing bar.
 *
 * @internal — read by the tick ledger and its own tests.
 */
export type GaugeWeekOnlyFacts = Pick<GaugePlanFacts, "plan" | "usageLimitPercent" | "weekPct">;

/**
 * The plan gauge: every readable plan, and where the next spawn of each class would go.
 *
 * @internal — read by the tick ledger and its own tests; nothing outside it names it.
 */
export interface GaugeFacts {
  readonly plans: readonly GaugePlanFacts[];
  /** Each fresh plan with no complete row, by its all-models week. Absent on a row recorded before the gauge carried it. */
  readonly weekOnlyPlans?: readonly GaugeWeekOnlyFacts[] | undefined;
  /** The plan the next all-models spawn routes to, or `null` when none can take one. */
  readonly nextAllModels: string | null;
  /** The plan the next Fable spawn routes to, or `null` when none can take one. */
  readonly nextFable: string | null;
  /**
   * The plan the chair's successor routes to, ranked as the chair's own seat is, its Fable week lined up as a Fable
   * seat is gated, or `null` when none can take one. ABSENT only on a row captured before the gauge named it, which the chair's cadence reads
   * as an unmeasured route rather than borrowing `nextFable`, a route the chair would not take.
   */
  readonly nextChair?: string | null | undefined;
  /**
   * Every other plan level with `nextChair` within one point of chair headroom (`../claude/loadBalance.ts`'s
   * `chairLevelWith`). ABSENT when no chair route was eligible, or on a row captured before the gauge carried it.
   */
  readonly chairLevelWith?: readonly string[] | undefined;
  /** Every `REACT NOW —` line the gauge printed, verbatim: each already names its own window and remedy. */
  readonly reactNowLines: readonly string[];
  /**
   * The gauge's own `PLAN` line for EVERY configured plan (`src/claude/planReadingRender.ts`), verbatim — each
   * window with its own reset, a paused or unreadable plan said. Absent on a row recorded before the gauge
   * printed them.
   */
  readonly planLines?: readonly string[] | undefined;
  /**
   * The Claude thresholds the gauge judged this reading under, in the register's own spelling, so the chair's
   * cadence judged off this row later uses the same bars (`src/plans/thresholds.ts`). Absent only on a row
   * recorded before the gauge carried them, which `supervisor/chairCadenceThresholds.ts` reads as the defaults
   * of the time — the only values that could have applied.
   */
  readonly thresholds?: ClaudeThresholdFields | undefined;
}
