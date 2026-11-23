/**
 * Waiting for the operation lock instead of refusing at the first contention — the one-call replacement for
 * the retry-with-sleep loop sessions wrapped `github stack push` in.
 *
 * MEASURED over 185,333 Bash tool calls deduplicated by tool-use id from every transcript on this
 * machine: of the 215 hand-rolled foreground poll loops written after the wait contract landed, about 25 were
 * re-running a stack verb until `another stack operation is in progress` stopped coming back. That loop is
 * worse than a flag in two ways beyond its per-tick context cost: every retry re-runs the verb's local gates
 * and its preflight from scratch, and a loop that gives up says nothing about WHY. Repro: extract every Bash
 * `tool_use` from `~/.claude/projects/**`, dedupe by `.id`, and
 * `grep -E '(while|for) .*sleep [0-9]' | grep -c 'stack push'`.
 *
 * ## Each attempt is independent, which is what makes waiting safe
 *
 * `acquireOperationLock` mints a fresh token and a fresh staging candidate per call and cleans that candidate
 * up in its own `finally`, so a wait is a SEQUENCE of whole attempts rather than one attempt held open. A
 * waiter therefore races exactly what the hand-rolled retry loop already raced — nothing is carried between
 * attempts, and the stale-takeover path inside `contestLock` is reached the same way it always was.
 */
import { LOCAL_WAIT_CEILING_MS, LOCAL_WAIT_SCHEDULE_MS, type WaitClock, waitUntilSettled } from "../wait/loop.js";
import { acquireOperationLock, type OperationLockResult } from "./operationLock.js";

/**
 * Acquire the operation lock, re-attempting on the local wait schedule until it is free or the deadline
 * passes. The reading a timeout returns is the LAST attempt's own refusal — which already names the holding
 * pid, its age and the stale threshold — so a caller prints the real reason rather than a synthesised one.
 *
 * @param key the lock key, already lower-cased by the caller exactly as the no-wait path lower-cases it
 * @param nowIso read again per attempt, because each attempt records its own instant in the lock file
 * @param timeoutSeconds how long the wait may run before it reports the last refusal
 * @param emit where a CHANGED waiting line goes. The shared loop suppresses an identical repeat, and a real
 *   lock refusal carries the holder's live AGE, so in practice this prints one line per read — each of which
 *   is a genuine change. That is the informative half: a reader watching the age climb toward the 15-minute
 *   stale threshold can see whether the holder is working or wedged
 * @param staleAfterMs the stale threshold every attempt is taken with, forwarded untouched; omitted, each
 *   attempt takes the lock's own default exactly as the no-wait path does
 * @param acquire the injected acquire, so a unit test needs no real lock and no real clock
 * @returns the acquired handle, or the last attempt's refusal
 */
export async function acquireOperationLockWaiting({
  home,
  key,
  nowIso,
  timeoutSeconds,
  clock,
  emit,
  staleAfterMs,
  acquire = acquireOperationLock,
}: {
  home: string;
  key: string;
  nowIso: () => string;
  timeoutSeconds: number;
  clock: WaitClock;
  emit: (line: string) => void;
  staleAfterMs?: number;
  acquire?: (input: { home: string; key: string; nowIso: string; staleAfterMs?: number }) => OperationLockResult;
}): Promise<OperationLockResult> {
  const outcome = await waitUntilSettled<OperationLockResult>({
    ceilingMs: LOCAL_WAIT_CEILING_MS,
    clock,
    emit,
    lines: (reading) => (reading.isErr() ? [`waiting for the ${key} operation lock: ${reading.error}`] : []),
    read: () =>
      Promise.resolve(
        acquire({ home, key, nowIso: nowIso(), ...(staleAfterMs === undefined ? {} : { staleAfterMs }) }),
      ),
    schedule: LOCAL_WAIT_SCHEDULE_MS,
    settled: (reading) => reading.isOk(),
    timeoutSeconds,
  });
  return outcome.reading;
}
