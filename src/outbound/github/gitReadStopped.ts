/**
 * A git read in a merge-time sweep that was still running at its bound. The reads it covers answer through
 * shapes that cannot carry a reason — a `ProbeSeams` callback's boolean, an empty listing, an `unknown` — so a
 * child killed at its timeout used to come back as "absent", "no files" or "unknown", indistinguishable from a
 * real answer. Instead the read THROWS this one error, and each sweep's entry (`./probeSweep.ts`,
 * `./docsBudgetSweep.ts`) catches exactly it and reports the sweep `not-evaluated` with its message. Nothing
 * else is caught: a different throw is a defect and still surfaces as one.
 */
import { isRecord } from "../../lib/parsers.js";

/** Thrown by a bounded git read that was stopped at its timeout; its message names the command and the bound. */
export class GitReadStoppedError extends Error {
  /** What a catch branches on, alongside `instanceof`. */
  readonly code = "GIT_READ_TIMED_OUT";
}

/**
 * Throw {@link GitReadStoppedError} when a caught child failure is Node's report of a child killed at its
 * `timeout` (`code: "ETIMEDOUT"`); return when it is any other failure, which the caller handles as before.
 *
 * @param error what the launcher threw
 * @param command the git arguments, joined, for the message
 * @param timeoutMs the bound the read carried
 */
export function throwIfStopped({
  error,
  command,
  timeoutMs,
}: {
  error: unknown;
  command: string;
  timeoutMs: number;
}): void {
  if (isRecord(error) && error["code"] === "ETIMEDOUT") {
    const minutes = String(timeoutMs / 60_000);
    throw new GitReadStoppedError(`git ${command} was still running after ${minutes} minutes, so it was stopped`);
  }
}
