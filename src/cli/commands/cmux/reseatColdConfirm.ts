/**
 * The four reads a cold verdict takes AFTER the first graft and before the second table read, in the order they
 * must run, each refused whole on a failed read and with the judgement's own wording on a disagreement: the image
 * behind each shell off `lsof -p`, the tab's tty's input modes off `stty -g`, every pid holding the tty device open
 * off `lsof /dev/<tty>`, and each prompt shell's process group beside its tty's foreground group off `ps -o
 * pgid=,tpgid=`. The modes read sits before the holders read on purpose: `stty -f` opens the device for its one
 * `TIOCGETA` and closes it on exit, so run first it is never a holder the next read sees. Why each read exists, and
 * what stays unread, is `./reseatCold.ts`'s `readColdTree`; the judgements are `../../../sessions/coldExecutables.ts`
 * and `../../../sessions/coldTtyModes.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import {
  executablePids,
  executablesAgree,
  foregroundAgrees,
  type GraftedTab,
  promptShellPids,
  ttyHoldersAgree,
} from "../../../sessions/coldExecutables.js";
import { ttyModesAtPrompt } from "../../../sessions/coldTtyModes.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import type { ReseatDeps } from "./reseatPass.js";

/** The four reads, as the pass's effects carry them. */
export type ConfirmReads = Pick<
  ReseatDeps,
  "readExecutables" | "readProcessGroups" | "readTtyHolders" | "readTtyModes"
>;

/**
 * Confirm a grafted tab against the four reads, in order. A forest with no shell in it costs no read and is confirmed
 * as it is: there is nothing to type into, and the judge after it says so.
 *
 * @param deps the four reads
 * @param grafted the forest off the first table read, and its tty
 * @param workspace the workspace it was read for
 * @returns the forest, or the first read that failed or disagreed
 */
export function confirmTab({
  deps,
  grafted,
  workspace,
}: {
  deps: ConfirmReads;
  grafted: GraftedTab;
  workspace: CmuxWorkspaceSummary;
}): Result<readonly CmuxProcess[], ReseatError> {
  const pids = executablePids({ tree: grafted.tree });
  if (pids.length === 0) {
    return ok(grafted.tree);
  }
  return confirmExecutables({ deps, pids, tree: grafted.tree, workspace })
    .andThen(() => confirmTtyModes({ deps, tty: grafted.tty, workspace }))
    .andThen(() => confirmTtyHolders({ deps, tree: grafted.tree, tty: grafted.tty, workspace }))
    .andThen(() => confirmForeground({ deps, tree: grafted.tree, tty: grafted.tty, workspace }));
}

/**
 * The read after the graft: the image behind each shell the graft placed, off `lsof`, which a process cannot name
 * for itself the way it names its argv (`../../../sessions/coldExecutables.ts`). A forest whose image is unread, or
 * is not the system shell its argv names, is refused with the graft's own wording. The `login` is never asked for,
 * being root's and unreadable by `lsof` as the owner; the holders read holds it instead.
 *
 * @param deps the four reads
 * @param pids the shells' pids, the forest's `executablePids`
 * @param tree the grafted forest
 * @param workspace the workspace it was read for
 * @returns the forest, or why its shells could not be confirmed
 */
function confirmExecutables({
  deps,
  pids,
  tree,
  workspace,
}: {
  deps: ConfirmReads;
  pids: readonly number[];
  tree: readonly CmuxProcess[];
  workspace: CmuxWorkspaceSummary;
}): Result<readonly CmuxProcess[], ReseatError> {
  const executables = deps.readExecutables({ pids });
  if (executables.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: executables.error,
        what: `the executables behind ${workspace.workspaceRef}'s shell`,
      }),
    );
  }
  const refusal = executablesAgree({ executables: executables.value, tree });
  if (refusal !== undefined) {
    return err(ReseatErrors.cmuxReadFailed({ cause: refusal.message, what: `${workspace.workspaceRef}'s processes` }));
  }
  return ok(tree);
}

/**
 * The read after the executables: the tab's tty's input modes, off `stty -g`, which no process read shows
 * (`../../../sessions/coldTtyModes.ts`'s `ttyModesAtPrompt`). A canonical tty, or one with a control character on
 * the byte a typed line ends with, is refused with the judgement's own wording, and a read that fails is refused
 * whole.
 *
 * @param deps the four reads
 * @param tty the tab's tty
 * @param workspace the workspace it was read for
 * @returns the tty, or why its modes could not be confirmed as a line editor's
 */
function confirmTtyModes({
  deps,
  tty,
  workspace,
}: {
  deps: ConfirmReads;
  tty: string;
  workspace: CmuxWorkspaceSummary;
}): Result<string, ReseatError> {
  const modes = deps.readTtyModes({ tty });
  if (modes.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: modes.error, what: `the input modes of ${workspace.workspaceRef}'s tty` }),
    );
  }
  const refusal = ttyModesAtPrompt({ modes: modes.value, tty });
  if (refusal !== undefined) {
    return err(ReseatErrors.cmuxReadFailed({ cause: refusal.message, what: `${workspace.workspaceRef}'s processes` }));
  }
  return ok(tty);
}

/**
 * The read after the modes: every pid holding the tab's tty device open, off `lsof`, which no `ps` column shows
 * (`../../../sessions/coldExecutables.ts`'s `ttyHoldersAgree`). A holder outside the forest is refused with the
 * graft's own wording, and a read that fails is refused whole.
 *
 * @param deps the four reads
 * @param tree the grafted forest
 * @param tty the tab's tty
 * @param workspace the workspace it was read for
 * @returns the forest, or why its tty's holders could not be confirmed
 */
function confirmTtyHolders({
  deps,
  tree,
  tty,
  workspace,
}: {
  deps: ConfirmReads;
  tree: readonly CmuxProcess[];
  tty: string;
  workspace: CmuxWorkspaceSummary;
}): Result<readonly CmuxProcess[], ReseatError> {
  const holders = deps.readTtyHolders({ tty });
  if (holders.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: holders.error,
        what: `the processes holding ${workspace.workspaceRef}'s tty open`,
      }),
    );
  }
  const refusal = ttyHoldersAgree({ holders: holders.value, tree, tty });
  if (refusal !== undefined) {
    return err(ReseatErrors.cmuxReadFailed({ cause: refusal.message, what: `${workspace.workspaceRef}'s processes` }));
  }
  return ok(tree);
}

/**
 * The read after the holders: each prompt shell's process group beside the FOREGROUND group of its tty, off `ps -o
 * pgid=,tpgid=`, which no other column shows (`../../../sessions/coldExecutables.ts`'s `foregroundAgrees`). A prompt
 * shell in a background group is refused with the graft's own wording, and a read that fails is refused whole.
 *
 * @param deps the four reads
 * @param tree the grafted forest
 * @param tty the tab's tty
 * @param workspace the workspace it was read for
 * @returns the forest, or why its prompt shell could not be confirmed as the tty's foreground
 */
function confirmForeground({
  deps,
  tree,
  tty,
  workspace,
}: {
  deps: ConfirmReads;
  tree: readonly CmuxProcess[];
  tty: string;
  workspace: CmuxWorkspaceSummary;
}): Result<readonly CmuxProcess[], ReseatError> {
  const groups = deps.readProcessGroups({ pids: promptShellPids({ tree }) });
  if (groups.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: groups.error,
        what: `the process groups behind ${workspace.workspaceRef}'s shell`,
      }),
    );
  }
  const refusal = foregroundAgrees({ groups: groups.value, tree, tty });
  if (refusal !== undefined) {
    return err(ReseatErrors.cmuxReadFailed({ cause: refusal.message, what: `${workspace.workspaceRef}'s processes` }));
  }
  return ok(tree);
}
