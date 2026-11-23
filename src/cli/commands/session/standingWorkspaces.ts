/**
 * `session standing`'s one cmux listing: the pids of the loop's workspace and of the pinned supervisor chat, read
 * over a single connection, because a session's `--plugin-dir` is reachable only through the pids cmux reports for
 * its tab. Every failure here costs a plugin-dir and nothing else.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { resolveSupervisorWorkspace } from "../../../live/standing/supervisor.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { reportedTabPids } from "../../../sessions/liveInTab.js";

/**
 * Every pid cmux reports for one workspace — the only route to a session's `--plugin-dir`. That is the attributed
 * tree AND the tab's listed tty pids: cmux 0.65.2 can attribute no tree to a live tab and list its processes there
 * instead, which left the chair check reading no session at all (`../../../supervisor/chairRead.ts`).
 *
 * @param client the cmux host's process oracle, which stage 2's liveness events replace
 * @param workspace the workspace to walk, or `undefined` when it did not resolve
 * @returns the pids, or none
 */
async function workspacePids({
  client,
  workspace,
}: {
  readonly client: Pick<CmuxHostSurface, "workspaceTop">;
  readonly workspace: CmuxWorkspaceSummary | undefined;
}): Promise<readonly number[]> {
  if (workspace === undefined) {
    return [];
  }
  const top = await client.workspaceTop({ workspaceId: workspace.workspaceId });
  return top.isOk() ? [...reportedTabPids({ report: top.value })] : [];
}

/** One cmux read, serving both plugin-dir halves — the loop's and the supervisor's. */
export interface StandingWorkspaceRead {
  readonly loopPids: readonly number[];
  readonly supervisorPids: readonly number[];
  readonly supervisorCwd: string | undefined;
  /** The pinned workspace's cmux id, so a chair read built here carries what `supervisor/chairRestore.ts` compares. */
  readonly supervisorWorkspaceId: string | undefined;
  readonly problems: readonly string[];
}

/**
 * Resolve both plugin-dir-bearing workspaces over ONE connection.
 *
 * `listen arm --background` DETACHES the listener, so walking up from its pid reaches init without ever
 * passing through a `claude` process (measured live: 61202 → 61048 → 1). The loop's workspace is
 * identified by the cwd the session ledger recorded for it, which is why `--loop-session-key` earns its place
 * even though it no longer decides liveness: without it there is no cwd, so no workspace, so the plugin-dir
 * is reported as unresolved rather than guessed at. The supervisor's is identified by its pin and its title
 * instead, exactly and never by resemblance — `live/standing/supervisor.ts` carries that reasoning.
 *
 * Both are read here rather than in two calls because a connection per lookup is a connection per lookup, and
 * the two questions are asked at the same instant of the same listing.
 *
 * Every failure costs a plugin-dir and nothing else.
 *
 * @param loopCwd the loop's recorded working directory, or `undefined` when no key was passed
 * @returns each session's candidate pids, the supervisor's own worktree, and anything that would not resolve
 */
export async function standingWorkspaceRead({
  loopCwd,
}: {
  readonly loopCwd: string | undefined;
}): Promise<StandingWorkspaceRead> {
  return withCmuxSessionHost<StandingWorkspaceRead>({
    body: async ({ host: client }) => {
      const listed = await client.listWorkspaces();
      if (listed.isErr()) {
        return {
          loopPids: [],
          problems: [
            `could not list cmux workspaces (${listed.error.message}) — neither the loop's nor the ` +
              "supervisor's plugin-dir is measured",
          ],
          supervisorCwd: undefined,
          supervisorPids: [],
          supervisorWorkspaceId: undefined,
        };
      }
      const loopWorkspace =
        loopCwd === undefined ? undefined : listed.value.find((candidate) => candidate.currentDirectory === loopCwd);
      const supervisor = resolveSupervisorWorkspace({ workspaces: listed.value });
      return {
        loopPids: await workspacePids({ client, workspace: loopWorkspace }),
        problems: supervisor.problems,
        supervisorCwd: supervisor.value?.currentDirectory,
        supervisorPids: await workspacePids({ client, workspace: supervisor.value }),
        supervisorWorkspaceId: supervisor.value?.workspaceId,
      };
    },
  });
}
