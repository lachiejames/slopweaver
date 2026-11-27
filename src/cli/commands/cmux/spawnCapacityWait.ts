/**
 * `cmux spawn`'s admission: every spawn, waited or not, goes through the fleet-wide spawn backoff
 * (`../../../live/machine/spawnBackoff.ts`) before anything is opened.
 *
 * ## What a spawn reads, and what it no longer skips
 *
 * An unwaited spawn that read only the boots in flight (the boot cap) let a seat booted onto a
 * machine holding on load, memory or a stalled hook; and a `--wait` spawn waited on the whole capacity hold on
 * its own schedule, then went with every other waiter on the same clear reading. Now both take one reading
 * through the shared window, under one lock: the load from `sysctl` (no `top` on a healthy machine), the
 * compressor and swapfiles, the boots in flight and any stalled hook, judged by `../../../live/machine/
 * capacityHolds.ts`'s unchanged thresholds. A held reading closes the door fleet-wide for an exponential window
 * and an unwaited spawn exits 4 naming it; the first clear reading after a hold admits ONE spawn and spaces the
 * rest. The disk floor is not read here, exactly as before: a full volume is `worktree prune`'s.
 *
 * ## Waiting
 *
 * `--wait` re-attempts on the one wait contract's LOCAL schedule (`../../../wait/loop.ts`), because an attempt
 * inside a closed window reads one small file and never the gauge — so twenty waiters cost the machine one
 * reading per window between them, not twenty. `for slug in …; do slopweaver cmux spawn "$slug" --model opus
 * --wait; done` remains the way to open a list.
 *
 * ## The two hatches, and the one caller that needs neither
 *
 * `SLOPWEAVER_ALLOW_BOOT_BURST=1` waives a hold on boots in flight, as it always did; `SLOPWEAVER_ALLOW_SPAWN_BACKOFF=1`
 * waives the whole gate. `machine watch`'s investigation seat opens THROUGH a hold by design — it is the seat
 * that investigates it, rate-limited by its own backoff (`../../../live/machine/backoff.ts`) — so it enters by
 * `runCmuxSpawnPastBackoff` in `./run.ts`, an in-process door no session can type. `session re-seat` enters
 * the same way, having taken its admission through {@link waitForSpawnCapacity} BEFORE it closed the seat, and so
 * does a Recovery press's chair restart (`../fleet/recoverChair.ts`), which seats the one supervisor the fleet is
 * missing.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { DEFAULT_TOP_N } from "../../../live/machine/capacity.js";
import type { GradeReason } from "../../../live/machine/capacityVerdict.js";
import {
  loadavgSysctlText,
  type MachineCapacityDeps,
  productionMachineCapacityDeps,
  READ_TIMEOUT_MS,
} from "../../../live/machine/read.js";
import {
  spawnAdmission,
  spawnHoldReasons,
  spawnIdleSampleNeeded,
  spawnWindow,
} from "../../../live/machine/spawnBackoff.js";
import { type SpawnBackoffStoreError, withSpawnAdmissionLock } from "../../../live/machine/spawnBackoffStore.js";
import type { WaitOptions } from "../../../wait/flags.js";
import {
  LOCAL_WAIT_CEILING_MS,
  LOCAL_WAIT_SCHEDULE_MS,
  realWaitClock,
  type WaitClock,
  waitUntilSettled,
} from "../../../wait/loop.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

/** The variable that waives a hold on boots in flight — the `boot-burst` row in `../../../hatch/registry.ts`. */
const ALLOW_BOOT_BURST_ENV = "SLOPWEAVER_ALLOW_BOOT_BURST";

/** The variable that waives the whole spawn backoff — the `spawn-backoff` row in `../../../hatch/registry.ts`. */
const ALLOW_SPAWN_BACKOFF_ENV = "SLOPWEAVER_ALLOW_SPAWN_BACKOFF";

/**
 * The read seams one spawn reading takes: the cheap gauges, and `top`'s sample only past the load hold.
 *
 * @internal
 */
export type SpawnGaugeDeps = Pick<
  MachineCapacityDeps,
  "compressorSysctl" | "cpuCount" | "cpuSample" | "elapsed" | "processes" | "sessions" | "swapfileCount"
> & {
  /** `sysctl -n vm.loadavg`'s stdout, or `undefined` when the read failed. */
  readonly loadavg: () => string | undefined;
};

/** Everything a spawn's admission touches, injected so a test passes a temp home, plain fakes and a fake clock. */
export interface SpawnAdmissionDeps {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly gauge: SpawnGaugeDeps;
  readonly clock: WaitClock;
  readonly nowIso: () => string;
}

/** What one admission attempt answered. */
export type SpawnAttempt =
  | { readonly kind: "admit" }
  /** The window was closed: nothing was read, and nothing was written. */
  | {
      readonly kind: "closed";
      readonly why: "held" | "recovery";
      readonly untilIso: string;
      readonly holdSubjects: readonly string[];
    }
  /** The reading held, and closed the window for {@link windowSeconds}. */
  | {
      readonly kind: "held";
      readonly reasons: readonly GradeReason[];
      readonly consecutiveHolds: number;
      readonly windowSeconds: number;
      readonly retryAtIso: string;
    }
  | { readonly kind: "failed"; readonly error: SpawnBackoffStoreError };

/**
 * Take one reading of the gauges a spawn can afford.
 *
 * @param gauge the read seams
 * @returns every hold clause the reading crossed
 */
function readSpawnHoldReasons({ gauge }: { gauge: SpawnGaugeDeps }): readonly GradeReason[] {
  const loadText = gauge.loadavg();
  const cores = gauge.cpuCount();
  let cpuSampleText: string | undefined;
  if (spawnIdleSampleNeeded({ cores, loadText })) {
    cpuSampleText = gauge.cpuSample();
  }
  return spawnHoldReasons({
    compressorText: gauge.compressorSysctl(),
    cores,
    cpuSampleText,
    elapsedRows: gauge.elapsed(),
    loadText,
    processes: gauge.processes(),
    sessions: gauge.sessions(),
    swapfileCount: gauge.swapfileCount(),
  });
}

/**
 * One admission attempt under the fleet's spawn lock: a closed window answers without a reading, an open one
 * reads the gauge once and writes what it decided.
 *
 * @param deps the home, gauge and clock
 * @param bootsBypassed whether a hold on boots in flight is waived for this spawn
 * @returns what the attempt answered
 */
export function attemptSpawnAdmission({
  deps,
  bootsBypassed,
}: {
  deps: SpawnAdmissionDeps;
  bootsBypassed: boolean;
}): SpawnAttempt {
  const nowIso = deps.nowIso();
  const outcome = withSpawnAdmissionLock<SpawnAttempt>({
    act: ({ state }) => {
      const window = spawnWindow({ bootsBypassed, nowIso, state });
      if (window.kind === "closed") {
        return { nextState: undefined, value: window };
      }
      const read = readSpawnHoldReasons({ gauge: deps.gauge });
      const waived = read.filter((reason) => bootsBypassed && reason.subject === "boots");
      waived.forEach((reason) => {
        logger.error({ msg: `cmux spawn: boot hold OVERRIDDEN by ${ALLOW_BOOT_BURST_ENV}=1 — ${reason.text}` });
      });
      const reasons = read.filter((reason) => !waived.includes(reason));
      // Stamped AFTER the gauge, which may spend seconds in `top`: a recovery gap measured from before the read
      // would count that latency as spacing and let the next spawn straight in.
      const decision = spawnAdmission({ nowIso: deps.nowIso(), reasons, state });
      if (decision.kind === "admit") {
        return { nextState: decision.nextState, value: { kind: "admit" } };
      }
      const { consecutiveHolds, retryAtIso, windowSeconds } = decision;
      return {
        nextState: decision.nextState,
        value: { consecutiveHolds, kind: "held", reasons, retryAtIso, windowSeconds },
      };
    },
    home: deps.home,
    nowIso,
  });
  if (outcome.isErr()) {
    return { error: outcome.error, kind: "failed" };
  }
  return outcome.value;
}

/** The subjects a deferring attempt names — the window's, or the reading's. */
function subjectsOf({ attempt }: { attempt: SpawnAttempt }): readonly string[] {
  if (attempt.kind === "closed") {
    return attempt.holdSubjects;
  }
  if (attempt.kind === "held") {
    return [...new Set(attempt.reasons.map((reason) => reason.subject))];
  }
  return [];
}

/**
 * The one line an attempt that did not admit prints — the window or reading, and when the door opens.
 *
 * @returns the line, or `undefined` for an admission
 */
function spawnAttemptLine({ attempt }: { attempt: SpawnAttempt }): string | undefined {
  switch (attempt.kind) {
    case "admit":
      return undefined;
    case "failed":
      return `spawn backoff: ${attempt.error.message}`;
    case "closed":
      if (attempt.why === "recovery") {
        return `spawn backoff: the machine has just come out of a hold, so the fleet admits one spawn at a time — the next at ${attempt.untilIso}`;
      }
      return `spawn backoff: HELD on ${subjectsOf({ attempt }).join(" and ")} — no spawn reads the gauge before ${attempt.untilIso}`;
    case "held":
      return (
        `spawn backoff: HELD — ${attempt.reasons.map((reason) => reason.text).join("; ")} — held reading ` +
        `${String(attempt.consecutiveHolds)} in a row, so no spawn reads the gauge for ${String(attempt.windowSeconds)}s, ` +
        `until ${attempt.retryAtIso}`
      );
    default: {
      const unhandled: never = attempt;
      return unhandled;
    }
  }
}

/**
 * The four-line refusal an unwaited spawn prints when the backoff defers it. A hold on boots alone names the
 * `boot-burst` hatch it always named; anything else names `spawn-backoff`.
 *
 * @param attempt a `closed` or `held` attempt
 * @returns the refusal
 */
export function spawnDeferralRefusal({ attempt }: { attempt: SpawnAttempt }): string {
  const subjects = subjectsOf({ attempt });
  const bootsOnly = subjects.length > 0 && subjects.every((subject) => subject === "boots");
  const line = spawnAttemptLine({ attempt })!; // every attempt this is called with defers
  return hatchRefusal({
    detail: `${line.replace(/^spawn backoff: /u, "")} — re-run with --wait to be held until the fleet's window opens`,
    hatch: hatchFor({ id: bootsOnly ? "boot-burst" : "spawn-backoff" }),
  });
}

/**
 * The production admission: the real gauges, environment and clock over the state home the SPAWN resolved, so a
 * `--home` spawn judges and writes that home's window, never the ambient one's.
 *
 * @param home the spawn's named `--home`, whose shared backoff state it reads and writes; unnamed is the ambient one
 * @returns the admission's effects
 */
export function productionSpawnAdmissionDeps({ home: named }: { home: string | undefined }): SpawnAdmissionDeps {
  const home = resolveHome({ named });
  const capacity = productionMachineCapacityDeps({ home, topN: DEFAULT_TOP_N });
  return {
    clock: realWaitClock(),
    env: process.env,
    gauge: {
      compressorSysctl: capacity.compressorSysctl,
      cpuCount: capacity.cpuCount,
      cpuSample: capacity.cpuSample,
      elapsed: capacity.elapsed,
      loadavg: loadavgSysctlText,
      processes: capacity.processes,
      sessions: capacity.sessions,
      swapfileCount: capacity.swapfileCount,
    },
    home,
    nowIso: () => new Date().toISOString(),
  };
}

/**
 * Admit one spawn through the fleet-wide backoff, or defer it. Unwaited, one attempt; waited, attempts on the
 * local wait schedule until one admits or the timeout passes.
 *
 * @param wait the parsed `--wait`/`--timeout-seconds`
 * @param deps the admission's effects — {@link productionSpawnAdmissionDeps} over the spawn's own state home
 * @returns `undefined` to proceed with the spawn, `EXIT_DEFERRED` when the backoff deferred it, or `EXIT_ERROR`
 *   when the shared state could not be read or written
 */
export async function waitForSpawnCapacity({
  wait,
  deps,
}: {
  wait: WaitOptions;
  deps: SpawnAdmissionDeps;
}): Promise<number | undefined> {
  if (deps.env[ALLOW_SPAWN_BACKOFF_ENV] === "1") {
    logger.error({ msg: `cmux spawn: spawn backoff OVERRIDDEN by ${ALLOW_SPAWN_BACKOFF_ENV}=1 — no reading taken` });
    return undefined;
  }
  const bootsBypassed = deps.env[ALLOW_BOOT_BURST_ENV] === "1";
  const attempt = (): Promise<SpawnAttempt> => attemptPastLockContention({ bootsBypassed, deps });
  if (!wait.wait) {
    return settleUnwaited({ attempt: await attempt() });
  }
  const outcome = await waitUntilSettled({
    ceilingMs: LOCAL_WAIT_CEILING_MS,
    clock: deps.clock,
    emit: (line) => {
      logger.out({ line: `cmux spawn: ${line}` });
    },
    lines: (reading) => {
      const line = spawnAttemptLine({ attempt: reading });
      return line === undefined ? [] : [line];
    },
    read: attempt,
    schedule: LOCAL_WAIT_SCHEDULE_MS,
    settled: (reading) => reading.kind === "admit" || (reading.kind === "failed" && reading.error.code !== "LOCK_HELD"),
    timeoutSeconds: wait.timeoutSeconds,
  });
  if (outcome.kind === "timed-out") {
    logger.error({
      msg: `cmux spawn: WAIT-TIMEOUT after ${String(wait.timeoutSeconds)}s; nothing was opened (${String(spawnAttemptLine({ attempt: outcome.reading }))})`,
    });
    return EXIT_DEFERRED;
  }
  if (outcome.reading.kind === "failed") {
    logger.error({ msg: `cmux spawn: refusing — ${outcome.reading.error.message}` });
    return EXIT_ERROR;
  }
  if (outcome.reads > 1) {
    logger.out({
      line: `cmux spawn: admitted by the spawn backoff after ${String(outcome.reads)} attempts — spawning`,
    });
  }
  return undefined;
}

/**
 * The timed children {@link readSpawnHoldReasons} runs one after another under the lock: `sysctl` for the load,
 * `top` for idle, `sysctl` for the compressor, `ps` twice (elapsed, processes), and `sysctl` for the swapfile
 * prefix before its directory scan.
 */
const GAUGE_CHILDREN_UNDER_LOCK = 6;

/**
 * How long one attempt waits out another spawn's admission before it answers `LOCK_HELD`, so two spawns started
 * together are both judged on the gauge, never one deferred on contention alone. The guarded section is one state
 * read, those children, two local directory scans (the session registry, the swapfile prefix) and one write —
 * under a second on a machine that is not wedged. The patience covers every child at its `read.ts` cap in turn,
 * plus half a minute for the rest. The directory scans carry no timeout, which is the stated residue:
 * a holder still in it past this leaves this spawn deferred (exit 4), never admitted beside it, since the lock is
 * never taken from the living.
 */
const LOCK_PATIENCE_MS = GAUGE_CHILDREN_UNDER_LOCK * READ_TIMEOUT_MS + 30_000;

/** The gap between two tries at a held admission lock. */
const LOCK_RETRY_MS = 100;

/** One admission attempt, re-tried past a lock another spawn holds for up to {@link LOCK_PATIENCE_MS}. */
async function attemptPastLockContention({
  deps,
  bootsBypassed,
}: {
  deps: SpawnAdmissionDeps;
  bootsBypassed: boolean;
}): Promise<SpawnAttempt> {
  const startedMs = deps.clock.nowMs();
  let attempt = attemptSpawnAdmission({ bootsBypassed, deps });
  while (
    attempt.kind === "failed" &&
    attempt.error.code === "LOCK_HELD" &&
    deps.clock.nowMs() - startedMs < LOCK_PATIENCE_MS
  ) {
    await deps.clock.sleep({ ms: LOCK_RETRY_MS });
    attempt = attemptSpawnAdmission({ bootsBypassed, deps });
  }
  return attempt;
}

/** An unwaited spawn's one attempt, as an exit: admitted, deferred with the refusal, or a state fault. */
function settleUnwaited({ attempt }: { attempt: SpawnAttempt }): number | undefined {
  if (attempt.kind === "admit") {
    return undefined;
  }
  if (attempt.kind === "failed") {
    logger.error({ msg: `cmux spawn: ${attempt.error.message}` });
    return attempt.error.code === "LOCK_HELD" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  logger.error({ msg: spawnDeferralRefusal({ attempt }) });
  return EXIT_DEFERRED;
}
