/**
 * `session close-done`'s keep-alive arm: a finished seat whose screen reads `busy` only because its footer counts the
 * `claude watch` keep-alive it started — every supervisor chair runs one in its own seat — closes when another watch
 * covers for it. The judgement is `../../../sessions/keepAliveSeatClose.ts`; this file reads the seat's process tree
 * and the process table over the sweep's client and its injected table read.
 *
 * **A watch in a chair this sweep closed is never cover.** Two retired chairs, one holding the live watch and the
 * other a queued one, each see the other as cover; closing both would retire every keep-alive on the machine. So the
 * sweep carries every pid inside a retired chair it has closed — or, on a dry run, reported closed — whichever path
 * closed it (idle close, park or this arm), its tree's and what the process table places under them, and a later
 * chair's cover excludes them (an idle-path close, then a park, could otherwise leave its watch
 * counted as cover for the next chair). A retired chair closed whose tree or table did not read blinds the rest of
 * the sweep: what it held is unknown, so no later keep-alive close is safe until the next tick re-reads.
 */
import { screenShowsBackgroundWork } from "../../../cmux/backgroundWork.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { SUPERVISOR_WORKSPACE_TITLE } from "../../../cmux/supervisorWorkspace.js";
import { flattenProcessTreePids } from "../../../live/standing/processes.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import { keepAliveForceNote, keepAliveOnlyCloseDecision, seatPids } from "../../../sessions/keepAliveSeatClose.js";
import type { CloseDoneDeps } from "./closeDone.js";

/** What one sweep has retired so far — shared across its candidates, in order. */
export interface KeepAliveSweep {
  /** Every pid inside a retired chair this sweep has closed, or reported closed on a dry run. */
  readonly retiring: Set<number>;
  /** Set once a retired chair closed whose process tree did not read: its own watch is unknown. */
  blind: boolean;
}

/** What the keep-alive arm says about one busy seat: close it forced, hold it with a note, or nothing to add. */
export type KeepAliveSeatVerdict =
  | { readonly kind: "force"; readonly note: string }
  | { readonly kind: "held"; readonly note: string }
  | { readonly kind: "not-keep-alive" };

/** Whether a workspace is a RETIRED chair — unpinned, still titled as one — the seat that starts a keep-alive. */
function retiredChair({ workspace }: { workspace: CmuxWorkspaceSummary }): boolean {
  return !workspace.pinned && workspace.title === SUPERVISOR_WORKSPACE_TITLE;
}

/**
 * Close one seat on a path other than the keep-alive arm — the ordinary idle close or the idle park — and, when it is
 * a retired chair and the outcome closed it (or reported it closed on a dry run), note what it held, so its watch
 * never covers a later chair this sweep. Its tree is read once BEFORE the close, since a closed seat has none to read,
 * and every read the close itself makes of that seat's tree is kept too: the park reads it again for its identity
 * and its last look, and a watch only a later read showed is as much the sweep's observation as the first. Any of those reads failing or empty blinds the sweep. A chair the close left open
 * records nothing: its watch still runs.
 *
 * @param sweep this sweep's record, mutated on a close
 * @param deps the sweep's client
 * @param workspace the workspace about to close
 * @param close the path's own close, run once over the client it is handed — one that keeps each tree it reads
 * @returns what `close` answered
 */
export async function closeRecordingChair({
  sweep,
  deps,
  workspace,
  close,
}: {
  sweep: KeepAliveSweep;
  deps: Pick<CloseDoneDeps, "client" | "processTable">;
  workspace: CmuxWorkspaceSummary;
  close: (args: { readonly client: CmuxHostSurface }) => Promise<CloseDoneOutcome>;
}): Promise<CloseDoneOutcome> {
  if (!retiredChair({ workspace })) {
    return close({ client: deps.client });
  }
  const seen = new Set<number>();
  const reads = { unread: false };
  const recording: CmuxHostSurface = {
    ...deps.client,
    processTree: async (args) => {
      const tree = await deps.client.processTree(args);
      if (args.workspaceId !== workspace.workspaceId) {
        return tree;
      }
      // An EMPTY tree shows nothing either: a live seat always runs its own `claude`, so none is no reading, exactly
      // as the decision treats it.
      if (tree.isErr() || tree.value.length === 0) {
        reads.unread = true;
        return tree;
      }
      for (const pid of flattenProcessTreePids({ roots: tree.value })) {
        seen.add(pid);
      }
      return tree;
    },
  };
  await recording.processTree({ workspaceId: workspace.workspaceId });
  // The table BEFORE the close, while what the seat held still runs: a loop its tree omitted sits under it there.
  const table = deps.processTable();
  const outcome = await close({ client: recording });
  if (outcome.kind !== "closed" && outcome.kind !== "parked") {
    return outcome;
  }
  if (reads.unread || table.isErr()) {
    sweep.blind = true;
    return outcome;
  }
  for (const pid of seatPids({ rows: table.value, treePids: seen })) {
    sweep.retiring.add(pid);
  }
  return outcome;
}

/**
 * Judge one busy candidate as a keep-alive seat, recording its tree in the sweep when it forces.
 *
 * A seat that is no retired chair, or whose footer counts no background shell, answers `not-keep-alive` and its held
 * line reads as it always did. A retired chair the judgement holds is held with the judgement's own reason as its
 * note — a turn, a Monitor, a second shell, a shell command that is not a keep-alive, the only keep-alive, a cover
 * this sweep closed — because "screen busy" alone hid why it never closed: MEASURED (`slopweaver session
 * close-done --dry-run`), 50 retired chairs printed a bare `run finished, but screen busy` every tick while every
 * one failed on its shell command.
 *
 * @param sweep this sweep's record of what it has retired, mutated on a force
 * @param deps the sweep's client and process-table read
 * @param screen the screen `judgeScreen` just read `busy`
 * @param workspace the candidate's live workspace, whose pin and title say whether it is a retired chair
 * @returns the verdict
 */
export async function keepAliveSeatVerdict({
  sweep,
  deps,
  screen,
  workspace,
}: {
  sweep: KeepAliveSweep;
  deps: Pick<CloseDoneDeps, "client" | "processTable">;
  screen: string | undefined;
  workspace: CmuxWorkspaceSummary;
}): Promise<KeepAliveSeatVerdict> {
  // No shell on its footer is no keep-alive, and a seat that is no retired chair never started one. Either way skip
  // the tree and the table, which every busy seat would cost.
  if (!retiredChair({ workspace }) || screen === undefined || !screenShowsBackgroundWork({ screen })) {
    return { kind: "not-keep-alive" };
  }
  const tree = await deps.client.processTree({ workspaceId: workspace.workspaceId });
  const roots = tree.isOk() ? tree.value : undefined;
  const table = deps.processTable();
  const decision = keepAliveOnlyCloseDecision({ retiring: sweep.retiring, screen, table, tree: roots });
  if (decision.kind === "held") {
    return { kind: "held", note: decision.detail };
  }
  if (sweep.blind) {
    return {
      kind: "held",
      note: "a retired chair this sweep closed did not show its processes, so its keep-alive is unknown; the next tick closes this one",
    };
  }
  // A force needs both reads, so both are in hand: what the table places under the tree retires with it too.
  const rows = table.isOk() ? table.value : undefined;
  for (const pid of seatPids({ rows: rows!, treePids: flattenProcessTreePids({ roots: roots! }) })) {
    sweep.retiring.add(pid);
  }
  return { kind: "force", note: keepAliveForceNote({ decision }) };
}
