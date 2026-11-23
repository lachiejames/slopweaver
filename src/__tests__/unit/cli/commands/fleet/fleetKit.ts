/**
 * Shared plain fakes for the `fleet resume` unit tests: a cmux client whose screens are scripted per workspace, the
 * reseat deps a pass would build, and a fresh pass state over a throwaway home. Seams, not mocks — every method is
 * an ordinary function the test reads back.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OperationLockAcquireErrors } from "../../../../../admit/operationLockHeld.js";
import type { ReseatDeps } from "../../../../../cli/commands/cmux/reseatPass.js";
import type { PassState } from "../../../../../cli/commands/fleet/resumePassState.js";
import type { CmuxClient, CmuxProcess, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { type CmuxError, CmuxErrors } from "../../../../../cmux/errors.js";
import { reachSession } from "../../../../../cmux/reach.js";
import type { CmuxRenderGrid } from "../../../../../cmux/renderGrid.js";
import type { CmuxResumeBinding } from "../../../../../cmux/resumeBinding.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../live/standing/processes.js";
import type { ProcessGroup } from "../../../../../live/standing/processGroups.js";
import { parseTtyModes, type TtyModes } from "../../../../../live/standing/ttyModes.js";
import type { CmuxHostReach } from "../../../../../sessionHarness/cmuxHost.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";

/**
 * The process table behind every tree the kit's tests script: a cold read refuses a tree the table does not hold
 * and so does a parent the two reads disagree on, so each fake pid a test puts in a tree is a row here, under the
 * parent the tree gives it. The bare shell (pid 1) has nothing under it,
 * so the scripted cmux tree alone decides its shape; the shell running `vim` is pid 2. A test that wants the table to
 * show more passes its own rows.
 */
const FAKE_TABLE: readonly TtyProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 0, state: "S", tty: "??" },
  { argv: "-/bin/zsh", pid: 1, ppid: 100, state: "S", tty: "ttys001" },
  { argv: "-/bin/zsh", pid: 2, ppid: 100, state: "S", tty: "ttys002" },
  { argv: "vim", pid: 7, ppid: 2, state: "S", tty: "ttys002" },
  { argv: "claude", pid: 4242, ppid: 0, state: "S", tty: "??" },
  { argv: "claude", pid: 5151, ppid: 0, state: "S", tty: "??" },
];

/**
 * The executables an honest `lsof` read would list for `pids`, off a table whose argv names each process truthfully:
 * the first argv word, a login shell's leading `-` dropped. A pid the table does not hold gets no entry, as `lsof`
 * lists nothing for a pid that is gone. A test that wants a process to run something other than it says passes its
 * own map.
 *
 * @param rows the table the same deps' `readProcessRows` answers with
 * @param pids the pids asked for
 * @returns each pid's image
 */
export function honestExecutables({
  rows,
  pids,
}: {
  rows: readonly TtyProcessRow[];
  pids: readonly number[];
}): ReadonlyMap<number, string> {
  const images = new Map<number, string>();
  for (const pid of pids) {
    const row = rows.find((candidate) => candidate.pid === pid);
    const [first = ""] = row === undefined ? [] : row.argv.trim().split(/\s+/u);
    if (row !== undefined) {
      images.set(pid, first.replace(/^-/u, ""));
    }
  }
  return images;
}

/**
 * The pids an honest `lsof` read of a tty device would list, off a table where every process on a tty holds it: the
 * rows whose controlling tty is `tty`, a `login` excluded as MEASURED (a bare tab's `login` holds no
 * descriptor on the tty it started the shell on), each on the descriptors a bare tab's shell measurably holds. A
 * test that wants a holder outside the forest, or a shell without the tty on its stdin, passes its own map.
 *
 * @param rows the table the same deps' `readProcessRows` answers with
 * @param tty the tty asked for
 * @returns each holder's descriptors, in table order
 */
export function honestTtyHolders({
  rows,
  tty,
}: {
  rows: readonly TtyProcessRow[];
  tty: string;
}): ReadonlyMap<number, readonly number[]> {
  return new Map(
    rows
      .filter((row) => row.tty === tty && !row.argv.startsWith("/usr/bin/login"))
      .map((row) => [row.pid, PROMPT_SHELL_FDS]),
  );
}

/** The descriptors a bare tab's shell holds its tty on, MEASURED on cmux 0.65.2 (`lsof -Fpf`). */
const PROMPT_SHELL_FDS: readonly number[] = [0, 1, 2, 10, 14];

/**
 * The process groups an honest `ps -o pid=,pgid=,tpgid=` read would list for `pids` when every shell asked for is
 * its own group leader and that group is its tty's foreground, as MEASURED on a bare tab (`40171 40171
 * 40171`). A test that wants a shell in a background group, or a pid the read holds no row for, passes its own map
 * or its own refusal.
 *
 * @param pids the pids asked for
 * @returns each pid's group pair
 */
export function honestProcessGroups({ pids }: { pids: readonly number[] }): ReadonlyMap<number, ProcessGroup> {
  return new Map(pids.map((pid): [number, ProcessGroup] => [pid, { pgid: pid, tpgid: pid }]));
}

/**
 * The modes `stty -f /dev/ttys005 -g` printed for a bare tab whose zsh waited in its line editor, MEASURED
 * on cmux 0.65.2: raw (`-icanon`), `inlcr icrnl`, and no control character on `^J` or `^M`.
 */
export const MEASURED_TTY_MODES =
  "gfmt1:cflag=4b00:iflag=6b42:lflag=4c3:oflag=3:discard=ff:dsusp=ff:eof=4:eol=ff:eol2=ff:erase=7f:intr=3:kill=15:lnext=ff:min=1:quit=ff:reprint=12:start=11:status=14:stop=13:susp=ff:time=0:werase=17:ispeed=9600:ospeed=9600";

/**
 * The modes an honest `stty -g` read of a bare tab's tty would list: the measured line, decoded. A test that wants
 * a canonical tty, or a control character on the byte a line ends with, passes its own modes.
 *
 * @returns the measured bare tab's modes
 */
export function honestTtyModes(): TtyModes {
  return unwrap(parseTtyModes({ text: MEASURED_TTY_MODES, tty: "ttys005" }));
}

/**
 * A throwaway state home; the caller removes it.
 *
 * @returns its path
 */
export function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "fleet-"));
}

/**
 * One live workspace as `cmux list` reports it.
 *
 * @param id its workspace id, which also names its title, directory and ref
 * @param pinned whether cmux shows it pinned
 * @returns the summary
 */
export function workspace({ id, pinned = false }: { id: string; pinned?: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/w/${id}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: id,
    windowId: "window:1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** Claude Code's empty composer: the chevron and a NON-BREAKING space, the cursor visible after it. */
const COMPOSER_GRID: CmuxRenderGrid = {
  columns: 40,
  cursor: { column: 2, row: 0, visible: true },
  rows: 1,
  spans: [{ column: 0, row: 0, styleId: 1, text: "❯ " }],
  styles: [{ bold: false, faint: false, foreground: "#ffffff", id: 1, italic: false }],
};

/** The failure every method a test did not script answers with. */
async function unscripted(): Promise<Result<never, CmuxError>> {
  return err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not scripted by this test", method: "fake" }));
}

/** The two `system.top` reads, scripted off the trees and tty pids a test names; a workspace absent fails to read. */
function treeReads({
  trees,
  ttyPids,
}: {
  trees: Readonly<Record<string, readonly CmuxProcess[]>>;
  ttyPids: Readonly<Record<string, readonly number[]>>;
}): Pick<CmuxClient, "processTree" | "workspaceTop"> {
  return {
    processTree: ({ workspaceId }) => {
      const tree = trees[workspaceId];
      if (tree === undefined) {
        return unscripted();
      }
      return Promise.resolve(ok(tree));
    },
    workspaceTop: ({ workspaceId }) => {
      const tree = trees[workspaceId];
      if (tree === undefined) {
        return unscripted();
      }
      const pids = ttyPids[workspaceId];
      if (pids === undefined) {
        return Promise.resolve(ok({ surfaces: 1, trees: tree, ttys: [], unattributedTtyPids: [] }));
      }
      return Promise.resolve(ok({ surfaces: 1, trees: tree, ttys: [], unattributedTtyPids: pids }));
    },
  };
}

/**
 * The two screen reads: each workspace's scripted plain text, and {@link COMPOSER_GRID} once a line was typed into a
 * workspace when the test asks for it; anything else fails to read.
 */
function screenReads({
  composerAfterSend,
  screens,
  typedInto,
}: {
  composerAfterSend: boolean;
  screens: Readonly<Record<string, string>>;
  typedInto: ReadonlySet<string>;
}): Pick<CmuxClient, "readScreen" | "readScreenGrid"> {
  return {
    readScreen: ({ target }) => {
      const screen = screens[target.workspaceId];
      if (screen === undefined) {
        return Promise.resolve(
          err(CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "surface.read_text" })),
        );
      }
      return Promise.resolve(ok(screen));
    },
    readScreenGrid: ({ target }) => {
      if (!composerAfterSend || !typedInto.has(target.workspaceId)) {
        return unscripted();
      }
      return Promise.resolve(ok(COMPOSER_GRID));
    },
  };
}

/**
 * A cmux client that reads the named screens, fails `sendLine` when asked, and answers every other call with a typed
 * failure.
 *
 * @param screens the plain text each workspace id shows; a workspace absent here fails to read
 * @param trees the process tree each workspace id runs; a workspace absent here fails to read
 * @param ttyPids the tty pids cmux 0.65.2 lists for a workspace but attributes to no tree; none by default
 * @param bindings the saved session cmux keeps for each workspace id; a workspace absent here has none
 * @param sendFails whether `sendLine` answers a typed failure
 * @param sent every line `sendLine` was asked to type, as `<workspace id>: <text>`
 * @param composerAfterSend whether a workspace shows {@link COMPOSER_GRID} once a line was typed into it; never by
 *   default, its grid failing to read
 * @returns the client, with the host's never-interrupting reach over it
 */
export function fakeClient({
  screens = {},
  trees = {},
  ttyPids = {},
  bindings = {},
  sendFails = false,
  sent = [],
  composerAfterSend = false,
}: {
  screens?: Readonly<Record<string, string>>;
  trees?: Readonly<Record<string, readonly CmuxProcess[]>>;
  ttyPids?: Readonly<Record<string, readonly number[]>>;
  bindings?: Readonly<Record<string, CmuxResumeBinding>>;
  sendFails?: boolean;
  sent?: string[];
  composerAfterSend?: boolean;
}): CmuxClient & CmuxHostReach {
  const typedInto = new Set<string>();
  const client: CmuxClient = {
    close: () => undefined,
    closeWorkspace: unscripted,
    createWorkspace: unscripted,
    identify: unscripted,
    interruptTurn: unscripted,
    listWorkspaces: unscripted,
    pinWorkspace: unscripted,
    ...treeReads({ trees, ttyPids }),
    readResumeBinding: ({ workspaceId }) => Promise.resolve(ok(bindings[workspaceId])),
    ...screenReads({ composerAfterSend, screens, typedInto }),
    renameWorkspace: unscripted,
    resolveWorkspace: unscripted,
    sendLine: ({ target, text }) => {
      sent.push(`${target.workspaceId}: ${text}`);
      typedInto.add(target.workspaceId);
      if (sendFails) {
        return Promise.resolve(
          err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "surface.send_text" })),
        );
      }
      return Promise.resolve(ok(undefined));
    },
    submitComposer: unscripted,
    unpinWorkspace: unscripted,
    listWorkspacesStrict: unscripted,
    topologyStrict: unscripted,
    workspaceSurface: unscripted,
  };
  return reachingOver({ client });
}

/**
 * A fake client with the host's never-interrupting reach over it — what `withCmuxSessionHost` hands the pass, so a
 * nudge or a chair line types through the fake's own `sendLine` and screen reads exactly as it does in production.
 *
 * @param client the fake client the reach types through
 * @returns the same client, reaching
 */
function reachingOver({ client }: { client: CmuxClient }): CmuxClient & CmuxHostReach {
  return {
    ...client,
    reachSession: ({ target, text, waits }) => reachSession({ client, interrupt: false, target, text, waits }),
  };
}

/**
 * A reseat lock held in memory — one holder per workspace, as the operation lock keeps across processes — that
 * journals every take, contention and release, so a test can assert what ran under it.
 *
 * @param journal where `lock <id>`, `lock-contended <id>` and `release <id>` go
 * @param heldBy workspaces another reseat already holds when the test starts
 * @returns the `acquireReseatLock` effect
 */
export function memoryReseatLock({
  journal,
  heldBy = new Set(),
}: {
  journal: string[];
  heldBy?: ReadonlySet<string>;
}): ReseatDeps["acquireReseatLock"] {
  const held = new Set(heldBy);
  return ({ workspaceId }) => {
    if (held.has(workspaceId)) {
      journal.push(`lock-contended ${workspaceId}`);
      return err(OperationLockAcquireErrors.contended({ message: "held by pid 4242 since 2026-10-30T00:00:00.000Z" }));
    }
    held.add(workspaceId);
    journal.push(`lock ${workspaceId}`);
    return ok({
      release: () => {
        held.delete(workspaceId);
        journal.push(`release ${workspaceId}`);
      },
      stillHeld: () => held.has(workspaceId),
      stoleFromPid: undefined,
    });
  };
}

/**
 * The reseat deps a pass would build, every effect answered in place.
 *
 * @param client the cmux client the deps carry
 * @param ownWorkspaceId the workspace the pass runs in, which a reseat refuses to stop
 * @param registry what Claude Code's registry holds at each read; empty by default
 * @param liveRecords the registry records that are live seats at each read; empty by default
 * @param transcripts the `<cwd>/<session id>` pairs whose transcript is on disk; every one by default
 * @returns deps whose routing succeeds with no store, where no session is live, whose process table is
 *   {@link FAKE_TABLE} and whose executables and tty holders are {@link honestExecutables} and
 *   {@link honestTtyHolders} off it
 */
export function fakeDeps({
  client,
  ownWorkspaceId,
  registry = () => [],
  liveRecords = () => [],
  transcripts,
}: {
  client: CmuxClient;
  ownWorkspaceId: string | undefined;
  registry?: () => readonly SessionRecord[];
  liveRecords?: () => readonly SessionRecord[];
  transcripts?: ReadonlySet<string>;
}): ReseatDeps {
  return {
    acquireReseatLock: memoryReseatLock({ journal: [] }),
    awaitBootSlot: () => Promise.resolve(),
    callerAncestry: () => ok(new Set<number>()),
    chairSessionId: undefined,
    chairWorkspaceId: undefined,
    client,
    coldShellPolls: 1,
    confirmPolls: 1,
    dryRun: false,
    env: {},
    flagModel: undefined,
    force: false,
    ledgerModels: new Map(),
    ownWorkspaceId,
    pause: () => Promise.resolve(),
    readArgv: () => undefined,
    readBoot: async () => ({ alias: "plan-one", kind: "store" }),
    readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: FAKE_TABLE })),
    readLiveRecords: () => ok(liveRecords()),
    readProcessGroups: ({ pids }) => ok(honestProcessGroups({ pids })),
    readProcessRows: () => ok(FAKE_TABLE),
    readRegistry: () => ok(registry()),
    readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: FAKE_TABLE, tty })),
    readTtyModes: () => ok(honestTtyModes()),
    routeCredential: () => Promise.resolve(ok({})),
    seatLine: async ({ sessionId }) => `seat ${sessionId}`,
    spawnDefaults: () => ({ envPrefix: "", pluginDir: undefined }),
    stop: () => Promise.resolve(true),
    transcriptExists: ({ cwd, sessionId }) => transcripts === undefined || transcripts.has(`${cwd}/${sessionId}`),
  };
}

/**
 * A fresh pass over a home: nothing recorded, nothing deferred.
 *
 * @param home the state home its journal lives under
 * @param fleet the store port its journal lines go through — the same one the test reads back
 * @returns the pass state
 */
export function passState({ home, fleet }: { home: string; fleet: FleetPort }): PassState {
  return {
    attemptId: "att-1",
    deferred: false,
    fleet,
    home,
    lines: [],
    passRefusal: undefined,
    refusals: [],
    releaseLock: () => undefined,
  };
}
