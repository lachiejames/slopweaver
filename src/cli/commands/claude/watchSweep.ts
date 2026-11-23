/**
 * The READ half of one `claude watch` tick: probe every store, repair what the touch guard clears, and decide.
 *
 * Split out of `watch.ts` along the seam between deciding and writing. Everything here reads the machine and
 * returns a decision; the one effect is a repair's bounded refresh, which runs only on a store
 * `storesClearedForRepair` (`claude/watchTouchGuard.ts`) clears and never on a dry run. The shell in `watch.ts`
 * performs what was decided, in the order its guards assume, and reports it.
 */
import { readAssertions } from "../../../claude/assertionStore.js";
import {
  type ClaudeStoreIdentity,
  parseStoreIdentities,
  recordStoreIdentity,
} from "../../../claude/checkoutIdentity.js";
import { pinnedAccountAlias } from "../../../claude/config.js";
import type { ClaudeAccount, ClaudeAccountGauge, ClaudePlanSpend } from "../../../claude/contracts.js";
import type { ClaudeGaugeOutcome } from "../../../claude/gaugeRender.js";
import { parseStoreTouches, type StoreTouch } from "../../../claude/keepAlive.js";
import {
  effectiveProbe,
  renderRepair,
  repairProbedPlans,
  repairSeams,
  type StoreProbeRepair,
} from "../../../claude/probeRepair.js";
import {
  type ClaudeActiveProbe,
  type ClaudeProbeResult,
  probeActiveSlot,
  probePlan,
} from "../../../claude/probeStore.js";
import type { SweptPlanProbe } from "../../../claude/recordPlanProbes.js";
import { type ClaudeRotationState, expireUnavailability, parseRotationState } from "../../../claude/rotationState.js";
import { readClaudePlanSpends } from "../../../claude/spendBudgets.js";
import { watchIdentityAlarms } from "../../../claude/watchIdentity.js";
import { planWatchTick, type WatchTickPlan } from "../../../claude/watchTick.js";
import { storesClearedForRepair, touchesHeldByBothDecisions } from "../../../claude/watchTouchGuard.js";
import { readJsonFile } from "../../../lib/jsonFile.js";
import type { ClaudeThresholds } from "../../../plans/thresholds.js";
import { pinnedActiveAlias, readActiveSlot, storesSharingActiveCredential } from "./watchSlotReads.js";

/** Where the rotation record lives, relative to the Slopweaver home. */
export const STATE_FILE = "claude-accounts/rotation-state.json";

/** Where the last-touched record for each store lives, relative to the Slopweaver home. */
export const TOUCH_FILE = "claude-accounts/keep-alive.json";

/** One store's first probe this tick, beside the plan it probed. */
type FirstProbe = { account: ClaudeAccount; result: ClaudeProbeResult };

/**
 * The accounts each store was last known to hold.
 *
 * A store the provider could not answer for this tick — expired, revoked, or simply unreachable — keeps its
 * previous identity rather than losing it. That is what stops one failed probe blinding the loop to which
 * plan is active and sending it straight back to touching nothing.
 *
 * @param home the Slopweaver home the record lives under
 * @returns every identity the record carries, empty when there is none
 */
function storedIdentities({ home }: { home: string }): readonly ClaudeStoreIdentity[] {
  return parseStoreIdentities({ value: readJsonFile({ path: `${home}/${STATE_FILE}` }) });
}

/**
 * Decide one tick from what the machine currently reads.
 *
 * @param accounts the configured plans
 * @param activeOrganizationId the organisation the ACTIVE credential belongs to, when the provider named it
 * @param activeSlotGauge what the ACTIVE slot itself read, which is the active plan's real budget
 * @param gauges every plan's reading this tick took
 * @param home the Slopweaver home the rotation record and touch record live under
 * @param identities every store's account, as this tick's probes found them
 * @param monthly every unpaused monthly-spend plan, never probed, read here only for the pin and the watch's own store
 * @param nowIso this tick's instant, ISO-8601
 * @param sharesActiveCredential every store observed holding the active slot's own credential, read ONCE per tick
 *   so the repair guard and the touch guard judge the same observation
 * @param spends every unpaused monthly-spend plan's spend verdict at this instant, off the local ledger
 * @param thresholds the install's Claude thresholds, which set the trigger's rotation bar
 * @returns what the tick decided, the record it decided against, and the touch records
 */
function decideTick({
  accounts,
  activeOrganizationId,
  activeSlotGauge,
  gauges,
  home,
  identities,
  monthly,
  nowIso,
  sharesActiveCredential,
  spends,
  thresholds,
}: {
  accounts: readonly ClaudeAccount[];
  activeOrganizationId?: string;
  activeSlotGauge?: ClaudeAccountGauge;
  gauges: readonly ClaudeAccountGauge[];
  home: string;
  identities: readonly ClaudeStoreIdentity[];
  monthly: readonly ClaudeAccount[];
  nowIso: string;
  sharesActiveCredential: readonly string[];
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): { plan: WatchTickPlan; state: ClaudeRotationState; touches: readonly StoreTouch[] } {
  const state = expireUnavailability({
    nowIso,
    state: parseRotationState({ value: readJsonFile({ path: `${home}/${STATE_FILE}` }) }),
  });
  const touches = parseStoreTouches({ value: readJsonFile({ path: `${home}/${TOUCH_FILE}` }) });
  // The pin and the watch's own store may sit on a monthly-spend plan, which is never probed and so not in
  // `accounts`: both are read across every unpaused plan, or a pinned monthly plan would never be reserved.
  const everyPlan = [...accounts, ...monthly];
  const reserved = pinnedAccountAlias({ accounts: everyPlan });
  const pinnedActive = pinnedActiveAlias({ accounts: everyPlan, pin: process.env["CLAUDE_SECURESTORAGE_CONFIG_DIR"] });
  const activeSlot = readActiveSlot({ nowIso });
  return {
    plan: planWatchTick({
      accounts,
      activeSlot,
      gauges,
      identities,
      nowIso,
      seat: "worker",
      sharesActiveCredential,
      spends,
      state,
      thresholds,
      touches,
      ...(activeOrganizationId === undefined ? {} : { activeOrganizationId }),
      ...(activeSlotGauge === undefined ? {} : { activeSlotGauge }),
      ...(pinnedActive === undefined ? {} : { pinnedActive }),
      ...(reserved === undefined ? {} : { reserved }),
    }),
    state,
    touches,
  };
}

/**
 * Probe the active slot and every store, all at once.
 *
 * The active slot is probed ALONGSIDE the stores rather than after them. Its account is the question the
 * whole tick turns on, and a serial extra round-trip would widen the window in which the fleet cannot say
 * which plan it is on, for no benefit at all. The whole sweep is awaited before anything else runs: a repair's
 * refresh is `execFileSync`, which blocks this thread, and a probe still in flight behind it would have its own
 * timeout held up (`probeRepair.ts` § The order, step 1).
 *
 * @param accounts the configured plans
 * @param nowIso this tick's instant, ISO-8601
 * @returns the active slot's reading, and each store's first probe in configured order
 */
async function probeSweep({
  accounts,
  nowIso,
}: {
  accounts: readonly ClaudeAccount[];
  nowIso: string;
}): Promise<{ active: ClaudeActiveProbe; first: readonly FirstProbe[] }> {
  const [active, ...results] = await Promise.all([
    probeActiveSlot({ nowIso }),
    ...accounts.map((account) => probePlan({ alias: account.alias, nowIso, storeDir: account.storeDir })),
  ]);
  return { active, first: accounts.map((account, index) => ({ account, result: results[index]! })) };
}

/**
 * Fold one reading per store into an up-to-date set of accounts, the gauges and the probe record.
 *
 * @param accounts the configured plans
 * @param active the active slot's reading
 * @param home the Slopweaver home the previous accounts are read from
 * @param nowIso this tick's instant, ISO-8601
 * @param results each store's reading, in configured order — the effective one, once a repair ran
 * @returns the active slot's account and reading, every store's account, each store's reading, and the
 *   WRONG ACCOUNT / DUPLICATE alarms comparing those accounts with their enrollments
 */
export function foldSweep({
  accounts,
  active,
  home,
  nowIso,
  results,
}: {
  accounts: readonly ClaudeAccount[];
  active: ClaudeActiveProbe;
  home: string;
  nowIso: string;
  results: readonly ClaudeProbeResult[];
}): {
  activeOrganizationId?: string;
  activeSlotGauge?: ClaudeAccountGauge;
  identities: readonly ClaudeStoreIdentity[];
  identityAlarms: readonly string[];
  outcomes: readonly ClaudeGaugeOutcome[];
  probes: readonly SweptPlanProbe[];
} {
  const identities = results.reduce<readonly ClaudeStoreIdentity[]>((carried, result) => {
    if (result.organizationId === undefined) {
      return carried;
    }
    return recordStoreIdentity({
      alias: result.outcome.alias,
      identities: carried,
      observedAtIso: nowIso,
      organizationId: result.organizationId,
    });
  }, storedIdentities({ home }));
  return {
    // Read-only, so `--dry-run` compares too: each store's enrollment against the account it named THIS tick.
    identityAlarms: watchIdentityAlarms({ accounts, assertions: readAssertions({ home }), probes: results }),
    identities,
    outcomes: results.map((result) => result.outcome),
    probes: accounts.map((account, index) => ({
      alias: account.alias,
      reading: results[index]!.reading,
      storeDir: account.storeDir,
    })),
    ...(active.organizationId === undefined ? {} : { activeOrganizationId: active.organizationId }),
    ...(active.gauge === undefined ? {} : { activeSlotGauge: active.gauge }),
  };
}

/**
 * Repair each store the provider refused on a merely expired token, once the tick knows which plan is active.
 *
 * The repair is a refresh, so it runs only on a store the tick's own touch guard clears
 * (`storesClearedForRepair`, `watchTouchGuard.ts`), judged against the plan resolved from the FIRST probes. A dry
 * run writes nothing, so it repairs nothing. What every reader downstream then sees — the identities, the
 * gauges, the probe record the sign-in note reads — is each store's effective reading: the re-probe after a
 * repair, else the first.
 *
 * @param dryRun whether this tick writes nothing
 * @param first each store's first probe, in configured order, already settled
 * @param plan what the tick decided from those first probes
 * @param sharesActiveCredential every store observed holding the active slot's own credential
 * @returns each store's effective reading in configured order, one line per repair worth a line, and whether
 *   any store was re-probed — the only case in which the tick must be decided again
 */
async function repairSweep({
  dryRun,
  first,
  plan,
  sharesActiveCredential,
}: {
  dryRun: boolean;
  first: readonly FirstProbe[];
  plan: WatchTickPlan;
  sharesActiveCredential: readonly string[];
}): Promise<{ reprobed: boolean; repairLines: readonly string[]; results: readonly ClaudeProbeResult[] }> {
  const unrepaired = first.map((entry) => entry.result);
  if (dryRun) {
    return { reprobed: false, repairLines: [], results: unrepaired };
  }
  const cleared = storesClearedForRepair({
    activeFrom: plan.activeFrom,
    probed: first.map((entry) => entry.account.alias),
    sharesActiveCredential,
    ...(plan.active === undefined ? {} : { active: plan.active }),
  });
  const repairs: readonly StoreProbeRepair[] = await repairProbedPlans({
    deps: repairSeams({ deps: undefined }),
    first: first.filter((entry) => cleared.includes(entry.account.alias)),
  });
  return {
    reprobed: repairs.some((repair) => repair.second !== undefined),
    repairLines: repairs.flatMap((repair) => {
      const line = renderRepair({ repair, speaker: "claude watch" });
      return line === undefined ? [] : [line];
    }),
    results: first.map((entry) => {
      const repaired = repairs.find((repair) => repair.account.alias === entry.account.alias);
      return repaired === undefined ? entry.result : effectiveProbe({ repair: repaired });
    }),
  };
}

/**
 * Probe, repair and decide one tick, with everything the shell then writes and reports.
 *
 * The tick is decided from the first probes, which settle which stores a repair may reach. It is decided again
 * only when a repair re-probed a store, so a repaired store's gauge and account reach the trigger, the record
 * and the sign-in note; which stores are TOUCHED must then pass both decisions (`touchesHeldByBothDecisions`).
 *
 * @param accounts the configured plans
 * @param dryRun whether this tick writes nothing, and so repairs nothing
 * @param home the Slopweaver home every record is read from
 * @param monthly the unpaused monthly-spend plans, judged on their recorded spend and never probed
 * @param nowIso this tick's instant, ISO-8601
 * @param thresholds the install's Claude thresholds, which set the trigger's rotation bar
 * @returns the decided plan, the readings it rests on, the records it decided against, and one line per repair
 */
export async function sweepTick({
  accounts,
  dryRun,
  home,
  monthly,
  nowIso,
  thresholds,
}: {
  accounts: readonly ClaudeAccount[];
  dryRun: boolean;
  home: string;
  monthly: readonly ClaudeAccount[];
  nowIso: string;
  thresholds: ClaudeThresholds;
}): Promise<{
  gauges: readonly ClaudeAccountGauge[];
  identities: readonly ClaudeStoreIdentity[];
  identityAlarms: readonly string[];
  outcomes: readonly ClaudeGaugeOutcome[];
  plan: WatchTickPlan;
  probes: readonly SweptPlanProbe[];
  repairLines: readonly string[];
  state: ClaudeRotationState;
  touches: readonly StoreTouch[];
}> {
  const { active, first } = await probeSweep({ accounts, nowIso });
  const sharesActiveCredential = storesSharingActiveCredential({ accounts });
  const spends = readClaudePlanSpends({ accounts: monthly, home, nowIso });
  const decide = ({ results }: { results: readonly ClaudeProbeResult[] }) => {
    const read = foldSweep({ accounts, active, home, nowIso, results });
    const gauges = read.outcomes.flatMap((outcome) => (outcome.gauge === undefined ? [] : [outcome.gauge]));
    const decided = decideTick({
      accounts,
      gauges,
      home,
      identities: read.identities,
      monthly,
      nowIso,
      sharesActiveCredential,
      spends,
      thresholds,
      ...(read.activeOrganizationId === undefined ? {} : { activeOrganizationId: read.activeOrganizationId }),
      ...(read.activeSlotGauge === undefined ? {} : { activeSlotGauge: read.activeSlotGauge }),
    });
    return { ...read, ...decided, gauges };
  };
  const unrepaired = decide({ results: first.map((entry) => entry.result) });
  const { reprobed, repairLines, results } = await repairSweep({
    dryRun,
    first,
    plan: unrepaired.plan,
    sharesActiveCredential,
  });
  const decided = reprobed ? decide({ results }) : unrepaired;
  const { gauges, identities, identityAlarms, outcomes, probes, state, touches } = decided;
  const plan = touchesHeldByBothDecisions({ first: unrepaired.plan, second: decided.plan });
  return { gauges, identities, identityAlarms, outcomes, plan, probes, repairLines, state, touches };
}
