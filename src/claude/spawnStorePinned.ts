/**
 * The pre-spawn credential gate's PINNED arm (`./spawnStore.ts`): a store the caller already chose — named by
 * `--plan`, or a standing seat's (`./seatPinning.ts`) — judged against its own live gauge, repaired first, and never
 * re-routed. The unpinned arm and the API-key exemption stay in `./spawnStore.ts`, which calls in here only once it
 * knows a store was pinned and nothing shadows the stores.
 *
 * Split from the gate along that seam because the pinned arm is the half with its own register re-read, its own
 * no-probe verdicts and its own plan-choice basis (`pinned`, or `requested` for a `--plan` name).
 */
import { logger } from "../lib/logger.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { aliasForStoreDir, unpausedAccounts } from "./config.js";
import { type ClaudeAccount, type ClaudePlanGauge, probedClaudeAccount } from "./contracts.js";
import {
  otherPlanReadings,
  pinnedClaudeChoice,
  pinnedSpendClaudeChoice,
  unmeasuredClaudeChoice,
} from "./planChoiceOf.js";
import { repairSeams } from "./probeRepair.js";
import { readClaudeFleet, type readSpawnAccounts } from "./spawnAccounts.js";
import { readSpawnGauges } from "./spawnGauges.js";
import type { SpawnGateContext, SpawnStoreRouting } from "./spawnStore.js";
import {
  pinnedGaugeVerdict,
  pinnedPlanPaused,
  pinnedSpendVerdict,
  pinnedWithNoGauge,
  unusableConfiguration,
} from "./spawnStoreRefusals.js";
import { readClaudePlanSpends } from "./spendBudgets.js";

/**
 * The configured weekly plans a sweep returned no reading for, by alias — read by both arms of the gate, for the
 * `unreadable` readings the recorded choice carries.
 *
 * @param accounts the weekly plans the sweep probed
 * @param gauges what it returned
 * @returns the aliases with no reading, in configured order
 */
export function unreadableAliases({
  accounts,
  gauges,
}: {
  accounts: readonly { readonly alias: string }[];
  gauges: readonly { readonly alias: string }[];
}): readonly string[] {
  return accounts
    .filter((account) => !gauges.some((gauge) => gauge.alias === account.alias))
    .map((account) => account.alias);
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
 * @param context this invocation's seams, ports and hatch state
 * @param home the resolved Slopweaver home whose plan register, probes and spend readings this gate reads
 * @param model the model the spawn was asked for, as it was typed, or undefined when it pinned none
 * @param storeDir the store the caller pinned this session to
 * @returns the same store, plus the refusal when its own gauge bars this spawn or could not be read
 */
export async function gatePinnedStore({
  context,
  home,
  model,
  storeDir,
}: {
  context: SpawnGateContext;
  home: string;
  model: string | undefined;
  storeDir: string;
}): Promise<SpawnStoreRouting> {
  const fleet = await readClaudeFleet({ home, port: context.port });
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
  const basis = context.namedPin === true ? "requested" : "pinned";
  const unprobed = pinnedVerdictWithoutProbe({ basis, home, pinned, seams, storeDir });
  if (unprobed.kind === "decided") {
    return unprobed.verdict;
  }
  const live = unprobed.account;
  // The pinned plan is live (checked above), so this filter only keeps the OTHER paused plans, and every
  // monthly-spend one, out of the probe the pinned arm runs.
  const probed = unpausedAccounts({ accounts }).filter((account) => probedClaudeAccount({ account }));
  const gauges = await readSpawnGauges({ accounts: probed, deps: seams, home, probesPort: context.probesPort });
  const unreadable = unreadableAliases({ accounts: probed, gauges });
  return judgePinnedGauges({
    basis,
    gauges,
    hatchOpen: context.unreadableHatchOpen,
    live,
    model,
    storeDir,
    thresholds,
    unreadable,
  });
}

/**
 * The pinned arm's verdict once its sweep has read: the pinned plan's own gauge decides, and the choice it records
 * carries every reading the sweep returned.
 *
 * @param basis how the store was pinned — `requested` by `--plan` this invocation, else a standing `pinned` seat
 * @param gauges every reading the sweep returned
 * @param hatchOpen whether the unreadable-plan hatch is open, for a pinned plan whose own gauge went unread
 * @param live the live weekly plan the pin resolved to
 * @param model the model the spawn was asked for, as typed, or undefined
 * @param storeDir the store the caller pinned, as it named it
 * @param thresholds the install's Claude thresholds
 * @param unreadable every probed plan the sweep returned no reading for
 * @returns the store, its refusal when one applies, and the choice an allowed or force-releasable spawn records
 */
function judgePinnedGauges({
  basis,
  gauges,
  hatchOpen,
  live,
  model,
  storeDir,
  thresholds,
  unreadable,
}: {
  basis: "pinned" | "requested";
  gauges: readonly ClaudePlanGauge[];
  hatchOpen: boolean;
  live: ClaudeAccount;
  model: string | undefined;
  storeDir: string;
  thresholds: ClaudeThresholds;
  unreadable: readonly string[];
}): SpawnStoreRouting {
  const gauge = gauges.find((reading) => reading.alias === live.alias);
  if (gauge === undefined) {
    const blind = pinnedWithNoGauge({
      hatchOpen,
      seat: live.alias,
      storeDir,
      usageLimitPercent: live.usageLimitPercent,
    });
    if (blind.refusal !== undefined) {
      return blind;
    }
    const others = otherPlanReadings({ chosen: live.alias, gauges, model, thresholds });
    return { ...blind, choice: unmeasuredClaudeChoice({ alias: live.alias, basis, others, unreadable }) };
  }
  const judged = pinnedGaugeVerdict({ gauge, gauges, model, storeDir, thresholds });
  // A spent-plan refusal carries the choice a `force` release records; `gateSpawnStore` drops it if none happens.
  if (judged.refusal !== undefined && judged.refusalKind !== "spent-plan") {
    return judged;
  }
  const forced = judged.refusal !== undefined;
  return {
    ...judged,
    choice: pinnedClaudeChoice({ basis, forced, gauge, gauges, model, thresholds, unreadable }),
  };
}

/**
 * Everything the pinned arm can conclude about its store WITHOUT a probe: a store no plan claims boots as named,
 * unmeasured; a paused plan refuses; a monthly-spend plan is judged on its recorded spend. Only a live weekly
 * plan is left for the gauge.
 *
 * @param basis how the store was pinned — `requested` by `--plan` this invocation, else a standing `pinned` seat —
 *   for the choice an allowed monthly-spend seat records
 * @param home the resolved home where spend readings are recorded
 * @param pinned the registered plan the pin resolved to by keychain-service identity, or undefined for none
 * @param seams whose clock judges a spend reading's freshness — read ONLY on the monthly-spend arm, as main did
 * @param storeDir the store the caller pinned, as it named it
 * @returns the verdict when one was reached, else the live weekly plan to probe
 */
function pinnedVerdictWithoutProbe({
  basis,
  home,
  pinned,
  seams,
  storeDir,
}: {
  basis: "pinned" | "requested";
  home: string;
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
    const [spend] = readClaudePlanSpends({ accounts: [pinned], home, nowIso: seams.nowIso() });
    const verdict = pinnedSpendVerdict({ account: pinned, spend: spend!, storeDir });
    const open = spend!.verdict;
    if (verdict.refusal !== undefined || open.kind !== "open") {
      return { kind: "decided", verdict };
    }
    const choice = pinnedSpendClaudeChoice({ alias: pinned.alias, basis, verdict: open });
    return { kind: "decided", verdict: { ...verdict, choice } };
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
