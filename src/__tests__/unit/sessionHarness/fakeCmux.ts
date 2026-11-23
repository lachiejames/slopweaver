/**
 * A hand-built cmux client for the session-harness tests: scripted workspaces, screens and close answers, and
 * a log of every call in the order it was made. A plain object satisfying the seam — no mock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CmuxClient, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import type { ReachWaits } from "../../../cmux/reach.js";
import { type CmuxRenderGrid, parseRenderGrid } from "../../../cmux/renderGrid.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../sessionHarness/cmuxHarness.js";
import { type CmuxHostReach, type CmuxHostSurface, cmuxHostSurfaceOver } from "../../../sessionHarness/cmuxHost.js";

/**
 * The empty-session placeholder, a REAL frozen `terminal.replay` capture: the one composer shape a clean send
 * leaves that the composer reader recognises without pressing Enter.
 */
export const PLACEHOLDER_GRID: CmuxRenderGrid = unwrap(
  parseRenderGrid({
    value: JSON.parse(readFileSync(join(import.meta.dirname, "../../fixtures/composer/placeholder.json"), "utf8")),
  }),
);

/** Every call the harness can make on the client, in the order it made them. */
export type FakeCall =
  | { readonly op: "closeWorkspace"; readonly force: boolean }
  | { readonly op: "interruptTurn"; readonly workspaceId: string; readonly surfaceId: string | undefined }
  | { readonly op: "listWorkspaces" }
  | { readonly op: "readScreen" }
  | { readonly op: "readScreenGrid" }
  | { readonly op: "resolveWorkspace"; readonly ref: string }
  | { readonly op: "sendLine"; readonly workspaceId: string; readonly text: string }
  | { readonly op: "submitComposer" };

/** Waits that take no time — a harness test asserts ORDER, never duration. */
export const INSTANT_WAITS: ReachWaits = {
  interruptPoll: () => Promise.resolve(),
  settle: () => Promise.resolve(),
};

/**
 * The cmux host surface a verb is handed in production, over a hand-built client instead of a socket: the inventory
 * through the real cmux harness, every raw operation the client's own.
 *
 * @param client the hand-built client the surface and its harness both run over
 * @returns the surface
 */
export function hostOverFake({ client }: { client: CmuxClient }): CmuxHostSurface & CmuxHostReach {
  return cmuxHostSurfaceOver({ client, harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }) });
}

/** An idle Claude Code screen: its composer over its footer, nothing running. */
export const IDLE_SCREEN = "❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)";

/** A Claude Code screen mid-turn. */
export const RUNNING_SCREEN = "❯ \n  ⏵⏵ bypass permissions on · esc to interrupt";

/**
 * One workspace row, every field set.
 *
 * @param n distinguishes the row's ref, id and directory
 * @returns the row
 */
export function workspaceRow({ n }: { n: number }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/work/tree-${String(n)}`,
    description: `seat ${String(n)}`,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: "2026-11-06T12:00:00.000Z",
    latestSubmittedMessage: "go",
    pinned: false,
    selected: n === 1,
    title: `title ${String(n)}`,
    windowId: "window-a",
    workspaceId: `id-${String(n)}`,
    workspaceRef: `workspace:${String(n)}`,
  };
}

/** What a close call answers, by whether it was forced. */
interface CloseScript {
  readonly plain: CmuxError | undefined;
  readonly forced: CmuxError | undefined;
}

/** cmux 0.65.2's refusal of an unforced close on a workspace with a live process. */
export const CONFIRMATION_REQUIRED: CmuxError = CmuxErrors.callFailed({
  cmuxCode: "confirmation_required",
  message: "Workspace has a running process; retry with --force",
  method: "workspace.close",
});

/**
 * The fake's close: logs whether it was forced and answers the scripted outcome for that kind.
 *
 * @param calls the shared call log
 * @param close what an unforced and a forced close answer
 * @returns the client's `closeWorkspace`
 */
function fakeCloseWorkspace({ calls, close }: { calls: FakeCall[]; close: CloseScript }): CmuxClient["closeWorkspace"] {
  return ({ force }) => {
    const forced = force === true;
    calls.push({ force: forced, op: "closeWorkspace" });
    const failure = forced ? close.forced : close.plain;
    return Promise.resolve(failure === undefined ? ok(undefined) : err(failure));
  };
}

/**
 * The fake's screen read: each successive call answers the next scripted screen, repeating the last.
 *
 * @param calls the shared call log
 * @param screens the scripted screens; `undefined` reads unreadable
 * @returns the client's `readScreen`
 */
function fakeReadScreen({
  calls,
  screens,
}: {
  calls: FakeCall[];
  screens: readonly (string | undefined)[];
}): CmuxClient["readScreen"] {
  let read = 0;
  return () => {
    calls.push({ op: "readScreen" });
    const screen = screens[Math.min(read, screens.length - 1)];
    read += 1;
    if (screen === undefined) {
      return Promise.resolve(
        err(CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "surface.read_text" })),
      );
    }
    return Promise.resolve(ok(screen));
  };
}

/**
 * The fake's resolve: a ref or an id names its row, and anything else answers cmux's own not-found.
 *
 * @param calls the shared call log
 * @param workspaces the rows a resolve searches
 * @returns the client's `resolveWorkspace`
 */
function fakeResolveWorkspace({
  calls,
  workspaces,
}: {
  calls: FakeCall[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): CmuxClient["resolveWorkspace"] {
  return ({ ref }) => {
    calls.push({ op: "resolveWorkspace", ref });
    const match = workspaces.find((row) => row.workspaceRef === ref || row.workspaceId === ref);
    if (match === undefined) {
      const message = `no live cmux workspace answers to ${ref}`;
      return Promise.resolve(err(CmuxErrors.callFailed({ cmuxCode: "not_found", message, method: "workspace.list" })));
    }
    return Promise.resolve(ok(match));
  };
}

/**
 * A fake client over scripted rows, screens and close answers.
 *
 * @param workspaces what the list answers, and what a resolve searches
 * @param screens what each successive screen read returns, repeating the last; `undefined` reads unreadable
 * @param close what an unforced and a forced close answer — both succeed when absent
 * @param listFailure what the list fails with, when it should fail
 * @returns the client and its call log
 */
export function fakeCmux({
  workspaces = [],
  screens = [IDLE_SCREEN],
  close = { forced: undefined, plain: undefined },
  listFailure,
}: {
  workspaces?: readonly CmuxWorkspaceSummary[];
  screens?: readonly (string | undefined)[];
  close?: CloseScript;
  listFailure?: CmuxError;
}): { readonly client: CmuxClient; readonly calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const unscripted = (): never => {
    throw new Error("unscripted cmux call");
  };
  const client = {
    close: () => undefined,
    closeWorkspace: fakeCloseWorkspace({ calls, close }),
    createWorkspace: unscripted,
    identify: unscripted,
    interruptTurn: ({ target }) => {
      calls.push({ op: "interruptTurn", surfaceId: target.surfaceId, workspaceId: target.workspaceId });
      return Promise.resolve(ok(undefined));
    },
    listWorkspaces: () => {
      calls.push({ op: "listWorkspaces" });
      return Promise.resolve(listFailure === undefined ? ok(workspaces) : err(listFailure));
    },
    listWorkspacesStrict: unscripted,
    pinWorkspace: unscripted,
    processTree: unscripted,
    readResumeBinding: unscripted,
    readScreen: fakeReadScreen({ calls, screens }),
    readScreenGrid: () => {
      calls.push({ op: "readScreenGrid" });
      return Promise.resolve(ok(PLACEHOLDER_GRID));
    },
    renameWorkspace: unscripted,
    resolveWorkspace: fakeResolveWorkspace({ calls, workspaces }),
    sendLine: ({ target, text }) => {
      calls.push({ op: "sendLine", text, workspaceId: target.workspaceId });
      return Promise.resolve(ok(undefined));
    },
    submitComposer: () => {
      calls.push({ op: "submitComposer" });
      return Promise.resolve(ok(undefined));
    },
    topologyStrict: unscripted,
    unpinWorkspace: unscripted,
    workspaceSurface: unscripted,
    workspaceTop: unscripted,
  } satisfies CmuxClient;
  return { calls, client };
}
