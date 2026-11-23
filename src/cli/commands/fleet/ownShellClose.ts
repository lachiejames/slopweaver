/**
 * `fleet resume`'s last act: closing the tab the pass ran in once its finish is journalled
 * (`../../../fleet/resumeShell.ts` decides whether it should). Split from `./recoveryRun.ts`, which is flags, effects
 * and exit codes; this is the one effect that ends the process with its shell.
 */
import { logger } from "#lib/logger.js";

import { isWorkspaceCloseConfirmationRequired } from "../../../cmux/errors.js";
import { type ResumeFinish, screenShowsFinish, shouldCloseOwnShell } from "../../../fleet/resumeShell.js";
import { readProcessTableWhole } from "../../../live/standing/inspect.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { pidInTab } from "../../../sessions/liveInTab.js";

/**
 * Close the tab this pass ran in once its finish is journalled. The LAST act: a close that succeeds ends this process
 * with its shell, so everything they could want from the tab is printed and journalled before it. A close that fails
 * says so and leaves the exit code the attempt earned.
 *
 * FORCED, and only on cmux's own running-process confirmation: the running process cmux names is this pass, at its
 * last act. MEASURED across several attempts: every unforced self-close answered
 * `confirmation_required` and stranded a bare tab the chair closed by hand, while the same close from another tab
 * after the pass exited went through unforced. Any other failure is reported as it was.
 *
 * @param client the open cmux client
 * @param finish the attempt this pass just finished, and how
 * @param finishJournalled whether the finish reached the recovery journal, without which the tab stays
 * @param episodeNamed whether the desktop launched this pass with `--episode`
 * @param ownWorkspaceId the workspace `CMUX_WORKSPACE_ID` names, undefined outside cmux
 */
export async function closeOwnShell({
  client,
  finish,
  finishJournalled,
  episodeNamed,
  ownWorkspaceId,
}: {
  client: CmuxHostSurface;
  finish: ResumeFinish;
  finishJournalled: boolean;
  episodeNamed: boolean;
  ownWorkspaceId: string | undefined;
}): Promise<void> {
  if (ownWorkspaceId === undefined) {
    return;
  }
  const wanted = { episodeNamed, finishJournalled, ownWorkspaceId };
  if (!shouldCloseOwnShell({ ...wanted, pinned: false })) {
    return;
  }
  const closable = (): Promise<boolean> => ownTabClosable({ client, finish, ownWorkspaceId, wanted });
  if (!(await closable())) {
    return;
  }
  const plain = await client.closeWorkspace({ workspaceId: ownWorkspaceId });
  if (plain.isOk()) {
    return;
  }
  if (!isWorkspaceCloseConfirmationRequired({ error: plain.error })) {
    logger.error({ msg: `fleet resume: this tab did not close: ${plain.error.message}` });
    return;
  }
  // Re-read before forcing, so a pin taken while the plain close was refused is never forced past.
  // cmux has no check-and-close, so this is the narrowest window there is.
  if (!(await closable())) {
    return;
  }
  const forced = await client.closeWorkspace({ force: true, workspaceId: ownWorkspaceId });
  if (forced.isErr()) {
    logger.error({ msg: `fleet resume: this tab did not close, forced past its own pass: ${forced.error.message}` });
  }
}

/**
 * Whether the workspace `CMUX_WORKSPACE_ID` names may be closed as this pass's own, read fresh before EACH close.
 *
 * A tab cmux no longer lists, or an inventory that will not read, is left alone. The client reads a row with no
 * `pinned` field as unpinned, so that check is not the last word: cmux itself refuses to close a pinned workspace
 * (docs/cmux-client/verbs-and-events.md, step 5), and that refusal lands as a failed close that leaves the tab. The
 * variable is inherited, never checked, so the tab must also HOST this process: its pid is, or descends through the
 * table's parent column from, a pid cmux reports for that workspace: a screen
 * showing the line alone can be a copy tee'd into another tab). And the tab must show this attempt's finish line, so a
 * `--json` pass, which prints none, keeps its tab. A split tab is left too, its other pane
 * being nobody's to end. Any read that fails leaves the tab.
 *
 * @param client the open cmux client
 * @param finish the attempt this pass just finished, and how
 * @param ownWorkspaceId the workspace the inherited variable names
 * @param wanted the close's standing inputs bar the pinned bit, which is read here
 * @returns true only when every read succeeded and each says the tab is this pass's own, unpinned, finished tab
 */
async function ownTabClosable({
  client,
  finish,
  ownWorkspaceId,
  wanted,
}: {
  client: CmuxHostSurface;
  finish: ResumeFinish;
  ownWorkspaceId: string;
  wanted: { episodeNamed: boolean; finishJournalled: boolean; ownWorkspaceId: string };
}): Promise<boolean> {
  const listed = await client.listWorkspaces();
  const self = listed.isOk() ? listed.value.find((workspace) => workspace.workspaceId === ownWorkspaceId) : undefined;
  if (self === undefined || !shouldCloseOwnShell({ ...wanted, pinned: self.pinned })) {
    return false;
  }
  const top = await client.workspaceTop({ workspaceId: ownWorkspaceId });
  // One surface only: closing a split tab would end whatever its other pane runs.
  if (top.isErr() || top.value.surfaces !== 1) {
    return false;
  }
  const rows = readProcessTableWhole();
  if (rows.isErr() || !pidInTab({ pid: process.pid, report: top.value, rows: rows.value })) {
    return false;
  }
  const screen = await client.readScreen({ target: { workspaceId: ownWorkspaceId } });
  return screen.isOk() && screenShowsFinish({ finish, screen: screen.value });
}
