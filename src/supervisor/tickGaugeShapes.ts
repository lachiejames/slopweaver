/**
 * The `claude gauge --json` slice `slopweaver supervisor tick-draft` reads, and the two functions that turn it
 * back into the producer's own gauge type and the tick's plan rows. Split from `./tickDraftShapes.ts` when the
 * chair's reading and its unread probe joined the slice and that file crossed the file-size ratchet, along the
 * seam it already had: every producer slice there, the gauge's here, because the gauge is the one slice that
 * also rebuilds a producer type rather than only reading fields.
 */
import { z } from "zod";

import { hasLineBreak } from "#lib/lineBreaks.js";
import {
  type ClaudeAccountGauge,
  type ClaudePlanGauge,
  type ClaudeWindowReading,
  claudePlanGauge,
} from "../claude/contracts.js";
import { PLAN_LINE_PREFIX } from "../claude/planReadingRender.js";
import { isUsageLimitPercent, type UsageLimitPercent } from "../plans/usageLimit.js";
import { type DraftFrame, isoInstant } from "./tickDraftShapes.js";
import { claudeThresholdFieldsSchema } from "./tickGaugeSchema.js";
import type { GaugePlanFacts, GaugeWeekOnlyFacts } from "./tickGaugeTypes.js";

/** One rate-limit window, as the gauge document carries it. */
const windowSlice = z.object({
  resetAtIso: isoInstant,
  status: z.enum(["allowed", "allowed_warning", "rejected"]),
  utilization: z.number(),
});

/** A plan's allowance, as the gauge document carries it. */
const allowanceSlice = z.object({ kind: z.enum(["weekly-window", "monthly-spend"]) });

/** A plan's usage limit, as the gauge document carries it. */
const usageLimitSlice = z.custom<UsageLimitPercent>((value) => isUsageLimitPercent(value));

/** One readable plan's reading, as the gauge document carries it. */
const gaugeReadingSlice = z.object({
  alias: z.string().min(1),
  // The plan's usage policy, which the gauge pairs onto a swept plan's reading (`gaugeRender.ts`'s
  // `planGaugeOutcome`). Optional on a swept plan: one without it is left out of the alerts rather than judged as if
  // it had no limit (`gaugePlansOf`).
  allowance: allowanceSlice.optional(),
  // Absent on a plan with no five-hour limit — the Ultra shape (`src/claude/contracts.ts`).
  fiveHour: windowSlice.optional(),
  observedAtIso: isoInstant,
  sevenDay: windowSlice,
  sevenDayFable: windowSlice.optional(),
  usageLimitPercent: usageLimitSlice.optional(),
});

/**
 * Every plan a capture prints more than one PLAN line for. The gauge writes exactly one line per configured plan,
 * so a repeated alias means the capture is not the gauge's own, and a reader would show that plan twice.
 *
 * @param planLines the capture's PLAN lines
 * @returns one message per repeated alias, empty for a capture that names each plan once
 */
function repeatedPlanLineIssues({ planLines }: { planLines: readonly string[] }): readonly string[] {
  const aliases = planLines.map((line) => line.slice(PLAN_LINE_PREFIX.length).split(":")[0]!);
  const repeated = new Set(aliases.filter((alias, index) => aliases.indexOf(alias) !== index));
  return [...repeated].map((alias) => `plan ${alias} has more than one PLAN line`);
}

/** The slice of `claude gauge --json` the gauge facts map. `ambient.kind` is its `ClaudeAmbientCredentialKind`. */
export const gaugeSlice = z
  .object({
    ambient: z.object({ kind: z.enum(["subscription", "shadowed"]), reason: z.string().min(1) }),
    balance: z
      .object({
        chairLevelWith: z.array(z.string().min(1)).optional(),
        nextAllModels: z.string().min(1).optional(),
        nextChair: z.string().min(1).optional(),
        nextFable: z.string().min(1).optional(),
      })
      .optional(),
    // The pinned chair (`seatBoot.ts`): `active` only when every live session names one plan, and each session's
    // own plan, so a SPLIT chair's plans are each warned about rather than none of them.
    chair: z
      .object({
        active: z.string().min(1).optional(),
        sessions: z.array(z.object({ plan: z.object({ alias: z.string().min(1).optional() }) })),
      })
      .optional(),
    // The chair's PAUSED plan, read beside a fleet-wide sweep for the chair's own warning alone (`gaugeRender.ts`),
    // carrying its own account's usage policy so the chair is judged by that plan's limit. A policy left absent is
    // decoded as the register decodes it (`chairPlanGaugeOf`), so a capture shaped as main wrote it still warns.
    chairReading: gaugeReadingSlice.optional(),
    // That same probe when it FAILED: the plan and why, so the chair is warned its wall is unknown, never silent.
    chairUnread: z.object({ alias: z.string().min(1), problem: z.string().min(1) }).optional(),
    observedAtIso: isoInstant,
    // One line per CONFIGURED plan, the gauge's own (`planReadingRender.ts`): carried verbatim, never re-derived,
    // so each is held to ONE physical line here — a reader splits the capture on line breaks.
    planLines: z.array(
      z
        .string()
        .startsWith(PLAN_LINE_PREFIX)
        .refine((line) => !hasLineBreak({ text: line }), "a PLAN line is one physical line"),
    ),
    plans: z.array(
      z.object({
        alias: z.string().min(1),
        gauge: gaugeReadingSlice.optional(),
        problem: z.string().min(1).optional(),
      }),
    ),
    // The Claude thresholds the gauge judged under (`gaugeRender.ts`). REQUIRED: a capture is the same tree's
    // gauge, run this tick, so one without them is not the gauge's own — only an old LEDGER row may lack them.
    thresholds: claudeThresholdFieldsSchema,
  })
  .superRefine((slice, context) => {
    for (const issue of repeatedPlanLineIssues({ planLines: slice.planLines })) {
      context.addIssue({ code: "custom", message: issue, path: ["planLines"] });
    }
  });

/**
 * A window's spend as the whole percentage the gauge itself prints (`fleetAlert.ts`'s `percent`).
 *
 * @param window the window
 * @returns the rounded percentage
 */
function percentOf({ window }: { window: ClaudeWindowReading }): number {
  return Math.round(window.utilization * 100);
}

/**
 * The producer's own gauge type, rebuilt from the slice so the producer's alert and acceptance functions run
 * over exactly what the gauge printed.
 *
 * @param reading one readable plan's parsed reading
 * @returns the account gauge
 */
export function accountGaugeOf({ reading }: { reading: z.output<typeof gaugeReadingSlice> }): ClaudeAccountGauge {
  return {
    alias: reading.alias,
    observedAtIso: reading.observedAtIso,
    sevenDay: reading.sevenDay,
    ...(reading.fiveHour === undefined ? {} : { fiveHour: reading.fiveHour }),
    ...(reading.sevenDayFable === undefined ? {} : { sevenDayFable: reading.sevenDayFable }),
  };
}

/**
 * The reading paired with the plan's usage policy, as the gauge printed it.
 *
 * @param reading one swept plan's parsed reading
 * @returns the plan gauge, or `undefined` when the reading carried no allowance or no usage limit — never a
 *   reading judged as if it had no limit
 */
export function planGaugeOf({ reading }: { reading: z.output<typeof gaugeReadingSlice> }): ClaudePlanGauge | undefined {
  const { allowance, usageLimitPercent } = reading;
  if (allowance === undefined || usageLimitPercent === undefined) {
    return undefined;
  }
  return { ...accountGaugeOf({ reading }), allowance, usageLimitPercent };
}

/**
 * The chair's paused reading paired with the usage policy it carried, an absent field decoded exactly as the register
 * decodes an account naming none (`claudePlanGauge`): a weekly window at 100%. `chairProbeOf` (`chairBudgetAlert.ts`)
 * writes the account's own policy, so a capture written before it carried one still warns where main did.
 *
 * @param reading the chair's paused reading, as the gauge document carries it
 * @returns the plan gauge the chair is judged by
 */
export function chairPlanGaugeOf({ reading }: { reading: z.output<typeof gaugeReadingSlice> }): ClaudePlanGauge {
  const account = {
    ...(reading.allowance === undefined ? {} : { allowance: reading.allowance }),
    ...(reading.usageLimitPercent === undefined ? {} : { usageLimitPercent: reading.usageLimitPercent }),
  };
  return claudePlanGauge({ account, gauge: accountGaugeOf({ reading }) });
}

/**
 * Every plan the gauge could represent completely, the readable gauges the alerts run over, and what was left.
 *
 * Each window carries its OWN reset — `resetsIso` the all-models week's, `fableResetsIso` and `fiveHourResetsIso`
 * theirs — because each resets on its own clock and a Fable week read against the all-models reset is wrong. A
 * reading that carries no usage policy still gets its row — the percentages are true — but stays out of `gauges`,
 * because the alerts would otherwise rank it as a plan with no usage limit. A fresh reading with no Fable week
 * still carries its all-models week in `weekOnly`, because that week alone can put the chair's plan at the
 * routing bar.
 *
 * @param plans the gauge document's per-plan outcomes
 * @param frame the tick's own frame
 * @returns the complete plan rows, the all-models week of each fresh plan with no complete row, the fresh
 *   readable gauges, and a note per plan left out
 */
export function gaugePlansOf({ plans, frame }: { plans: z.output<typeof gaugeSlice>["plans"]; frame: DraftFrame }): {
  rows: readonly GaugePlanFacts[];
  weekOnly: readonly GaugeWeekOnlyFacts[];
  gauges: readonly ClaudePlanGauge[];
  notes: readonly string[];
} {
  const rows: GaugePlanFacts[] = [];
  const weekOnly: GaugeWeekOnlyFacts[] = [];
  const gauges: ClaudePlanGauge[] = [];
  const notes: string[] = [];
  for (const plan of plans) {
    const fresh = freshReadingOf({ frame, plan });
    if (fresh.kind === "unread") {
      notes.push(fresh.note);
      continue;
    }
    const planGauge = planGaugeOf({ reading: fresh.reading });
    if (planGauge === undefined) {
      notes.push(`${plan.alias} carried no usage policy, so no alert judges it`);
    } else {
      gauges.push(planGauge);
    }
    const account = accountGaugeOf({ reading: fresh.reading });
    const limit = planGauge === undefined ? {} : { usageLimitPercent: planGauge.usageLimitPercent };
    const row = planRowOf({ gauge: account });
    if (row === undefined) {
      notes.push(`${plan.alias} carried no Fable week window, so it has no complete row`);
      weekOnly.push({ plan: account.alias, weekPct: percentOf({ window: account.sevenDay }), ...limit });
      continue;
    }
    rows.push({ ...row, ...limit });
  }
  return { gauges, notes, rows, weekOnly };
}

/**
 * One plan's reading when the gauge read it inside this tick, else why it is left out.
 *
 * @param plan one per-plan outcome of the gauge document
 * @param frame the tick's own frame, whose start a reading must not predate
 * @returns the fresh reading, or the note naming why there is none
 */
function freshReadingOf({
  plan,
  frame,
}: {
  plan: z.output<typeof gaugeSlice>["plans"][number];
  frame: DraftFrame;
}): { kind: "read"; reading: z.output<typeof gaugeReadingSlice> } | { kind: "unread"; note: string } {
  if (plan.gauge !== undefined) {
    if (Date.parse(plan.gauge.observedAtIso) < Date.parse(frame.startedIso)) {
      return {
        kind: "unread",
        note: `${plan.alias} was read at ${plan.gauge.observedAtIso}, before this tick started`,
      };
    }
    return { kind: "read", reading: plan.gauge };
  }
  if (plan.problem === undefined) {
    return { kind: "unread", note: `${plan.alias} was not read, and the gauge carried no reading and no reason` };
  }
  return { kind: "unread", note: `${plan.alias} was not read: ${plan.problem}` };
}

/**
 * The complete row a reading makes, each window on its own reset.
 *
 * @param gauge the plan's account gauge
 * @returns the row, or `undefined` when the reading carried no Fable week window
 */
function planRowOf({ gauge }: { gauge: ClaudeAccountGauge }): GaugePlanFacts | undefined {
  if (gauge.sevenDayFable === undefined) {
    return undefined;
  }
  return {
    fablePct: percentOf({ window: gauge.sevenDayFable }),
    fableResetsIso: gauge.sevenDayFable.resetAtIso,
    ...(gauge.fiveHour === undefined
      ? {}
      : { fiveHourPct: percentOf({ window: gauge.fiveHour }), fiveHourResetsIso: gauge.fiveHour.resetAtIso }),
    plan: gauge.alias,
    resetsIso: gauge.sevenDay.resetAtIso,
    weekPct: percentOf({ window: gauge.sevenDay }),
  };
}
