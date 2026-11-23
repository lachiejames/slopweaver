/**
 * Which live Claude session a `cmux reseat` stops: the one cmux's attributed tree and Claude Code's registry agree
 * on, else — for a tab cmux attributed no process to at all — the one live session the process table puts on the
 * tab's own tty. Split out of `./reseatPass.ts`, whose pass order it serves.
 *
 * ## Why a tab with no pid is not taken at its word
 *
 * MEASURED: `cmux reseat` refused two workspaces
 * `NO_LIVE_SESSION (no-process)` while both ran Claude Code — one's claude had read BUSY and still ran on its
 * tab's tty. cmux's attribution is a heuristic
 * that moves between reads (`tty-collision` one minute, `explicit-root-pid` the next); the surface's `tty` does not.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { CmuxWorkspaceTop } from "../../../cmux/processTree.js";
import { flattenProcessTreePids } from "../../../live/standing/processes.js";
import { liveSessionsInTab } from "../../../sessions/liveInTab.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { sessionInTree } from "../../../sessions/reseat.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import type { ReseatDeps } from "./reseatPass.js";

/** Whether cmux reported the tab as one surface with one tty and no pid at all: the one shape the tty tie reads. */
function tabReportsNoPidOnOneTty({ top }: { top: CmuxWorkspaceTop }): boolean {
  return top.surfaces === 1 && top.ttys.length === 1 && top.trees.length === 0 && top.unattributedTtyPids.length === 0;
}

/**
 * The one live Claude session in a workspace, off its process tree and Claude Code's registry — or, when cmux
 * attributed no process to the tab at all, the one start-stamp-validated live session the table puts on the tab's own
 * tty (`../../../sessions/liveInTab.ts`).
 *
 * @param deps the pass's effects
 * @returns the session, or the refusal naming why none could be picked
 */
export async function liveSessionOf({
  deps,
  workspace,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
}): Promise<Result<SessionRecord, ReseatError>> {
  const tree = await deps.client.processTree({ workspaceId: workspace.workspaceId });
  if (tree.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: tree.error.message, what: `${workspace.workspaceRef}'s process tree` }),
    );
  }
  const registry = deps.readRegistry();
  if (registry.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: registry.error, what: "Claude Code's session registry" }));
  }
  const attributed = sessionInTree({
    records: registry.value,
    treePids: flattenProcessTreePids({ roots: tree.value }),
    workspaceRef: workspace.workspaceRef,
  });
  // A tree that reported any pid answers as it always did: the tie is for a tab BOTH reads report empty, never one a
  // second read races to empty.
  if (attributed.isOk() || attributed.error.code !== "NO_LIVE_SESSION" || tree.value.length > 0) {
    return attributed;
  }
  return liveSessionOnTty({ deps, missed: attributed.error, workspace });
}

/**
 * The one live session the process table puts on the tab's tty, for a tab cmux attributed nothing to. Only
 * `readLiveRecords`' records: the live arm stops what this names, and a raw registry row can name a pid the kernel has
 * since handed to another process. With no live record anywhere there is nothing a tty
 * could tie, so the tab's listing is not read again. Until the listing shows the one shape the tie reads, a read
 * that fails answers `missed` exactly as before the tie existed: a tab cmux reports
 * a pid for is never refused differently.
 *
 * @param missed the attributed read's own refusal, returned whenever the tty ties nothing
 * @returns the one session, `missed` for none, `AMBIGUOUS_SESSION` for several, or the read that failed
 */
async function liveSessionOnTty({
  deps,
  missed,
  workspace,
}: {
  deps: ReseatDeps;
  missed: ReseatError;
  workspace: CmuxWorkspaceSummary;
}): Promise<Result<SessionRecord, ReseatError>> {
  const live = deps.readLiveRecords();
  if (live.isErr() || live.value.length === 0) {
    return err(missed);
  }
  const top = await deps.client.workspaceTop({ workspaceId: workspace.workspaceId });
  if (top.isErr() || !tabReportsNoPidOnOneTty({ top: top.value })) {
    return err(missed);
  }
  const rows = deps.readProcessRows();
  if (rows.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: rows.error,
        what: `the process table behind ${workspace.workspaceRef}'s processes`,
      }),
    );
  }
  const onTty = stillLive({
    deps,
    sessions: liveSessionsInTab({ liveRecords: live.value, report: top.value, rows: rows.value }),
  });
  if (onTty.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: onTty.error, what: "which Claude sessions are live" }));
  }
  return oneOnTty({ missed, onTty: onTty.value });
}

/**
 * The sessions a process table tied to a tab that are STILL live once that table has been read. A record validated
 * before the table could name a pid the kernel reused in between for whatever started on the tty, and a tie read off
 * it would stop, confirm or stand an unrelated process. A
 * second validation after the table closes that window; the same pid with a new start stamp is no longer live.
 *
 * @param deps the pass's effects, whose live read validates every record's start stamp afresh
 * @param sessions what the table tied, matched against live records read before it
 * @returns the sessions that survive a fresh live read, or that read's failure
 */
export function stillLive({
  deps,
  sessions,
}: {
  deps: Pick<ReseatDeps, "readLiveRecords">;
  sessions: readonly SessionRecord[];
}): Result<readonly SessionRecord[], string> {
  if (sessions.length === 0) {
    return ok(sessions);
  }
  const again = deps.readLiveRecords();
  if (again.isErr()) {
    return err(again.error);
  }
  return ok(
    // The whole identity, start stamps included: the same pid resuming the same session elsewhere is another process.
    sessions.filter((record) =>
      again.value.some(
        (live) =>
          live.pid === record.pid &&
          live.sessionId === record.sessionId &&
          live.procStart === record.procStart &&
          live.startedAtMs === record.startedAtMs,
      ),
    ),
  );
}

/**
 * The one session a tab's tty ties, refusing to pick between several.
 *
 * @param missed returned when the tty ties none
 * @param onTty every live session the tty tied
 * @returns the one session, `missed` for none, or `AMBIGUOUS_SESSION`
 */
function oneOnTty({
  missed,
  onTty,
}: {
  missed: ReseatError;
  onTty: readonly SessionRecord[];
}): Result<SessionRecord, ReseatError> {
  const [only] = onTty;
  if (only === undefined) {
    return err(missed);
  }
  if (onTty.length > 1) {
    return err(ReseatErrors.ambiguousSession({ sessionIds: onTty.map((record) => record.sessionId) }));
  }
  return ok(only);
}
