/**
 * One step of a run's ownership fold: the writer after one journal line, given the writer before it.
 *
 * Its own module so every reader that walks a journal applies the SAME rule — `./runOwner.ts`'s fold, and
 * `../sessions/parkSeat.ts` attributing a let-go line to the host that held the run — never a re-derivation of it
 * (Codex 4d r3: a re-derived copy let a hostless `resumed` keep a host the fold drops).
 */
import type { RunEvent } from "./ledger.js";
import type { RunWriter } from "./runOwner.js";
import { releaseWhyOf } from "./runRelease.js";

/**
 * The writer after `event`, given the writer the fold held just before it. A hostless `resumed` keeps a host only
 * when the writer was that same session; a release or park clears only the writer it names.
 *
 * @param writer the writer the fold held just before this event
 * @returns the writer after it, `undefined` once its own release or park clears it
 */
export function nextWriter({
  event,
  writer,
}: {
  event: RunEvent;
  writer: RunWriter | undefined;
}): RunWriter | undefined {
  if (event.kind === "launched") {
    return launchedWriter({ event });
  }
  if (event.kind === "resumed") {
    return resumedWriter({ event, writer });
  }
  if (event.kind === "claimed") {
    return claimedWriter({ event });
  }
  if (releaseWhyOf({ event, holder: writer?.sessionId }) !== undefined) {
    return undefined;
  }
  return writer;
}

/** Writer identity from a launch, preserving compatibility with old hostless journals. */
function launchedWriter({ event }: { event: Extract<RunEvent, { kind: "launched" }> }): RunWriter {
  const writer = { atIso: event.atIso, pid: event.pid, sessionId: event.sessionId, worktree: event.worktree };
  return event.host === undefined ? writer : { ...writer, host: event.host };
}

/** Writer identity from a resume, carrying location only for the same session. */
function resumedWriter({
  event,
  writer,
}: {
  event: Extract<RunEvent, { kind: "resumed" }>;
  writer: RunWriter | undefined;
}): RunWriter {
  if (writer?.sessionId !== event.sessionId) {
    return { atIso: event.atIso, pid: undefined, sessionId: event.sessionId, worktree: undefined };
  }
  // `event.pid` — THIS turn's process — wins over the launch's, per its own docstring: "the only recorded pid
  // was the first turn's, dead by construction from turn two onwards." Falling straight to `writer.pid` here
  // silently re-broke exactly that: a codex review pass found that a hostless writer's dead
  // LAUNCH pid survived a live `resumed` event, so a liveness check reading `writer.pid` after this fold would
  // call a live, still-running writer dead. `event.pid` is optional only for journals that predate the field.
  let pid = writer.pid;
  if (event.pid !== undefined) {
    pid = event.pid;
  }
  const resumed = { atIso: event.atIso, pid, sessionId: event.sessionId, worktree: writer.worktree };
  return writer.host === undefined ? resumed : { ...resumed, host: writer.host };
}

/** Writer identity from an explicit cross-host claim. */
function claimedWriter({ event }: { event: Extract<RunEvent, { kind: "claimed" }> }): RunWriter {
  return {
    atIso: event.atIso,
    host: event.host,
    pid: event.pid,
    sessionId: event.sessionId,
    worktree: event.worktree,
  };
}
