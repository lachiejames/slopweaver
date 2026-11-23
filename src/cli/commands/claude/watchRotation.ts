/**
 * What a `claude watch` tick RECOMMENDS about rotation, and the line that says so: the trigger's conclusion,
 * reported, with nothing performed. The tick that computes it is `./watch.ts`.
 */
import { type ClaudeRotationState, holdAccount } from "../../../claude/rotationState.js";
import type { WatchRotationScope, WatchTickPlan } from "../../../claude/watchTick.js";

/**
 * Report the rotation this tick would have chosen, and perform nothing.
 *
 * ## The act this used to perform is retired
 *
 * It called `performClaudeSwap`, which COPIED one store's credential into the shared default keychain slot so
 * that sessions reading that slot would pick the new plan up. Two things ended it, and both are measurements
 * rather than preferences.
 *
 * **Refresh-token rotation is real on this provider** (MEASURED, `rotate.ts` § This verb no longer
 * writes a credential), so two slots holding one credential is revoked the moment either refreshes — the one
 * revocation mechanism here with evidence behind it. **And nothing read what the copy wrote**: MEASURED
 * 2026, the default slot's access token had expired four days earlier while all four stores were live and the
 * whole fleet ran on them, because every session boots against a named store.
 *
 * So which plan a session spends is chosen per SPAWN, by `claude/spawnStore.ts` selecting a store, and a plan
 * whose credential has merely expired is repaired on demand at that same gate rather than waited for here.
 *
 * What remains is honest reporting, and it is deliberately not nothing: the trigger still computes which plan
 * the fleet SHOULD be on, and a reader who can see that recommendation can act on it. What no longer happens is
 * the loop writing the record as though a rotation occurred — {@link afterRotation} is where that mattered,
 * and it now folds nothing in.
 *
 * **Both rotation scopes are reported now, including `process-pinned`.** That scope used to suppress the act,
 * because a tick reading a pinned store's budgets would have handed the default slot's credential to a store
 * chosen by the mismatch. Reporting a recommendation writes nothing, so there is nothing for the mismatch to
 * damage — and a reader on a pinned machine is exactly the reader who was previously told nothing at all.
 *
 * @param plan what this tick decided
 * @returns the recommendation, or undefined when this tick chose no rotation
 */
export function observeRotationRecommendation({ plan }: { plan: WatchTickPlan }): ClaudeRotation | undefined {
  if (plan.rotateTo === undefined) {
    return undefined;
  }
  return {
    rotationScope: plan.rotationScope,
    status: "retired",
    to: plan.rotateTo,
    ...(plan.active === undefined ? {} : { from: plan.active }),
  };
}

/**
 * What one tick RECOMMENDED, kept together so the record and the report read the same observation.
 *
 * There is no `swapMs` any more, and its absence is the honest shape rather than a gap: nothing was performed,
 * so there is no duration to report, and `watchReport.ts`'s recovery estimate names the swap as unmeasured
 * instead of substituting a zero. A zero there would read as an instant recovery.
 */
export interface ClaudeRotation {
  readonly to: string;
  readonly from?: string;
  /**
   * Always `retired`, and {@link rotationLines} RENDERS it rather than only carrying it — a field nothing reads
   * is a field that can quietly stop being true, which is what the Codex review pass on this change named.
   */
  readonly status: "retired";
  /** Which store's budgets the recommendation was computed from, carried so the reader can judge it. */
  readonly rotationScope: WatchRotationScope;
}

/**
 * Fold a rotation RECOMMENDATION into the record: the plan it recommends leaving is held out, and nothing else.
 *
 * ## What it no longer writes, and why that half was the lie
 *
 * It used to write the recommended plan as `selected` as well. `selected` means "the store the ACTIVE SLOT is
 * checked out from", and that was only ever true because a swap had actually moved the fleet. Nothing moves now
 * — the credential copy is retired — so writing it would make the record lie about the one fact it exists to
 * answer, and the next tick would read that lie back as though something had established it.
 *
 * ## What it still writes, and why the HOLD survives the retirement
 *
 * A plan is recommended for leaving because a window crossed the threshold, and a gauge a minute later would
 * happily recommend going straight back to it on a number that has not moved. Holding it out until the reset
 * its own crossed window named is what makes the RECOMMENDATION stable — and an unstable recommendation is
 * still a cost, because the owner reads these lines and a register that alternates every tick tells them
 * nothing. `trigger.ts` reads that hold, so this is a live write rather than a vestige.
 *
 * A recommendation that named no plan, or whose crossed window named no reset instant, gets no hold: an
 * invented one would idle a healthy plan for nothing.
 *
 * @param plan what this tick decided, which carries the window that crossed
 * @param rotation what this tick recommended, when it recommended anything
 * @param state the record with this tick's observations already folded in
 * @returns the record to write
 */
export function afterRotation({
  plan,
  rotation,
  state,
}: {
  plan: WatchTickPlan;
  rotation?: ClaudeRotation;
  state: ClaudeRotationState;
}): ClaudeRotationState {
  const leaving = rotation?.from;
  if (leaving === undefined) {
    return state;
  }
  const untilIso = leftPlanEligibleAtIso({ alias: leaving, plan });
  if (untilIso === undefined) {
    return state;
  }
  return holdAccount({ alias: leaving, reason: plan.why, state, untilIso });
}

/**
 * When the plan a recommendation would leave becomes eligible again.
 *
 * Taken from the trigger's own exclusion for that plan rather than computed here, so the hold expires on the
 * instant the provider named for the window that actually crossed. A plan excluded for no reason this tick
 * recorded gets no hold, because an invented one would idle a healthy plan.
 *
 * @param alias the plan being left
 * @param plan what this tick decided
 * @returns the reset instant, ISO-8601, or undefined when the tick named none
 */
function leftPlanEligibleAtIso({ alias, plan }: { alias: string; plan: WatchTickPlan }): string | undefined {
  if (plan.outcome.act !== "rotate") {
    return undefined;
  }
  const excluded = plan.outcome.decision.kind === "stay" ? [] : plan.outcome.decision.excluded;
  return excluded.find((entry) => entry.alias === alias)?.eligibleAtIso;
}

/**
 * The lines a rotation recommendation writes to stderr, so the reader sees what the trigger concluded and that
 * nothing acted on it.
 *
 * @param rotation what this tick recommended, when it recommended anything
 * @returns one line per thing worth saying, empty when nothing was recommended
 */
export function rotationLines({ rotation }: { rotation?: ClaudeRotation }): readonly string[] {
  if (rotation === undefined) {
    return [];
  }
  const from = rotation.from === undefined ? "" : ` from ${rotation.from}`;
  return [
    `rotation ${rotation.status.toUpperCase()}: RECOMMENDED${from} onto ${rotation.to} (scope ` +
      `${rotation.rotationScope}) — nothing was performed, because the credential copy is retired and a ` +
      `session spends a plan by being booted against its store, which the pre-spawn gate chooses`,
  ];
}
