/**
 * The pre-spawn credential gate: read the LIVE gauge of the account a session would actually boot on, REPAIR a
 * store whose token has merely expired, choose a plan when nothing pinned one, and refuse rather than open a
 * session into a wall or onto a credential nobody can name.
 *
 * ## Why this module moved out of the `cmux spawn` verb
 *
 * MEASURED: the bot loop re-dispatched two stranded asks and both workers
 * (`cmux read-screen workspace:280`/`:281`) booted on the DEFAULT keychain — the account already at its
 * weekly wall — and sat rendering `Weekly limit reached · Retrying in 5h (<reset day> at <reset hour>) · attempt 1/300`
 * with zero tool calls while `ListAgents` reported them busy. Routing existed and was correct; it just lived
 * inside one CLI verb, and `turn dispatch`, `turn review` and both recipe spawns never called it. The rule is
 * to make this mistake structurally impossible: a check runs before any session spawns, to see what account it
 * is on.
 *
 * So the gate is no longer a call a caller may forget. It is a REQUIRED member of `cmux/spawn.ts`'s
 * `SpawnDeps`, applied by `bootCmuxWorkspace` before any worktree or workspace exists, and this module is in
 * `src/claude/` rather than under `cli/` precisely so the spawn primitive can reach it without importing a
 * verb.
 *
 * ## Why every spawn pays for a live read
 *
 * MEASURED the same day, and it is the reason this cannot be a cached number or a remembered active plan: the
 * default keychain item and the `plan-one` item held DIFFERENT tokens at the same instant, because a
 * `/login` performed inside a session running under `CLAUDE_SECURESTORAGE_CONFIG_DIR=<plan-one>` rewrote the
 * plan-one item and the SHARED `~/.claude.json` account record, and left the default item alone. So
 * `claude auth status` reported the fresh account on the default store while its requests still went out on
 * a spent token. A spawn must therefore be judged by a live reading of the token it will ACTUALLY send.
 *
 * ## An expired token is REPAIRED here, which is why the clock was retired
 *
 * A probe the provider answered `401` to used to end the story: the plan was reported unreadable and the
 * spawn went on without it. That is what made an eight-hour access-token TTL behave like a sign-in deadline,
 * and it is what three successive keep-alive timers were built to work around. It is a cache miss:
 * `credentialRepair.ts` carries the measurement that every store's refresh grant runs weeks out, and
 * `probeRepair.ts` performs the two-pass read that repairs one refused store at the moment something wants
 * it. Nothing is owed between spawns, because nothing needs a token between spawns.
 *
 * **What that costs in latency, as a budget rather than a promise.** The gate is no longer bounded by one
 * probe's ten seconds. Count the keychain READS rather than the stores, because one reading serves as both the
 * decision and the refresh witness's baseline. Each store is read once by its first probe; a REFUSED one once more to decide,
 * which is also the before-baseline; an ATTEMPTED one once after the command; and a re-probed one once more.
 * So for `N` configured plans of which `R` were refused, `A` attempted and `Q` re-probed, the configured
 * timeout ALLOWANCES add up to `5 × (N + R + A + Q) + 60A + 20` seconds — `5` per keychain read
 * (`keychain.ts`), `60` per refresh command (`storeRefresh.ts`), `10` per concurrent probe sweep
 * (`probeStore.ts`), of which there are two. With every store refused and repaired, `R = A = Q = N`, so that is
 * `80N + 20`, and four plans is **340 seconds**. That is a sum of ceilings and NOT a measurement. MEASURED on
 * one machine against two naturally expired stores, one repaired each time: **12.4s** and
 * **9.1s** wall clock. The ordinary case attempts nothing and costs `5N + 10`, because a plan the provider did
 * not refuse is never read a second time. Reproduce with `time slopweaver claude route --model fable`.
 *
 * One cost sits OUTSIDE that sum: after the sweep the gate files each plan's effective probe in the store's
 * `claude-plan-probes` row (`./spawnGauges.ts`) — one local store open and at most three read-and-compare-and-set
 * attempts (`./planProbesStore.ts`), with no timeout of its own. It never refuses a spawn: a store that cannot be
 * reached prints one line and the gate decides on the same gauges.
 *
 * ## Fail CLOSED on evidence, fall through only on a genuinely absent install
 *
 * This used to collapse three different configurations into one empty list and fall through on all of them.
 * The three are now separated, and the distinction is the gate's shape:
 *
 * - **No Claude destination registered at all** — an install without the fleet, whether nothing has been
 *   registered or nothing has been configured. No store override, the ambient slot, a byte-identical boot
 *   line. That is the only remaining fall-through and it is a legitimate configuration.
 * - **A register that is present and unreadable, readable and invalid, or in a store that cannot be reached** —
 *   which plans exist, and the usage limit and allowance the owner set on each, are UNKNOWN, so EVERY spawn refuses:
 *   unpinned, a standing pin and a `--plan` pin alike, and no hatch and no `force` crosses it. This is chosen over
 *   keeping a hatch because going over a limit the owner set hurts trust: fail closed, but let the owner know
 *   early that something is wrong with one of their plans. A typo in the register therefore stops the
 *   fleet until it is fixed, and `claude-plan-unusable` floats the register fault the pass it is seen, so the
 *   owner learns it then rather than from a stalled fleet.
 * - **Configuration fine, no gauge readable even after repairs** — also a refusal, under its own registered
 *   hatch (`unreadable-plan`), and when that hatch IS open the gate returns an EXPLICIT store rather than no
 *   store. Permission to proceed without gauge evidence is never permission to boot on an unnamed credential;
 *   that was the escape in the old generic "strip the refusal when forced" tail.
 * - **Gauges readable and every candidate spent** — the refusal that already existed, under the hatch that
 *   already existed (`spent-plan`).
 * - **The plan is at the owner's usage limit, or is a monthly-spend plan with no fresh spend reading** — `usage-limit`
 *   and `not-measured`, with NO hatch at all (`../plans/usageLimit.ts` quotes why). A monthly plan is never probed
 *   here — it is judged on its recorded spend (`./spendBudgets.ts`), in dollars, as a fallback behind every
 *   eligible weekly plan — and the unreadable-plan fallback and the spent-plan release never name one. Nor
 *   does the unreadable-plan hatch boot a plan whose limit is BELOW 100%: with no reading, nothing shows it is
 *   under that limit, and no override crosses one.
 *
 * The two hatches are independent on purpose and neither releases the other. `force` answers "boot onto a
 * plan I can SEE is spent"; it says nothing about booting with no evidence at all, and reading it as both is
 * how a dead fleet would have gone on looking like a working one.
 *
 * ## And NONE of the three fires under an API key, which is checked before anything else
 *
 * An Anthropic-issued credential in the environment outranks every credential store, so no store decides what
 * the session spends and no refusal about a store is about anything. {@link underApiKey} carries the
 * measurement and the two review passes it took to put the check in the right place.
 */
import { slopweaverHome } from "../config.js";
import { logger } from "../lib/logger.js";
import type { PlanRegisterPort } from "../plans/port.js";
import type { ClaudeAmbientCredential } from "./ambientCredential.js";
import { aliasForStoreDir, unpausedAccounts } from "./config.js";
import { type ClaudeAccount, probedClaudeAccount } from "./contracts.js";
import type { ClaudePlanProbesPort } from "./planProbes.js";
import { type ProbeRepairDeps, repairSeams } from "./probeRepair.js";
import { type ClaudeSpawnRoute, renderSpawnRoute, routeSpawnToPlan } from "./routeSpawn.js";
import { readClaudeFleet, type readSpawnAccounts } from "./spawnAccounts.js";
import { readSpawnGauges } from "./spawnGauges.js";
import {
  ALLOW_SPENT_PLAN_ENV,
  ALLOW_UNREADABLE_PLAN_ENV,
  everyPlanPaused,
  everyPlanSpent,
  noGaugeReadable,
  pinnedGaugeVerdict,
  pinnedPlanPaused,
  pinnedSpendVerdict,
  pinnedWithNoGauge,
  unusableConfiguration,
} from "./spawnStoreRefusals.js";
import { readClaudePlanSpends } from "./spendBudgets.js";

/**
 * Whether this spawn's spent-plan escape hatch is open — the flag a verb parsed, OR the ambient variable the
 * refusal names, never one instead of the other.
 *
 * It is an OR, and it lives in a named function, because of what happened when it was neither. MEASURED
 * from a supervisor seat:
 * `SLOPWEAVER_ALLOW_SPENT_PLAN=1 slopweaver cmux spawn <slug> --model fable` printed the SAME refusal it had
 * printed without the variable — "To override, run the same command again with SLOPWEAVER_ALLOW_SPENT_PLAN=1"
 * — so the block told the operator to do the thing the operator had just done, and with the ruling that a
 * supervisor runs on Fable and no other model, the chain could seat no successor at all. The cause was that
 * `cmux/spawn.ts` read the variable in a PARAMETER DEFAULT, and a default initialiser is skipped whenever a
 * caller passes that argument at all: `cmux spawn` always passed one (its own `--force`, `false` when the
 * flag was absent), so the variable was inert on the one verb the refusal named. The methodology is that
 * there is always an escape hatch, not heavy-handed hard blocks. A hatch that does not open is
 * worse than no hatch, because the operator stops looking for another way out.
 *
 * The shape is now machine-enforced too — `src/devLint/hatchRelease.ts` refuses any escape-hatch environment
 * read written as a parameter default, anywhere in the tree.
 *
 * @param flag the caller's own escape, already parsed — `cmux spawn --force`; `false` on the four spawn
 * paths that have no command line to type one on
 * @param env the raw value of {@link ALLOW_SPENT_PLAN_ENV}, or undefined when it is unset
 * @returns true when the spawn may open onto a plan the live gauges call spent
 */
export function spentPlanHatchOpen({ flag, env }: { flag: boolean; env: string | undefined }): boolean {
  return flag || env === "1";
}

/**
 * Whether this spawn's unreadable-gauge escape hatch is open.
 *
 * It takes no caller flag, and that absence is deliberate rather than an omission: `cmux spawn --force` means
 * "onto a spent plan" and has meant that since it existed. Folding a second, different permission into it
 * would make every forced spawn also a permission to boot blind, which is the one thing the old generic
 * refusal-stripping tail did wrong.
 *
 * @param env the raw value of {@link ALLOW_UNREADABLE_PLAN_ENV}, or undefined when it is unset
 * @returns true when the spawn may open with no readable gauge at all, on an explicitly named store
 */
export function unreadablePlanHatchOpen({ env }: { env: string | undefined }): boolean {
  return env === "1";
}

/**
 * Why the gate allowed a spawn with no gauge-based choice behind it.
 *
 * @internal — the `basis` of {@link SpawnStoreRouting}; callers read that field.
 */
export type SpawnStoreBasis =
  /** A plan was chosen from live gauges. */
  | "routed"
  /** The caller pinned a seat, and its own gauge was read. */
  | "pinned"
  /** No Claude destination is registered, so routing does not apply at all and the ambient slot stands. */
  | "unconfigured"
  /** No gauge was readable and the unreadable-plan hatch is open, so a configured store was named instead. */
  | "unreadable-override"
  /** An Anthropic-issued credential outranks every store, so no store decides anything and none is named. */
  | "api-key";

/**
 * WHICH refusal this is, named rather than inferred.
 *
 * It exists because inferring it was a real defect waiting to happen: a spent-plan refusal and a pinned seat's
 * unreadable-gauge refusal both carry a `storeDir`, so any test over the shape of the value would have let
 * `force` release the one it must never release. `force` is permission to spend a plan you can SEE is spent.
 *
 * @internal — the `refusalKind` of {@link SpawnStoreRouting}; callers read that field.
 */
export type SpawnRefusalKind =
  /** A live reading says the chosen plan is spent. Released by {@link ALLOW_SPENT_PLAN_ENV} or `force`. */
  | "spent-plan"
  /** No gauge was readable. Released by {@link ALLOW_UNREADABLE_PLAN_ENV} only, at the branch that raised it. */
  | "unreadable-plan"
  /**
   * The register is present and unusable, or the routed plan has no configured store. NON-BYPASSABLE in both
   * cases: no hatch and no `force` releases it — see {@link unusableConfiguration} and {@link routeSpawnStore}'s
   * unmapped-alias arm.
   */
  | "configuration"
  /**
   * The plan is at the owner's own usage limit (`../plans/usageLimit.ts`). NON-BYPASSABLE: `force`,
   * {@link ALLOW_SPENT_PLAN_ENV} and {@link ALLOW_UNREADABLE_PLAN_ENV} never release it, because the limit is a
   * ceiling the owner set and the fleet stops at it.
   */
  | "usage-limit"
  /**
   * The plan that could take this spawn is a monthly-spend plan with no fresh, readable spend reading, so nothing
   * shows it is under the owner's limit. NON-BYPASSABLE, for the same reason, and no such plan was probed to learn it.
   */
  | "not-measured"
  /**
   * Every configured plan is paused, or the one a pinned spawn names is — a deliberate stop, never a broken
   * register (`./config.ts`). NON-BYPASSABLE:
   * no hatch and no `force` releases it, and no plan was probed to learn it; `claude resume` is the way on.
   */
  | "paused";

/** What the gate concluded, in the terms a spawn acts on. */
export interface SpawnStoreRouting {
  /** The store to boot against, absent when the gate did not apply or found nothing to override with. */
  readonly storeDir?: string;
  /** The refusal to report, when a successful read said this spawn must not proceed. */
  readonly refusal?: string;
  /** Which refusal it is, so a caller releases exactly the one its permission covers. */
  readonly refusalKind?: SpawnRefusalKind;
  /** The route, when one was computed — carried so a caller can journal the gauge the choice was made from. */
  readonly route?: ClaudeSpawnRoute;
  /**
   * WHY this conclusion was reached, for a caller that must tell "no plan was readable" apart from "this
   * install has no plans". A `route` of `undefined` alone cannot: they were the same value, and
   * `claude route` reported the first as the second.
   */
  readonly basis?: SpawnStoreBasis;
}

/** What one gate invocation needs to know about itself, resolved once by the production caller. */
export interface SpawnGateContext {
  /** The Slopweaver home the plan register lives under. */
  readonly home?: string;
  /** The repair seams. */
  readonly deps?: ProbeRepairDeps;
  /**
   * Where the plan register is read — `planRegisterPort()` from the production caller, a seam in a test.
   * Required, never defaulted, so a gate a test forgot to inject cannot reach a real store.
   */
  readonly port: PlanRegisterPort;
  /**
   * Where each sweep's probes are filed for the owner's sign-in note — `claudePlanProbesPort()` from the production
   * caller, a seam in a test. Required for the same reason as `port`.
   */
  readonly probesPort: ClaudePlanProbesPort;
  /** Whether the unreadable-plan hatch is open, resolved by the production caller and never defaulted here. */
  readonly unreadableHatchOpen: boolean;
  /**
   * Whether the pinned store was named by `--plan` this invocation. Such a store is MEASURED, never trusted: one
   * the register no longer carries is refused like any unreadable gauge, not booted on as a standing pin is.
   */
  readonly namedPin?: boolean;
  /**
   * What the environment says this session would ACTUALLY present, resolved by the production CALLER.
   *
   * Required rather than defaulted, and for two reasons. It is load-bearing — {@link unreadableUnderApiKey}
   * carries why — and resolving it needs a `settings.json` read that lives under `cli/commands/claude/`, which
   * this module may not import: `spawnStore.ts` is in `src/claude/` precisely so the spawn primitive can reach
   * it without pulling in a verb.
   */
  readonly ambient: ClaudeAmbientCredential;
}

/**
 * The Slopweaver home whose plan register this gate reads.
 *
 * `claude route`, and a reseat that names no store, carry no home: they gate a spawn on the operator's own
 * install, so the register is read from the resolved home. A caller holding an explicit home names it.
 */
function registerHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * What NAMED an Anthropic-issued credential outranking every store, when one does.
 *
 * @param context this invocation's injected ambient classification
 * @returns the name of what shadows the stores, or undefined when nothing does
 */
function shadowingSource({ context }: { context: SpawnGateContext }): string | undefined {
  return context.ambient.kind === "shadowed" ? context.ambient.source : undefined;
}

/**
 * What the gate concludes when an Anthropic-issued credential outranks every credential store.
 *
 * `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `apiKeyHelper` all resolve ahead of the saved claude.ai login
 * a store holds, measured against Claude Code v2.1.261 (`ambientCredential.ts` carries the reproduction). So
 * under one of them the session presents an API key whatever store it was booted against: every configured plan
 * could be signed out, or spent, or unconfigured, and the spawn would still work.
 *
 * **Which is why this is checked FIRST, ahead of reading the configuration at all.** Two Codex review passes
 * found it in two places. The first version only exempted the no-gauge refusal, so an emptied register
 * still refused a working spawn; the second still refused a READABLE spent plan, which is a true measurement
 * about a plan this session will not spend. Neither refusal was about anything. The old gate allowed all of
 * them by accident, through the same fall-through this change closed, and refusing them would have been a
 * regression with a usable credential in hand.
 *
 * The spawn proceeds with no routing and no store override of its own, which is the honest answer: there is no
 * store to name, because no store decides anything here. A caller that PINNED one keeps it, since that is the
 * caller's own choice and not this gate's.
 *
 * @param source what named the shadowing credential
 * @returns the gate's conclusion, allowed and unrouted and said out loud
 */
function underApiKey({ source }: { source: string }): SpawnStoreRouting {
  logger.error({
    msg:
      `claude routing: \`${source}\` outranks every credential store, so this session presents an API key ` +
      `rather than a plan login. No store decides what it spends, no plan gauge describes its cost, and nothing ` +
      `was routed or refused on one. An API key bills a Console organisation per token.`,
  });
  return { basis: "api-key" };
}

/**
 * Read every configured plan's gauge, repair what had merely expired, and choose the store an UNPINNED spawn
 * boots against.
 *
 * @param chair whether this spawn seats the supervisor chair, routed under the chair's Fable-week bar
 * @param context this invocation's home, seams and hatch state
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @returns the store to use, or the refusal, or neither when this install has no configured plans
 */
export async function routeSpawnStore({
  chair,
  context,
  model,
}: {
  chair?: boolean;
  context: SpawnGateContext;
  model: string | undefined;
}): Promise<SpawnStoreRouting> {
  // The API-key exemption is checked HERE as well as in `gateSpawnStore`, because `claude route` calls this
  // function directly and its whole contract is to be the same call a spawn makes. Without it, under an ambient API
  // key a spawn returns `api-key` and probes nothing, while `claude route` would go on to probe and repair. Idempotent, so the outer check staying is not a duplication to remove.
  const shadowed = shadowingSource({ context });
  if (shadowed !== undefined) {
    return underApiKey({ source: shadowed });
  }
  const home = registerHome({ home: context.home });
  const fleet = await readClaudeFleet({ home, port: context.port });
  if (fleet.isErr()) {
    return unusableConfiguration({ error: fleet.error, storeDir: undefined });
  }
  const { accounts, thresholds } = fleet.value;
  if (accounts === undefined) {
    return { basis: "unconfigured" };
  }
  // A PAUSED plan never reaches the probe, and this is the whole of the fix. Every surface downstream —
  // `readSpawnGauges`, `routeSpawnToPlan`, the no-gauge and every-plan-spent arms — then cannot see it, so
  // none of them needs its own notion of paused. Routing prints NOTHING about it either: a line on every
  // spawn about a plan the operator deliberately took out is the noise this exists to remove, and
  // `claude gauge` is where a paused plan is reported.
  const live = unpausedAccounts({ accounts });
  if (live.length === 0) {
    return everyPlanPaused({ accounts });
  }
  // A monthly-spend plan is never PROBED — its allowance is dollars, which no rate-limit header reports, and every
  // probe is a billed request. It is read from its recorded spend instead, which costs nothing.
  const weekly = live.filter((account) => probedClaudeAccount({ account }));
  const seams = repairSeams({ deps: context.deps });
  const gauges = await readSpawnGauges({ accounts: weekly, deps: seams, home, probesPort: context.probesPort });
  const spends = readClaudePlanSpends({ accounts: live, home, nowIso: seams.nowIso() });
  // No weekly reading and no monthly plan open is the unreadable fleet, unless the fleet is monthly plans alone —
  // then the router's own refusal names which of the owner's policies barred each one.
  const anyMonthlyOpen = spends.some((spend) => spend.verdict.kind === "open");
  if (gauges.length === 0 && !anyMonthlyOpen && (weekly.length > 0 || spends.length === 0)) {
    return noGaugeReadable({ accounts: live, hatchOpen: context.unreadableHatchOpen });
  }
  const route = routeSpawnToPlan({ chair: chair === true, gauges, model, spends, thresholds });
  logger.out({ line: renderSpawnRoute({ route }) });
  if (route.kind === "no-plan") {
    return everyPlanSpent({ accounts: live, route });
  }
  return routedStore({ live, route });
}

/**
 * The store of the plan routing chose, or a refusal when no configured plan carries that alias.
 *
 * @param live the unpaused configured plans routing chose among
 * @param route the routing decision that named a plan
 * @returns the routed store, or the configuration refusal
 */
function routedStore({
  live,
  route,
}: {
  live: readonly { readonly alias: string; readonly storeDir: string }[];
  route: Extract<ClaudeSpawnRoute, { kind: "route" }>;
}): SpawnStoreRouting {
  const storeDir = live.find((account) => account.alias === route.to)?.storeDir;
  if (storeDir === undefined) {
    // Unreachable through `probePlan`, which stamps each reading with the alias it was asked for — and a
    // refusal rather than a storeless success regardless, because "an allowed spawn always carries an explicit
    // store" has to hold structurally. An injected probe answering
    // under an alias no account configures reaches it: routing chooses it, the lookup misses, and the gate would
    // return neither a store nor a refusal, which is the ambient-credential fall-through this whole shape exists to close.
    return {
      refusal:
        `claude routing: the chosen plan \`${route.to}\` is not one of the configured plans, so there is no ` +
        `store to boot it against — refusing rather than booting on whatever credential is ambient`,
      refusalKind: "configuration",
      route,
    };
  }
  return { basis: "routed", route, storeDir };
}

/**
 * Judge a store the caller already chose — a pinned seat — against its own live gauge, repairing it first.
 *
 * A pinned seat is never re-routed: a store named by `--plan`, or the publishing seat's (`./seatPinning.ts`), is
 * the operator's choice, which routing does not overrule. The supervisor chair is NOT one — it carries no store
 * and takes the routed branch. A pinned seat is still CHECKED and REPAIRED: a store whose token expired overnight
 * is refreshed before the boot rather than booted dead.
 *
 * **A pinned seat whose own gauge is unreadable refuses, even when other plans read fine.** Those other
 * readings say nothing about this store, and the pin is not negotiable — so the honest answer is the
 * unreadable-plan refusal, whose hatch then returns this exact store.
 *
 * @param context this invocation's home, seams and hatch state
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param storeDir the store the caller pinned this session to
 * @returns the same store, plus the refusal when its own gauge bars this spawn or could not be read
 */
async function gatePinnedStore({
  context,
  model,
  storeDir,
}: {
  context: SpawnGateContext;
  model: string | undefined;
  storeDir: string;
}): Promise<SpawnStoreRouting> {
  const fleet = await readClaudeFleet({ home: registerHome({ home: context.home }), port: context.port });
  const unregistered = namedPinUnregistered({ accounts: fleet.map((read) => read.accounts), context, storeDir });
  if (unregistered !== undefined) {
    return unregistered;
  }
  if (fleet.isErr()) {
    return unusableConfiguration({ error: fleet.error, storeDir });
  }
  const { accounts, thresholds } = fleet.value;
  if (accounts === undefined) {
    return { basis: "unconfigured", storeDir };
  }
  // Store identity is the keychain service the path derives (`aliasForStoreDir`), so a pin spelled in another
  // canonically equivalent form, or a different path colliding on that truncated hash, still finds its row — and
  // its pause.
  const pinnedAlias = aliasForStoreDir({ accounts, storeDir });
  const pinned = accounts.find((account) => account.alias === pinnedAlias);
  const seams = repairSeams({ deps: context.deps });
  const unprobed = pinnedVerdictWithoutProbe({ home: context.home, pinned, seams, storeDir });
  if (unprobed.kind === "decided") {
    return unprobed.verdict;
  }
  const live = unprobed.account;
  // The pinned plan is live (checked above), so this filter only keeps the OTHER paused plans, and every
  // monthly-spend one, out of the probe the pinned arm runs.
  const gauges = await readSpawnGauges({
    accounts: unpausedAccounts({ accounts }).filter((account) => probedClaudeAccount({ account })),
    deps: seams,
    home: registerHome({ home: context.home }),
    probesPort: context.probesPort,
  });
  const gauge = gauges.find((reading) => reading.alias === live.alias);
  if (gauge === undefined) {
    return pinnedWithNoGauge({
      hatchOpen: context.unreadableHatchOpen,
      seat: live.alias,
      storeDir,
      usageLimitPercent: live.usageLimitPercent,
    });
  }
  return pinnedGaugeVerdict({ gauge, gauges, model, storeDir, thresholds });
}

/**
 * Everything the pinned arm can conclude about its store WITHOUT a probe: a store no plan claims boots as named,
 * unmeasured; a paused plan refuses; a monthly-spend plan is judged on its recorded spend. Only a live weekly
 * plan is left for the gauge.
 *
 * @param home the caller's `--home`, or undefined for the ambient one, where spend readings are recorded
 * @param pinned the registered plan the pin resolved to by keychain-service identity, or undefined for none
 * @param seams whose clock judges a spend reading's freshness — read ONLY on the monthly-spend arm, as main did
 * @param storeDir the store the caller pinned, as it named it
 * @returns the verdict when one was reached, else the live weekly plan to probe
 */
function pinnedVerdictWithoutProbe({
  home,
  pinned,
  seams,
  storeDir,
}: {
  home: string | undefined;
  pinned: ClaudeAccount | undefined;
  seams: { readonly nowIso: () => string };
  storeDir: string;
}): { kind: "decided"; verdict: SpawnStoreRouting } | { kind: "probe"; account: ClaudeAccount } {
  if (pinned === undefined) {
    // A pin naming a store this install does not configure. It is still an EXPLICIT store and still better
    // than the ambient slot, so it is used and reported rather than replaced — but nothing probed it, so the
    // gate says so instead of implying a reading it does not have.
    logger.error({
      msg:
        `claude routing: the pinned store is not one of the configured plans, so its budget was not read — ` +
        `booting on it as named, unmeasured`,
    });
    return { kind: "decided", verdict: { basis: "pinned", storeDir } };
  }
  // A store pinned by `--plan` whose plan was paused after the flag resolved it: the pause is the
  // operator's stop, so it refuses as `paused` BEFORE the probe or the spend read, rather than reaching the
  // no-gauge arm whose unreadable-plan hatch would boot the paused store anyway. (The register's `pinned: true`
  // row is a different pin, and `parseClaudeAccounts` already refuses pausing that one.)
  if (pinned.paused !== undefined) {
    return { kind: "decided", verdict: pinnedPlanPaused({ alias: pinned.alias, storeDir }) };
  }
  if (!probedClaudeAccount({ account: pinned })) {
    const [spend] = readClaudePlanSpends({
      accounts: [pinned],
      home: registerHome({ home }),
      nowIso: seams.nowIso(),
    });
    return { kind: "decided", verdict: pinnedSpendVerdict({ account: pinned, spend: spend!, storeDir }) };
  }
  return { account: pinned, kind: "probe" };
}

/**
 * The refusal for a store `--plan` named that the register no longer carries, or undefined to judge it as a pin.
 *
 * `--plan` resolved this store off the register before any worktree existed; if the register stopped carrying it
 * since, its gauge cannot be read, so it refuses rather than booting unmeasured as a standing pin does.
 *
 * A register that could not be REREAD is refused with no hatch at all, exactly as `--plan`'s own resolution refuses
 * one (`cli/commands/cmux/claudePlanFlag.ts`): the row's usage limit and allowance went unread with it, and the
 * unreadable-plan hatch releasing the store would boot past a limit, or onto a monthly-spend plan, nobody checked.
 *
 * @param accounts the register as the gate read it
 * @param context this invocation's hatch state, and whether the store was named
 * @param storeDir the store the caller pinned
 * @returns the refusal or unreadable-plan outcome, or undefined when the store was not named or is still registered
 */
function namedPinUnregistered({
  accounts,
  context,
  storeDir,
}: {
  accounts: Awaited<ReturnType<typeof readSpawnAccounts>>;
  context: SpawnGateContext;
  storeDir: string;
}): SpawnStoreRouting | undefined {
  if (context.namedPin !== true) {
    return undefined;
  }
  if (accounts.isErr()) {
    return {
      refusal:
        `claude routing: --plan named ${storeDir}, but the plans register could not be reread to check its usage ` +
        `limit and allowance — ${accounts.error.message}. No hatch crosses an unread usage limit; repair the ` +
        `register and spawn again.`,
      refusalKind: "configuration",
      storeDir,
    };
  }
  if (accounts.value !== undefined && aliasForStoreDir({ accounts: accounts.value, storeDir }) !== undefined) {
    return undefined;
  }
  return pinnedWithNoGauge({
    hatchOpen: context.unreadableHatchOpen,
    seat: `${storeDir} (named by --plan, and no longer in the register)`,
    storeDir,
    usageLimitPercent: undefined,
  });
}

/**
 * The whole pre-spawn gate: which store this session boots against, and whether it may boot at all.
 *
 * Called by `cmux/spawn.ts`'s `bootCmuxWorkspace` for EVERY spawn — a handover run, a `turn dispatch` bot
 * worker, an answer reviewer, the recipe scheduler and its children alike. A caller that pinned a store gets
 * that store back (checked and repaired, never re-routed); a caller that pinned none gets the plan with the
 * most of the budget its model will actually spend.
 *
 * **`force` releases the SPENT-plan refusal and nothing else.** It is not a general "strip whatever the gate
 * said" bit, and it used to be: the old tail deleted any refusal and returned the remaining fields, so a
 * forced spawn against an unreadable fleet came back with no store at all and booted on the ambient
 * credential. Each refusal now releases at its own branch.
 * **A configuration refusal is released by nothing** — not `force`, not the `unreadable-plan` hatch — and is
 * raised for a pinned seat exactly as for an unpinned one, because an unread register is an unread usage limit
 * (§ Fail CLOSED).
 *
 * @param chair whether this spawn seats the supervisor chair; it changes only the ROUTED branch, since a pinned store is
 *   the operator's choice
 * @param context this invocation's home, seams and unreadable-plan hatch state
 * @param force whether the caller is overriding a SPENT-plan refusal, opening the session onto it anyway
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param pinnedStoreDir the store the caller already pinned, or undefined to let the gauge choose one
 * @returns the store to boot against, and the refusal when this spawn must not proceed
 */
export async function gateSpawnStore({
  chair,
  context,
  force,
  model,
  pinnedStoreDir,
}: {
  chair?: boolean;
  context: SpawnGateContext;
  force: boolean;
  model: string | undefined;
  pinnedStoreDir: string | undefined;
}): Promise<SpawnStoreRouting> {
  // FIRST, before the configuration is even read. An Anthropic-issued credential outranks every credential
  // store, so under one of them no store decides what this session spends, no plan's budget describes its cost,
  // and NONE of the gate's three refusals is about anything. Checked later, the configuration arm would
  // refuse first, and a readable SPENT plan would refuse too — a true measurement about a plan the session will
  // not spend.
  const shadowed = shadowingSource({ context });
  if (shadowed !== undefined) {
    return {
      ...underApiKey({ source: shadowed }),
      ...(pinnedStoreDir === undefined ? {} : { storeDir: pinnedStoreDir }),
    };
  }
  const gated =
    pinnedStoreDir === undefined
      ? await routeSpawnStore({ chair: chair === true, context, model })
      : await gatePinnedStore({ context, model, storeDir: pinnedStoreDir });
  if (gated.refusal === undefined) {
    return gated;
  }
  // `force` releases the SPENT-plan refusal and nothing else, tested on the refusal's own NAME rather than on
  // the shape of the value — a pinned seat's unreadable-gauge refusal carries a `storeDir` too, so any
  // shape-based test would release exactly the refusal this must never release. A `usage-limit` or `not-measured`
  // refusal is therefore NEVER released here, whatever `force` or `SLOPWEAVER_ALLOW_SPENT_PLAN` says: the owner's
  // own limit is a ceiling, and a pinned one carries a `storeDir` exactly as a spent one does.
  if (!force || gated.refusalKind !== "spent-plan" || gated.storeDir === undefined) {
    return gated;
  }
  logger.error({ msg: `${gated.refusal} OVERRIDDEN by ${ALLOW_SPENT_PLAN_ENV} — booting anyway.` });
  const { refusal: _overridden, refusalKind: _kind, ...allowed } = gated;
  return allowed;
}
