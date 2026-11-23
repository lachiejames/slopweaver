/**
 * One `cmux list` text row: the workspace ref, its UUID and its title by default, and with `--full` the
 * checkout directory as a fourth column too.
 *
 * MEASURED over 81 supervisor passes (`slopweaver transcripts draw --session <id>` per chair, page
 * `$SLOPWEAVER_HOME/pages/chair-token-waste/index.html`): 1.9 calls a pass returning a mean 340 tokens, about
 * 25,600 carried a pass. The long worktree path is most of each row, and a reconciliation reads `--json`. Pure.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";

/** A workspace's title column: one nobody has named is listed as untitled, never as a blank column. */
function workspaceTitleLabel({ workspace }: { workspace: CmuxWorkspaceSummary }): string {
  const title = workspace.title;
  if (title === undefined) {
    return "(untitled)";
  }
  return title;
}

/**
 * One workspace as a tab-separated row.
 *
 * @param full whether `--full` was passed, adding the checkout directory column
 * @param workspace the workspace cmux reported
 * @returns the row
 */
export function cmuxWorkspaceLine({ full, workspace }: { full: boolean; workspace: CmuxWorkspaceSummary }): string {
  const columns = [workspace.workspaceRef, workspace.workspaceId, workspaceTitleLabel({ workspace })];
  if (full) {
    columns.push(workspace.currentDirectory);
  }
  return columns.join("\t");
}
