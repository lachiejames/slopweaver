/**
 * The machine's lap lock as `slopweaver github lap` reads it, as pure functions: its decoded shape, the phase a
 * holder is in, how that phase reads in a sentence, and whether a standing lock still holds the machine. The file
 * edges that take, advance and release it are `./lapLock.ts`'s.
 */

import { isRecord } from "../../../lib/parsers.js";

/**
 * Where a lap holding the machine stands: `preflight` from the moment it takes the lock, before its reads, its
 * fetch and the landing check's fresh tree; `running` once it has a head and starts its lanes or its landing.
 */
export type LapLockPhase = "preflight" | "running";

/** A standing lap lock as read from disk. */
export interface LapLock {
  readonly pid: number;
  readonly startedIso: string;
  readonly subject: string;
  readonly phase: LapLockPhase;
  /** Random per acquisition, so a lap removes only the lock it took and a reused pid is told apart. */
  readonly nonce: string;
}

/**
 * Decode a parsed lock file. A lock with no `phase` was written by a lap that locked only at its lanes, so it is
 * `running`; a phase present but neither known value is not a lock this code can read.
 *
 * @param value the parsed JSON
 * @returns the lock, or `undefined` when the value is not one
 */
export function decodeLapLock({ value }: { value: unknown }): LapLock | undefined {
  if (
    !isRecord(value) ||
    typeof value["pid"] !== "number" ||
    typeof value["subject"] !== "string" ||
    typeof value["nonce"] !== "string"
  ) {
    return undefined;
  }
  const written = value["phase"];
  let phase: LapLockPhase = "running";
  if (written === "preflight") {
    phase = "preflight";
  } else if (written !== undefined && written !== "running") {
    return undefined;
  }
  return {
    nonce: value["nonce"],
    phase,
    pid: value["pid"],
    startedIso: String(value["startedIso"]),
    subject: value["subject"],
  };
}

/**
 * How a lock's phase reads in a sentence naming its holder.
 *
 * @returns the phase in words
 */
export function lapLockPhaseWords({ phase }: { phase: LapLockPhase }): string {
  if (phase === "preflight") {
    return "still in its preflight, before its lanes";
  }
  return "running its lanes or landing";
}

/**
 * Whether a standing lock still holds the machine. Only a LIVE process holds it: a lap that died leaves its file
 * behind, and refusing on that forever would park every later lap on a corpse.
 *
 * @returns `held` while its process is alive, `stale` once it is gone
 */
export function lapLockState({ lock, pidAlive }: { lock: LapLock; pidAlive: boolean }): "held" | "stale" {
  return pidAlive && lock.pid > 0 ? "held" : "stale";
}
