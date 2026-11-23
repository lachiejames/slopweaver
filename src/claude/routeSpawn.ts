/**
 * Which plan a spawn should boot against, given every plan's live gauge and the model it will run. Pure: no
 * clock, no filesystem, no network, no credential.
 *
 * ## The defect this exists to close
 *
 * MEASURED across several plans read side by side from their usage pages:
 * one plan's plan-wide week was fully spent — locked out of everything — while much of its Fable week sat
 * unspent and unspendable; another's Fable week was fully spent with plan-wide headroom still free, so
 * no Fable seat could open there while ordinary work could; a third had barely been touched.
 * Nothing routed: the supervisor was expected to balance auto routing between the plans and did not.
 *
 * Every one of those three states is a DIFFERENT answer to "where should this spawn go", and telling them
 * apart needs both windows. {@link selectClaudeAccount} answers a different question — which single plan the
 * whole fleet's shared credential slot should sit on — and it reads only the plan-wide pair, so it cannot
 * tell a plan that is useless from a plan that is merely useless for Fable.
 *
 * ## The order of the two rules, which is the whole design
 *
 * **Plan-wide first, Fable second.** MEASURED the same day: a Fable request against a plan whose plan-wide
 * seven-day window reads `rejected` is itself refused `429`, even while that plan's Fable window reads
 * `allowed` with half the week left. Fable headroom on a plan-wide-exhausted plan is not spendable at all.
 * So the Fable window is never an escape from the plan-wide gate — it is a SECOND gate that only Fable
 * spawns must also pass, and a ranking key that only Fable spawns use.
 *
 * A consequence worth stating because it inverts the intuition: an `all-models` spawn ignores the Fable
 * window completely, including when it is exhausted. Plan B in the incident above is a perfectly good home
 * for an Opus worker precisely while it is refusing every Fable seat.
 *
 * ## What this deliberately does NOT decide
 *
 * The PINNED seat. A publishing seat boots against a fixed store because the owner's gallery and browser live
 * on that account (`seatPinning.ts`), and a seat `--plan` named boots where it was told. Routing a spawn's
 * budget and routing the pin are separate questions with separate answers, and this module answers only the
 * first: a caller that has a pinned store uses it and never calls in here. The supervisor chair is NOT pinned —
 * its successor routes here as a Fable spawn.
 *
 * ## N plans, never three
 *
 * Nothing here counts accounts; "every plan is spent" is simply the case where the
 * eligible list came back empty.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { PlanAllowanceKind } from "../plans/usageLimit.js";
import type {
  ClaudeAccountAlias,
  ClaudeAccountGauge,
  ClaudeExclusion,
  ClaudeModelClass,
  ClaudePlanGauge,
  ClaudePlanSpend,
  ClaudeWindowReading,
} from "./contracts.js";

import { type ClaudeRankedPlan, chairLevelWith, planExcludedBy, rankClaudeBudgets } from "./loadBalance.js";

/**
 * The model names that spend the Fable-only week, matched as a prefix so a point release does not silently
 * reclassify a Fable spawn as ordinary work.
 *
 * A prefix rather than an exact id because the id carries a version (`claude-fable-5-1`) and the alias does
 * not (`fable`), and doctrine rule 5 lets a spawn name either. Getting this wrong is not a cosmetic error:
 * an unrecognised Fable model would be routed on the plan-wide window alone and land on the one plan whose
 * Fable week is spent.
 */
const FABLE_MODEL_PREFIXES: readonly string[] = ["fable", "claude-fable"] as const;

/**
 * Which budget a spawn's `--model` will actually draw down.
 *
 * An ABSENT model is `all-models`, and that is a statement rather than a default: a spawn that pins no model
 * inherits the launching user's saved tier, and doctrine rule 5 puts Fable on the supervisor chair, whose
 * handoff names `--model fable` and so routes on the Fable week.
 *
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @returns `fable` when it spends the Fable week, `all-models` otherwise
 */
export function classifyModel({ model }: { model: string | undefined }): ClaudeModelClass {
  if (model === undefined) {
    return "all-models";
  }
  const normalised = model.trim().toLowerCase();
  return FABLE_MODEL_PREFIXES.some((prefix) => normalised.startsWith(prefix)) ? "fable" : "all-models";
}

/**
 * Whether ONE already-chosen plan can take this spawn — the same rule {@link routeSpawnToPlan} excludes on,
 * exported so the pre-spawn gate can ask it of a store that was never routed at all.
 *
 * A pinned seat and an ambient slot are both "the account this session is about to boot on" with no ranking
 * question attached, and the failure this closes was exactly that shape: two bot workers booted on the
 * DEFAULT keychain at its weekly wall (MEASURED, `cmux read-screen workspace:280`/`:281`, both
 * rendering `Weekly limit reached · Retrying in 5h`), because nothing asked the one question the router
 * already knew how to answer.
 *
 * @param chair whether this spawn seats the supervisor chair, held to the routing bar on its Fable week too
 * @param gauge the plan's reading, carrying its allowance and usage limit
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param thresholds the install's Claude thresholds, off the register
 * @returns why the plan bars this spawn, typed by which rule fired, or undefined when it can take it
 */
export function spawnBlockedBy({
  chair,
  gauge,
  model,
  thresholds,
}: {
  chair?: boolean;
  gauge: ClaudePlanGauge;
  model: string | undefined;
  thresholds: ClaudeThresholds;
}): ClaudeExclusion | undefined {
  return planExcludedBy({ chair: chair === true, gauge, modelClass: classifyModel({ model }), thresholds });
}

/** What a routing pass concluded. `no-plan` is a state to report and wait out, not a failure of the router. */
export type ClaudeSpawnRoute =
  | {
      readonly kind: "route";
      readonly to: ClaudeAccountAlias;
      /** Which budget the spawn will spend, so the printed reason can name the window it was ranked on. */
      readonly modelClass: ClaudeModelClass;
      /**
       * The evidence the choice was made from — a weekly plan's gauge or a monthly plan's open spend verdict — what a
       * spawn log carries so the decision is re-checkable.
       */
      readonly plan: ClaudeRankedPlan;
      readonly excluded: readonly ClaudeExclusion[];
    }
  | {
      readonly kind: "no-plan";
      readonly modelClass: ClaudeModelClass;
      readonly excluded: readonly ClaudeExclusion[];
      /**
       * The earliest instant any barring window resets, ISO-8601, so a refusal says when the fleet comes
       * back rather than only that it is down. ABSENT when there were no gauges at all, which is a different
       * state from "resets now" and must never be flattened into one.
       */
      readonly earliestResetIso?: string;
    };

/**
 * Choose the plan a spawn should boot against.
 *
 * @param gauges every weekly-window plan's reading paired with its usage policy, in configured order — the final
 *   tie-break
 * @param spends every unpaused monthly-spend plan's spend verdict, in configured order — the fallback lane
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param thresholds the install's Claude thresholds, off the register
 * @param chair whether this spawn seats the supervisor chair, held to the routing bar on its Fable week too
 * @returns the plan and the evidence it was chosen from, or every plan excluded with the earliest reset
 */
export function routeSpawnToPlan({
  chair,
  gauges,
  model,
  spends,
  thresholds,
}: {
  chair?: boolean;
  gauges: readonly ClaudePlanGauge[];
  model: string | undefined;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): ClaudeSpawnRoute {
  const modelClass = classifyModel({ model });
  const { excluded, ranked } = rankClaudeBudgets({ chair: chair === true, gauges, modelClass, spends, thresholds });
  const best = ranked[0];
  if (best === undefined) {
    const earliest = excluded.reduce<string | undefined>(
      (soonest, exclusion) =>
        exclusion.eligibleAtIso !== undefined && (soonest === undefined || exclusion.eligibleAtIso < soonest)
          ? exclusion.eligibleAtIso
          : soonest,
      undefined,
    );
    return { excluded, kind: "no-plan", modelClass, ...(earliest === undefined ? {} : { earliestResetIso: earliest }) };
  }
  return { excluded, kind: "route", modelClass, plan: best, to: best.alias };
}

/**
 * Where the router would send the next spawn of each budget, asked of {@link routeSpawnToPlan} ITSELF rather than of
 * a second ranking that happens to agree with it today. A supervisor acting on these lines is acting on what a spawn
 * would actually do.
 *
 * The chair's successor is asked separately, with the chair flag its spawn carries, because the chair's Fable week is
 * lined up as a Fable seat is gated and an ordinary Fable seat's is not: the chair's cadence judges THAT route, and the
 * plans level with it (`chairLevelWith`), never `nextFable`.
 *
 * @param gauges every readable plan's reading, in configured order
 * @param spends every unpaused monthly-spend plan's spend verdict at the sweep's instant
 * @param thresholds the install's Claude thresholds, off the same register read
 * @returns the chosen alias for each budget, absent when no plan can take that spawn, and the plans level with the
 *   chair's route
 */
export function nextSpawnTargets({
  gauges,
  spends,
  thresholds,
}: {
  gauges: readonly ClaudePlanGauge[];
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): {
  chairLevelWith?: readonly string[];
  nextAllModels?: string;
  nextChair?: string;
  nextFable?: string;
} {
  const fable = routeSpawnToPlan({ gauges, model: "fable", spends, thresholds });
  const chair = routeSpawnToPlan({ chair: true, gauges, model: "fable", spends, thresholds });
  const allModels = routeSpawnToPlan({ gauges, model: undefined, spends, thresholds });
  return {
    ...(allModels.kind === "route" ? { nextAllModels: allModels.to } : {}),
    ...(chair.kind === "route"
      ? { chairLevelWith: chairLevelWith({ gauges, route: chair.to, thresholds }), nextChair: chair.to }
      : {}),
    ...(fable.kind === "route" ? { nextFable: fable.to } : {}),
  };
}

/**
 * The one line a spawn prints to say which plan it chose and why — the gauge it read, not a memory of one.
 *
 * It is one line on purpose (doctrine rule 7): this appears in a spawn log the owner scans, and a reader who
 * has to scroll to find which plan a session is spending is a reader who will not check. It renders an alias
 * and percentages only, never an organisation or an email, because this text is kept.
 *
 * @param route what the router concluded
 * @returns the line to print
 */
export function renderSpawnRoute({ route }: { route: ClaudeSpawnRoute }): string {
  const barred = route.excluded.map((exclusion) => `${exclusion.alias} ${exclusion.reason}`).join(", ");
  const passedOver = barred === "" ? "" : `; passed over ${barred}`;
  if (route.kind === "no-plan") {
    const back =
      route.earliestResetIso === undefined ? "no reset instant was readable" : `back ${route.earliestResetIso}`;
    return `claude routing: NO plan can take a ${route.modelClass} spawn — ${back}${passedOver}`;
  }
  const { plan } = route;
  if (plan.lane === "monthly-spend") {
    return `claude routing: ${route.to} for a ${route.modelClass} spawn — monthly spend: ${plan.spend.verdict.reason}${passedOver}`;
  }
  const { gauge } = plan;
  const spent = (window: ClaudeWindowReading | undefined): string =>
    window === undefined ? "unread" : `${String(Math.round(window.utilization * 100))}%`;
  // A Fable seat walls on whichever week runs out first, so its line names both — the Fable week alone hid a
  // plan-wide week at 95% behind `fable-week 44%` (`fableSeatBars.ts`).
  const allModels = `all-models week ${spent(gauge.sevenDay)}`;
  const ranked = route.modelClass === "fable" ? `fable-week ${spent(gauge.sevenDayFable)}, ${allModels}` : allModels;
  // No five-hour window is the measured shape of every plan now (`contracts.ts`): the plan has no such limit, so the
  // line names none, rather than a standing "no 5h limit" or an "unread" that would send a reader looking for one.
  const fiveHour = gauge.fiveHour === undefined ? "" : `, 5h ${spent(gauge.fiveHour)}`;
  return `claude routing: ${route.to} for a ${route.modelClass} spawn — ${ranked}${fiveHour}, read ${gauge.observedAtIso}${passedOver}`;
}

/**
 * The one line a spawn refused on LOCAL POLICY prints — the plan's usage limit, or a monthly-spend plan with no fresh
 * spend reading. It names no escape hatch, and says so (`../plans/usageLimit.ts`): a limit the owner
 * sets is respected even if it means taking the fleet down, so the only move is to change the limit itself.
 *
 * @param alias the plan that barred the spawn, which the fix command names
 * @param allowance what the plan's usage limit is a share of, so the fix command names the plan's own allowance
 * @param kind which local policy fired
 * @param limit the already-rendered description of what barred this spawn
 * @returns the line to print
 */
export function renderPolicyRefusal({
  alias,
  allowance,
  kind,
  limit,
}: {
  alias: ClaudeAccountAlias;
  allowance: PlanAllowanceKind;
  kind: "usage-limit" | "not-measured";
  limit: string;
}): string {
  const change =
    kind === "usage-limit"
      ? `raise it with \`slopweaver plans set-usage-limit --provider claude --plan ${alias} --percent <N> --allowance ${allowance}\``
      : `record a fresh spend reading with \`slopweaver claude spend --plan ${alias}\` (it is evidence for one hour)`;
  return `${limit} — REFUSING. This is the owner's own policy on the plan, so no \`--force\` and no escape hatch crosses it; to change it, ${change}.`;
}

/**
 * The one line a refused spawn prints: what barred it, how to override it anyway, and where else it could go.
 *
 * Its shape: it fails and says what limit barred it, to override run the command again with the named
 * environment variable, otherwise consider one of the other plans. All three parts are load-bearing — a refusal that names only the limit leaves a reader with a dead
 * fleet and no next move, which is the state the escape hatch exists to end.
 *
 * It renders aliases and percentages only, never an organisation or an email, for the same reason
 * {@link renderSpawnRoute} does: this text is kept.
 *
 * @param eligible every plan that COULD take this spawn, already filtered by the caller — empty when none can
 * @param escapeHatchEnv the environment variable that opens the session onto a spent plan anyway
 * @param limit the already-rendered description of what barred this spawn
 * @returns the line to print
 */
export function renderSpawnRefusal({
  eligible,
  escapeHatchEnv,
  limit,
}: {
  eligible: readonly ClaudeAccountGauge[];
  escapeHatchEnv: string;
  limit: string;
}): string {
  const spent = (window: ClaudeWindowReading): string => `${String(Math.round(window.utilization * 100))}%`;
  const others =
    eligible.length === 0
      ? "no other configured plan has headroom either"
      : `otherwise use one of the other plans: ${eligible.map((gauge) => `${gauge.alias} (week ${spent(gauge.sevenDay)})`).join(", ")}`;
  return `${limit} — REFUSING rather than booting into a wall. To override, run the same command again with ${escapeHatchEnv}=1; ${others}.`;
}
