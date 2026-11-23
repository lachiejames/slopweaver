/**
 * The `claude watch` shell: a foreground, model-free loop that keeps every credential store alive and says
 * what the fleet WOULD do about its budgets.
 *
 * ## Why this is legal under doctrine rule 2, stated rather than assumed
 *
 * No model runs here, ever. The loop reads rate-limit headers, runs the CLI's own refresh under a store that
 * is due one or that the provider refused on an expired token, and prints. It is the same standing this repo already grants
 * `listen --follow`: it records and switches, and never answers. Three properties keep that true and each
 * is enforced by something rather than remembered —
 *
 * - it runs in the FOREGROUND of a visible session, so the owner can watch it and interrupt it mid-tick;
 * - it uses `execFileSync` only, which blocks and therefore cannot outlive the process that started it —
 *   the `no-headless` gate permits exactly that member and bans every asynchronous one;
 * - it is not a scheduled job and never becomes one. There is no `.plist` here, nothing activates launchd,
 *   and a future session reaching for one should read this paragraph as the reason not to.
 *
 * ## It rotates, and there is no flag to turn that on
 *
 * This loop used to report what it WOULD do and reach no swap at all, so that enabling rotation would
 * arrive as a change to this file. The owner ruled against that in the plainest terms they had:
 * a report they have to act on is a manual step, and a manual step at four in the morning is the stall the
 * whole feature exists to remove.
 *
 * What replaced the flag is the guard set underneath it, not trust. Four of them, each closing something
 * that has actually gone wrong here:
 *
 * - **The swap checks IN before it checks OUT.** The active slot's credential goes back to the store it came
 *   from first, so no store is left holding a token the slot then refreshes past. A refresh revokes the copy,
 *   and a revoked store is the one kind that needs the owner's own hand to repair.
 * - **The write carries a size threshold, an argv fallback and a backup-and-rollback.** That is what the
 *   outage cost, when a silently truncated `security` stdin line destroyed the credential every
 *   session on the machine was using.
 * - **The target can only be a plan that answered a gauge this tick**, because selection runs over readings
 *   and a store that did not answer has none. The fleet cannot be rotated onto a dead store.
 * - **The plan just left is held out until its own reset**, so two plans near the wall cannot hand the fleet
 *   back and forth on every cycle.
 *
 * `--dry-run` still reports a tick with no effect whatsoever, which is how each guard is proven against real
 * stores before it is trusted with them.
 *
 * The other thing it writes is each non-active store's own credential, in place, by refreshing it. That is
 * the entire point of keep-alive and it touches no slot a running session authenticates with.
 *
 * ## A slot holding nothing is not the same as a slot nobody could name
 *
 * The BLANKET hold — touch nothing when no plan can be named — rests on "any store could be the one whose
 * account the active slot holds". A slot holding no usable credential has already answered that: it holds
 * nobody's. Treating it as ambiguity instead is what broke keep-alive outright: MEASURED, the
 * default slot's credential had expired, so no probe could attribute it and no
 * store byte-matched it, every unpinned tick concluded `unknown`, and `unknown` holds EVERY store back. The
 * loop whose one job is to keep four stores alive refreshed none of them for seven days.
 *
 * `readActiveSlot` is the positive finding that closes it, and it releases that one hold only — the
 * byte-comparison guard above survives a dead slot. `ActiveSlotHolding` carries the rest of the reasoning.
 */
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { ClaudeStoreIdentity } from "../../../claude/checkoutIdentity.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { ClaudeGaugeOutcome } from "../../../claude/gaugeRender.js";
import { recordStoreTouch, type StoreTouch } from "../../../claude/keepAlive.js";
import { touchOneStore, touchProblemLine } from "../../../claude/keepAliveTouch.js";
import { repairSeams } from "../../../claude/probeRepair.js";
import { type ClaudeRotationState, selectAccount } from "../../../claude/rotationState.js";
import { recoveryEta, renderWatchLines, watchTickDocument } from "../../../claude/watchReport.js";
import { type ClaudeWatchSession, WATCH_SESSION_FILE } from "../../../claude/watchSession.js";
import type { WatchTickPlan } from "../../../claude/watchTick.js";
import { slopweaverHome } from "../../../homeDir.js";
import { writeJsonFile } from "../../../lib/jsonFile.js";
import { logger } from "../../../lib/logger.js";
import { launchedCheckout } from "../../../live/standing/processes.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import type { ClaudeThresholds } from "../../../plans/thresholds.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { admitClaudeWatch, runReleasedWatch } from "./watchAdmission.js";
import { parseClaudeWatchArgs } from "./watchArgs.js";
import { type ClaudeWatchPlans, rereadWatchPlans, watchOpeningLines, watchPlans } from "./watchPlans.js";
import { afterRotation, type ClaudeRotation, observeRotationRecommendation, rotationLines } from "./watchRotation.js";
import { storeLives } from "./watchSlotReads.js";
import { STATE_FILE, sweepTick, TOUCH_FILE } from "./watchSweep.js";
import { finishWatchTick, fireOnUnreadRegister } from "./watchTickTail.js";

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, watch, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** How many characters of a fresh UUID name one run. The same length `listen arm` gives an arm id. */
const WATCH_ID_LENGTH = 8;

/**
 * Stamp the loop's own record, so its ABSENCE is a thing something can measure.
 *
 * Written at the START of every tick, and `watchSession.ts`'s header carries why: a tick legitimately
 * runs for minutes (one bounded refresh per due or refused store), so stamping at the end would make a slow
 * healthy tick read exactly like a stopped one for as long as it ran.
 *
 * **Neither `--once` nor `--dry-run` stamps it, and that is the contract rather than a shortcut.** The
 * record's one job is to answer "is a standing session keeping idle stores alive right now", and neither
 * mode can be. A `--once` run has already exited by the time anyone reads the record, and a `--dry-run`
 * writes nothing by definition. A record either of them left would be graded non-live a moment later, so
 * it adds no information and one more state a reader has to reason past. Only the indefinite loop —
 * which is the standing session — claims to be one.
 *
 * The `standing` decision lives HERE rather than at the call site, so the one place that knows what the
 * record means is the one place that decides whether to write it.
 *
 * @param home the Slopweaver home the record is written under
 * @param intervalMs how far apart this loop's ticks are
 * @param nowIso this tick's instant, ISO-8601
 * @param standing whether this run is the indefinite loop, and so may claim to be a standing session
 * @param startedAtIso when this RUN began, ISO-8601 — unchanged across its ticks
 * @param watchId this run's own id
 */
function stampWatchSession({
  home,
  intervalMs,
  nowIso,
  standing,
  startedAtIso,
  watchId,
}: {
  home: string;
  intervalMs: number;
  nowIso: string;
  standing: boolean;
  startedAtIso: string;
  watchId: string;
}): void {
  if (!standing) {
    return;
  }
  const session: ClaudeWatchSession = {
    // The checkout as this process's own argv spells it, which is what `ps` shows the gauge — never
    // `process.cwd()`, which is wherever the caller stood (`launchedCheckout`'s header has the counterexample).
    cwd: launchedCheckout({ argv: process.argv, fallback: process.cwd() }),
    intervalMs,
    lastTickStartedAtIso: nowIso,
    pid: process.pid,
    startedAtIso,
    watchId,
  };
  writeJsonFile({ path: `${home}/${WATCH_SESSION_FILE}`, value: session });
}

/**
 * Touch every store the plan named, recording each one whose expiry the touch actually advanced.
 *
 * A store that refuses is REPORTED and the loop carries on to the next: one dead store must not stop the
 * others being kept alive, which is the whole reason a tick touches them as a set. A store with life left
 * beyond the CLI's refresh window runs nothing and records nothing, so it stays due and the next tick reads
 * it again — one keychain read, no process (`keepAliveTouch.ts`).
 *
 * @param accounts the configured plans, to resolve an alias to its store
 * @param home the Slopweaver home the touch record is written under
 * @param plan what this tick decided
 * @param touches what was known about when each store was last refreshed
 * @returns the stores that refused, each with its reason
 */
function performTouches({
  accounts,
  home,
  plan,
  touches,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
  plan: WatchTickPlan;
  touches: readonly StoreTouch[];
}): readonly string[] {
  let recorded: readonly StoreTouch[] = touches;
  const refusals: string[] = [];
  const deps = repairSeams({ deps: undefined });
  for (const alias of plan.touch) {
    const account = accounts.find((candidate) => candidate.alias === alias)!;
    const result = touchOneStore({ account, deps });
    if (result.kind === "refreshed") {
      recorded = recordStoreTouch({ alias, nowIso: deps.nowIso(), touches: recorded });
    }
    const problem = touchProblemLine({ result });
    if (problem !== undefined) {
      refusals.push(problem);
    }
  }
  if (recorded !== touches) {
    writeJsonFile({ path: `${home}/${TOUCH_FILE}`, value: { touches: recorded } });
  }
  return refusals;
}

/**
 * Write the checkout-identity record back, so the next tick starts from what this one learned.
 *
 * ## Only an IDENTIFIED plan is recorded as selected
 *
 * The record's whole job is to be the answer of last resort, so it may only ever be written from the FIRST
 * answer. Writing a byte-comparison or — worse — the record's own previous value back into itself would make
 * the fallback self-confirming: a guess made once would be re-read next tick as though something had
 * established it, and the retired check-in would then have handed a credential to a store chosen by that guess.
 *
 * **`pinned` does NOT write it either, and that is not an oversight.** It outranks `identified` for the
 * keep-alive question and is still the wrong claim for this record. `selected` means "the store the ACTIVE
 * SLOT is checked out from", which is what the retired check-in handed the slot's credential back to; `pinned` means
 * "the store THIS PROCESS reads", which on a pinned machine is a different keychain item entirely. Writing
 * one as the other would have a check-in copy the default slot's credential over a healthy store — the
 * exact class of destruction the check-in guard exists to prevent.
 *
 * Everything else on the record is carried through untouched. The unavailability holds in particular belong
 * to the trigger, not to this writer, and a keep-alive tick that dropped them would let the fleet flap back
 * onto a plan its own refusal had just held out.
 *
 * @param home the Slopweaver home the record lives under
 * @param identities every store's account, as this tick's probes found them
 * @param nowIso this tick's instant, ISO-8601
 * @param plan what this tick concluded, including which source named the active plan
 * @param state the record as this tick read it, with expired holds already dropped
 * @returns nothing
 */
function recordTick({
  home,
  identities,
  nowIso,
  plan,
  rotation,
  state,
}: {
  home: string;
  identities: readonly ClaudeStoreIdentity[];
  nowIso: string;
  plan: WatchTickPlan;
  rotation?: ClaudeRotation;
  state: ClaudeRotationState;
}): void {
  const observed =
    plan.activeFrom === "identified" && plan.active !== undefined
      ? selectAccount({
          alias: plan.active,
          nowIso,
          reason: "the provider names this store's account as the one the active slot holds",
          state,
        })
      : state;
  const settled = afterRotation({ plan, state: observed, ...(rotation === undefined ? {} : { rotation }) });
  writeJsonFile({ path: `${home}/${STATE_FILE}`, value: { ...settled, identities } });
}

/**
 * Perform everything a tick WRITES, in the one order the guards assume.
 *
 * The order is the contract rather than a convenience: the touches run first, so a store the tick is
 * about to rotate onto has already been refreshed; the swap runs next, so the record it produces
 * describes what actually happened; and the record is written last, so a failed swap leaves the previous
 * state standing rather than a claim the fleet moved. `--dry-run` performs none of them, which is what
 * lets each guard be proven against real stores before it is trusted with them.
 *
 * @param accounts the configured plans
 * @param activeOrganizationId the organisation the ACTIVE credential belongs to, when the provider named it
 * @param dryRun whether this tick writes nothing at all
 * @param home the Slopweaver home the records live under
 * @param identities every store's account, as this tick's probes found them
 * @param nowIso this tick's instant, ISO-8601
 * @param plan what this tick decided
 * @param state the rotation record as this tick read it
 * @param touches when each store was last refreshed
 * @returns the stores that refused a refresh, and what the swap did when one ran
 */
function performTick({
  accounts,
  dryRun,
  home,
  identities,
  nowIso,
  plan,
  state,
  touches,
}: {
  accounts: readonly ClaudeAccount[];
  dryRun: boolean;
  home: string;
  identities: readonly ClaudeStoreIdentity[];
  nowIso: string;
  plan: WatchTickPlan;
  state: ClaudeRotationState;
  touches: readonly StoreTouch[];
}): { refusals: readonly string[]; rotation?: ClaudeRotation } {
  if (dryRun) {
    return { refusals: [] };
  }
  const refusals = performTouches({ accounts, home, plan, touches });
  const rotation = observeRotationRecommendation({ plan });
  recordTick({ home, identities, nowIso, plan, state, ...(rotation === undefined ? {} : { rotation }) });
  return { refusals, ...(rotation === undefined ? {} : { rotation }) };
}

/**
 * Run one tick: read every gauge, touch what is due, and report what the fleet would do.
 *
 * @param accounts the configured plans
 * @param monthly the unpaused monthly-spend plans, judged on their recorded spend and never probed
 * @param home the Slopweaver home the touch record is written under
 * @param dryRun whether to report the tick without touching anything at all
 * @param intervalMs how often this loop ticks, which is its worst case for noticing a wall
 * @param standing whether this run is the indefinite loop, and therefore may claim to be a standing session
 * @param startedAtIso when this RUN began, for the loop's own record
 * @param thresholds the install's Claude thresholds, off the same register read as `accounts`
 * @param watchId this run's own id, for the loop's own record
 * @param wantsJson whether to emit the machine document instead of the human lines
 * @returns nothing
 */
async function runTick({
  accounts,
  dryRun,
  home,
  intervalMs,
  monthly,
  standing,
  startedAtIso,
  thresholds,
  watchId,
  wantsJson,
  once,
}: {
  accounts: readonly ClaudeAccount[];
  dryRun: boolean;
  home: string;
  intervalMs: number;
  monthly: readonly ClaudeAccount[];
  standing: boolean;
  startedAtIso: string;
  thresholds: ClaudeThresholds;
  watchId: string;
  wantsJson: boolean;
  once: boolean;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  stampWatchSession({ home, intervalMs, nowIso, standing, startedAtIso, watchId });
  const { gauges, identities, identityAlarms, outcomes, plan, probes, repairLines, state, touches } = await sweepTick({
    accounts,
    dryRun,
    home,
    monthly,
    nowIso,
    thresholds,
  });
  const { refusals, rotation } = performTick({ accounts, dryRun, home, identities, nowIso, plan, state, touches });
  reportTick({
    accounts,
    dryRun,
    identityAlarms,
    intervalMs,
    nowIso,
    outcomes,
    plan,
    refusals: [...repairLines, ...refusals],
    wantsJson,
    ...(rotation === undefined ? {} : { rotation }),
  });
  await finishWatchTick({ dryRun, gauges, home, nowIso, once, probes, wantsJson });
}

/**
 * Print one tick: the machine document or the human lines on stdout, and every problem on stderr.
 *
 * Split from the deciding half so a tick's branchiness lives where the branches mean something. Nothing here
 * decides anything; it reads what the tick concluded and says it.
 *
 * @param accounts the configured plans, to read each store's remaining life
 * @param dryRun whether this tick reported without touching anything
 * @param identityAlarms each store holding the wrong or a shared account, in `signin --status`'s words
 * @param intervalMs how often this loop ticks, which is its worst case for noticing a wall
 * @param nowIso this tick's instant, ISO-8601
 * @param outcomes each store's reading, or the reason there was none
 * @param plan what this tick decided
 * @param refusals the stores that would not accept a refresh
 * @param rotation what the swap did, when one ran
 * @param wantsJson whether to emit the machine document instead of the human lines
 * @returns nothing
 */
function reportTick({
  accounts,
  dryRun,
  identityAlarms,
  intervalMs,
  nowIso,
  outcomes,
  plan,
  refusals,
  rotation,
  wantsJson,
}: {
  accounts: readonly ClaudeAccount[];
  dryRun: boolean;
  identityAlarms: readonly string[];
  intervalMs: number;
  nowIso: string;
  outcomes: readonly ClaudeGaugeOutcome[];
  plan: WatchTickPlan;
  refusals: readonly string[];
  rotation?: ClaudeRotation;
  wantsJson: boolean;
}): void {
  // No `swapMs`: nothing is performed any more, so the swap leg stays UNMEASURED rather than zero. A zero
  // would read as an instant recovery, which is the opposite of what a retired mechanism means.
  const eta = recoveryEta({ intervalMs });
  const lives = storeLives({ accounts });
  if (wantsJson) {
    logger.out({ line: JSON.stringify(watchTickDocument({ dryRun, eta, lives, nowIso, plan })) });
  } else {
    for (const line of renderWatchLines({ dryRun, eta, lives, nowIso, plan })) {
      logger.out({ line });
    }
  }
  // The identity alarms lead: a store spending the wrong account outranks every other line a tick can print.
  const problems = [
    ...identityAlarms,
    ...outcomes.flatMap((outcome) => (outcome.problem === undefined ? [] : [`${outcome.alias}: ${outcome.problem}`])),
  ];
  for (const msg of [...problems, ...refusals, ...rotationLines(rotation === undefined ? {} : { rotation })]) {
    logger.error({ msg });
  }
}

/**
 * Watch every configured plan, keeping their stores alive and reporting what the fleet would do.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeWatch(argv: readonly string[]): Promise<number> {
  const args = parseClaudeWatchArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    logger.error({ msg: `claude watch: ${args.error.join("; ")}` });
    return EXIT_USAGE;
  }
  const { dryRun, intervalMinutes: interval, once, wait, wantsJson } = args.value;
  const home = slopweaverHome();
  // Admission comes before every read of the configuration and every write, so a refused or queued start
  // leaves no trace: no watch id, no stamped record, no touched store. `./watchAdmission.ts` carries why it
  // is a snapshot check and not a fence.
  if (!dryRun && !(await admitClaudeWatch({ home, wait }))) {
    return EXIT_ERROR;
  }
  // A released `--wait` start runs the loop as a foreground child WITHOUT the flag, so no ticking watch
  // ever carries `--wait` — `./watchAdmission.ts`'s `releasedWatchCommand` has the counterexample.
  if (wait) {
    return runReleasedWatch();
  }
  // A watch is the fleet's own standing probe, so its subject is the plans the fleet may SPEND: `./watchPlans.ts`
  // drops a paused one and hands back the line naming what it is out for, said once here rather than
  // re-probed every interval forever.
  const port = planRegisterPort();
  const opening = await watchPlans({ home, port });
  if (opening.isErr()) {
    logger.error({ msg: `claude watch: ${opening.error.message}` });
    // The watch cannot tick, and the register card is how they hear why (`./watchTickTail.ts`).
    await fireOnUnreadRegister({ dryRun, home });
    return EXIT_ERROR;
  }
  for (const msg of watchOpeningLines({ interval, once, plans: opening.value })) {
    logger.error({ msg });
  }
  return watchLoop({
    dryRun,
    home,
    intervalMs: interval * MS_PER_MINUTE,
    once,
    plans: opening.value,
    port,
    wantsJson,
  });
}

/**
 * The watch's own loop: tick, then — unless it is a one-shot run — pause and re-read the register, so a plan
 * resumed mid-run is probed again (`./watchPlans.ts`).
 *
 * @param plans the plans the opening read resolved
 * @param intervalMs how long to pause between ticks
 * @param port where every re-read between ticks reads the plan register
 * @returns the process exit code, once a one-shot run has ticked
 */
async function watchLoop({
  dryRun,
  home,
  intervalMs,
  once,
  plans: opening,
  port,
  wantsJson,
}: {
  dryRun: boolean;
  home: string;
  intervalMs: number;
  once: boolean;
  plans: ClaudeWatchPlans;
  port: PlanRegisterPort;
  wantsJson: boolean;
}): Promise<number> {
  let plans = opening;
  const watchId = randomUUID().slice(0, WATCH_ID_LENGTH);
  const startedAtIso = new Date().toISOString();
  let readable = true;
  for (;;) {
    if (readable) {
      await runTick({
        accounts: plans.live,
        dryRun,
        home,
        intervalMs,
        monthly: plans.monthly,
        once,
        standing: !once && !dryRun,
        startedAtIso,
        thresholds: plans.thresholds,
        watchId,
        wantsJson,
      });
    }
    if (once) {
      return EXIT_OK;
    }
    // Waits between ticks on an ordinary timer, so the owner's Ctrl-C interrupts it like any other.
    await setTimeout(intervalMs);
    const next = await rereadWatchPlans({ home, port, previous: plans });
    for (const msg of next.lines) {
      logger.error({ msg });
    }
    ({ plans, readable } = next);
    if (!readable) {
      await fireOnUnreadRegister({ dryRun, home });
    }
  }
}

export const claudeWatchCommand = defineCommand({ run: runClaudeWatch });
