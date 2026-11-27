/**
 * The pre-spawn gate's conclusions once the readings are in: what an unpinned spawn gets when no gauge read or every
 * plan is barred, and what a pinned seat gets from its own gauge. The gate's orchestration — reading the register,
 * probing, choosing — stays in `./spawnStore.ts`, which owns the hatch names and the result shape these return.
 *
 * Every refusal here names its kind, and the two the owner's own policy raises — `usage-limit` and `not-measured`
 * — never carry a store a spent-plan release could boot onto unless it is the pinned seat's own, which
 * `gateSpawnStore` releases for `spent-plan` alone.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { logger } from "../lib/logger.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { decodePlanAllowance, decodeUsageLimitPercent, type UsageLimitPercent } from "../plans/usageLimit.js";
import type { SessionPlanChoice } from "../sessions/planChoice.js";
import {
  type ClaudeAccount,
  type ClaudeExclusionKind,
  type ClaudePlanGauge,
  type ClaudePlanSpend,
  probedClaudeAccount,
} from "./contracts.js";
import type { ClaudeRotationError } from "./errors.js";
import {
  type ClaudeSpawnRoute,
  renderPolicyRefusal,
  renderSpawnRefusal,
  renderSpawnRoute,
  spawnBlockedBy,
} from "./routeSpawn.js";
import type { SpawnStoreRouting } from "./spawnStore.js";

/**
 * The environment variable that opens a session onto a plan this gate would otherwise refuse as SPENT.
 *
 * An env var rather than a flag because the gate now fires on FIVE spawn paths and only one of them
 * (`cmux spawn`) has flags at all — a `turn dispatch` worker or a recipe child has no command line the owner
 * types. Exported because the refusal names it and a test asserts the refusal names it.
 */
export const ALLOW_SPENT_PLAN_ENV = "SLOPWEAVER_ALLOW_SPENT_PLAN";

/**
 * The environment variable that opens a session when NO plan's gauge could be read at all.
 *
 * A second, independent variable rather than a widening of {@link ALLOW_SPENT_PLAN_ENV}, because the two
 * refusals state different facts and an override is permission for a specific fact. "This plan is spent" is a
 * measurement; "no plan could be read" is the absence of one, and its legitimate exceptions are different —
 * the registered row carries them.
 */
export const ALLOW_UNREADABLE_PLAN_ENV = "SLOPWEAVER_ALLOW_UNREADABLE_PLAN";

/**
 * Whether a plan carries a usage limit below 100% — one the unreadable-plan hatch may never boot it past blind.
 *
 * @param usageLimitPercent the plan's usage limit off its row, absent on a row written before limits existed
 * @returns true when its decoded usage limit is under 100
 */
function belowFullUsageLimit({ usageLimitPercent }: { usageLimitPercent: UsageLimitPercent | undefined }): boolean {
  return decodeUsageLimitPercent({ usageLimitPercent }) < 100;
}

/**
 * The line a `usage-limit` refusal carries when a limited plan's gauge could not be read.
 *
 * @param alias the limited plan, as the refusal names it
 * @param usageLimitPercent its usage limit off its row
 * @returns the refusal's opening line
 */
function unreadableUnderUsageLimit({
  alias,
  usageLimitPercent,
}: {
  alias: string;
  usageLimitPercent: UsageLimitPercent | undefined;
}): string {
  const percent = decodeUsageLimitPercent({ usageLimitPercent });
  return (
    `claude routing: ${alias} has a usage limit of ${String(percent)}% and no readable gauge, so nothing ` +
    `shows it is under that limit — ${ALLOW_UNREADABLE_PLAN_ENV} boots only a plan with no usage limit set`
  );
}

/**
 * What an UNPINNED spawn gets when every configured plan is paused: a named stop, never an unreadable gauge.
 *
 * Pausing an install's last live plan is legal (`./config.ts`): one plan is a whole fleet, and pausing it is the
 * operator taking that fleet out on purpose. So nothing is probed, no store is carried, and neither `force` nor a
 * hatch releases it — `claude resume` is the way on, and the line names it.
 *
 * @param accounts the configured plans, every one of them paused
 * @returns the non-bypassable `paused` refusal
 */
export function everyPlanPaused({ accounts }: { accounts: readonly ClaudeAccount[] }): SpawnStoreRouting {
  const aliases = accounts.map((account) => account.alias).join(", ");
  return {
    refusal:
      `claude routing: every configured Claude plan is paused (${aliases}) — REFUSING. A pause is the operator's ` +
      `own stop, so no \`--force\` and no escape hatch crosses it; to go on, resume one with ` +
      `\`slopweaver claude resume <alias>\`.`,
    refusalKind: "paused",
  };
}

/**
 * The refusal a PINNED spawn gets when the plan its store belongs to is paused — reached when the plan was paused
 * after `--plan` resolved its store, which pausing the last live plan makes an ordinary race. A
 * pause is the operator's own stop whether the spawn was routed or pinned, so this is the same non-bypassable
 * `paused` kind, never the unreadable-plan refusal whose hatch would boot the paused store anyway.
 *
 * @param alias the paused plan the pin names
 * @param storeDir the store the caller pinned, carried so the refusal still names it
 * @returns the non-bypassable `paused` refusal
 */
export function pinnedPlanPaused({ alias, storeDir }: { alias: string; storeDir: string }): SpawnStoreRouting {
  return {
    refusal:
      `claude routing: the pinned plan \`${alias}\` is paused — REFUSING. A pause is the operator's own stop, so ` +
      `no \`--force\` and no escape hatch crosses it; to go on, resume it with \`slopweaver claude resume ${alias}\`.`,
    refusalKind: "paused",
    storeDir,
  };
}

/**
 * The refusal printed when no plan's gauge could be read at all, and the store named when its hatch is open.
 *
 * The fallback is chosen from PROBED plans only: a monthly-spend plan is admitted on its recorded spend or not at
 * all, so the unreadable-plan hatch, which is permission to boot without a reading, is never permission to boot onto
 * one. Nor is the fallback ever a plan with a usage limit below 100%: with no reading nothing shows it is under that limit,
 * so the hatch boots only an unlimited plan, and when only limited ones are left it refuses as `usage-limit`.
 *
 * @param accounts the configured, unpaused plans, in configured order
 * @param choiceFor builds the plan choice the session records when the hatch names a plan, from its alias
 * @param hatchOpen whether {@link ALLOW_UNREADABLE_PLAN_ENV} is set
 * @returns the gate's conclusion for the no-gauge case
 */
export function noGaugeReadable({
  accounts,
  choiceFor,
  hatchOpen,
}: {
  accounts: readonly ClaudeAccount[];
  choiceFor?: (options: { alias: string }) => SessionPlanChoice;
  hatchOpen: boolean;
}): SpawnStoreRouting {
  const measurable = accounts.filter((account) => probedClaudeAccount({ account }));
  if (!hatchOpen) {
    return { refusal: hatchRefusal({ hatch: hatchFor({ id: "unreadable-plan" }) }), refusalKind: "unreadable-plan" };
  }
  const fallback = measurable.find((account) => !belowFullUsageLimit({ usageLimitPercent: account.usageLimitPercent }));
  const limited = measurable.find((account) => belowFullUsageLimit({ usageLimitPercent: account.usageLimitPercent }));
  if (fallback === undefined && limited !== undefined) {
    return {
      refusal: renderPolicyRefusal({
        alias: limited.alias,
        allowance: "weekly-window",
        kind: "usage-limit",
        limit: unreadableUnderUsageLimit({ alias: limited.alias, usageLimitPercent: limited.usageLimitPercent }),
      }),
      refusalKind: "usage-limit",
    };
  }
  if (fallback === undefined) {
    return { refusal: hatchRefusal({ hatch: hatchFor({ id: "unreadable-plan" }) }), refusalKind: "unreadable-plan" };
  }
  // An EXPLICIT store, never the ambient slot. The choice is configured ORDER and nothing more — it is not a
  // capacity decision, because there is no capacity reading to decide from, and the warning says so.
  logger.error({
    msg:
      `claude routing: no plan's gauge was readable, and ${ALLOW_UNREADABLE_PLAN_ENV}=1 is set — booting on ` +
      `${fallback.alias} because it is FIRST IN CONFIGURED ORDER, not because anything measured it. Its ` +
      `remaining budget is unknown.`,
  });
  return {
    basis: "unreadable-override",
    storeDir: fallback.storeDir,
    ...(choiceFor === undefined ? {} : { choice: choiceFor({ alias: fallback.alias }) }),
  };
}

/**
 * The kinds of exclusion a spent-plan override may cross: the provider's own refusal and the house bar. The owner's
 * usage limit and a not-measured plan are absent ON PURPOSE — `force` never nominates one.
 */
const BYPASSABLE_EXCLUSIONS: ReadonlySet<ClaudeExclusionKind> = new Set(["provider-refused", "routing-bar"]);

/** What a refusal says when the provider refuses a monthly-spend plan's spend: a fact no override crosses. */
const NO_MONTHLY_RELEASE = "no override boots a monthly-spend plan the provider refuses";

/**
 * What an UNPINNED spawn gets when every readable plan is spent.
 *
 * It carries a `storeDir` alongside the refusal, which is what lets `force` release onto a NAMED plan instead of
 * handing back a storeless success. The store is the first WEEKLY-WINDOW plan, in configured order, that was READ
 * and barred only by the house bar or the provider: a spent plan the owner chose to spend, never an unnamed
 * credential, never a plan at the owner's own usage limit or one nothing measures, and never a monthly-spend plan — a
 * release onto one would spend dollars on a plan the provider has just refused, and an admin raising its limit
 * mid-session would let that session spend past the owner's.
 *
 * When no such plan exists, the refusal is the policy's own, carrying NO store, so neither `force` nor
 * {@link ALLOW_SPENT_PLAN_ENV} has anything to release onto.
 *
 * @param accounts the configured plans, in configured order
 * @param choiceFor builds the plan choice a release onto the named spent plan records, from its alias; the gate
 *   drops it unless the release happens
 * @param route what the router concluded, for the refusal's own wording and each plan's typed exclusion
 * @returns the refusal, and the store a release would use when one may
 */
export function everyPlanSpent({
  accounts,
  choiceFor,
  route,
}: {
  accounts: readonly ClaudeAccount[];
  choiceFor?: (options: { alias: string }) => SessionPlanChoice;
  route: ClaudeSpawnRoute;
}): SpawnStoreRouting {
  const bypassable = new Set(
    route.excluded.filter((exclusion) => BYPASSABLE_EXCLUSIONS.has(exclusion.kind)).map((exclusion) => exclusion.alias),
  );
  const spentCandidate = accounts.find((account) => bypassable.has(account.alias) && probedClaudeAccount({ account }));
  if (spentCandidate === undefined) {
    return policyRefusal({ accounts, limit: renderSpawnRoute({ route }), route });
  }
  return {
    refusal: renderSpawnRefusal({
      eligible: [],
      escapeHatchEnv: ALLOW_SPENT_PLAN_ENV,
      limit: renderSpawnRoute({ route }),
    }),
    refusalKind: "spent-plan",
    route,
    storeDir: spentCandidate.storeDir,
    ...(choiceFor === undefined ? {} : { choice: choiceFor({ alias: spentCandidate.alias }) }),
  };
}

/**
 * The refusal for a spawn no plan can take and no release may cross: `usage-limit` when any plan is at the owner's
 * limit, else `not-measured` when any plan has no evidence, else the provider refusing every remaining monthly plan's
 * spend. It carries no `storeDir`, so nothing downstream can release onto one even by mistake.
 *
 * @param accounts the configured plans, whose allowance the fix command names
 * @param limit the already-rendered description of what barred this spawn
 * @param route the route, carried for the caller's journal; its exclusions are never empty here
 * @returns the refusal
 */
function policyRefusal({
  accounts,
  limit,
  route,
}: {
  accounts: readonly ClaudeAccount[];
  limit: string;
  route: ClaudeSpawnRoute;
}): SpawnStoreRouting {
  for (const kind of ["usage-limit", "not-measured"] as const) {
    const fired = route.excluded.find((exclusion) => exclusion.kind === kind);
    if (fired !== undefined) {
      const account = accounts.find((candidate) => candidate.alias === fired.alias);
      const allowance = decodePlanAllowance({ allowance: account?.allowance }).kind;
      return { refusal: renderPolicyRefusal({ alias: fired.alias, allowance, kind, limit }), refusalKind: kind, route };
    }
  }
  // What is left is a monthly plan the provider refuses — extra usage off, or its own limit reached. A provider fact,
  // so `spent-plan`; with no store, so no release can boot it.
  return { refusal: `${limit} — REFUSING: ${NO_MONTHLY_RELEASE}.`, refusalKind: "spent-plan", route };
}

/**
 * A monthly-spend pinned seat judged on its recorded spend, never probed: allowed while its verdict is open, else
 * refused with no hatch. A POLICY refusal carries the store so a caller can journal which seat it was, and
 * `gateSpawnStore` releases only `spent-plan`; the provider refusing the plan's spend is `spent-plan` and carries NO
 * store, exactly as {@link everyPlanSpent}'s, so no release can boot it.
 *
 * @param account the pinned plan
 * @param spend its spend verdict at this spawn's instant
 * @param storeDir the pinned store
 * @returns that store, or the refusal when its spend bars this spawn
 */
export function pinnedSpendVerdict({
  account,
  spend,
  storeDir,
}: {
  account: ClaudeAccount;
  spend: ClaudePlanSpend;
  storeDir: string;
}): SpawnStoreRouting {
  const { verdict } = spend;
  if (verdict.kind === "open") {
    return { basis: "pinned", storeDir };
  }
  const limit = `claude routing: the pinned seat ${account.alias} has monthly spend: ${verdict.reason}`;
  if (verdict.kind === "provider-refused") {
    return { refusal: `${limit} — REFUSING: ${NO_MONTHLY_RELEASE}.`, refusalKind: "spent-plan" };
  }
  return {
    refusal: renderPolicyRefusal({ alias: account.alias, allowance: "monthly-spend", kind: verdict.kind, limit }),
    refusalKind: verdict.kind,
    storeDir,
  };
}

/**
 * A pinned seat judged by its own live gauge: allowed, refused on the owner's policy, or refused as spent.
 *
 * @param gauge the pinned plan's own reading
 * @param gauges every reading the probe returned, so a spent-plan refusal can name what is still eligible
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param storeDir the pinned store
 * @param thresholds the install's Claude thresholds, off the register
 * @returns that store, plus the refusal when its own gauge bars this spawn
 */
export function pinnedGaugeVerdict({
  gauge,
  gauges,
  model,
  storeDir,
  thresholds,
}: {
  gauge: ClaudePlanGauge;
  gauges: readonly ClaudePlanGauge[];
  model: string | undefined;
  storeDir: string;
  thresholds: ClaudeThresholds;
}): SpawnStoreRouting {
  const blocked = spawnBlockedBy({ gauge, model, thresholds });
  if (blocked === undefined) {
    return { basis: "pinned", storeDir };
  }
  const back = blocked.eligibleAtIso === undefined ? "no reset instant was readable" : `back ${blocked.eligibleAtIso}`;
  const limit = `claude routing: the pinned seat ${blocked.alias} has ${blocked.reason} — ${back}`;
  if (blocked.kind === "usage-limit" || blocked.kind === "not-measured") {
    return {
      // A live gauge exists only for a probed plan, so this plan's usage limit is a share of its weekly window.
      refusal: renderPolicyRefusal({ alias: blocked.alias, allowance: "weekly-window", kind: blocked.kind, limit }),
      refusalKind: blocked.kind,
      storeDir,
    };
  }
  return {
    refusal: renderSpawnRefusal({
      eligible: gauges.filter((reading) => spawnBlockedBy({ gauge: reading, model, thresholds }) === undefined),
      escapeHatchEnv: ALLOW_SPENT_PLAN_ENV,
      limit,
    }),
    refusalKind: "spent-plan",
    storeDir,
  };
}

/**
 * What a PINNED seat whose own gauge could not be read gets: the unreadable-plan refusal, or that same store.
 *
 * Other plans reading fine is not evidence about this one, and a pin is not negotiable — so the hatch returns
 * the seat's own store rather than a different plan's, and never the ambient slot. A store `--plan` named that
 * the register stopped carrying before the gate ran lands here too: its gauge is just as unreadable.
 *
 * @param seat named in the warning — a pinned plan's alias, or the store `--plan` named and why it is unread
 * @param hatchOpen whether {@link ALLOW_UNREADABLE_PLAN_ENV} is set
 * @param storeDir the pinned store
 * @param usageLimitPercent the pinned plan's usage limit off its row, undefined for a store the register no longer
 *   carries; below 100 the hatch refuses as `usage-limit`, because nothing shows the seat under that limit
 * @returns the refusal, or that store with a warning
 */
export function pinnedWithNoGauge({
  hatchOpen,
  seat,
  storeDir,
  usageLimitPercent,
}: {
  hatchOpen: boolean;
  seat: string;
  storeDir: string;
  usageLimitPercent: UsageLimitPercent | undefined;
}): SpawnStoreRouting {
  if (!hatchOpen) {
    return {
      refusal: hatchRefusal({ hatch: hatchFor({ id: "unreadable-plan" }) }),
      refusalKind: "unreadable-plan",
      storeDir,
    };
  }
  if (belowFullUsageLimit({ usageLimitPercent })) {
    return {
      refusal: renderPolicyRefusal({
        alias: seat,
        // Only a probed plan, or a store the register no longer carries (no usage limit), ever reaches this gate.
        allowance: "weekly-window",
        kind: "usage-limit",
        limit: unreadableUnderUsageLimit({ alias: seat, usageLimitPercent }),
      }),
      refusalKind: "usage-limit",
      storeDir,
    };
  }
  logger.error({
    msg:
      `claude routing: the pinned seat ${seat} has no readable gauge, and ${ALLOW_UNREADABLE_PLAN_ENV}=1 is ` +
      `set — booting on it anyway, with its remaining budget unknown`,
  });
  return { basis: "unreadable-override", storeDir };
}

/**
 * The `stale-store` hatch's variable, read off its register row so the refusal and the reader name one thing.
 *
 * @internal — exported so the refusal's test names the same variable
 */
export const STALE_STORE_HATCH_ENV: string = staleStoreVariable();

/** The variable the `stale-store` row keys on; a row keyed any other way is a broken register, said at load. */
function staleStoreVariable(): string {
  const { key } = hatchFor({ id: "stale-store" });
  if (key.kind !== "env") {
    throw new Error("the stale-store hatch row is not keyed on an environment variable");
  }
  return key.variable;
}

/**
 * What EVERY spawn gets when the register is present and unusable — unpinned or pinned, hatch or not.
 *
 * Which plans exist is unknown, and so is the usage limit and allowance the owner set on each: booting anyway means
 * booting on a plan nothing showed is under the limit the owner chose, or onto whatever credential is ambient. So the
 * refusal has no hatch and `force` never releases it (`gateSpawnStore` releases `spent-plan` alone). That is chosen
 * over a hatch that kept an install with no limits moving, because going over the limit the owner set is the very
 * bad outcome. It replaced two allowances: the
 * `unreadable-plan` hatch booting an unpinned spawn on the ambient credential, and a standing pin booting as named
 * because "the register adds nothing" — it adds the pin's own usage limit.
 *
 * A PINNED caller's refusal carries its store, so the journal still names which seat was stopped; the refusal's
 * kind is `configuration`, which no release reads.
 *
 * **A STALE store says how to seat the investigator, and that is not a hatch over this refusal.** When the store
 * answered and `connectStore` refused it as stale, the `stale-store` hatch opens the store as it stands; while the
 * `plan_register` row still queries on that schema the register READS and every usage limit in it is judged — so the
 * spawn the chair runs under it meets this gate with a register in hand, and never crosses an unread limit. A
 * migration that broke the register's own table leaves it unreadable under the hatch too, and this gate refuses
 * again. Saying "nothing crosses" there was false, and it is the line a chair reads when it tries to seat the
 * investigator the owner's rule says it must (`skills/supervisor/reference/boots-refused.md`). A store that cannot
 * be opened at all still names no way through.
 *
 * @param error what was wrong with the register
 * @param storeDir the pinned store, or undefined for an unpinned spawn
 * @returns the refusal
 * @internal — exported for its unit test; `gateSpawnStore` in `./spawnStore.ts` is the caller
 */
export function unusableConfiguration({
  error,
  storeDir,
}: {
  error: ClaudeRotationError;
  storeDir: string | undefined;
}): SpawnStoreRouting {
  const stale = error.code === "ACCOUNT_CONFIG_STORE_UNAVAILABLE" && error.staleStore === true;
  const way = stale
    ? `the store answered and was refused as stale, and \`${STALE_STORE_HATCH_ENV}=1\` opens it as it stands, so if ` +
      "the register still queries there, it and every limit in it READ: seat ONE investigator under it to judge the " +
      "pending migration (skills/supervisor/reference/boots-refused.md), never a blind `store push`."
    : "no hatch and no --force crosses an unread usage limit.";
  const refusal =
    `claude routing: ${error.message} — the usage limit and allowance on every plan went unread with it, so no Claude ` +
    `spawn boots until the register reads again; ${way} ` +
    "`slopweaver plans validate` says what is wrong, and the `claude-plan-unusable` monitor floats this fault as a note.";
  return { refusal, refusalKind: "configuration", ...(storeDir === undefined ? {} : { storeDir }) };
}
