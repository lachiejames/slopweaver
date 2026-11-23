/**
 * The pure decision behind the poll gate: given what a call is polling and when the same thing was last
 * polled, allow it and record it, or refuse it with the background-wait recipe.
 *
 * The window is 60 seconds because that is the shape of the waste measured: a median of 15 seconds between
 * polls. A bounded wait that genuinely blocked for a minute or more is, by construction, never inside the
 * window, so `TaskOutput` with `block: true` and a real timeout passes — the one thing a session cannot
 * do is come back for the same answer twice in a minute.
 *
 * The clock is not the whole test: a re-read whose change token (`./pollFingerprint.ts`) describes only files the last
 * poll's token already described, each unchanged, is a read of static files, never a poll, and it is allowed. The
 * window still refuses a file that changed in between — still being written — a file the last read did not name, and
 * every target with no token: a pid, a task, a loop naming no file, a path that is missing, a directory, or a record
 * written before tokens existed.
 *
 * The state read and the state write live in `./pollGateRunner.ts` and `./pollGateStore.ts`.
 */
import { tokenUnchangedSince } from "./pollFingerprint.js";
import type { PollShape } from "./pollShape.js";

/** How long after one poll of a target the next poll of the same target is refused. */
export const POLL_WINDOW_MS = 60_000;

/** The break-glass variable, read from the hook process's own environment so no inline prefix can set it. */
export const POLL_BREAK_GLASS = "SLOPWEAVER_ALLOW_POLL";

/**
 * What the gate decided about one call.
 *
 * @internal
 */
export type PollDecision =
  { readonly kind: "allow"; readonly record: boolean } | { readonly kind: "block"; readonly message: string };

/**
 * The refusal, naming what was polled, how recently, and the three shapes that replace it.
 *
 * @param label the poll's human label
 * @param target what it polled
 * @param secondsAgo how long ago the same target was last polled
 * @param replacement the one command that waits on this target, when there is one (`./pollReplacement.ts`)
 * @returns the stderr text Claude Code shows the model
 */
export function pollRefusal({
  label,
  target,
  secondsAgo,
  replacement,
}: {
  label: string;
  target: string;
  secondsAgo: number;
  replacement?: string | undefined;
}): string {
  const named =
    replacement === undefined
      ? ""
      : `Wait with ONE call instead: ${replacement} — run it with run_in_background: true when it may outlast 600s. `;
  return (
    `poll-gate: refused a ${label} of ${target} — the same target was polled ${String(secondsAgo)}s ago, and ` +
    `nothing shows it unchanged since (a re-read of files that have not changed is let through; this one names a file that changed, one the last read did not name, or something that is not a file). ` +
    `We never poll: every turn that comes back for an answer that is not ready costs the full context again (measured 13.7% of fleet spend).` +
    named +
    `Otherwise set a monitor with a timeout: slopweaver wait --pid <n> or --file <path>, Monitor with timeout_ms on the file or pid, or Bash with run_in_background: true and ONE ` +
    `TaskOutput with block: true and a timeout, or slopweaver github checks --wait for CI. If the process has already finished, read ` +
    `the file once in full. Break-glass for one deliberate re-read: ${POLL_BREAK_GLASS}=1 in the session's environment.`
  );
}

/**
 * Decide one call.
 *
 * @param shape what the classifier said
 * @param lastSeenMs when this target was last polled by this session, or `undefined` for never
 * @param lastFingerprint the target's change token at that poll, or `undefined` when it had none
 * @param fingerprint the target's change token now, or `undefined` when it has none
 * @param nowMs the current instant
 * @param allowPoll whether the break-glass is set
 * @param windowMs the refusal window (defaults to {@link POLL_WINDOW_MS})
 * @param replacement the one command that waits on this target, named in a refusal (`./pollReplacement.ts`)
 * @returns allow (with whether to record this instant) or block with its message
 */
export function decidePoll({
  shape,
  lastSeenMs,
  lastFingerprint,
  fingerprint,
  nowMs,
  allowPoll,
  windowMs = POLL_WINDOW_MS,
  replacement,
}: {
  shape: PollShape;
  lastSeenMs: number | undefined;
  lastFingerprint: string | undefined;
  fingerprint: string | undefined;
  nowMs: number;
  allowPoll: boolean;
  windowMs?: number;
  replacement?: string | undefined;
}): PollDecision {
  if (shape.kind === "not-poll") {
    return { kind: "allow", record: false };
  }
  if (allowPoll || lastSeenMs === undefined || nowMs - lastSeenMs >= windowMs) {
    return { kind: "allow", record: true };
  }
  const unchanged =
    fingerprint !== undefined &&
    lastFingerprint !== undefined &&
    tokenUnchangedSince({ last: lastFingerprint, token: fingerprint });
  if (unchanged) {
    // Not recorded: the record already holds this token, and moving its instant forward would refuse a later changed
    // read that the clock rule alone, counting from the read that started the window, would have let through.
    return { kind: "allow", record: false };
  }
  return {
    kind: "block",
    message: pollRefusal({
      label: shape.label,
      replacement,
      secondsAgo: Math.round((nowMs - lastSeenMs) / 1000),
      target: shape.target,
    }),
  };
}
