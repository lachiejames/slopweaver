/**
 * THE FLEET-WIDE SPAWN BACKOFF — the third step: when hook latency or load is
 * over the line the fleet backs off spawns exponentially rather than every seat contending. Pure; the state
 * file and its lock are `./spawnBackoffStore.ts`, the door is `../../cli/commands/cmux/spawnCapacityWait.ts`.
 *
 * ## What was missing
 *
 * Steps 1 and 2 bounded one hook. Nothing slowed the FLEET: an unwaited `cmux spawn` read only the
 * boots in flight, never the load, the memory gauges or a stalled hook, so a seat booted onto a machine already
 * holding; and every `--wait` spawn polled on its own schedule and all of them went on the first clear reading,
 * a herd landing on a machine that had only just recovered. A new seat's boot storm on a saturated box is what
 * turned one slow hook into the 2h19m wedge.
 *
 * ## The two halves, and why neither touches a healthy machine
 *
 * The owner's ruling bounds this: the thresholds are doubled and the load hold reads idle too. So nothing here slows a spawn the current
 * thresholds would let through on a healthy machine. Both halves start only ABOVE the line:
 *
 * - **The held window.** A reading that holds (load with idle under its floor, the compressor, swapfiles, a
 *   stalled hook, the boots in flight — `./capacityHolds.ts`'s thresholds, unchanged) closes the door for
 *   {@link spawnBackoffSeconds} and nobody reads the gauge again until it opens: 10s, then 20, 40, 80, 160, capped
 *   at 180, doubling on each consecutive held reading. One reading per window, fleet-wide, because the window is
 *   in a shared file — a waiter that wakes inside it reads a file, never `top`.
 * - **The recovery spacing.** The first clear reading admits one spawn, and the next must wait half the last
 *   window after it, then half that, until the gap falls under the base and the fleet is back to no spacing at all.
 *   That is what stops the herd: twenty waiters released by one clear reading become one boot now and the rest
 *   spread over the minutes the load average needs to see it (`./recentBoots.ts`, its 3τ).
 *
 * The disk floor is not here: a full volume is `worktree prune`'s, and a `--wait` settles past it already.
 *
 * ## Constants, and which is measured
 *
 * {@link SPAWN_BACKOFF_BASE_SECONDS} is a JUDGEMENT: one second of `top` and a few `ps` reads is the gauge, so a
 * 10s window costs a waiting spawn little and spares the machine nine readings in ten. The cap is DERIVED: the
 * 1-minute load average's own 3τ (`./recentBoots.ts`'s `BOOT_WINDOW_SECONDS`), past which a boot the window was
 * waiting on is fully visible to the load hold, so a longer window would be waiting on nothing new.
 * {@link HOLD_STREAK_GAP_SECONDS} is the same 3τ: two held readings further apart than a load average's memory
 * are two incidents, not one escalating.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import type { ProcessRow } from "../standing/processes.js";
import { DEFAULT_SEGMENTS_HOLD_PCT, DEFAULT_SWAPFILE_HOLD_COUNT } from "./capacity.js";
import { diskFloorFor, holdReasons, loadHoldFor } from "./capacityHolds.js";
import { parseCompressorSysctl, parseSysctlLoadavg } from "./capacityParse.js";
import type { GradeReason } from "./capacityVerdict.js";
import { DEFAULT_HOOK_STALL_HOLD_SECONDS, fleetLoadReading, type ProcessElapsed } from "./fleetLoad.js";
import { hiddenCpuReading } from "./hiddenCpu.js";
import { BOOT_WINDOW_SECONDS, recentBoots } from "./recentBoots.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** The first held window, in seconds. A judgement, sized in this module's header. */
const SPAWN_BACKOFF_BASE_SECONDS = 10;

/** The longest held window: the load average's 3τ, past which there is nothing new for a window to wait on. */
const SPAWN_BACKOFF_MAX_SECONDS = BOOT_WINDOW_SECONDS;

/** Two held readings further apart than this are two incidents, so the second starts again at the base. */
const HOLD_STREAK_GAP_SECONDS = BOOT_WINDOW_SECONDS;

/** The fleet's shared backoff, as the state file carries it. */
export interface SpawnBackoffState {
  /** Held readings in a row since the fleet last admitted a spawn. */
  readonly consecutiveHolds: number;
  /** No gauge is read before this instant — the window the last held reading earned. */
  readonly retryAtIso: string | undefined;
  /** What the last held reading held on, printed while its window stands. */
  readonly holdSubjects: readonly string[];
  /** When the fleet last admitted a spawn. */
  readonly lastAdmitIso: string | undefined;
  /** How long after {@link lastAdmitIso} the next admission must wait — the recovery spacing, halving per admission. */
  readonly admitGapSeconds: number;
}

/** A fresh install's state: nothing held, nothing admitted, no spacing. */
export const INITIAL_SPAWN_BACKOFF_STATE: SpawnBackoffState = {
  admitGapSeconds: 0,
  consecutiveHolds: 0,
  holdSubjects: [],
  lastAdmitIso: undefined,
  retryAtIso: undefined,
};

const STATE_SCHEMA = z
  .object({
    admitGapSeconds: z.number().int().nonnegative(),
    consecutiveHolds: z.number().int().nonnegative(),
    holdSubjects: z.array(z.string()),
    lastAdmitIso: z.iso.datetime().optional(),
    retryAtIso: z.iso.datetime().optional(),
  })
  .strict()
  // A held streak, its retry instant and its subjects are written together and cleared together, so a document
  // carrying one without the others was not written by this module — and read as written, a streak with no
  // retry instant would open the door it was recording as shut.
  .refine(
    (state) =>
      state.consecutiveHolds > 0 === (state.retryAtIso !== undefined) &&
      state.consecutiveHolds > 0 === state.holdSubjects.length > 0,
    { message: "a held streak, its retryAtIso and its holdSubjects must be present together or absent together" },
  )
  // Recovery spacing is measured FROM an admission, and only an admission clears a streak while keeping a gap,
  // so a cleared streak still spacing with no admission to measure from would read as no spacing at all.
  .refine((state) => state.consecutiveHolds > 0 || state.admitGapSeconds <= 0 || state.lastAdmitIso !== undefined, {
    message: "a recovery gap with no held streak must carry the lastAdmitIso it is measured from",
  });

/**
 * Validate a decoded state document. A malformed one is an error naming what is wrong, never the initial state:
 * reading a broken file as "nothing held" would license a spawn on exactly the machine that wrote it mid-incident.
 *
 * @param value the decoded JSON
 * @returns the state, or why it is not one
 */
export function parseSpawnBackoffState({ value }: { value: unknown }): Result<SpawnBackoffState> {
  const parsed = STATE_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const { admitGapSeconds, consecutiveHolds, holdSubjects, lastAdmitIso, retryAtIso } = parsed.data;
  return ok({ admitGapSeconds, consecutiveHolds, holdSubjects, lastAdmitIso, retryAtIso });
}

/**
 * The window the k-th consecutive held reading earns: the base, doubling per reading, capped.
 *
 * @param consecutiveHolds how many held readings in a row, this one included
 * @returns the window in seconds — zero for no held reading at all
 */
export function spawnBackoffSeconds({ consecutiveHolds }: { consecutiveHolds: number }): number {
  if (consecutiveHolds <= 0) {
    return 0;
  }
  return Math.min(SPAWN_BACKOFF_BASE_SECONDS * 2 ** (consecutiveHolds - 1), SPAWN_BACKOFF_MAX_SECONDS);
}

/** Half a gap, in whole seconds, or zero once that falls under the base — the recovery's own end. */
function halvedGap({ seconds }: { seconds: number }): number {
  const half = Math.floor(seconds / 2);
  return half < SPAWN_BACKOFF_BASE_SECONDS ? 0 : half;
}

/** An instant `seconds` after `iso`, as ISO. */
function plusSeconds({ iso, seconds }: { iso: string; seconds: number }): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

/** Whether the door is open to a reading now, or closed until an instant and why. */
export type SpawnWindow =
  | { readonly kind: "open" }
  | {
      readonly kind: "closed";
      /** `held`: a held reading's window; `recovery`: the spacing after the last admission. */
      readonly why: "held" | "recovery";
      readonly untilIso: string;
      readonly holdSubjects: readonly string[];
    };

/**
 * Whether a spawn may take a reading now. Inside a held window, or inside the recovery spacing after the last
 * admission, the answer is closed and NO gauge is read — that is what makes the window fleet-wide rather than
 * a per-process sleep.
 *
 * @param state the shared backoff
 * @param nowIso the instant being judged
 * @param bootsBypassed whether `SLOPWEAVER_ALLOW_BOOT_BURST=1` is set, which opens a window that held on boots alone
 * @returns open, or closed until when and why
 */
export function spawnWindow({
  state,
  nowIso,
  bootsBypassed,
}: {
  state: SpawnBackoffState;
  nowIso: string;
  bootsBypassed: boolean;
}): SpawnWindow {
  const now = Date.parse(nowIso);
  const bootsOnly = state.holdSubjects.length > 0 && state.holdSubjects.every((subject) => subject === "boots");
  if (state.retryAtIso !== undefined && now < Date.parse(state.retryAtIso) && !(bootsBypassed && bootsOnly)) {
    return { holdSubjects: state.holdSubjects, kind: "closed", untilIso: state.retryAtIso, why: "held" };
  }
  if (state.lastAdmitIso !== undefined && state.admitGapSeconds > 0) {
    const untilIso = plusSeconds({ iso: state.lastAdmitIso, seconds: state.admitGapSeconds });
    if (now < Date.parse(untilIso)) {
      return { holdSubjects: [], kind: "closed", untilIso, why: "recovery" };
    }
  }
  return { kind: "open" };
}

/** What one reading taken through an open window decided, and the state to write. */
export type SpawnAdmission =
  | { readonly kind: "admit"; readonly nextState: SpawnBackoffState }
  | {
      readonly kind: "held";
      readonly reasons: readonly GradeReason[];
      readonly consecutiveHolds: number;
      readonly windowSeconds: number;
      readonly retryAtIso: string;
      readonly nextState: SpawnBackoffState;
    };

/**
 * Judge one reading taken through an open window. A held reading closes the window for the next exponential
 * step — or restarts at the base when the last hold is older than {@link HOLD_STREAK_GAP_SECONDS} — and carries
 * that window into the recovery spacing; a clear one admits, resets the streak, and halves the spacing.
 *
 * @param state the shared backoff the window was judged on
 * @param reasons the hold clauses the reading crossed, already without any a hatch waived
 * @param nowIso the instant of the reading
 * @returns admit or held, each with the state to write
 */
export function spawnAdmission({
  state,
  reasons,
  nowIso,
}: {
  state: SpawnBackoffState;
  reasons: readonly GradeReason[];
  nowIso: string;
}): SpawnAdmission {
  if (reasons.length === 0) {
    return {
      kind: "admit",
      nextState: {
        admitGapSeconds: halvedGap({ seconds: state.admitGapSeconds }),
        consecutiveHolds: 0,
        holdSubjects: [],
        lastAdmitIso: nowIso,
        retryAtIso: undefined,
      },
    };
  }
  const streakLive =
    state.retryAtIso !== undefined &&
    Date.parse(nowIso) - Date.parse(state.retryAtIso) <= HOLD_STREAK_GAP_SECONDS * 1000;
  let consecutiveHolds = 1;
  if (streakLive) {
    consecutiveHolds = state.consecutiveHolds + 1;
  }
  const windowSeconds = spawnBackoffSeconds({ consecutiveHolds });
  const retryAtIso = plusSeconds({ iso: nowIso, seconds: windowSeconds });
  return {
    consecutiveHolds,
    kind: "held",
    nextState: {
      admitGapSeconds: windowSeconds,
      consecutiveHolds,
      holdSubjects: [...new Set(reasons.map((reason) => reason.subject))],
      lastAdmitIso: state.lastAdmitIso,
      retryAtIso,
    },
    reasons,
    retryAtIso,
    windowSeconds,
  };
}

/**
 * Whether the one-second `top` sample is worth taking: only when the load is at or over its hold, because idle
 * only ever CLEARS a load hold (`./cpuLoadHold.ts`). Under the hold, a spawn pays for no `top` at all.
 *
 * @param loadText `sysctl -n vm.loadavg`'s stdout, or `undefined` when it could not be read
 * @param cores the core count that sizes the load hold
 * @returns true when the idle reading could change the verdict
 */
export function spawnIdleSampleNeeded({
  loadText,
  cores,
}: {
  loadText: string | undefined;
  cores: number | undefined;
}): boolean {
  const load = loadText === undefined ? undefined : parseSysctlLoadavg({ text: loadText });
  return load !== undefined && load.load1 >= loadHoldFor({ cores });
}

/**
 * The hold clauses one spawn reading crosses — `./capacityHolds.ts`'s own thresholds over the cheap gauges a
 * spawn can afford, minus the disk floor, which is `worktree prune`'s and never a spawn's.
 *
 * @param loadText `sysctl -n vm.loadavg`'s stdout
 * @param cpuSampleText `top -l 2 -s 1 -stats pid,cpu`'s stdout, taken only when {@link spawnIdleSampleNeeded}
 * @param compressorText the compressor oids' stdout
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` table, where a stalled hook is found
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` rows, which age the boots and the hooks
 * @param sessions every live Claude Code session, the boots' source
 * @returns every clause crossed, in `holdReasons`' order; empty when the reading is clear
 */
export function spawnHoldReasons({
  loadText,
  cpuSampleText,
  compressorText,
  swapfileCount,
  cores,
  processes,
  elapsedRows,
  sessions,
}: {
  loadText: string | undefined;
  cpuSampleText: string | undefined;
  compressorText: string | undefined;
  swapfileCount: number | undefined;
  cores: number | undefined;
  processes: readonly ProcessRow[];
  elapsedRows: readonly ProcessElapsed[];
  sessions: readonly ClaudeSession[];
}): readonly GradeReason[] {
  return holdReasons({
    boots: recentBoots({ elapsedRows, sessions }),
    compressor: compressorText === undefined ? undefined : parseCompressorSysctl({ text: compressorText }),
    disk: undefined,
    diskFloor: diskFloorFor(),
    fleet: fleetLoadReading({ cpuRows: [], elapsedRows, processes }),
    hookStallHoldSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS,
    idlePct: hiddenCpuReading({ cores, cpuSampleText, statRows: [] }).idlePct,
    load: loadText === undefined ? undefined : parseSysctlLoadavg({ text: loadText }),
    loadHold: loadHoldFor({ cores }),
    segmentsHoldPct: DEFAULT_SEGMENTS_HOLD_PCT,
    swapfileCount,
    swapfileHoldCount: DEFAULT_SWAPFILE_HOLD_COUNT,
  });
}

/** The backoff as `machine capacity` reports it. */
export type SpawnBackoffStatus =
  | { readonly phase: "clear" }
  | {
      readonly phase: "held" | "recovery";
      readonly consecutiveHolds: number;
      readonly holdSubjects: readonly string[];
      /** When the door opens again. */
      readonly untilIso: string;
    };

/**
 * The backoff's phase at an instant, for `machine capacity`.
 *
 * @param state the shared backoff
 * @param nowIso the instant being reported
 * @returns the phase and when it ends
 */
export function spawnBackoffStatus({
  state,
  nowIso,
}: {
  state: SpawnBackoffState;
  nowIso: string;
}): SpawnBackoffStatus {
  const window = spawnWindow({ bootsBypassed: false, nowIso, state });
  if (window.kind === "open") {
    return { phase: "clear" };
  }
  return {
    consecutiveHolds: state.consecutiveHolds,
    holdSubjects: window.holdSubjects,
    phase: window.why,
    untilIso: window.untilIso,
  };
}

/** The backoff as `machine capacity` reports it: its phase, or why its state could not be read. */
export type SpawnBackoffReport = SpawnBackoffStatus | { readonly phase: "unreadable"; readonly message: string };

/**
 * The one line `machine capacity` prints while the backoff is closed or unreadable, or `undefined` while it is
 * open. An unreadable state is printed rather than hidden: every spawn on the machine is refusing on it.
 *
 * @param report the backoff's phase, or its read failure
 * @returns e.g. `spawn backoff: HELD on cpu — held reading 3 in a row, no spawn reads the gauge before <iso>`
 */
export function spawnBackoffLine({ report }: { report: SpawnBackoffReport }): string | undefined {
  switch (report.phase) {
    case "clear":
      return undefined;
    case "unreadable":
      return `spawn backoff: UNREADABLE — every spawn refuses until it is fixed: ${report.message}`;
    case "recovery":
      return `spawn backoff: RECOVERY — one spawn admitted at a time after a hold, the next at ${report.untilIso}`;
    case "held":
      return (
        `spawn backoff: HELD on ${report.holdSubjects.join(" and ")} — held reading ${String(report.consecutiveHolds)} ` +
        `in a row, no spawn reads the gauge before ${report.untilIso}`
      );
    default: {
      const unhandled: never = report;
      return unhandled;
    }
  }
}
