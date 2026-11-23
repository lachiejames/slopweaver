/**
 * The constants and small builders every `reseatPass` case reads: ids, screens, process shapes, the process table and
 * the workspace and registry records the fake world is made of.
 */
import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../../../../cmux/client.js";
import type { CmuxRenderGrid } from "../../../../../../cmux/renderGrid.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import type { SessionRecord } from "../../../../../../sessions/liveSessions.js";
import type { ReseatError } from "../../../../../../sessions/reseatErrors.js";
import type { ReseatOutcome } from "../../../../../../sessions/reseatOutcome.js";

export const SEAT_ID = "a0000096-0000-4000-8000-000000000103";
export const CHAIR_ID = "a0000049-0000-4000-8000-000000000052";
export const LOGGED_OUT = "> \nNot logged in · Please run /login";
export const ROUTED =
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/seat 3</home/plan-one/setup-token";
export const OFF_PLAN = "signed out: it declares no setup token descriptor, and its store /x is no configured plan's";

/**
 * The error a refused outcome carries; throws on any other, so a case names the failure it expects.
 *
 * @returns the refusal's error
 */
export function unwrapRefusal({ outcome }: { outcome: ReseatOutcome }): ReseatError {
  if (outcome.kind !== "refused") {
    throw new Error(`expected a refusal, got ${outcome.kind}`);
  }
  return outcome.error;
}

/** The shell a stopped seat leaves behind, and what a busy one runs under it. */
export const SHELL: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 1 }];
export const SHELL_RUNNING_VIM: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "vim", pid: 7 }], name: "zsh", pid: 3 },
];

/** The bare shell a cold tab holds. */
export const BARE: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 1 }];

/**
 * The process table behind every tree this world reads: a cold read refuses a tree the table does not hold, and a
 * child under a parent the two reads disagree on. The bare shell (pid 1) has nothing under it,
 * so the scripted cmux tree alone decides its shape; the shell running `vim` is pid 3.
 */
export const TABLE: readonly TtyProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 0, state: "S", tty: "??" },
  { argv: "-/bin/zsh", pid: 1, ppid: 100, state: "S", tty: "ttys001" },
  { argv: "/usr/bin/login", pid: 2, ppid: 100, state: "S", tty: "ttys002" },
  { argv: "-/bin/zsh", pid: 3, ppid: 100, state: "S", tty: "ttys003" },
  { argv: "vim", pid: 7, ppid: 3, state: "S", tty: "ttys003" },
];

/** Claude Code's empty composer: the chevron and a NON-BREAKING space, the cursor visible after it. */
export const COMPOSER_GRID: CmuxRenderGrid = {
  columns: 40,
  cursor: { column: 2, row: 0, visible: true },
  rows: 1,
  spans: [{ column: 0, row: 0, styleId: 1, text: "❯ " }],
  styles: [{ bold: false, faint: false, foreground: "#ffffff", id: 1, italic: false }],
};

/** A surface with no composer on it: a bare shell's. */
export const NO_COMPOSER_GRID: CmuxRenderGrid = { columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] };

/**
 * One workspace by id and ref.
 *
 * @returns the workspace summary
 */
export function workspace({ id, ref }: { id: string; ref: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/wt/${id}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: id,
    windowId: "window:1",
    workspaceId: id,
    workspaceRef: ref,
  };
}

/**
 * One registry record.
 *
 * @returns the idle interactive record
 */
export function record({ pid, sessionId, cwd }: { pid: number; sessionId: string; cwd: string }): SessionRecord {
  return { cwd, entrypoint: "cli", kind: "interactive", name: "s", pid, sessionId, startedAtMs: 0, status: "idle" };
}
