/** The fake cmux client of a `reseatPass` world, built from a read half and a write half over one shared state. */
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../../cmux/errors.js";
import { err, ok } from "../../../../../../lib/result.js";
import { COMPOSER_GRID, NO_COMPOSER_GRID } from "./fixtures.js";
import type { WorldState } from "./harnessTypes.js";

/**
 * The client's reads: each workspace runs one `claude` (pid by workspace), its screen is `screens`, and a stopped seat
 * leaves `afterStop` in its tab until a line has been typed into it.
 *
 * @returns the four read members of the client
 */
function clientReadSeams({
  state,
}: {
  state: WorldState;
}): Pick<CmuxClient, "processTree" | "workspaceTop" | "readScreen" | "readScreenGrid"> {
  const { afterStop, pids, relaunched, screens } = state;
  return {
    processTree: ({ workspaceId }) => {
      const pid = pids.get(workspaceId)!;
      const live = relaunched.has(workspaceId) ? pid + 1000 : pid;
      return Promise.resolve(ok([{ children: [{ children: [], name: "2.1.287", pid: live }], name: "zsh", pid: 1 }]));
    },
    // Once a line was typed, the relaunched claude (pid + 1000) runs under the tab's shell.
    workspaceTop: ({ workspaceId }) =>
      Promise.resolve(
        ok({
          surfaces: 1,
          trees: relaunched.has(workspaceId)
            ? [
                {
                  children: [{ children: [], name: "2.1.287", pid: pids.get(workspaceId)! + 1000 }],
                  name: "zsh",
                  pid: 1,
                },
              ]
            : afterStop,
          ttys: [],
          unattributedTtyPids: [],
        }),
      ),
    readScreen: ({ target }) => {
      const screen = screens.get(target.workspaceId);
      if (screen === undefined) {
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "gone", method: "surface.read_text" })));
      }
      return Promise.resolve(ok(screen));
    },
    readScreenGrid: ({ target }) =>
      Promise.resolve(ok(relaunched.has(target.workspaceId) ? COMPOSER_GRID : NO_COMPOSER_GRID)),
  };
}

/**
 * The client's one write: typing a line journals it and marks the workspace relaunched.
 *
 * @returns the write member of the client
 */
function clientWriteSeams({ state }: { state: WorldState }): Pick<CmuxClient, "sendLine"> {
  const { journal, relaunched } = state;
  return {
    sendLine: ({ target, text }) => {
      journal.push(`send ${target.workspaceId}: ${text}`);
      relaunched.add(target.workspaceId);
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * The whole fake client: the two halves, and a member that throws for every call reseat never makes.
 *
 * @returns a client over `state`
 */
export function worldClient({ state }: { state: WorldState }): CmuxClient {
  const unused = (): never => {
    throw new Error("reseat never calls this");
  };
  return {
    close: () => undefined,
    closeWorkspace: unused,
    createWorkspace: unused,
    identify: unused,
    interruptTurn: unused,
    listWorkspaces: unused,
    pinWorkspace: unused,
    ...clientReadSeams({ state }),
    readResumeBinding: unused,
    renameWorkspace: unused,
    resolveWorkspace: unused,
    ...clientWriteSeams({ state }),
    submitComposer: unused,
    unpinWorkspace: unused,
    listWorkspacesStrict: unused,
    topologyStrict: unused,
    workspaceSurface: unused,
  };
}
