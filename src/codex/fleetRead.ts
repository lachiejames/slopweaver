/**
 * Reading the whole Codex fleet once: the register, and every registered destination's own evidence.
 *
 * The EFFECTFUL half of `./rank.ts`. Everything that touches a disk happens here and once, so a ranking and
 * an assessment are both pure functions of one snapshot rather than two reads that can disagree with each
 * other about what the fleet looked like.
 *
 * ## Why this does not call `codexDestinations()`
 *
 * `./destinations.ts` answers the question a SPENDER asks — which alias pairs with which home — and it
 * deliberately drops everything else: a paused row and an unpaused one come back identical, and a register
 * that will not decode comes back as an empty list. Both are right for a quota read and wrong here. A
 * routing decision has to be able to say "there are three destinations, one is paused and here is the
 * owner's own reason", and an unreadable register must surface as its typed error rather than as a healthy
 * fleet with nothing in it.
 *
 * ## One instant, and one scan per destination
 *
 * `readAtIso` is captured ONCE and every judgement in the snapshot is made against it, so two rows cannot
 * be dated differently inside one answer. Each destination costs one bounded gauge scan (five day
 * directories, twelve files — `./gaugeScan.ts`) plus its own quota read, so the cost grows with the number
 * of registered destinations. The whole fleet then shares ONE live batch (`./accountLive.ts`): every store's
 * app-server is asked at once, under one shared deadline that ends each store separately, so a slow or broken store costs its own row and
 * never the read. That is stated rather than capped: there is no artificial account limit here, and nothing
 * probes in the background — the batch runs only inside a verb the owner invoked.
 *
 * ## Under a caller's deadline, the live batch is the meter and nothing else grows
 *
 * The cost above grows with the register, and `slopweaver talk verb` kills `codex route` on a fixed deadline
 * (`../lib/childDeadline.ts`), so a long enough register would print nothing at all. Given a deadline, the read
 * opens NO rollout log — a gauge scan carries no deadline of its own and widens a file's tail until it finds a
 * reading, and even the quota read's one-file tail first walks the session directories to find that file, so only
 * skipping both bounds them — and every row says so (`scanSkippedReason`) rather than
 * reading as a home with no log. A live answer is the reading a scan would have lost to anyway
 * (`effectiveGauge`); a store whose live read failed shows unread instead of a rollout line. The live batch is
 * asked to be over {@link ANSWER_RESERVE_MS} before the deadline, and sizes its own shared deadline so its cleanup
 * margin is the standing one (`./liveReadBudget.ts`). What is left per store is a fixed handful of
 * small reads: its cached cap record and clear mark, its auth stamp, and its sign-in observation in the store — one compare-and-set
 * per store over one connection, never retried, so a store slow enough to matter is the one extra wait here. That
 * reserve also absorbs the batch's own pre-launch work (a temp directory and one program file), which its outer
 * timeout is not measured from.
 *
 * ## The two writes: which stores the live batch found unusable, and whether anything was left
 *
 * Every Codex pass, `codex route` and a Codex seat read the fleet here, so this is the moment a signed-out
 * store is skipped. The batch's answer for each store is filed as its `codex_sign_in_observation` row in the store
 * (`./signInRecordStore.ts`) for the `codex-plan-signed-out` monitor, which cannot run the batch itself. The
 * ranking over the whole read is filed in the store's `codex_fleet_cap` row (`./fleetCapPort.ts`) for the
 * `codex-fleet-capped` monitor, for the same reason. A write that fails is reported and never fails the read.
 * A read under a caller's deadline files NO cap record: a live batch it shortened or never launched, with no scan
 * to fall back on, leaves stores unmeasured, and a whole fleet of those would tell the monitor nothing is capped.
 * Keying on the deadline rather than on which part it cut is what a Codex review (r3) asked for: a shortened
 * batch reads `unreadable` exactly as a broken store does, so no row can say the deadline was why. The monitor
 * waits for the next undeadlined read, as it does for a failed write. The sign-in records are still filed,
 * because a store the deadline left `unreadable` KEEPS what was filed for it (`./signInRecord.ts`).
 */
import { parseIsoMs } from "#lib/date.js";
import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { err, ok } from "#lib/result.js";

import type { PlanRegisterError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import type { RegisteredPlan } from "../plans/types.js";
import type { ReadCodexAccountsLive } from "./accountLive.js";
import { type CodexAccountLive, effectiveGauge } from "./accountLiveParse.js";
import type { CodexDestination } from "./destinations.js";
import { type CodexFleetCapPort, fileCodexFleetCapRecord } from "./fleetCapPort.js";
import { codexFleetCapRecordOf } from "./fleetCapRecord.js";
import type { CodexFleetSnapshot, CodexPlanObservation } from "./fleetTypes.js";
import { type CodexGaugeScan, scanCodexGauge } from "./gaugeScan.js";
import { readCodexQuotaCache, readCodexQuotaClearMark } from "./quotaCache.js";
import type { CodexQuotaDecision } from "./quotaGate.js";
import { currentCodexQuotaDecision, decideCurrentCodexQuota } from "./quotaNow.js";
import { rankCodexPlans } from "./rank.js";
import { readCodexAuthStamp } from "./signInAuthStamp.js";
import type { CodexSignInObserved, CodexSignInPort } from "./signInPort.js";

/**
 * What a read under a deadline keeps after the live batch: every row's quota read, the sign-in records, an
 * assessment, a render and an exit — all of it a fixed amount of work per store. It also absorbs the one instant
 * the live batch cannot budget, `spawnSync`'s own fork and exec before its timer starts, so the batch's outer
 * timeout may end that much past the instant handed to it and still well before the caller's. Fixed for state the install
 * wrote on a local disk, where each of those reads takes milliseconds: a FIFO, a hung mount, or a filesystem slow
 * enough that a per-store read takes a large fraction of the reserve, blocks or stretches these synchronous reads
 * here exactly as on an unbounded read, and the caller's own kill ends it.
 */
const ANSWER_RESERVE_MS = 2_000;

/** Why no row of a deadline-bound read carries a rollout scan. */
const SCAN_NOT_RUN_REASON = "not run: under a caller's deadline the live read is the meter";

/** Why a monthly-spend row carries no live answer and no rollout scan: nothing here measures monthly spend. */
const MONTHLY_NOT_PROBED_REASON = "not probed: a monthly-spend plan is NOT MEASURED";

/** A rollout scan not run, so the row says why it has no log reading rather than looking like an empty home. */
const SKIPPED_SCAN: CodexGaugeScan = { filesRead: 0, filesSkipped: 0, filesUnreadable: 0, gauge: undefined };

/**
 * Gather one registered Codex row's evidence: its freshest reading, and whether it is refusing.
 *
 * The destination is built from the row itself rather than looked up again — the alias its cap record is
 * keyed by and the home its log lives in are the row's own two fields, and resolving them separately is how
 * one account's log gets read beside another account's cap record.
 *
 * @param home the state home the cached quota records live under
 * @param nowIso the instant a window reset is judged against, and the one the gauge scan drops a later reading
 *   against — ONE instant, because a scan reading its own later clock can keep a reading the ranker then
 *   rejects as future, discarding the whole gauge and showing a capped window as unread
 * @param plan the register row
 * @param live that row's store's answer from this read's one live batch
 * @param scanSkippedReason why the rollout log is not to be opened — neither the gauge scan nor the quota read's
 *   tail — or undefined to read both
 * @returns everything the ranker and the assessment need about that destination
 */
function observe({
  home,
  live,
  nowIso,
  plan,
  scanSkippedReason,
}: {
  home: string;
  live: CodexAccountLive;
  nowIso: string;
  plan: RegisteredPlan;
  scanSkippedReason: string | undefined;
}): CodexPlanObservation {
  const destination: CodexDestination = { alias: plan.alias, codexHome: plan.storeDir };
  const nowMs = parseIsoMs({ tsIso: nowIso });
  let scan = SKIPPED_SCAN;
  let quota: CodexQuotaDecision;
  if (scanSkippedReason === undefined) {
    scan = scanCodexGauge({ codexHome: destination.codexHome, ...(nowMs === undefined ? {} : { nowMs }) });
    quota = currentCodexQuotaDecision({
      alias: destination.alias,
      codexHome: destination.codexHome,
      home,
      live,
      nowIso,
    });
  } else {
    // Under a deadline the rollout log is not opened at all: even the quota read's one-file tail first walks the
    // session directories to find that file (`./quotaLog.ts`'s `findLatestRolloutPath`), so only the cached
    // record, its clear mark and the live answer are read.
    quota = decideCurrentCodexQuota({
      cached: readCodexQuotaCache({ alias: destination.alias, home }),
      clearedAtIso: readCodexQuotaClearMark({ alias: destination.alias, home }),
      live,
      nowIso,
      rolloutEvidence: undefined,
      rolloutObservations: [],
    });
  }
  const effective = effectiveGauge({ live, rolloutGauge: scan.gauge });
  return {
    destination,
    gauge: effective.gauge,
    gaugeSource: effective.source,
    live,
    plan,
    quota,
    scan,
    ...(scanSkippedReason === undefined ? {} : { scanSkippedReason }),
  };
}

/**
 * Read the register and every Codex destination's evidence in one pass.
 *
 * @param home the state home holding the register and the cached quota records
 * @param nowIso the instant every judgement in the snapshot is made against, ISO-8601 — supplied rather
 *   than read from a clock so a caller can date a whole fleet read exactly
 * @param readLive the live account reader, asked ONCE for every Codex row at the same time. Required, never
 *   defaulted: a composition root passes `readCodexAccountsLive` and a test passes a fake, so no test can reach
 *   a real app-server by forgetting an argument
 * @param deadlineAtMs the epoch-millisecond instant the read must have answered by, when a parent will kill it
 *   then (`codex route` under `talk verb`); absent, the read takes as long as its bounded parts do
 * @param port where the register is read. Required for the same reason `readLive` is: `planRegisterPort()` at
 *   a composition root, an in-memory seam in a test, so no test reaches a real store by forgetting it
 * @param fleetCap where the read's conclusion is filed for the monitor — `codexFleetCapPort()` at a composition
 *   root, an in-memory seam in a test, required for the same reason as `port`
 * @param signInPort where each store's sign-in observation is filed — required for the same reason, and
 *   `codexSignInPort()` at a composition root
 * @returns the snapshot, or the register's own typed error — a store outage included — never an empty fleet
 *   standing in for one
 */
export async function readCodexFleetSnapshot({
  deadlineAtMs,
  fleetCap,
  home,
  nowIso,
  port,
  readLive,
  signInPort,
}: {
  deadlineAtMs?: number;
  fleetCap: CodexFleetCapPort;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  signInPort: CodexSignInPort;
}): Promise<Result<CodexFleetSnapshot, PlanRegisterError>> {
  const read = await port.read({ home });
  if (read.isErr()) {
    return err(read.error);
  }
  const snapshot = await snapshotOf({ deadlineAtMs, home, nowIso, readLive, register: read.value, signInPort });
  if (deadlineAtMs === undefined) {
    await fileCodexFleetCapRecord({
      home,
      port: fleetCap,
      record: codexFleetCapRecordOf({
        observations: snapshot.observations,
        ranking: rankCodexPlans({ nowIso, observations: snapshot.observations, thresholds: snapshot.thresholds }),
        readAtIso: nowIso,
        thresholds: snapshot.thresholds,
      }),
    });
  }
  return ok(snapshot);
}

/**
 * Observe every Codex destination the register names, at one instant.
 *
 * @param register the register as read
 * @param home the state home holding the cached quota records
 * @param nowIso the instant every judgement is made against
 * @param readLive the live account reader, asked once for every weekly-window Codex row and never a monthly-spend one
 * @param deadlineAtMs the instant the read must answer by, when a parent will kill it then
 * @param signInPort where each store's sign-in observation is filed
 * @returns the snapshot
 */
async function snapshotOf({
  deadlineAtMs,
  home,
  nowIso,
  readLive,
  register,
  signInPort,
}: {
  deadlineAtMs: number | undefined;
  home: string;
  nowIso: string;
  readLive: ReadCodexAccountsLive;
  register: CodexFleetSnapshot["register"];
  signInPort: CodexSignInPort;
}): Promise<CodexFleetSnapshot> {
  const plans = plansForProvider({ plans: register.plans, provider: "codex" });
  // A monthly-spend row is NOT MEASURED and is never probed: the live batch, the rollout scan and the sign-in filing
  // all skip it, and its observation carries only its cached quota record (the
  // exclusion is applied BEFORE the batch asks its store).
  const probed = plans.filter((plan) => plan.allowance.kind === "weekly-window");
  const authBefore = probed.map((plan) => readCodexAuthStamp({ codexHome: plan.storeDir }));
  const lives = readLive({
    codexHomes: probed.map((plan) => plan.storeDir),
    readAtIso: nowIso,
    ...(deadlineAtMs === undefined ? {} : { deadlineAtMs: deadlineAtMs - ANSWER_RESERVE_MS }),
  });
  await fileCodexSignIns({
    home,
    observed: probed.map((plan, index) => ({
      alias: plan.alias,
      authAfter: readCodexAuthStamp({ codexHome: lives[index]!.codexHome }),
      authBefore: authBefore[index]!,
      live: lives[index]!,
    })),
    signInPort,
  });
  let scanSkippedReason: string | undefined;
  if (deadlineAtMs !== undefined) {
    scanSkippedReason = SCAN_NOT_RUN_REASON;
  }
  // `lives` is in `probed` order, which is `plans` order with the monthly rows taken out, so one cursor pairs them.
  let probedIndex = 0;
  const observations = plans.map((plan) => {
    if (plan.allowance.kind === "monthly-spend") {
      return observe({
        home,
        live: { codexHome: plan.storeDir, kind: "unreadable", readAtIso: nowIso, reason: MONTHLY_NOT_PROBED_REASON },
        nowIso,
        plan,
        scanSkippedReason: MONTHLY_NOT_PROBED_REASON,
      });
    }
    const live = lives[probedIndex]!;
    probedIndex += 1;
    return observe({ home, live, nowIso, plan, scanSkippedReason });
  });
  return { observations, readAtIso: nowIso, register, thresholds: register.thresholds.codex };
}

/**
 * File one live batch's sign-in observations, and say on stderr what was not filed — never failing the read.
 *
 * The routing read is how Codex keeps working, and unblocking Codex outranks the card (the owner's priority is unblocking Codex usage). So a store outage, a refused alias or a lost
 * compare-and-set is a warning — which every verb running the read prints — and the card is late by one read.
 *
 * @param observed each read store's alias, live answer and auth stamps
 * @param signInPort where the observations are filed
 */
async function fileCodexSignIns({
  home,
  observed,
  signInPort,
}: {
  home: string;
  observed: readonly CodexSignInObserved[];
  signInPort: CodexSignInPort;
}): Promise<void> {
  if (observed.length === 0) {
    return;
  }
  const unfiled: string[] = [];
  try {
    const filed = await signInPort.record({ home, observed });
    if (filed.isErr()) {
      unfiled.push(filed.error.message);
    } else {
      for (const outcome of filed.value) {
        if (outcome.kind === "refused") {
          unfiled.push(`${outcome.alias}: ${outcome.error.message}`);
        }
      }
    }
  } catch (cause) {
    unfiled.push(errorMessage({ error: cause }));
  }
  for (const why of unfiled) {
    try {
      logger.warn({ msg: `a codex sign-in observation was not filed, so its card waits for the next read: ${why}` });
    } catch {
      // The warning sink itself failed; the card is still only one read late, and routing must not stop for it.
    }
  }
}
