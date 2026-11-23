/**
 * Render the fleet's plan gauges as the one thing the owner actually looks at. Pure: takes readings, returns
 * lines.
 *
 * The shape is a decision rather than a default. Doctrine rule 7 caps what appears above the fold on any
 * outbound surface, and this is read in a terminal and pasted into a sidebar row, so it is one line per
 * plan: the alias, the account it holds, every window as a bar and a percentage, and when each resets.
 *
 * The FABLE week gets its own column because the two numbers move independently and the owner reads both on
 * their own usage screen. MEASURED, the fleet's whole failure was invisible in a two-column render:
 * one plan showed a spent week while half its Fable week sat unused, another showed a healthy week while no
 * Fable seat could open on it, and neither state is distinguishable from the plan-wide pair alone. Anything a reader has to
 * scroll to reach is a line they will not read while deciding whether the fleet is about to stall.
 *
 * The account column exists because an alias alone leaves the owner unable to tell which of their accounts a
 * plan is. It prints a DECIDED cell (`accountBinding.ts`), never a blank that reads as fine, and never the
 * raw `email` `accounts.json` maps — that string is a display cache which drifts from the token in the store
 * and printing it as the account can hold a launch on the wrong account. The organisation id is still never
 * rendered.
 */
import { type ClaudeThresholdFields, type ClaudeThresholds, claudeThresholdFieldsOf } from "../plans/thresholds.js";
import { type UsageLimitPercent, weeklyUsageLimitOf } from "../plans/usageLimit.js";
import type { ClaudeAccountCell, ClaudeAccountTrust } from "./accountBinding.js";
import { renderAccountCell } from "./accountBinding.js";
import type { ClaudeAmbientCredential } from "./ambientCredential.js";
import { type FleetSpread, fleetSpread, type PlanLean, planLeans } from "./balance.js";
import type { ChairProbe } from "./chairBudgetAlert.js";
import {
  type ClaudeAccount,
  type ClaudeAccountGauge,
  type ClaudePlanGauge,
  type ClaudeWindowReading,
  claudePlanGauge,
} from "./contracts.js";
import { BASICALLY_ZERO_TOKENS, type ProbeCost, probeCostIsBasicallyZero, probeCostTokens } from "./gaugeProbe.js";
import type { GaugeChair } from "./seatBoot.js";
import { type ClaudeCapWindow, claudeEffectiveUsageCeiling } from "./select.js";

/**
 * One plan's decided account cell, keyed by the alias it belongs to.
 *
 * @internal — what the `claude gauge` shell builds after probing and what both renderers below consume.
 */
export interface ClaudeAliasAccountCell {
  readonly alias: string;
  readonly cell: ClaudeAccountCell;
}

/**
 * The cell decided for one plan, or the honest absence when the shell decided none for it.
 *
 * An alias with no cell is a plan nobody probed and nobody read config for, so `unread` is the true
 * statement — not `UNMAPPED`, which would claim `accounts.json` was consulted and found empty.
 *
 * @param alias the plan to look up
 * @param cells every decided cell
 * @returns the cell, or the `unread` cell
 */
function cellFor({ alias, cells }: { alias: string; cells: readonly ClaudeAliasAccountCell[] }): ClaudeAccountCell {
  const found = cells.find((entry) => entry.alias === alias);
  if (found === undefined) {
    return { trust: "unread" };
  }
  return found.cell;
}

/** How many cells the bar is drawn in. Ten reads as a percentage without arithmetic. */
const BAR_CELLS = 10;

/** Drawn when a window has crossed the rotation threshold, so a spent plan is visible without reading digits. */
const FULL = "#";

/** Drawn for the remaining headroom. */
const EMPTY = ".";

/** The five-hour cell of a plan the provider no longer five-hour limits, as wide as a flag plus a bar. */
const NO_FIVE_HOUR_LIMIT = "     no 5h limit    ";

/** The window columns' header, five-hour first; a table with no five-hour window drops that leading column. */
const WINDOWS_HEADER = "5-hour            7-day all         7-day fable       resets";

/**
 * One window as a fixed-width bar plus its percentage.
 *
 * @param window the reading to draw
 * @returns the bar and percentage, padded so a column of them lines up
 */
function bar({ window }: { window: ClaudeWindowReading }): string {
  const filled = Math.min(BAR_CELLS, Math.round(window.utilization * BAR_CELLS));
  const drawn = `${FULL.repeat(filled)}${EMPTY.repeat(BAR_CELLS - filled)}`;
  const percent = `${String(Math.round(window.utilization * 100))}%`;
  return `${drawn} ${percent.padStart(4)}`;
}

/**
 * A short marker for a window that needs attention, or spaces when it does not.
 *
 * `NEAR` marks where routing stops putting new work on this window: its EFFECTIVE ceiling
 * ({@link claudeEffectiveUsageCeiling}). On a weekly window that is the owner's usage limit when it binds — a 50%
 * plan's week reads `NEAR` at 50% — and the house bar otherwise, which lifts in a weekly window's last five hours,
 * so an unlimited week reads blank at 97% there rather than `NEAR`: routing has not stopped choosing that plan, and
 * a marker saying otherwise would send a reader to move spawns off a plan the router is deliberately spending out
 * (an owner ruling). A usage limit never lifts, so a limited week reads `NEAR` at its limit in those hours too.
 *
 * @param claim which window this is, since only the weekly ones lift near their reset or carry the limit
 * @param observedAtIso when the gauge carrying this window was taken
 * @param thresholds the install's Claude thresholds, off the plan register
 * @param usageLimitPercent the plan's usage limit, a share of its weekly allowance
 * @param window the reading to judge
 * @returns `SPENT` when the provider refused it, `NEAR` when it warns or at or past the effective ceiling, else blank
 */
function flag({
  claim,
  observedAtIso,
  thresholds,
  usageLimitPercent,
  window,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
  window: ClaudeWindowReading;
}): string {
  if (window.status === "rejected") {
    return "SPENT";
  }
  const ceiling = claudeEffectiveUsageCeiling({
    claim,
    observedAtIso,
    resetAtIso: window.resetAtIso,
    thresholds,
    usageLimitPercent,
  });
  if (window.status === "allowed_warning" || window.utilization >= ceiling.utilization) {
    return "NEAR ";
  }
  return "     ";
}

/**
 * Render every plan's gauge, one line each, newest reading last.
 *
 * @param cells each plan's decided account cell, from `accountBinding.ts`
 * @param gauges every plan's reading, in configured order
 * @param active the plan the fleet is on now, marked so the reader can see it at a glance
 * @param reserved the plan held back for the browser, marked so its idleness reads as deliberate
 * @param thresholds the install's Claude thresholds, which with each plan's usage limit decide where `NEAR` starts
 * @returns one line per plan, plus a header
 */
export function renderGaugeLines({
  active,
  cells,
  gauges,
  reserved,
  thresholds,
}: {
  active?: string;
  cells: readonly ClaudeAliasAccountCell[];
  gauges: readonly ClaudePlanGauge[];
  reserved?: string;
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const flagOf = ({
    claim,
    gauge,
    window,
  }: {
    claim: ClaudeCapWindow;
    gauge: ClaudePlanGauge;
    window: ClaudeWindowReading;
  }): string => {
    const usageLimitPercent = weeklyUsageLimitOf(gauge);
    const observedAtIso = gauge.observedAtIso;
    return `${flag({ claim, observedAtIso, thresholds, usageLimitPercent, window })}${bar({ window })}`;
  };
  const width = Math.max(4, ...gauges.map((gauge) => gauge.alias.length));
  const accountOf = ({ alias }: { alias: string }): string => renderAccountCell({ cell: cellFor({ alias, cells }) });
  const accountWidth = Math.max("account".length, ...gauges.map((gauge) => accountOf({ alias: gauge.alias }).length));
  // The five-hour column is drawn only when some plan in the table still carries that window. Measured, no plan
  // does: every live probe answers the weekly trios alone (`claude gauge`, then read each plan's headers), so a
  // column of `no 5h limit` would print a window the provider no longer has on every row. The trio stays PARSED
  // (`usage.ts`), so a plan that carries one again brings the column back for the whole table.
  const showFiveHour = gauges.some((gauge) => gauge.fiveHour !== undefined);
  const windowsHeader = showFiveHour ? WINDOWS_HEADER : WINDOWS_HEADER.slice(WINDOWS_HEADER.indexOf("7-day all"));
  const header = `${"plan".padEnd(width)}    ${"account".padEnd(accountWidth)}  ${windowsHeader}`;
  const rows = gauges.map((gauge) => {
    const marks = [gauge.alias === active ? "*" : " ", gauge.alias === reserved ? "B" : " "].join("");
    // In a mixed table a plan with no five-hour limit says so, rather than a `0%` bar that would read as a window it
    // could still fill.
    const fiveHourCell =
      gauge.fiveHour === undefined ? NO_FIVE_HOUR_LIMIT : flagOf({ claim: "five_hour", gauge, window: gauge.fiveHour });
    return [
      `${gauge.alias.padEnd(width)}${marks}`,
      accountOf({ alias: gauge.alias }).padEnd(accountWidth),
      ...(showFiveHour ? [fiveHourCell] : []),
      flagOf({ claim: "seven_day", gauge, window: gauge.sevenDay }),
      // Absent is "not measured", never "empty" — a blank column is the honest render of a gauge taken with a
      // model that carries no Fable trio, and printing `0%` there would read as a whole unspent Fable week.
      gauge.sevenDayFable === undefined
        ? "     unread     "
        : flagOf({ claim: "seven_day_fable", gauge, window: gauge.sevenDayFable }),
      gauge.sevenDay.resetAtIso,
    ].join("  ");
  });
  return [header, ...rows, "", "* = in the chair   B = held for the browser"];
}

/**
 * One plan's outcome from a gauge sweep: a reading, or the reason there is none.
 *
 * @internal — the shape the `claude gauge` shell produces and {@link gaugeDocument} consumes.
 */
export interface ClaudeGaugeOutcome {
  readonly alias: string;
  readonly gauge?: ClaudeAccountGauge;
  readonly problem?: string;
  /** What this plan's probe cost, as the provider counted it. Absent is UNMEASURED, never zero. */
  readonly probeCost?: ProbeCost;
}

/**
 * One `PROBE COST` line per plan whose probe was NOT under the basically-zero ceiling the owner's cap exemption rides on.
 *
 * Silent for an exempt or unmeasured probe: the line exists to be noticed, so it prints only when it is true.
 *
 * @param outcomes every probed plan's outcome
 * @returns the warning lines, in the order the outcomes came
 */
export function probeCostWarningLines({ outcomes }: { outcomes: readonly ClaudeGaugeOutcome[] }): readonly string[] {
  return outcomes.flatMap(({ alias, probeCost }) =>
    probeCost === undefined || probeCostIsBasicallyZero({ cost: probeCost })
      ? []
      : [
          `PROBE COST ${alias}: ${String(probeCostTokens({ cost: probeCost }))} tokens — not under the ` +
            `${String(BASICALLY_ZERO_TOKENS)} the owner's cap exemption allows, so the gauge probe is no longer basically zero`,
        ],
  );
}

/**
 * One plan's outcome with its reading PAIRED to the plan's usage policy — what {@link gaugeDocument} serialises, so
 * a reader rebuilding the gauge from `claude gauge --json` (`supervisor/tickGaugeShapes.ts`) gets the same
 * allowance and usage limit every gate judged it by.
 *
 * @internal — produced by {@link planGaugeOutcome}.
 */
export interface ClaudePlanGaugeOutcome extends ClaudeGaugeOutcome {
  readonly gauge?: ClaudePlanGauge;
}

/**
 * Pair one probe's outcome with the configured plan it was taken against.
 *
 * @param account the configured plan the probe read
 * @param outcome the probe's outcome
 * @returns the outcome, its reading (when there is one) carrying the plan's allowance and usage limit
 */
export function planGaugeOutcome({
  account,
  outcome,
}: {
  account: Pick<ClaudeAccount, "allowance" | "usageLimitPercent">;
  outcome: ClaudeGaugeOutcome;
}): ClaudePlanGaugeOutcome {
  const { gauge, ...rest } = outcome;
  if (gauge === undefined) {
    return rest;
  }
  return { ...rest, gauge: claudePlanGauge({ account, gauge }) };
}

/**
 * One plan the operator deliberately took out of the fleet, as the document reports it.
 *
 * It is a SEPARATE list from `plans` rather than an outcome with a `problem`, because the two are different
 * claims: a `problem` says a reading was attempted and failed, and a paused plan was never asked. Flattening
 * them would make a declared state indistinguishable from an outage in the one document a console reads.
 */
export interface ClaudeGaugePaused {
  readonly alias: string;
  readonly reason: string;
  readonly sinceIso: string;
}

/* The fleet's spread and each plan's lean, over every plan whose gauge was read. */
function fleetBalance({
  outcomes,
  thresholds,
}: {
  outcomes: readonly ClaudeGaugeOutcome[];
  thresholds: ClaudeThresholds;
}): {
  readonly sevenDay: FleetSpread;
  readonly sevenDayFable: FleetSpread;
  readonly leans: readonly PlanLean[];
} {
  const gauges = outcomes.flatMap((outcome) => (outcome.gauge === undefined ? [] : [outcome.gauge]));
  return {
    leans: planLeans({ gauges }),
    sevenDay: fleetSpread({ gauges, thresholds, window: "seven_day" }),
    sevenDayFable: fleetSpread({ gauges, thresholds, window: "seven_day_fable" }),
  };
}

/* One plan's outcome with its rendered account cell and the trust verdict behind it. */
function accountedOutcome({
  cells,
  outcome,
}: {
  cells: readonly ClaudeAliasAccountCell[];
  outcome: ClaudePlanGaugeOutcome;
}): ClaudePlanGaugeOutcome & { readonly account: string; readonly accountTrust: ClaudeAccountTrust } {
  const cell = cellFor({ alias: outcome.alias, cells });
  return { ...outcome, account: renderAccountCell({ cell }), accountTrust: cell.trust };
}

/* The shape of the `claude gauge --json` document, named because it is the contract a tick's capture parses. */
type GaugeDocument = {
  readonly observedAtIso: string;
  readonly planLines: readonly string[];
  readonly ambient: ClaudeAmbientCredential;
  readonly chair: GaugeChair;
  readonly readable: number;
  readonly unreadable: number;
  readonly paused: readonly ClaudeGaugePaused[];
  readonly plans: readonly (ClaudePlanGaugeOutcome & {
    readonly account: string;
    readonly accountTrust: ClaudeAccountTrust;
  })[];
  readonly balance?: {
    readonly sevenDay: FleetSpread;
    readonly sevenDayFable: FleetSpread;
    readonly leans: readonly PlanLean[];
    readonly chairLevelWith?: readonly string[];
    readonly nextAllModels?: string;
    readonly nextChair?: string;
    readonly nextFable?: string;
  };
  readonly thresholds: ClaudeThresholdFields;
  /** What the chair's paused-plan probe cost, when that plan was probed apart from the sweep and its reply said. */
  readonly chairProbeCost?: { readonly alias: string; readonly cost: ProbeCost };
} & ChairProbe;

/**
 * The machine-readable document `claude gauge --json` prints.
 *
 * Kept pure and separate from the shell so the SHAPE a caller parses is pinned by a test rather than by
 * whatever the shell happened to emit. Every unreadable plan stays in the document with its reason: a sweep
 * that silently dropped the plan it could not read would report a healthier fleet than exists, which is the
 * one lie this whole feature must not tell.
 *
 * The document also carries the AMBIENT credential, because without it every number here answers the wrong
 * question. A gauge reads a STORE, by presenting that store's own token to the provider; what a Claude Code
 * session spends is whatever the environment resolves first, and an API key resolves ahead of a store
 * (`ambientCredential.ts` carries the measurement). So a reader who sees three healthy plans and concludes
 * the fleet has three healthy plans of runway is right only while nothing shadows them — and that condition
 * is invisible in every field but this one.
 *
 * It also carries the BALANCE block, because the owner's ruling is that one command must give
 * a supervisor everything needed to decide what spawns next where. A reader who has to run a second verb to
 * learn which plan the next Fable seat belongs on is a reader who will spawn it wherever the last one went.
 *
 * `balance` is ABSENT on a narrowed sweep, and that absence is load-bearing rather than tidy. Every spread
 * over a single requested plan grades `unmeasurable`, whose whole meaning is "the fleet is unread" — and
 * that would be false whenever the caller simply asked about one plan of a fully readable fleet. A field
 * that cannot be computed honestly is omitted rather than filled with a value a reader would act on.
 *
 * Each plan carries `account` — the rendered account cell, ALWAYS present — and `accountTrust`, the machine
 * readable discriminant behind it. Neither is ever omitted, and that is deliberate in a document as much as
 * in a table: an absent key reads as "nothing to say here" to a parser exactly as a blank column does to a
 * reader, and "nothing bound an address to this store" is a thing to say. `accountTrust` exists so a caller
 * branches on the verdict rather than matching the text of `account`.
 *
 * `chair` is the pinned chair read from each live session's boot credential (`seatBoot.ts`): `active` only when
 * every session names the same plan, `unread` when the chair itself could not be read. It is the field to assert
 * a seat's plan against, since Claude Code's own `userEmail` names the last hand login on the machine, not the plan.
 *
 * `chairReading` is present only when the chair sits on a plan this sweep did not probe — a PAUSED one, on a
 * fleet-wide read — so the chair's own warning still has a reading. It is outside `plans` on purpose: nothing
 * that ranks, balances or routes reads it, because a paused plan must never take a spawn. When that probe FAILED,
 * `chairUnread` names the plan and the reason instead, so a chair whose plan cannot be read is never shown as a
 * chair with nothing to warn about.
 *
 * @param ambient what a session launched in this environment would actually present
 * @param cells each plan's decided account cell, from `accountBinding.ts` * @param chair which plan each live session in the pinned chair booted on, and the mark it earns
 * @param chairProbe the chair's paused plan, probed beside the sweep for the chair's warning alone: its reading,
 *   or why there is none
 * @param outcomes every configured plan's outcome, in configured order
 * @param chairOutcomes the chair's paused-plan probe, probed apart from the sweep, whose cost is printed beside it
 * @param paused every plan the operator took out of the fleet, which was therefore never probed
 * @param nowIso when the sweep ran
 * @param fleetWide whether the sweep covered every configured plan, since balance means nothing otherwise
 * @param planLines one `PLAN` line per CONFIGURED plan (`planReadingRender.ts`), carried verbatim so a tick reads
 *   every plan's windows and resets — paused and unread ones included — from the same lines the human read prints
 * @param nextAllModels the plan the router would send the next all-models spawn to, when one is eligible
 * @param nextChair the plan the router would seat the chair's successor on, ranked as a chair spawn, when one is eligible
 * @param chairLevelWith every other plan within one point of chair headroom of that successor route, which the chair's
 *   cadence keeps a seated chair on (`loadBalance.ts`'s `chairLevelWith`)
 * @param nextFable the plan the router would send the next Fable spawn to, when one is eligible
 * @param thresholds the install's Claude thresholds every verdict here was judged under, carried in the document in
 *   the register's own percents so a tick that judges this reading later (`supervisor/tickGaugeShapes.ts`) uses
 *   the same bars, not whatever the register says by then
 * @returns the document to serialise
 */
export function gaugeDocument({
  ambient,
  cells,
  chair,
  chairOutcomes = [],
  chairLevelWith,
  chairProbe,
  fleetWide,
  nextAllModels,
  nextChair,
  nextFable,
  nowIso,
  outcomes,
  paused,
  planLines,
  thresholds,
}: {
  ambient: ClaudeAmbientCredential;
  cells: readonly ClaudeAliasAccountCell[];
  chair: GaugeChair;
  chairOutcomes?: readonly ClaudeGaugeOutcome[];
  chairLevelWith?: readonly string[];
  chairProbe?: ChairProbe | undefined;
  fleetWide: boolean;
  nextAllModels?: string;
  nextChair?: string;
  nextFable?: string;
  nowIso: string;
  outcomes: readonly ClaudePlanGaugeOutcome[];
  paused: readonly ClaudeGaugePaused[];
  planLines: readonly string[];
  thresholds: ClaudeThresholds;
}): GaugeDocument {
  const balance = {
    ...fleetBalance({ outcomes, thresholds }),
    ...(chairLevelWith === undefined ? {} : { chairLevelWith }),
    ...(nextAllModels === undefined ? {} : { nextAllModels }),
    ...(nextChair === undefined ? {} : { nextChair }),
    ...(nextFable === undefined ? {} : { nextFable }),
  };
  return {
    ambient,
    chair,
    observedAtIso: nowIso,
    paused,
    planLines,
    plans: outcomes.map((outcome) => accountedOutcome({ cells, outcome })),
    readable: outcomes.filter((outcome) => outcome.gauge !== undefined).length,
    thresholds: claudeThresholdFieldsOf({ thresholds }),
    unreadable: outcomes.filter((outcome) => outcome.gauge === undefined).length,
    ...(fleetWide ? { balance } : {}),
    ...chairProbe,
    ...chairOutcomes.flatMap(({ alias, probeCost }) =>
      probeCost === undefined ? [] : [{ chairProbeCost: { alias, cost: probeCost } }],
    )[0],
  };
}
