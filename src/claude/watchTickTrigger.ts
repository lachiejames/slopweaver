/**
 * What one watch tick hands the rotation trigger: the readings it is entitled to judge, each paired with its plan's
 * usage policy, and the plans a standing hold keeps out. The tick's orchestration — resolving the active plan,
 * the slot, the touches — stays in `./watchTick.ts`.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { SessionSeat } from "./claimResponse.js";
import {
  type ClaudeAccount,
  type ClaudeAccountGauge,
  type ClaudeLimitSignal,
  type ClaudePlanSpend,
  pairClaudePlanGauges,
} from "./contracts.js";
import { type ClaudeRotationState, isSelectable } from "./rotationState.js";
import { type TriggerOutcome, triggerDecision } from "./trigger.js";
import type { ActiveFrom } from "./watchTickActiveSlot.js";

/**
 * Replace the active plan's reading with what the ACTIVE SLOT itself read.
 *
 * The active plan's own store is the one a probe cannot read, because the slot has refreshed past the
 * credential the store still holds. So the store either has no reading at all, or a reading from before the
 * checkout. The slot's own reading is the same ACCOUNT's current budget, which is the number the trigger has
 * to judge, and it arrives under a placeholder alias because the probe could not know which plan it was.
 *
 * With no active plan resolved, or no slot reading, the store readings stand unchanged. Attributing a
 * reading to a plan nobody could name is the guess this whole module refuses everywhere else.
 *
 * @param active the plan the fleet is on, when a source named it
 * @param activeSlotGauge what the active slot read, when it answered
 * @param gauges every store's reading
 * @returns the readings the trigger judges
 */
function withActiveReading({
  active,
  activeSlotGauge,
  gauges,
}: {
  active?: string;
  activeSlotGauge?: ClaudeAccountGauge;
  gauges: readonly ClaudeAccountGauge[];
}): readonly ClaudeAccountGauge[] {
  if (active === undefined || activeSlotGauge === undefined) {
    return gauges;
  }
  const stamped = { ...activeSlotGauge, alias: active };
  return [...gauges.filter((gauge) => gauge.alias !== active), stamped];
}

/**
 * Every plan under an unexpired hold, kept out of the selection so the fleet cannot flap back onto one.
 *
 * @param aliases every plan selection could land on, weekly and monthly-spend alike, in configured order
 * @param nowIso this tick's instant, ISO-8601
 * @param state what this repository last recorded about the fleet
 * @returns the held aliases, in configured order
 */
export function heldPlans({
  aliases,
  nowIso,
  state,
}: {
  aliases: readonly string[];
  nowIso: string;
  state: ClaudeRotationState;
}): readonly string[] {
  return aliases.filter((alias) => !isSelectable({ alias, nowIso, state }));
}

/**
 * What the trigger concludes, over the readings it is entitled to judge.
 *
 * Two filters sit between the raw gauges and the decision, and both are corrections rather than tidying: the
 * active plan's own store cannot answer a probe, so {@link withActiveReading} substitutes the slot's own
 * reading for it; and a plan under a standing hold is removed entirely, so the trigger chooses among what is
 * genuinely eligible rather than picking one the record already knows is spent.
 *
 * Then every reading left is PAIRED with its configured plan's usage policy, AFTER the active slot's reading is
 * re-stamped with the active alias — so the slot's reading carries the active plan's own usage limit, and a
 * reading no configured plan carries is dropped rather than judged against a limit nobody set.
 *
 * @param accounts the configured plans, whose usage policy each reading is judged against
 * @param active the plan the fleet is on, when a source named it
 * @param activeFrom which source did, since a PINNED reading is about this process's store and must never be
 *   stamped onto the default slot's budget
 * @param activeSlotGauge what the slot itself read, under a placeholder alias
 * @param gauges every store's reading this tick took
 * @param held every plan under an unexpired hold
 * @param reserved the plan held back for the browser
 * @param seat which seat this loop speaks for
 * @param signal a claim that already refused a session, when one reached this loop
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick; a held one is dropped like a gauge,
 *   bar the active plan's own
 * @param thresholds the install's Claude thresholds, off the same register read as `accounts`
 * @returns what the trigger concluded
 */
export function decideTrigger({
  accounts,
  active,
  activeFrom,
  activeSlotGauge,
  gauges,
  held,
  reserved,
  seat,
  signal,
  spends,
  thresholds,
}: {
  accounts: readonly ClaudeAccount[];
  active?: string;
  activeFrom: ActiveFrom;
  activeSlotGauge?: ClaudeAccountGauge;
  gauges: readonly ClaudeAccountGauge[];
  held: readonly string[];
  reserved?: string;
  seat: SessionSeat;
  signal?: ClaudeLimitSignal;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): TriggerOutcome {
  const judged = withActiveReading({
    gauges,
    ...(active === undefined || activeFrom === "pinned" ? {} : { active }),
    ...(activeSlotGauge === undefined ? {} : { activeSlotGauge }),
  }).filter((gauge) => !held.includes(gauge.alias));
  return triggerDecision({
    gauges: pairClaudePlanGauges({ accounts, gauges: judged }),
    seat,
    // The active plan keeps its verdict even under a hold: dropped, a closed one would read as no reading and hold
    // the fleet on a plan its spend has closed.
    spends: spends.filter((spend) => spend.alias === active || !held.includes(spend.alias)),
    thresholds,
    ...(active === undefined ? {} : { active }),
    ...(reserved === undefined ? {} : { reserved }),
    ...(signal === undefined ? {} : { signal }),
  });
}
