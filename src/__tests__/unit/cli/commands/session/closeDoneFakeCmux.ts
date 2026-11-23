/**
 * The fake cmux seams the `session close-done` cases share: a plain-object client and a residue seam over a
 * hand-built process table. Neither is a mock — each records what it was asked and can reach nothing real.
 */
import type { ResidueDeps } from "../../../../../cli/commands/cmux/worktreeResidue.js";
import type { CmuxClient, CmuxProcess, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, ok } from "../../../../../lib/result.js";
import type { ProcessRow } from "../../../../../live/standing/processes.js";

/**
 * A cmux client that lists what it is given, answers each screen read from a table, and records every
 * workspace id it is asked to close. Every other method is unreachable from this verb.
 *
 * @returns the client and the live list of workspace ids it was asked to close.
 */
// max-lines-exempt: one plain-object fake of the whole CmuxClient interface, its length that interface's, moved verbatim out of a test file this gate skips
export function fakeClient({
  workspaces,
  screens = {},
  trees = {},
  closeFails = false,
  listFailsAfter,
  topology = "same",
  surfacePids = [],
  onClose = () => undefined,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  /** Each workspace's screen — one for every read, or one per read in order, the last repeated. */
  screens?: Readonly<Record<string, string | readonly string[]>>;
  /** Each workspace's process tree, one entry per read in order, the last repeated; absent reads as a failure. */
  trees?: Readonly<Record<string, readonly (readonly CmuxProcess[])[]>>;
  closeFails?: boolean;
  /** The list call index (1-based) from which `listWorkspaces` starts failing — the reclaim's re-read is 2. */
  listFailsAfter?: number;
  /** Which workspaces `topologyStrict` holds: the same inventory, a failure, or a different one. */
  topology?: "same" | "fails" | readonly CmuxWorkspaceSummary[];
  /** The pids `topologyStrict` puts under some surface. */
  surfacePids?: readonly number[];
  /** Runs at each close, before it is recorded — a probe of what holds at that instant. */
  onClose?: () => void;
}): { readonly client: CmuxClient; readonly closed: string[] } {
  const closed: string[] = [];
  const treeReads = new Map<string, number>();
  const screenReads = new Map<string, number>();
  let lists = 0;
  const unreachable = (): never => {
    throw new Error("close-done never calls this");
  };
  const client: CmuxClient = {
    close: () => undefined,
    closeWorkspace: ({ workspaceId, force }) => {
      // cmux 0.65.2 refuses an idle `claude` unforced, and every close this sweep makes follows its own idle
      // proof — so an unforced close here is the defect, and every case that closes anything witnesses it.
      if (force !== true) {
        return Promise.resolve(
          err(
            CmuxErrors.callFailed({
              cmuxCode: "confirmation_required",
              message: "Workspace has a running process; retry with --force",
              method: "workspace.close",
            }),
          ),
        );
      }
      if (closeFails) {
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "cmux said no", method: "workspace.close" })));
      }
      onClose();
      closed.push(workspaceId);
      return Promise.resolve(ok(undefined));
    },
    createWorkspace: unreachable,
    identify: unreachable,
    interruptTurn: unreachable,
    listWorkspaces: () => {
      lists += 1;
      if (listFailsAfter !== undefined && lists >= listFailsAfter) {
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "socket gone", method: "workspace.list" })));
      }
      return Promise.resolve(ok(workspaces));
    },
    pinWorkspace: unreachable,
    processTree: ({ workspaceId }) => {
      const reads = trees[workspaceId];
      let index = 0;
      const before = treeReads.get(workspaceId);
      if (before !== undefined) {
        index = before;
      }
      treeReads.set(workspaceId, index + 1);
      const tree = reads?.[Math.min(index, reads.length - 1)];
      return Promise.resolve(
        tree === undefined ? err(CmuxErrors.malformedReply({ detail: "no tree", method: "system.top" })) : ok(tree),
      );
    },
    workspaceTop: unreachable,
    readResumeBinding: unreachable,
    readScreen: ({ target }) => {
      const reads = screens[target.workspaceId];
      const index = screenReads.has(target.workspaceId) ? screenReads.get(target.workspaceId)! : 0;
      screenReads.set(target.workspaceId, index + 1);
      const screen = typeof reads === "string" ? reads : reads?.[Math.min(index, reads.length - 1)];
      return Promise.resolve(
        screen === undefined
          ? err(CmuxErrors.malformedReply({ detail: "settling", method: "terminal.text" }))
          : ok(screen),
      );
    },
    readScreenGrid: () => Promise.resolve(ok({ columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] })),
    renameWorkspace: unreachable,
    resolveWorkspace: unreachable,
    sendLine: unreachable,
    submitComposer: unreachable,
    unpinWorkspace: unreachable,
    // Absence is judged off one `system.top` reply, never the per-window fan-out a moved workspace can slip between.
    listWorkspacesStrict: unreachable,
    topologyStrict: () => {
      if (topology === "fails") {
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "a row dropped", method: "system.top" })));
      }
      const listed = topology === "same" ? workspaces : topology;
      return Promise.resolve(ok({ surfacePids, workspaceRefs: listed.map((row) => row.workspaceRef) }));
    },
    workspaceSurface: unreachable,
  };
  return { client, closed };
}

/** The one row every fake process table carries, so a table is never read as unreadable. */
export const LAUNCHD: ProcessRow = { argv: "/sbin/launchd", pid: 1, ppid: 0 };

/**
 * A residue seam over a hand-built process table: it records every pid it is asked to signal and can never
 * reach a real one. No declared checkout by default, so a case about which chats close reaps nothing. Every
 * candidate works in `finished-doc`'s root, where nx starts its daemon.
 *
 * @returns the residue seam and the live list of pids it was asked to signal.
 */
export function fakeResidue({
  processes = [LAUNCHD],
  mainCheckouts = [],
}: {
  processes?: readonly ProcessRow[];
  mainCheckouts?: readonly string[];
} = {}): { readonly residue: ResidueDeps; readonly signalled: number[] } {
  const signalled: number[] = [];
  const residue: ResidueDeps = {
    cwds: ({ pids }) => new Map(pids.map((pid) => [pid, "/w/.claude/worktrees/finished-doc"])),
    kill: ({ pid }) => {
      signalled.push(pid);
      return undefined;
    },
    mainCheckouts: () => mainCheckouts,
    processes: () => processes,
    selfPid: () => 99_999,
  };
  return { residue, signalled };
}
