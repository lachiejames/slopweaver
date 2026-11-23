/**
 * {@link spawnCmuxSession}'s ORDERING and its WITNESS CHAIN — the two properties this module's own history
 * says were skipped: sending the pickup command without first verifying boot produced a silently-broken chat,
 * and a dispatch that had genuinely landed being reported failed because the only witness was a
 * screen that threw under load.
 *
 * A hand-written recording fake, never `vi.fn`/`vi.mock` — it records every client call in order and answers
 * `readScreen` from a scripted sequence, so a test asserts on ORDER and on WHICH witness answered without any
 * real cmux.
 */
import type { CmuxClient } from "../../../../cmux/client.js";
import { CmuxErrors } from "../../../../cmux/errors.js";
import type { CmuxRenderGrid } from "../../../../cmux/renderGrid.js";
import { err, ok } from "../../../../lib/result.js";

/** A scripted screen value telling {@link fakeClient} to answer unreadable, as a settling surface really does. */
export const UNREADABLE = Symbol("UNREADABLE");

/** What the fake answers when a test asks for a composer submit that cmux itself refuses. */
const SUBMIT_REFUSED = CmuxErrors.callFailed({
  cmuxCode: "not_found",
  message: "surface gone",
  method: "surface.send_key",
});

/** A grid with no composer on it at all, which `readComposer` answers `unreadable` — every pre-gate test's box. */
export const NO_COMPOSER_GRID: CmuxRenderGrid = { columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] };

/** The workspace the fake always creates, so every assertion names the same four addresses. */
export const CREATED = {
  surfaceId: "id-surface-1",
  surfaceRef: "surface:1",
  workspaceId: "id-workspace-1",
  workspaceRef: "workspace:1",
} as const;

/** One recorded client call: the operation, and whatever text it carried. */
export interface Recorded {
  readonly op: string;
  readonly text?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly force?: boolean | undefined;
}

/** The four addresses one created workspace answers with. */
type CreatedAddresses = {
  readonly surfaceId: string;
  readonly surfaceRef: string;
  readonly workspaceId: string;
  readonly workspaceRef: string;
};

/** A second workspace, distinct from {@link CREATED} in every address, for a boot that is retried in a fresh tab. */
export const RETRIED = {
  surfaceId: "id-surface-2",
  surfaceRef: "surface:2",
  workspaceId: "id-workspace-2",
  workspaceRef: "workspace:2",
} as const;

/** The two screen reads, each answering from its own scripted sequence and repeating the LAST entry once exhausted. */
function screenReads({
  calls,
  grids,
  screens,
}: {
  calls: Recorded[];
  grids: readonly (CmuxRenderGrid | typeof UNREADABLE)[];
  screens: readonly (string | typeof UNREADABLE)[];
}): Pick<CmuxClient, "readScreen" | "readScreenGrid"> {
  let nextScreen = 0;
  let nextGrid = 0;
  return {
    readScreen: () => {
      calls.push({ op: "readScreen" });
      const screen = screens[Math.min(nextScreen, screens.length - 1)]!;
      nextScreen += 1;
      return Promise.resolve(
        screen === UNREADABLE
          ? err(CmuxErrors.terminalTextUnreadable({ detail: "still settling", method: "surface.read_text" }))
          : ok(screen),
      );
    },
    readScreenGrid: () => {
      calls.push({ op: "readScreenGrid" });
      const grid = grids[Math.min(nextGrid, grids.length - 1)]!;
      nextGrid += 1;
      return Promise.resolve(
        grid === UNREADABLE
          ? err(CmuxErrors.terminalTextUnreadable({ detail: "grid gone", method: "surface.read_render_grid" }))
          : ok(grid),
      );
    },
  };
}

/** The reads no test here scripts or records, each answering one fixed value. */
function unscriptedReads(): Pick<
  CmuxClient,
  "identify" | "processTree" | "readResumeBinding" | "resolveWorkspace" | "topologyStrict" | "workspaceTop"
> {
  return {
    identify: () =>
      Promise.resolve(
        ok({ surfaceId: undefined, surfaceRef: undefined, workspaceId: undefined, workspaceRef: undefined }),
      ),
    processTree: () => Promise.resolve(ok([])),
    workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] })),
    readResumeBinding: () => Promise.resolve(ok(undefined)),
    resolveWorkspace: () =>
      Promise.resolve(
        err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not used here", method: "workspace.list" })),
      ),
    topologyStrict: () => Promise.resolve(ok({ surfacePids: [], workspaceRefs: [] })),
  };
}

/** The recorded workspace reads: the created row as `listWorkspaces` reports it, and the created surface. */
function workspaceReads({
  calls,
  submitted,
}: {
  calls: Recorded[];
  submitted: string | undefined;
}): Pick<CmuxClient, "listWorkspaces" | "listWorkspacesStrict" | "workspaceSurface"> {
  return {
    listWorkspaces: () => {
      calls.push({ op: "listWorkspaces" });
      return Promise.resolve(
        ok([
          {
            currentDirectory: "/tmp/a-doc-worktree",
            description: undefined,
            latestConversationMessage: undefined,
            latestSubmittedAtIso: undefined,
            latestSubmittedMessage: submitted,
            pinned: false,
            selected: false,
            title: undefined,
            windowId: "id-window-1",
            workspaceId: CREATED.workspaceId,
            workspaceRef: CREATED.workspaceRef,
          },
        ]),
      );
    },
    listWorkspacesStrict: () => {
      calls.push({ op: "listWorkspacesStrict" });
      return Promise.resolve(ok([]));
    },
    workspaceSurface: () => {
      calls.push({ op: "workspaceSurface" });
      return Promise.resolve(ok({ ...CREATED }));
    },
  };
}

/** Every write the fake answers: creates repeat the LAST scripted address, and a close or submit can be set to fail. */
function writes({
  calls,
  closeFails,
  creates,
  submitFails,
}: {
  calls: Recorded[];
  closeFails: boolean;
  creates: readonly CreatedAddresses[];
  submitFails: boolean;
}): Pick<
  CmuxClient,
  | "close"
  | "closeWorkspace"
  | "createWorkspace"
  | "interruptTurn"
  | "pinWorkspace"
  | "renameWorkspace"
  | "sendLine"
  | "submitComposer"
  | "unpinWorkspace"
> {
  let nextCreate = 0;
  return {
    close: () => undefined,
    closeWorkspace: ({ workspaceId, force }) => {
      calls.push({ force, op: "closeWorkspace", workspaceId });
      return Promise.resolve(
        closeFails
          ? err(CmuxErrors.callFailed({ cmuxCode: "busy", message: "tab held", method: "workspace.close" }))
          : ok(undefined),
      );
    },
    createWorkspace: ({ name, description }) => {
      calls.push({ description, name, op: "createWorkspace" });
      const created = creates[Math.min(nextCreate, creates.length - 1)]!;
      nextCreate += 1;
      return Promise.resolve(ok({ ...created }));
    },
    interruptTurn: () => Promise.resolve(ok(undefined)),
    pinWorkspace: () => Promise.resolve(ok(undefined)),
    renameWorkspace: () => Promise.resolve(ok(undefined)),
    sendLine: ({ text }) => {
      calls.push({ op: "sendLine", text });
      return Promise.resolve(ok(undefined));
    },
    submitComposer: () => {
      calls.push({ op: "submitComposer" });
      return Promise.resolve(submitFails ? err(SUBMIT_REFUSED) : ok(undefined));
    },
    unpinWorkspace: () => Promise.resolve(ok(undefined)),
  };
}

/**
 * A fake {@link CmuxClient} answering `readScreen` from a scripted sequence — repeating the LAST entry once
 * exhausted, matching the real poll loop's shape: a boot that never changes keeps reporting the same
 * unchanged screen on every tick, not `undefined`.
 *
 * `latestSubmittedMessage` defaults to `undefined`, so unless a test opts in, the screen is the only witness
 * — which keeps every pre-existing ordering assertion measuring exactly what it measured before.
 *
 * @returns the client, and the list every one of its recorded calls lands in, in order
 */
export function fakeClient({
  screens,
  submitted,
  submitFails = false,
  grids = [NO_COMPOSER_GRID],
  creates = [CREATED],
  closeFails = false,
}: {
  screens: readonly (string | typeof UNREADABLE)[];
  submitted?: string;
  submitFails?: boolean;
  /** What each successive `createWorkspace` answers with, repeating the last. */
  creates?: readonly CreatedAddresses[];
  /** Whether `closeWorkspace` answers a typed failure. */
  closeFails?: boolean;
  /**
   * What each successive styled-grid read returns, repeating the last — the composer gate's only input.
   * {@link UNREADABLE} is a read cmux refuses.
   */
  grids?: readonly (CmuxRenderGrid | typeof UNREADABLE)[];
}): {
  calls: Recorded[];
  client: CmuxClient;
} {
  const calls: Recorded[] = [];
  return {
    calls,
    client: {
      ...screenReads({ calls, grids, screens }),
      ...unscriptedReads(),
      ...workspaceReads({ calls, submitted }),
      ...writes({ calls, closeFails, creates, submitFails }),
    },
  };
}
