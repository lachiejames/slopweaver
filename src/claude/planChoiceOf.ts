/**
 * The Claude half of a session's recorded plan choice (`../sessions/planChoice.ts`), built by the pre-spawn gate
 * (`./spawnStore.ts`) while every reading it decided on is still in scope. Pure.
 *
 * Every reading is composed here from an alias, a typed kind, window percentages and ISO instants — never from an
 * exclusion's free-text `reason`, a store directory, a token path or an account address. A plan appears exactly once:
 * chosen, eligible but not chosen, excluded, or unreadable.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { PlanChoiceReading, SessionPlanChoice } from "../sessions/planChoice.js";
import type { ClaudeExclusion, ClaudeModelClass, ClaudePlanGauge } from "./contracts.js";
import type { ClaudeRankedPlan } from "./loadBalance.js";
import { type ClaudeSpawnRoute, classifyModel, gaugeWindowsText, spawnBlockedBy } from "./routeSpawn.js";
import type { ClaudeSpendVerdict } from "./spendPolicy.js";

/** How a Claude spawn names another plan. */
const CLAUDE_ALTERNATIVE = "--plan <alias>";

/** How a `--plan` spawn goes back to routing, or names another plan. */
const REQUESTED_ALTERNATIVE = "--plan <alias> names another plan; omit --plan to route on live gauges";

/** A gauge's reading text and instant. */
function gaugeReading({
  gauge,
  modelClass,
  state,
}: {
  gauge: ClaudePlanGauge;
  modelClass: ClaudeModelClass;
  state: PlanChoiceReading["state"];
}): PlanChoiceReading {
  return {
    alias: gauge.alias,
    observedAtIso: gauge.observedAtIso,
    reading: gaugeWindowsText({ gauge, modelClass }),
    state,
  };
}

/** An open monthly-spend verdict as a reading: the share of the owner's usage limit already spent. */
function openSpendText({ verdict }: { verdict: Extract<ClaudeSpendVerdict, { kind: "open" }> }): string {
  return `monthly spend ${String(Math.round(verdict.usedFraction * 100))}% of its usage limit`;
}

/** One ranked plan as a reading. */
function rankedReading({
  modelClass,
  plan,
  state,
}: {
  modelClass: ClaudeModelClass;
  plan: ClaudeRankedPlan;
  state: PlanChoiceReading["state"];
}): PlanChoiceReading {
  if (plan.lane === "monthly-spend") {
    return { alias: plan.alias, reading: openSpendText({ verdict: plan.spend.verdict }), state };
  }
  return gaugeReading({ gauge: plan.gauge, modelClass, state });
}

/** One exclusion as a reading: its typed kind, the plan's windows when it was read, and when it lifts. */
function excludedReading({
  exclusion,
  gauges,
  modelClass,
}: {
  exclusion: ClaudeExclusion;
  gauges: readonly ClaudePlanGauge[];
  modelClass: ClaudeModelClass;
}): PlanChoiceReading {
  const gauge = gauges.find((candidate) => candidate.alias === exclusion.alias);
  const windows = gauge === undefined ? "" : `, ${gaugeWindowsText({ gauge, modelClass })}`;
  const lifts = exclusion.eligibleAtIso === undefined ? "" : `, eligible again ${exclusion.eligibleAtIso}`;
  return {
    alias: exclusion.alias,
    reading: `${exclusion.kind}${windows}${lifts}`,
    state: "excluded",
    ...(gauge === undefined ? {} : { observedAtIso: gauge.observedAtIso }),
  };
}

/** A configured plan the probe could not read. */
function unreadableReading({ alias }: { alias: string }): PlanChoiceReading {
  return { alias, reading: "no gauge was readable", state: "unreadable" };
}

/**
 * The choice a routed spawn records: the winner, every other eligible plan, every excluded plan and every configured
 * weekly plan whose gauge could not be read.
 *
 * @param route the routing decision that named a plan
 * @param gauges every reading the sweep returned, for an excluded plan's windows
 * @param unreadable the configured weekly plans the sweep returned no reading for
 * @returns the recorded choice
 */
export function routedClaudeChoice({
  gauges,
  route,
  unreadable,
}: {
  gauges: readonly ClaudePlanGauge[];
  route: Extract<ClaudeSpawnRoute, { kind: "route" }>;
  unreadable: readonly string[];
}): SessionPlanChoice {
  const { modelClass } = route;
  const eligibleCount = route.eligible.length + 1;
  const lane = route.plan.lane === "monthly-spend" ? "the monthly-spend fallback, " : "";
  return {
    alias: route.to,
    basis: "routed",
    kind: "named",
    alternative: CLAUDE_ALTERNATIVE,
    readings: [
      rankedReading({ modelClass, plan: route.plan, state: "chosen" }),
      ...route.eligible.map((plan) => rankedReading({ modelClass, plan, state: "eligible" })),
      ...route.excluded.map((exclusion) => excludedReading({ exclusion, gauges, modelClass })),
      ...unreadable.map((alias) => unreadableReading({ alias })),
    ],
    reason: `${lane}ranked first of ${String(eligibleCount)} eligible plan(s) for a ${modelClass} spawn`,
    vendor: "claude",
  };
}

/**
 * Every OTHER plan a pinned seat's sweep read, classified by the same rule the gate judges a pin on: eligible when its
 * gauge allows this spawn, else excluded by the typed kind that bars it.
 *
 * @param chosen the pinned plan, left out
 * @param gauges every reading the sweep returned
 * @param model the model the spawn was asked for, as typed, or undefined
 * @param thresholds the install's Claude thresholds
 * @returns one reading per other plan the sweep read
 */
export function otherPlanReadings({
  chosen,
  gauges,
  model,
  thresholds,
}: {
  chosen: string;
  gauges: readonly ClaudePlanGauge[];
  model: string | undefined;
  thresholds: ClaudeThresholds;
}): readonly PlanChoiceReading[] {
  const modelClass = classifyModel({ model });
  return gauges
    .filter((reading) => reading.alias !== chosen)
    .map((reading): PlanChoiceReading => {
      const blocked = spawnBlockedBy({ gauge: reading, model, thresholds });
      if (blocked === undefined) {
        return gaugeReading({ gauge: reading, modelClass, state: "eligible" });
      }
      return excludedReading({ exclusion: blocked, gauges, modelClass });
    });
}

/**
 * The choice a pinned or `--plan` seat records when its own live gauge allowed it — or, with `forced`, when the
 * spent-plan hatch booted it past its own spent gauge. Every other reading is classified by the same rule the gate
 * judged the pin on.
 *
 * @param basis `requested` when `--plan` named the store this invocation, `pinned` for a standing pin
 * @param forced whether the spent-plan hatch released the seat's own spent gauge
 * @param gauge the pinned plan's own reading
 * @param gauges every reading the sweep returned
 * @param model the model the spawn was asked for, as typed, or undefined
 * @param thresholds the install's Claude thresholds
 * @param unreadable the configured weekly plans the sweep returned no reading for
 * @returns the recorded choice
 */
export function pinnedClaudeChoice({
  basis,
  forced,
  gauge,
  gauges,
  model,
  thresholds,
  unreadable,
}: {
  basis: "pinned" | "requested";
  forced: boolean;
  gauge: ClaudePlanGauge;
  gauges: readonly ClaudePlanGauge[];
  model: string | undefined;
  thresholds: ClaudeThresholds;
  unreadable: readonly string[];
}): SessionPlanChoice {
  const modelClass = classifyModel({ model });
  const others = otherPlanReadings({ chosen: gauge.alias, gauges, model, thresholds });
  const why = basis === "requested" ? "--plan named it" : "the seat is pinned to it";
  const reason = forced
    ? `${why}; booted past its spent gauge by the spent-plan hatch`
    : `${why}; its own gauge allows it`;
  return {
    alias: gauge.alias,
    basis,
    kind: "named",
    alternative: basis === "requested" ? REQUESTED_ALTERNATIVE : CLAUDE_ALTERNATIVE,
    readings: [
      gaugeReading({ gauge, modelClass, state: "chosen" }),
      ...others,
      ...unreadable.map((alias) => unreadableReading({ alias })),
    ],
    reason,
    vendor: "claude",
  };
}

/**
 * The choice a pinned monthly-spend seat records: judged on its recorded spend, never probed.
 *
 * @param alias the pinned plan
 * @param basis `requested` when `--plan` named it, `pinned` for a standing pin
 * @param verdict its open spend verdict
 * @returns the recorded choice
 */
export function pinnedSpendClaudeChoice({
  alias,
  basis,
  verdict,
}: {
  alias: string;
  basis: "pinned" | "requested";
  verdict: Extract<ClaudeSpendVerdict, { kind: "open" }>;
}): SessionPlanChoice {
  const why = basis === "requested" ? "--plan named it" : "the seat is pinned to it";
  return {
    alias,
    basis,
    kind: "named",
    alternative: basis === "requested" ? REQUESTED_ALTERNATIVE : CLAUDE_ALTERNATIVE,
    readings: [{ alias, reading: openSpendText({ verdict }), state: "chosen" }],
    reason: `${why}; its recorded monthly spend allows it`,
    vendor: "claude",
  };
}

/**
 * The choice a seat booted with NO readable gauge records, under the unreadable-plan hatch: named, never measured.
 *
 * @param alias the plan it boots on
 * @param basis `routed` for the first plan in configured order, `pinned` or `requested` for a pin
 * @param others every other plan the sweep DID read — a pinned seat's sweep can read plans its own gauge is not among
 * @param unreadable every configured weekly plan the sweep returned no reading for, the chosen one included
 * @returns the recorded choice
 */
export function unmeasuredClaudeChoice({
  alias,
  basis,
  others,
  unreadable,
}: {
  alias: string;
  basis: "routed" | "pinned" | "requested";
  others: readonly PlanChoiceReading[];
  unreadable: readonly string[];
}): SessionPlanChoice {
  // A routed one is the first plan in configured order that no usage limit below 100% holds back
  // (`noGaugeReadable`): with nothing measured, a limited plan cannot be shown under its limit.
  const reason =
    basis === "routed"
      ? "first in configured order with no usage limit to stay under, booted unmeasured by the unreadable-plan hatch: no plan's gauge was readable"
      : "the pinned seat, booted unmeasured by the unreadable-plan hatch: its own gauge was not readable";
  return {
    alias,
    basis,
    kind: "named",
    alternative: basis === "requested" ? REQUESTED_ALTERNATIVE : CLAUDE_ALTERNATIVE,
    readings: [
      { alias, reading: "no gauge was readable", state: "chosen" },
      ...others,
      ...unreadable.filter((other) => other !== alias).map((other) => unreadableReading({ alias: other })),
    ],
    reason,
    vendor: "claude",
  };
}

/**
 * The choice an UNPINNED spawn records when the spent-plan hatch booted it on a plan every reading called spent.
 *
 * @param alias the spent plan the release boots on
 * @param route the no-plan routing decision, every plan excluded
 * @param gauges every reading the sweep returned
 * @param unreadable the configured weekly plans the sweep returned no reading for
 * @returns the recorded choice
 */
export function spentReleaseClaudeChoice({
  alias,
  gauges,
  route,
  unreadable,
}: {
  alias: string;
  gauges: readonly ClaudePlanGauge[];
  route: ClaudeSpawnRoute;
  unreadable: readonly string[];
}): SessionPlanChoice {
  const { modelClass } = route;
  const excluded = route.excluded.map((exclusion) => {
    const reading = excludedReading({ exclusion, gauges, modelClass });
    return exclusion.alias === alias ? { ...reading, state: "chosen" as const } : reading;
  });
  return {
    alias,
    basis: "routed",
    kind: "named",
    alternative: CLAUDE_ALTERNATIVE,
    readings: [...excluded, ...unreadable.map((other) => unreadableReading({ alias: other }))],
    reason: `every plan was spent for a ${modelClass} spawn; the spent-plan hatch booted the first spent plan in configured order`,
    vendor: "claude",
  };
}

/**
 * The choice a spawn records when no plan's store decides what it spends.
 *
 * @param source what outranks the stores — an API key's variable or `apiKeyHelper` — or undefined when no plan is
 *   registered at all
 * @returns the recorded choice
 */
export function ambientClaudeChoice({ source }: { source: string | undefined }): SessionPlanChoice {
  if (source === undefined) {
    return {
      kind: "ambient",
      alternative: `register a Claude plan, then ${CLAUDE_ALTERNATIVE}`,
      reason: "no Claude plan is registered, so the ambient login stands and nothing was routed",
      vendor: "claude",
    };
  }
  return {
    kind: "ambient",
    alternative: `unset ${source} to spend a plan login`,
    reason: `${source} outranks every credential store, so the session presents an API key and no plan decides`,
    vendor: "claude",
  };
}
