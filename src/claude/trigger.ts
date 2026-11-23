/**
 * The trigger: given what just happened and what every plan has left, decide whether the fleet moves.
 *
 * Pure. It performs no probe, no swap and no write; it composes the pieces that already exist —
 * `transcriptSignal.ts` for what refused a session, `claimResponse.ts` for what that means for the seat
 * that hit it, and `select.ts` for which plan to move to.
 *
 * ## Recover-after-the-wall is the design, not a shortcoming to fix later
 *
 * Two of the four claims can be seen coming and two cannot. A plan-wide window reports its own utilisation
 * on every response, so `five_hour` and `seven_day` are pre-emptable at a threshold. A per-model claim
 * reports NOTHING until it bites: measured, the headers carry `5h` and `7d` utilisation and no
 * per-model figure at all. So a Fable wall on the supervisor chair can only ever be recovered from, never
 * avoided, and the honest goal is to make that recovery automatic and fast rather than to pretend it is
 * avoidable.
 *
 * ## A hold is not the same as headroom
 *
 * The proactive half needs a reading, and the active plan is the one whose store a probe most often cannot
 * read. Those two outcomes are reported as different sentences rather than one, because "hold, it has budget"
 * and "hold, nobody looked" call for opposite responses from a reader.
 *
 * That makes ETA-TO-RECOVER the number this design is judged on, and it has exactly three parts: how long
 * until the wall is NOTICED, plus the swap itself, plus how long a running session takes to pick the new
 * credential up. Only the first is under this code's control, which is why {@link triggerDecision} is
 * written to fire on a signal rather than to wait for the next poll.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { responseToClaim, type SessionSeat } from "./claimResponse.js";
import type { ClaudeLimitSignal, ClaudePlanGauge, ClaudePlanSpend, ClaudeRotationDecision } from "./contracts.js";
import { claudeEffectiveUsageCeiling, monthlyGaugeExclusion, selectClaudeAccount } from "./select.js";

/**
 * What the trigger concluded, and why — the `why` is printed into an event and never carries a credential.
 *
 * @internal — the value {@link triggerDecision} returns; the watch loop branches on it rather than building
 *   one.
 */
export type TriggerOutcome =
  | { readonly act: "rotate"; readonly decision: ClaudeRotationDecision; readonly why: string }
  | { readonly act: "downgrade-model"; readonly why: string }
  | { readonly act: "hold"; readonly why: string };

/**
 * Whether any plan-wide window on the active plan has reached the rotation threshold.
 *
 * The house threshold is `select.ts`'s `spendCapFor`, not a constant, so in a weekly window's last five hours this stops
 * pre-empting and the fleet rides that plan to the wall — which is what the owner asked for.
 * `allowed_warning` is left alone either way: that is the PROVIDER's own approaching-limit signal, and the
 * ruling lifted OUR cap rather than licensing us to ignore what the provider says. It produces no churn,
 * because {@link selectClaudeAccount} answers `stay` while the active plan is still eligible.
 *
 * The bar is the EFFECTIVE ceiling (`select.ts`'s `claudeEffectiveUsageCeiling`), so an active plan at its owner-set
 * usage limit moves the fleet just as one at the house bar does, and says which: the owner's limit is a ceiling
 * the fleet stops at, never something a running loop rides past. A monthly-spend active plan is judged on its spend
 * instead ({@link monthlySpendOutcome}); a gauge of one that reaches here moves the fleet at once.
 *
 * @param gauge the active plan's reading, when there is one
 * @param thresholds the install's Claude thresholds, which set the house bar
 * @returns what crossed — the window, and the usage limit when that is what fired — or undefined
 */
function thresholdCrossed({
  gauge,
  thresholds,
}: {
  gauge: ClaudePlanGauge | undefined;
  thresholds: ClaudeThresholds;
}): string | undefined {
  if (gauge === undefined) {
    return undefined;
  }
  if (monthlyGaugeExclusion({ plan: gauge }) !== undefined) {
    return "a monthly-spend plan's windows (its spend is its measure)";
  }
  for (const [claim, window] of [
    ["five_hour", gauge.fiveHour],
    ["seven_day", gauge.sevenDay],
  ] as const) {
    // A plan with no five-hour limit (the Ultra shape, `contracts.ts`) has no five-hour window to cross.
    if (window === undefined) {
      continue;
    }
    if (window.status === "allowed_warning") {
      return claim;
    }
    // The ceiling is compared on utilization WHATEVER the window's status, exactly as before the limit existed: a
    // `rejected` week at or past the bar still rotates proactively. Asking `claudeWindowExclusion` here instead
    // read such a week as `provider-refused` and HELD on it.
    const ceiling = claudeEffectiveUsageCeiling({
      claim,
      observedAtIso: gauge.observedAtIso,
      resetAtIso: window.resetAtIso,
      thresholds,
      usageLimitPercent: gauge.usageLimitPercent,
    });
    if (window.utilization < ceiling.utilization) {
      continue;
    }
    if (ceiling.source === "usage-limit") {
      return `${claim} usage limit of ${String(gauge.usageLimitPercent)}%`;
    }
    return claim;
  }
  return undefined;
}

/**
 * What the proactive half concludes when the active plan is a monthly-spend plan. Its spend verdict is its whole
 * measure, and it never reports weekly headroom: at its usage limit, past the provider's, or with its reading gone
 * stale, the fleet moves before a wall; and while it is open the fleet still leaves it once a weekly plan is eligible
 * again, because the monthly lane is the fallback (`select.ts`).
 *
 * @param decision what selection concluded over every plan, the active one included
 * @param spend the active plan's spend verdict
 * @returns rotate when the verdict is closed or selection moves the fleet, else hold, with the plan's own spend reason
 */
function monthlySpendOutcome({
  decision,
  spend,
}: {
  decision: ClaudeRotationDecision;
  spend: ClaudePlanSpend;
}): TriggerOutcome {
  const { verdict } = spend;
  if (verdict.kind !== "open") {
    return {
      act: "rotate",
      decision,
      why: `monthly spend ${verdict.kind} (${verdict.reason}) moved the fleet before a wall`,
    };
  }
  if (decision.kind === "rotate") {
    return {
      act: "rotate",
      decision,
      why: `${decision.to} is preferred over monthly spend, which is the fallback lane`,
    };
  }
  return { act: "hold", why: `the active plan is under its monthly usage limit: ${verdict.reason}` };
}

/**
 * Decide what the fleet should do.
 *
 * @param signal what a transcript line just reported, when one did — the REACTIVE half
 * @param gauges every weekly-window plan's latest reading, in configured order — the PROACTIVE half
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick, in configured order
 * @param active the plan the fleet is on now
 * @param reserved the plan held back for the browser
 * @param seat which seat saw the signal, since a per-model wall answers differently for the chair
 * @param thresholds the install's Claude thresholds, off the register the plans came from
 * @returns what to do, with a sentence saying why
 */
export function triggerDecision({
  active,
  gauges,
  reserved,
  seat,
  signal,
  spends,
  thresholds,
}: {
  active?: string;
  gauges: readonly ClaudePlanGauge[];
  reserved?: string;
  seat: SessionSeat;
  signal?: ClaudeLimitSignal;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): TriggerOutcome {
  const select = (): ClaudeRotationDecision =>
    selectClaudeAccount({
      gauges,
      spends,
      thresholds,
      ...(active === undefined ? {} : { active }),
      ...(reserved === undefined ? {} : { reserved }),
    });

  if (signal?.kind === "plan-limit" && signal.claim !== undefined) {
    const response = responseToClaim({ claim: signal.claim, seat });
    if (response === "downgrade-model") {
      // A model wall changes the model, never the plan, so a monthly plan its spend verdict has closed still moves.
      const monthly = monthlyRotation({ active, select, spends });
      if (monthly !== undefined) {
        return monthly;
      }
      return { act: "downgrade-model", why: `${signal.claim} refused a worker — change model, not plan` };
    }
    return { act: "rotate", decision: select(), why: `${signal.claim} refused ${seat}` };
  }

  if (signal?.kind === "ignored") {
    // A line that is not a plan limit holds a weekly plan, as it always has; a monthly plan's spend verdict is its
    // only measure, so the line never holds one that verdict has closed or selection has moved.
    const monthly = monthlyRotation({ active, select, spends });
    if (monthly !== undefined) {
      return monthly;
    }
    return { act: "hold", why: `not a plan limit: ${signal.reason}` };
  }
  return proactiveOutcome({ active, gauges, select, spends, thresholds });
}

/**
 * The rotation an active monthly-spend plan's own verdict calls for, whatever a transcript line said beside it.
 *
 * @param select selection over every plan, run only when the active plan is a monthly one
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick
 * @returns the rotate outcome, or undefined when the active plan is weekly or its monthly verdict holds it
 */
function monthlyRotation({
  active,
  select,
  spends,
}: {
  active: string | undefined;
  select: () => ClaudeRotationDecision;
  spends: readonly ClaudePlanSpend[];
}): TriggerOutcome | undefined {
  const activeSpend = spends.find((spend) => spend.alias === active);
  if (activeSpend === undefined) {
    return undefined;
  }
  const monthly = monthlySpendOutcome({ decision: select(), spend: activeSpend });
  if (monthly.act === "rotate") {
    return monthly;
  }
  return undefined;
}

/**
 * The PROACTIVE half: what the active plan's own spend verdict or gauge says, with no transcript signal deciding it.
 *
 * @param active the plan the fleet is on now
 * @param gauges every weekly-window plan's latest reading
 * @param select selection over every plan, run only when an outcome needs a destination
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick
 * @param thresholds the install's Claude thresholds
 * @returns rotate before a wall, or hold with why
 */
function proactiveOutcome({
  active,
  gauges,
  select,
  spends,
  thresholds,
}: {
  active: string | undefined;
  gauges: readonly ClaudePlanGauge[];
  select: () => ClaudeRotationDecision;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): TriggerOutcome {
  const activeSpend = spends.find((spend) => spend.alias === active);
  if (activeSpend !== undefined) {
    return monthlySpendOutcome({ decision: select(), spend: activeSpend });
  }
  const activeGauge = gauges.find((gauge) => gauge.alias === active);
  const crossed = thresholdCrossed({ gauge: activeGauge, thresholds });
  if (crossed !== undefined) {
    return { act: "rotate", decision: select(), why: `${crossed} reached the rotation threshold before a wall` };
  }
  if (activeGauge === undefined) {
    // Never report headroom that was never read. A missing reading and a healthy one both used to fall
    // through to the same sentence, so a tick that could not see the active plan at all announced that it
    // had budget left — the one lie this feature must not tell, and the likeliest one, because the active
    // plan's own store is exactly the store a probe cannot read after the slot has refreshed past it.
    return { act: "hold", why: "no reading for the active plan, so its remaining budget is unknown" };
  }
  return { act: "hold", why: "the active plan has plan-wide headroom" };
}
