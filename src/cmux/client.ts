/**
 * The one owned client for cmux — typed calls over the control socket, no process boundary.
 *
 * ## Why this is a socket client and not a `cmux` wrapper
 *
 * The rule is the Octokit precedent: where a TypeScript SDK exists use it (no process boundary); where only a CLI
 * exists, wrap it with verbs. cmux publishes no npm SDK, but it does publish a socket its own CLI is a thin front on — so the
 * SDK is the socket, and this module is the typed face of it. `socketFrames.ts` records the wire format,
 * measured live rather than read off a spec.
 *
 * ## What the socket cannot do, stated rather than discovered later
 *
 * MEASURED against cmux 0.64.22's own `capabilities` method list: the sidebar-publishing family — `todo`,
 * `workspace status set`, `set-progress`, `set-status`, `log` — has **no v2 socket method at all**. Not an
 * undocumented one; none. `workspace.action`'s own `invalid_params` reply enumerates its supported actions
 * and the checklist is not among them, and `extension.sidebar.snapshot` (which does exist) returns no todo,
 * progress, status or log field even immediately after the CLI has written all four. Slopweaver writes none of
 * the checklist, lane or progress bar; the one family member it still uses, `set-status` for
 * the row's ref pill, goes through the `cmux` binary in `sidebar.ts` — see that module's own header.
 * Every other operation in this file is a real socket call.
 *
 * `extension.sidebar.snapshot` DOES carry a `latest_notification_text` per workspace — MEASURED,
 * over a live `workspace.list`-sized reply: it is the raw text a `Notification` hook last raised. It is NOT
 * what `session watch`'s attention signal needs, though, and is not wired into {@link CmuxWorkspaceSummary}
 * for that reason: cmux never clears it once a session moves past the notification, and carries no
 * timestamp beside it — measured, three workspaces
 * whose OWN hook fold (`cmux/sessionActivity.ts`) had already cleared their attention on a later
 * `PreToolUse` still showed non-null `latest_notification_text` in the same snapshot. `session watch`'s fold
 * already tracks both "when" and "still open" (`SessionActivity.attentionSinceIso`, cleared on
 * `RESUMPTION_EVENTS`); this raw field would be a strictly noisier read of the same fact, not a mechanical
 * signal worth building a scraper — or a second reader — around.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { recordedWhenLive } from "./insideCalls.js";
import { type CmuxWorkspaceTop, parseProcessTrees, parseWorkspaceTop } from "./processTree.js";
import { type CmuxRenderGrid, parseRenderGrid, RENDER_GRID_METHOD } from "./renderGrid.js";
import { optionalString } from "./replyFields.js";
import { type ReadResumeBinding, readResumeBindingOver } from "./resumeBinding.js";
import { parseScreenText } from "./screenText.js";
import { type CmuxSocket, openCmuxSocket, withSocketRetry } from "./socket.js";
import { listWorkspacesStrictOver } from "./strictInventory.js";
import { type CmuxTopology, parseTopology } from "./topology.js";
import { type CmuxCall, closeWorkspaceOver, createWorkspaceOver, workspaceSurfaceOver } from "./workspaceAddresses.js";
import { parseWorkspaceRow } from "./workspaceRow.js";

/** A newly created workspace's addressable surface. */
export interface CmuxWorkspace {
  readonly workspaceRef: string;
  readonly workspaceId: string;
  readonly surfaceRef: string;
  readonly surfaceId: string;
}

/**
 * One workspace as `workspace.list` reports it — the fields this repository actually uses, out of a much
 * larger real reply (which also carries remote/daemon/port state nothing here reads).
 *
 * `latestSubmittedMessage`/`latestSubmittedAt` are cmux's OWN record of what it delivered to the surface, and
 * are the independent send witness `spawn.ts` used to lack: a screen read is a re-render the caller has to
 * catch mid-flicker, while this is what cmux believes it sent.
 */
export interface CmuxWorkspaceSummary {
  readonly windowId: string;
  readonly workspaceId: string;
  readonly workspaceRef: string;
  readonly currentDirectory: string;
  readonly description: string | undefined;
  readonly title: string | undefined;
  /**
   * The last text cmux itself accepted for this workspace, TRUNCATED by cmux to 240 characters with a
   * trailing `…` — never compare it whole. `./sendEvidence.ts` owns that comparison and the measured
   * truncation fact behind it; this field is the raw reading it works from.
   */
  readonly latestSubmittedMessage: string | undefined;
  readonly latestSubmittedAtIso: string | undefined;
  readonly latestConversationMessage: string | undefined;
  /**
   * Whether this workspace is the one pinned in cmux's own sidebar — how a supervised session tells the
   * supervisor from a peer (`.claude/rules/cross-session-messages.md`). Measured: cmux enforces no
   * single-pin invariant of its own — pinning a second workspace left BOTH `pinned: true` — so a caller relying
   * on "at most one pinned" must check that itself; see `./pin.ts`.
   */
  readonly pinned: boolean;
  /** Whether this workspace is the tab currently focused on screen — cmux's own `selected`, not this caller's. */
  readonly selected: boolean;
}

/** One process cmux attributes to a surface, with its children. */
export interface CmuxProcess {
  readonly pid: number;
  readonly name: string;
  readonly children: readonly CmuxProcess[];
}

/** Where the calling process itself is, in cmux's own terms. */
interface CmuxIdentity {
  readonly workspaceId: string | undefined;
  readonly workspaceRef: string | undefined;
  readonly surfaceId: string | undefined;
  readonly surfaceRef: string | undefined;
}

/**
 * Address one workspace (and optionally one surface within it) by UUID — never by `workspace:N` ref.
 *
 * **This is a safety property, measured, not a style preference.** `surface.send_text` given a ref that
 * resolves to nothing does NOT fail: it silently falls back to whatever surface is currently FOCUSED. Probed
 * live, `surface.send_text {"workspace":"workspace:999","text":"x"}` typed `x` into the
 * owner's focused supervisor session and answered `ok:true` naming that session's refs. The same call keyed
 * by `workspace_id` answers `not_found: Workspace not found` and touches nothing.
 *
 * A ref is index-shaped (`workspace:12`) and cmux renumbers every one when the app restarts, so a ref recorded
 * before a restart can address a DIFFERENT session — which is exactly how a stale ref reaches the fallback path.
 * Within one run of the app a close does NOT renumber the rest: MEASURED: thirteen live workspaces
 * carried refs up to `workspace:30` with every gap a close left still open, and new ones took fresh numbers rather
 * than freed ones (`slopweaver cmux list --json | jq -r '.[].workspaceRef'`).
 * Every write in this client therefore takes ids, and {@link CmuxClient.resolveWorkspace} is the one place a
 * ref is turned into one, refusing loudly when it names nothing.
 */
export interface CmuxTarget {
  readonly workspaceId: string;
  readonly surfaceId?: string;
}

/** Turn a {@link CmuxTarget} into the params every targeted method takes. */
function targetParams({ target }: { target: CmuxTarget }): Readonly<Record<string, unknown>> {
  return {
    workspace_id: target.workspaceId,
    ...(target.surfaceId === undefined ? {} : { surface_id: target.surfaceId }),
  };
}

/**
 * How long to give a paste before the follow-up Enter.
 *
 * Both halves of {@link sendLine}'s dance are measured, and both survive the move off the CLI because the CLI
 * was only ever calling these same two methods: a trailing `\n` alone is swallowed by bracketed paste on any
 * text long enough to wrap, and an immediately-following Enter is absorbed by the paste still being
 * processed. Neither is a subprocess artefact.
 */
const SEND_SUBMIT_DELAY_MS = 400;

/** The seam every caller uses, so a test can drive the ORDER of a spawn without a running cmux. */
export interface CmuxClient {
  /**
   * Create a workspace at a directory, returning the surface it opened with in the same call.
   *
   * @param options the workspace title, its working directory, and optional description metadata
   * @returns the created workspace's refs and ids
   */
  readonly createWorkspace: (options: {
    name: string;
    cwd: string;
    description?: string;
  }) => Promise<Result<CmuxWorkspace, CmuxError>>;
  /**
   * The four addresses of a workspace that already exists — its one pane's selected surface, via `pane.list`.
   *
   * @param options the workspace to resolve, by id
   * @returns the workspace's and its surface's ids and refs, or the typed failure (see `./workspaceAddresses.ts`)
   */
  readonly workspaceSurface: (options: { workspaceId: string }) => Promise<Result<CmuxWorkspace, CmuxError>>;
  /**
   * Send text to a surface and submit it.
   *
   * @param options the target surface, the text (without a trailing newline), and the paste/Enter delay
   * @returns nothing on success, or the typed failure
   */
  readonly sendLine: (options: {
    target: CmuxTarget;
    text: string;
    wait?: () => Promise<void>;
  }) => Promise<Result<void, CmuxError>>;
  /**
   * Interrupt whatever turn the surface's agent is currently running, by sending it Escape.
   *
   * Measured live against Claude Code 2.1.241: ONE `surface.send_key escape` takes a session
   * parked on a foreground command from `esc to interrupt` to `Interrupted \u00b7 What should Claude do
   * instead?` in under three seconds, after which a line sent to it is answered rather than queued. It is
   * the only reach a supervisor has into a session that is mid-turn — see `./turnBusy.ts` for why neither
   * delivery witness in this repository can even SEE that a line queued.
   *
   * This does not wait for the interrupt to take effect; the caller polls the screen for that, because how
   * long it is willing to wait is the caller's decision and not this client's.
   *
   * @param options the target surface
   * @returns nothing on success, or the typed failure
   */
  readonly interruptTurn: (options: { target: CmuxTarget }) => Promise<Result<void, CmuxError>>;
  /**
   * Submit whatever text is ALREADY sitting in the surface's composer, by sending it Enter and nothing else.
   *
   * The distinction from {@link sendLine} is the entire point and it is not a shorthand: `sendLine` TYPES and
   * then submits, so calling it twice puts the text in twice. This types nothing. On a composer holding a
   * stranded line it submits that line; on an empty one it is a no-op, because neither host this repository
   * boots submits an empty prompt.
   *
   * @param options the target surface
   * @returns nothing on success, or the typed failure
   */
  readonly submitComposer: (options: { target: CmuxTarget }) => Promise<Result<void, CmuxError>>;
  /**
   * Read a surface's current text.
   *
   * @param options the target surface, and how much scrollback to include
   * @returns the plain text, or the typed failure (`TERMINAL_TEXT_UNREADABLE` while a surface is settling)
   */
  readonly readScreen: (options: {
    target: CmuxTarget;
    scrollbackLines?: number;
  }) => Promise<Result<string, CmuxError>>;
  /**
   * The same surface as {@link CmuxClient.readScreen}, but STYLED — every run of cells with the attributes it
   * is drawn in.
   *
   * The one thing this can answer that a plain read cannot: whether text in the prompt box is faint, which is
   * how a suggestion Claude Code wrote itself is told from a line a person typed. See `./composer.ts`.
   *
   * @param options the surface to read, by id
   * @returns the styled grid, or the typed failure
   */
  readonly readScreenGrid: (options: { target: CmuxTarget }) => Promise<Result<CmuxRenderGrid, CmuxError>>;
  /**
   * Close a workspace.
   *
   * `force` skips cmux's running-process confirmation, which from 0.65.2 refuses an idle `claude` at its prompt
   * as `confirmation_required`. It belongs only behind the caller's own proof that the seat is finished and
   * idle (`../sessions/closeForce.ts`); omitted, the wire request carries no `force` field at all.
   *
   * @param options the workspace to close, by id, and whether to skip cmux's running-process confirmation
   * @returns nothing on success, or the typed failure
   */
  readonly closeWorkspace: (options: { workspaceId: string; force?: boolean }) => Promise<Result<void, CmuxError>>;
  /**
   * Turn a `workspace:N` ref (or a UUID) into the workspace it names TODAY.
   *
   * @param options the ref or id to resolve
   * @returns the matching workspace, or a typed failure naming what could not be resolved
   */
  readonly resolveWorkspace: (options: { ref: string }) => Promise<Result<CmuxWorkspaceSummary, CmuxError>>;
  /**
   * Every workspace cmux knows about, across every window.
   *
   * @returns the whole inventory, or the typed failure
   */
  readonly listWorkspaces: () => Promise<Result<readonly CmuxWorkspaceSummary[], CmuxError>>;
  /**
   * The same inventory as {@link listWorkspaces}, but a read that FAILS on any window or row that one would drop.
   *
   * @returns the whole inventory, or the typed failure naming what could not be decoded (see `./strictInventory.ts`)
   */
  readonly listWorkspacesStrict: () => Promise<Result<readonly CmuxWorkspaceSummary[], CmuxError>>;
  /**
   * Every workspace ref and every surface pid, off one reply — the read to conclude a workspace is ABSENT from.
   *
   * @returns what exists at one instant, or the typed failure naming what could not be decoded (see `./topology.ts`)
   */
  readonly topologyStrict: () => Promise<Result<CmuxTopology, CmuxError>>;
  /**
   * The process tree cmux attributes to one workspace.
   *
   * @param options the workspace to inspect, by id
   * @returns each surface's process tree, or the typed failure
   */
  readonly processTree: (options: { workspaceId: string }) => Promise<Result<readonly CmuxProcess[], CmuxError>>;
  /**
   * `processTree` plus the tty processes cmux lists for the workspace's surfaces without attributing them to a tree
   * (`unattributed_tty_process_pids`, cmux 0.65.2): the tab's own `login` and shell, which `processTree` alone now
   * reads as nothing running. The cold-seat judge reads this (`../sessions/coldSeat.ts`).
   *
   * @param options the workspace to inspect, by id
   * @returns the attributed trees and the unattributed tty pids, or the typed failure
   */
  readonly workspaceTop: (options: { workspaceId: string }) => Promise<Result<CmuxWorkspaceTop, CmuxError>>;
  /**
   * The Claude session cmux saved for a workspace's surface (`surface.resume.get`), so a recovery can resume it on
   * the fleet's own credential rather than cmux's bare relaunch (`./resumeBinding.ts`).
   *
   * @param options the workspace to read, by id
   * @returns the saved session, `undefined` when the surface saved none, or the typed failure
   */
  readonly readResumeBinding: ReadResumeBinding;
  /**
   * Rename a workspace — the title its sidebar row shows.
   *
   * `cmux spawn` sets this at creation (`workspace.create`'s `name`), so this is for the workspace a HUMAN
   * opened by hand: `cmux <path>` titles it after the directory, and a supervisor dispatching into it has no
   * other way to say what it is now working on.
   *
   * @param options the workspace to rename, by id, and the title to give it
   * @returns nothing on success, or the typed failure
   */
  readonly renameWorkspace: (options: { workspaceId: string; title: string }) => Promise<Result<void, CmuxError>>;
  /**
   * Pin a workspace — the same `workspace.action` the sidebar's pin toggle writes, keyed by id like every other
   * targeted write here. cmux enforces no single-pin invariant of its own; a caller wanting "at most one pinned"
   * checks that itself (`./pin.ts`) before calling this.
   *
   * @param options the workspace to pin, by id
   * @returns nothing on success, or the typed failure
   */
  readonly pinWorkspace: (options: { workspaceId: string }) => Promise<Result<void, CmuxError>>;
  /**
   * Unpin a workspace.
   *
   * @param options the workspace to unpin, by id
   * @returns nothing on success, or the typed failure
   */
  readonly unpinWorkspace: (options: { workspaceId: string }) => Promise<Result<void, CmuxError>>;
  /**
   * Which workspace and surface cmux currently has FOCUSED — the tab on screen, not the caller.
   *
   * Measured, after a `cmux title` with no `--workspace` renamed the supervisor's workspace from a
   * session that was not focused: the reply's `focused` block is exactly what its name says, and it is the
   * caller's own only when the caller happens to be the tab being looked at. A verb that means "my own
   * workspace" reads `CMUX_WORKSPACE_ID` from its environment instead, which cmux exports into every surface
   * it opens and which cannot move while the process runs.
   *
   * @returns the focused workspace/surface, or the typed failure
   */
  readonly identify: () => Promise<Result<CmuxIdentity, CmuxError>>;
  /** Release the underlying connection. */
  readonly close: () => void;
}

/**
 * Parse a `workspace.list` reply into every workspace it names.
 *
 * A malformed row is dropped rather than failing the whole parse — this is an inventory read, and one bad row
 * must not blind a collision check to every other workspace.
 *
 * @param value the decoded reply
 * @returns every workspace the reply names
 */
export function parseWorkspaceList({ value }: { value: unknown }): readonly CmuxWorkspaceSummary[] {
  if (!isRecord(value) || !Array.isArray(value["workspaces"])) {
    return [];
  }
  // Measured: `workspace.list` always echoes the window it answered for at the top level. A reply without it
  // is one this client cannot attribute, and a collision check keyed on an invented window id would be worse
  // than no answer — so the whole reply is dropped rather than half-believed.
  const windowId = optionalString({ field: "window_id", value });
  if (windowId === undefined) {
    return [];
  }
  const rows: CmuxWorkspaceSummary[] = [];
  for (const entry of value["workspaces"]) {
    const row = parseWorkspaceRow({ entry, windowId });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parse a `window.list` reply into every window id.
 *
 * @param value the decoded reply
 * @returns every window id the reply names
 */
export function parseWindowIds({ value }: { value: unknown }): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value["windows"])) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value["windows"]) {
    const id = optionalString({ field: "id", value: entry });
    if (id !== undefined && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Every workspace across EVERY cmux window.
 *
 * A bare `workspace.list` is scoped to the CALLER'S OWN window — measured: it returned 13 rows while
 * `window.list` reported one window holding exactly those 13, and cmux's own CLI agrees. That is not a global
 * inventory, and a shared-checkout collision check that believed it was would miss a colliding workspace in
 * another window entirely. So this fans out: `window.list`, then `workspace.list` per window id.
 *
 * cmux names the required parameter in its own rejection (`supported_param: "window_id"`), which is how that
 * spelling was settled rather than guessed.
 */
async function listEveryWorkspace({
  call,
}: {
  call: CmuxCall;
}): Promise<Result<readonly CmuxWorkspaceSummary[], CmuxError>> {
  const windows = await call({ method: "window.list", params: {} });
  if (windows.isErr()) {
    return err(windows.error);
  }
  const rows: CmuxWorkspaceSummary[] = [];
  for (const windowId of parseWindowIds({ value: windows.value })) {
    const listed = await call({ method: "workspace.list", params: { window_id: windowId } });
    if (listed.isErr()) {
      return err(listed.error);
    }
    rows.push(...parseWorkspaceList({ value: listed.value }));
  }
  return ok(rows);
}

/** `surface.send_text` then, after a real gap, `surface.send_key enter` — see {@link SEND_SUBMIT_DELAY_MS}. */
function sendLineOver({ call }: { call: CmuxCall }): CmuxClient["sendLine"] {
  return async ({ target, text, wait = defaultSendWait }) => {
    const pasted = await call({
      method: "surface.send_text",
      params: { ...targetParams({ target }), text: `${text}\n` },
    });
    if (pasted.isErr()) {
      return err(pasted.error);
    }
    await wait();
    return (await call({ method: "surface.send_key", params: { ...targetParams({ target }), key: "enter" } })).map(
      () => undefined,
    );
  };
}

/** The styled read, hoisted out of the client literal so its whole body is one named thing. */
function readScreenGridOver({ call }: { call: CmuxCall }): CmuxClient["readScreenGrid"] {
  return async ({ target }) =>
    (await call({ method: RENDER_GRID_METHOD, params: { ...targetParams({ target }) } })).andThen((value) =>
      parseRenderGrid({ value }),
    );
}

/** One bare key press at a surface — the shape both {@link CmuxClient.interruptTurn} and {@link CmuxClient.submitComposer} are. */
function sendKeyOver({
  call,
  key,
}: {
  call: CmuxCall;
  key: string;
}): (options: { target: CmuxTarget }) => Promise<Result<void, CmuxError>> {
  return async ({ target }) =>
    (await call({ method: "surface.send_key", params: { ...targetParams({ target }), key } })).map(() => undefined);
}

/** A bare `workspace.action` on one workspace — the shape both {@link CmuxClient.pinWorkspace} and its unpin are. */
function pinActionOver({ call, action }: { call: CmuxCall; action: "pin" | "unpin" }): CmuxClient["pinWorkspace"] {
  return async ({ workspaceId }) =>
    (await call({ method: "workspace.action", params: { action, workspace_id: workspaceId } })).map(() => undefined);
}

/** `workspace.list` resolved to one workspace by ref or id, refusing loudly when it names nothing live. */
function resolveWorkspaceOver({ call }: { call: CmuxCall }): CmuxClient["resolveWorkspace"] {
  return async ({ ref }) =>
    (await listEveryWorkspace({ call })).andThen((workspaces) => {
      const match = workspaces.find((workspace) => workspace.workspaceRef === ref || workspace.workspaceId === ref);
      return match === undefined
        ? err(
            CmuxErrors.callFailed({
              cmuxCode: "not_found",
              message: `no live cmux workspace answers to ${ref}`,
              method: "workspace.list",
            }),
          )
        : ok(match);
    });
}

/** `system.top` for one workspace, read as the attributed trees alone and as those trees plus the unattributed tty pids. */
function workspaceTopOver({ call }: { call: CmuxCall }): Pick<CmuxClient, "processTree" | "workspaceTop"> {
  return {
    processTree: async ({ workspaceId }) =>
      (await call({ method: "system.top", params: { include_processes: true, workspace_id: workspaceId } })).andThen(
        (value) => parseProcessTrees({ value, workspaceId }),
      ),
    workspaceTop: async ({ workspaceId }) =>
      (await call({ method: "system.top", params: { include_processes: true, workspace_id: workspaceId } })).andThen(
        (value) => parseWorkspaceTop({ value, workspaceId }),
      ),
  };
}

/**
 * Build a client over an already-open socket — the seam every wrapper and every test shares.
 *
 * @param socket the connected transport to issue calls on
 * @returns the typed client
 */
export function cmuxClientOver({ socket }: { socket: CmuxSocket }): CmuxClient {
  const call: CmuxCall = ({ method, params }) => socket.call({ method, params });
  return {
    close: () => {
      socket.close();
    },
    closeWorkspace: closeWorkspaceOver({ call }),
    createWorkspace: createWorkspaceOver({ call }),
    identify: async () =>
      (await call({ method: "system.identify", params: {} })).map((value) => {
        const focused = isRecord(value) && isRecord(value["focused"]) ? value["focused"] : {};
        return {
          surfaceId: optionalString({ field: "surface_id", value: focused }),
          surfaceRef: optionalString({ field: "surface_ref", value: focused }),
          workspaceId: optionalString({ field: "workspace_id", value: focused }),
          workspaceRef: optionalString({ field: "workspace_ref", value: focused }),
        };
      }),
    interruptTurn: sendKeyOver({ call, key: "escape" }),
    listWorkspaces: async () => listEveryWorkspace({ call }),
    pinWorkspace: pinActionOver({ action: "pin", call }),
    ...workspaceTopOver({ call }),
    readResumeBinding: readResumeBindingOver({ call }),
    readScreen: async ({ target, scrollbackLines }) =>
      (
        await call({
          method: "surface.read_text",
          params: {
            ...targetParams({ target }),
            ...(scrollbackLines === undefined ? {} : { lines: scrollbackLines, scrollback: true }),
          },
        })
      ).andThen((value) => parseScreenText({ value })),
    readScreenGrid: readScreenGridOver({ call }),
    renameWorkspace: async ({ workspaceId, title }) =>
      (
        await call({
          method: "workspace.action",
          // `title`, not `name` — measured: `workspace.action` answers a `name` param with
          // `invalid_params: Missing or invalid title`, even though `workspace.create` calls the same field `name`.
          params: { action: "rename", title, workspace_id: workspaceId },
        })
      ).map(() => undefined),
    resolveWorkspace: resolveWorkspaceOver({ call }),
    sendLine: sendLineOver({ call }),
    submitComposer: sendKeyOver({ call, key: "enter" }),
    unpinWorkspace: pinActionOver({ action: "unpin", call }),
    listWorkspacesStrict: listWorkspacesStrictOver({ call }),
    topologyStrict: async () =>
      (await call({ method: "system.top", params: { include_processes: true } })).andThen((value) =>
        parseTopology({ value }),
      ),
    workspaceSurface: workspaceSurfaceOver({ call }),
  };
}

/** The real production delay between a paste and its follow-up Enter. */
async function defaultSendWait(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SEND_SUBMIT_DELAY_MS));
}

/**
 * A client on a fresh connection to the live cmux socket, resilient to a transient `SOCKET_UNAVAILABLE`
 * write failure (`write EPIPE`, measured four times in one night — see `socket.ts`'s
 * {@link withSocketRetry}) — every call this client makes goes through that wrapper, since `withSocketRetry`
 * wraps the socket itself rather than any one method; it replays every call but a keystroke and a create.
 *
 * The caller OWNS the connection and must {@link CmuxClient.close} it — an unclosed socket keeps the Node
 * event loop alive, so a verb that forgets prints its answer and then hangs. Only `src/sessionHarness/` calls this
 * (the `session-harness-lifecycle` gate): a verb opens cmux through `withCmuxSessionHost`
 * (`../sessionHarness/cmuxHost.ts`), and a launch takes `productionSpawnDeps` (`../sessionHarness/recordedSpawn.ts`).
 *
 * @param socketPath the socket to connect to, defaulting to the resolved live one
 * @returns the connected client
 */
export function realCmuxClient({ socketPath }: { socketPath?: string } = {}): CmuxClient {
  const socket = withSocketRetry({
    openFresh: () => openCmuxSocket(socketPath === undefined ? {} : { socketPath }),
    wait: ({ delayMs }) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  });
  return cmuxClientOver({ socket: recordedWhenLive({ live: socketPath === undefined, socket }) });
}

/**
 * Run one body against a fresh client and close the connection afterwards, whatever happens.
 *
 * @param body what to do with the connected client
 * @param socketPath the socket to connect to, defaulting to the resolved live one
 * @returns whatever `body` returned
 */
export async function withCmuxClient<T>({
  body,
  socketPath,
}: {
  body: (options: { client: CmuxClient }) => Promise<T>;
  socketPath?: string;
}): Promise<T> {
  const client = realCmuxClient(socketPath === undefined ? {} : { socketPath });
  try {
    return await body({ client });
  } finally {
    client.close();
  }
}
