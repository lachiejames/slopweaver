/**
 * Reading a workspace COLD over a reseat pass's effects: its tree, the live sessions and the binding cmux saved,
 * judged by `../../../sessions/coldSeat.ts` — once, or polled until a reopened tab settles into a bare shell.
 *
 * The relaunch a cold verdict feeds is `./reseatRelaunch.ts`; the pass and its effects are `./reseatPass.ts`; the
 * four reads between the two table reads are `./reseatColdConfirm.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { CmuxWorkspaceTop } from "../../../cmux/processTree.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import {
  executablePids,
  type GraftedTab,
  graftChanged,
  tabPlacement,
  tabTty,
} from "../../../sessions/coldExecutables.js";
import { graftTtyProcesses } from "../../../sessions/coldGraft.js";
import { type ColdSeatVerdict, isPromptShellTree, judgeColdSeat, savedSessionId } from "../../../sessions/coldSeat.js";
import { liveSessionsInTab, liveSessionsTouchingTab } from "../../../sessions/liveInTab.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import { confirmTab } from "./reseatColdConfirm.js";
import { stillLive } from "./reseatLiveSession.js";
import type { ReseatDeps } from "./reseatPass.js";

/** How long a reopened tab gets to show a bare shell before a cold resume gives up on it. */
export const COLD_SHELL_WAIT_SECONDS = 60;

/** How many failed reads in a row end the wait: a slow start fails once or twice, a hung socket keeps failing. */
const COLD_READ_ERROR_LIMIT = 3;

/**
 * A non-cold verdict in a few words, for the `NOT_COLD` refusal.
 *
 * @param verdict a verdict that came back anything but cold
 * @returns the transcript that is missing, or the verdict's own reason
 */
export function coldWhy({ verdict }: { verdict: Exclude<ColdSeatVerdict, { kind: "cold" }> }): string {
  if (verdict.kind === "unresumable") {
    return `session ${verdict.sessionId} has no transcript`;
  }
  return verdict.why;
}

/**
 * A tab cmux attributed no process to: `live` when the process table puts a live session on its one tty
 * (`../../../sessions/liveInTab.ts`), else the empty tree a shell not yet started reads as. MEASURED:
 * read as the empty tree without that look, two running seats were refused `no-process`. The tty match only ever
 * answers never-type; it builds no prompt tree, so the graft's proof is untouched.
 *
 * @param top what cmux reported for the tab, holding no pid
 * @param liveRecords the registry records whose own process runs now
 * @returns `live`, the empty tree, or the table read that failed — never `no-process` over an unread table
 */
function emptyReport({
  deps,
  workspace,
  top,
  liveRecords,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  top: CmuxWorkspaceTop;
  liveRecords: readonly SessionRecord[];
}): Result<ColdRead, ReseatError> {
  if (top.ttys.length === 0 || liveRecords.length === 0) {
    return ok({ kind: "tree", tree: [] });
  }
  const rows = readTable({ deps, workspace });
  if (rows.isErr()) {
    return err(rows.error);
  }
  // Validated again after the table, the way every tie off it is (`stillLive`).
  const onTty = stillLive({ deps, sessions: liveSessionsInTab({ liveRecords, report: top, rows: rows.value }) });
  if (onTty.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: onTty.error, what: "which Claude sessions are live" }));
  }
  if (onTty.value.length > 0) {
    return ok({ kind: "live" });
  }
  return ok({ kind: "tree", tree: [] });
}

/**
 * One workspace's process tree WITH the tty processes cmux lists but attributes to no tree grafted back in: on cmux
 * 0.65.2 a tab at its prompt attributes nothing and lists its `login` and shell as unattributed, so a tree read off
 * `processes` alone is an empty tab where a bare shell is (`../../../cmux/processTree.ts`). The process table is read
 * whenever cmux reports ANY process, listed or attributed, and every one must be in it (a tree
 * trusted without the table is a tree no second read checked); a tab reporting nothing is never cold, and costs a `ps`
 * only to look for a live session on its tty (`emptyReport`).
 * A tab holding more than one surface is `split`, never a tree: its processes are read across every surface and the
 * line would reach the selected one alone. After the graft, the image behind each SHELL it
 * placed is read off `lsof` and must be the exact system shell path the argv spells: the argv is the process's own
 * word for itself, and `execve("/tmp/zsh", ["/bin/zsh"])` prints `/bin/zsh` in every `ps` column, MEASURED; a
 * `/usr/local/bin/zsh` behind `-/bin/zsh` is refused too. The tab's `login` is NOT asked for: it is root's process, and `lsof` as the owner
 * prints no block for it and exits 1, MEASURED on a real bare tab, where asking refused every real tab
 * whole; a `login` is held instead to holding NO descriptor on the tab's tty, which a real one hands to its shell.
 * Then the tab's tty's input modes are read off `stty -g` and must be a line editor's: raw, with no control
 * character on `^J` or `^M`. A same-owner helper that ran `stty -f /dev/<tty> icanon inlcr -icrnl` and exited before
 * any read leaves the shell sleeping, childless, the tty on fd 0 and its group the foreground, while the kernel
 * holds every typed byte for a delimiter it maps away, so the resume line queues and is never entered. MEASURED: a bare tab's zsh waits with the tty raw and `inlcr icrnl` set, and a
 * `\n` reaches its editor as `^M`, which accepts the line. The read sits before the holders read so `stty`'s own
 * brief descriptor is never a holder that read sees. Then every pid holding the tab's tty DEVICE open is read off
 * `lsof`, with the descriptors it holds it on, and must be in the forest: a `setsid`'d helper reparented to launchd,
 * on no controlling tty, that kept fd 0 on the tab's tty reads the typed line, and every `ps` column shows the tab
 * a bare shell; and every shell at the prompt shape must hold the tty on fd 0: `exec /bin/zsh -i </tmp/feed` shows
 * every column a prompt shows, holds the tty on fds 1 and 2 alone, and a typed line reaches no reader. MEASURED: a bare tab's tty is held by its shell alone, on fds 0, 1, 2, 10
 * and 14, so holders are a subset of the forest. Then each prompt shell's process group and the FOREGROUND group of
 * its tty are read off `ps -o pgid=,tpgid=` and must be the same: a helper that ignored `SIGTTOU`, `tcsetpgrp`'d
 * the tty to the `login`'s group and exited leaves a sleeping, childless shell with the tty on fd 0 that is stopped
 * with `SIGTTIN` the moment it reads, so the typed line queues unread. MEASURED: a bare tab's shell is its own group leader and that group is the tty's foreground. The table is then
 * read AGAIN, the LAST read before the line, and
 * must rebuild the same forest on the same tty: `lsof` reads only the pids the first table placed, so a child the
 * shell forked between that table read and the lsof read was in neither, and the shell it hung under confirmed as
 * `/bin/zsh`; a same forest the second read puts on another tty had its holders
 * read on a tty it is no longer on; and each forest pid must sit under the same
 * parent, on the same tty, with the same argv in both reads, since the same forest on the same tty can be under
 * another cmux app row the second time.
 *
 * RESIDUE, stated. The first (at `./reseatRelaunch.ts`'s `clearPrior`): the last
 * read and the typed line are two cmux calls, and a program started in the instant between them receives the line,
 * as a shell a same-owner helper on another tty STOPS with a signal in that instant has the line queued on its pty
 * while in state `T`, where the relaunch's read-back times out and says so; nothing
 * deliberate runs between the two, and ANY change to the forest or the tty in that instant is this residue, since a
 * read repeated only moves it. Its pair: the lsof reads, the stty read and the second table read are
 * separate calls, and a shell that `exec`s another image in that instant with its own row spelled back (`exec -a
 * -/bin/zsh /tmp/foo`) rebuilds the same forest over an image the lsof read no longer describes, as a helper that
 * opens the tab's tty after the holders read and before the line is a holder that read never saw, and one that
 * sets the tty's modes after the stty read leaves modes that read no longer describes. The next: the cmux read and the `ps` read are two calls. A shell that
 * exits in the instant between them, its pid handed straight to another tab's shell of the same class, would read as
 * still this tab's. The kernel reuses a pid only once every other pid has been handed out, so that instant is not
 * reachable on this machine; a pid taken by a process of another CLASS in the same instant is refused by the graft.
 * The third: a shell SLEEPING in any
 * builtin that waits without forking, `read`, `wait`, `select`, or `vared`, which waits in the same line editor the
 * prompt does and takes the line as a variable's value, or still reading a startup file somebody replaced with a
 * FIFO held open, or running a native module its startup files loaded whose own thread reads the tty, shows both reads the childless shell a prompt shows, and the line typed would be the shell's
 * input once it reaches one. Whatever runs INSIDE the shell process is this residue: no process read tells it from
 * the line editor, and a module's mapping is one more `txt` row of a shell that may load any. A tab cmux reopened
 * after a restart runs no builtin until someone types one and reads the owner's own startup files, so the shape is
 * reached only by hand or by the owner's own files. A
 * shell SPINNING in a builtin loop is not this residue: it is on the CPU, and the graft refuses a childless shell on
 * the tab's tty in state `R` (`../../../sessions/coldGraftAgreement.ts`). The fourth: a line typed at the prompt and never entered sits in the shell's
 * line editor, which no process read shows, and the resume line lands after it. A tab cmux reopened after a restart
 * has nothing typed, and `cmux reseat <ws>` by hand is run on a tab whose screen the operator reads; a screen read
 * keyed on a prompt character would refuse every themed prompt, and the recovery with it. The fifth: a ROOT-owned process already holding the tab's tty open, on another tty or none, is listed by no
 * read run as the owner: `lsof` prints no descriptor of a root process (the tab's own `login`, measured), and `ps`
 * places it on its own controlling tty. Every read here runs as the owner, and a root process on this machine can
 * as well write the tty itself; running the reads as root is access the fleet does not hold.
 *
 * @param deps the pass's effects
 * @param workspace the workspace to read
 * @returns the grafted tree, or the split tab, or why the tab or the process table could not be read
 */
async function readColdTree({
  deps,
  workspace,
  liveRecords,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  liveRecords: readonly SessionRecord[];
}): Promise<Result<ColdRead, ReseatError>> {
  const top = await deps.client.workspaceTop({ workspaceId: workspace.workspaceId });
  if (top.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: top.error.message, what: `${workspace.workspaceRef}'s process tree` }),
    );
  }
  if (top.value.surfaces > 1) {
    return ok({ kind: "split", surfaces: top.value.surfaces });
  }
  // A reply that decodes but holds no surface for the tab is a tab that is gone or not listed, never an empty one
  // (judging it `no-process` would be the shape of a shell not yet started).
  if (top.value.surfaces === 0) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: "cmux's process listing holds no surface for the tab, so it is gone or not listed",
        what: `${workspace.workspaceRef}'s process tree`,
      }),
    );
  }
  if (top.value.unattributedTtyPids.length === 0 && top.value.trees.length === 0) {
    return emptyReport({ deps, liveRecords, top: top.value, workspace });
  }
  // The session before the forest: a live one in the tab is never typed into, so nothing the graft refuses on — a
  // zombie, a helper on `tty ??`, the shell outside the foreground group Claude holds — may stand in front of that
  // answer (`../../../sessions/liveInTab.ts`). A pid cmux reported itself needs no table, so a `ps` that fails cannot
  // refuse it either.
  if (liveSessionsInTab({ liveRecords, report: top.value, rows: [] }).length > 0) {
    return ok({ kind: "live" });
  }
  const rows = readTable({ deps, workspace });
  if (rows.isErr()) {
    return err(rows.error);
  }
  if (liveSessionsTouchingTab({ liveRecords, report: top.value, rows: rows.value }).length > 0) {
    return ok({ kind: "live" });
  }
  const first = graftFromTable({ rows: rows.value, top: top.value, workspace });
  if (first.isErr()) {
    return err(first.error);
  }
  const confirmed = confirmTab({ deps, grafted: first.value, workspace });
  if (confirmed.isErr()) {
    return err(confirmed.error);
  }
  return rereadTree({ deps, first: first.value, top: top.value, workspace });
}

/**
 * The second table read a tree holding an executable takes, refusing a forest that moved between the two reads.
 *
 * @param deps the pass's effects
 * @param first the graft off the first table read
 * @param top what cmux reported for the tab
 * @param workspace the workspace it was read for
 * @returns the first tree when nothing in it executes, else the second, or why the two reads disagreed
 */
function rereadTree({
  deps,
  first,
  top,
  workspace,
}: {
  deps: ReseatDeps;
  first: GraftedTab;
  top: CmuxWorkspaceTop;
  workspace: CmuxWorkspaceSummary;
}): Result<ColdRead, ReseatError> {
  if (executablePids({ tree: first.tree }).length === 0) {
    return ok({ kind: "tree", tree: first.tree });
  }
  const again = readTable({ deps, workspace });
  if (again.isErr()) {
    return err(again.error);
  }
  const second = graftFromTable({ rows: again.value, top, workspace });
  if (second.isErr()) {
    return err(second.error);
  }
  const changed = graftChanged({ after: second.value, before: first });
  if (changed !== undefined) {
    return err(ReseatErrors.cmuxReadFailed({ cause: changed.message, what: `${workspace.workspaceRef}'s processes` }));
  }
  return ok({ kind: "tree", tree: second.value.tree });
}

/** One read of the process table behind a tab's processes. */
function readTable({
  deps,
  workspace,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
}): Result<readonly TtyProcessRow[], ReseatError> {
  const rows = deps.readProcessRows();
  if (rows.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: rows.error,
        what: `the process table behind ${workspace.workspaceRef}'s processes`,
      }),
    );
  }
  return ok(rows.value);
}

/**
 * One process-table snapshot grafted onto what cmux reported for the tab, and the tab's tty off the same snapshot.
 *
 * @param rows the process table, read beside the tab
 * @param top what cmux reported for the tab
 * @param workspace the workspace it was read for
 * @returns the grafted forest and its tty, or why the graft refused it
 */
function graftFromTable({
  rows,
  top,
  workspace,
}: {
  rows: readonly TtyProcessRow[];
  top: CmuxWorkspaceTop;
  workspace: CmuxWorkspaceSummary;
}): Result<GraftedTab, ReseatError> {
  const grafted = graftTtyProcesses({ rows, trees: top.trees, ttyPids: top.unattributedTtyPids });
  if (grafted.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: grafted.error.message, what: `${workspace.workspaceRef}'s processes` }),
    );
  }
  const tty = tabTty({ rows, tree: grafted.value });
  if (tty.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: tty.error.message, what: `${workspace.workspaceRef}'s processes` }),
    );
  }
  return ok({
    placement: tabPlacement({ rows, tree: grafted.value }),
    tree: grafted.value,
    tty: tty.value,
  });
}

/**
 * What one cold read of a tab found: its grafted tree, that it holds more than one surface, or that a live Claude
 * session runs in it — found before any graft, so nothing about the forest around that session decided it.
 */
type ColdRead =
  | { readonly kind: "tree"; readonly tree: readonly CmuxProcess[] }
  | { readonly kind: "split"; readonly surfaces: number }
  | { readonly kind: "live" };

/** Whether a tab is at a bare shell prompt, and when it is not, which non-cold reason the tree gave. */
export type PromptVerdict = { readonly kind: "at-prompt" } | { readonly kind: "not-at-prompt"; readonly why: string };

/**
 * Judge whether a workspace is a bare shell at its prompt, nothing else: the read a LIVE relaunch takes after it stopped
 * the old `claude` and before it types (the stop leaving the shell is what the typed line
 * assumes, and a process beside the one stopped would take the keystrokes). The saved session is not consulted — the
 * live arm already knows which session it resumes.
 *
 * @param deps the pass's effects
 * @param workspace the workspace to read
 * @returns at the prompt, or not and why, or why the tab could not be read
 */
export async function judgeWorkspaceAtPrompt({
  deps,
  workspace,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
}): Promise<Result<PromptVerdict, ReseatError>> {
  // No live read: the arm calling this has just stopped the session it resumes, and asks only what is left.
  const read = await readColdTree({ deps, liveRecords: [], workspace });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.kind === "split") {
    return ok({ kind: "not-at-prompt", why: "split-surfaces" });
  }
  if (read.value.kind === "live") {
    return ok({ kind: "not-at-prompt", why: "live-session" });
  }
  if (read.value.tree.length === 0) {
    return ok({ kind: "not-at-prompt", why: "no-process" });
  }
  return ok(
    isPromptShellTree({ tree: read.value.tree })
      ? { kind: "at-prompt" }
      : { kind: "not-at-prompt", why: "not-a-bare-shell" },
  );
}

/**
 * Judge one workspace cold or not, reading the live sessions, the binding cmux saved for it, the saved session's
 * transcript, and its tree and table LAST, the table once more after `lsof`: that table read is the one the typed line
 * stands on, so nothing is read after it (the live-session read
 * takes its own `ps` snapshot, and a program started between the tree read and that snapshot was judged off the older
 * tree; the transcript stat sat after the tree read too).
 *
 * @param deps the pass's effects
 * @param workspace the workspace to read
 * @param pinnedSessionId the supervisor pin's session id, for the chair's tab only
 * @returns the verdict, or why it could not be read
 */
export async function judgeWorkspaceCold({
  deps,
  workspace,
  pinnedSessionId,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  pinnedSessionId: string | undefined;
}): Promise<Result<ColdSeatVerdict, ReseatError>> {
  const live = deps.readLiveRecords();
  if (live.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: live.error, what: "which Claude sessions are live" }));
  }
  const binding = await deps.client.readResumeBinding({ workspaceId: workspace.workspaceId });
  if (binding.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: binding.error.message, what: `${workspace.workspaceRef}'s saved session` }),
    );
  }
  // The transcript is stat'ed here, for the one session the judge will name, so no file read follows the tree read.
  const sessionId = savedSessionId({ binding: binding.value, pinnedSessionId });
  const transcript = sessionId !== undefined && deps.transcriptExists({ cwd: workspace.currentDirectory, sessionId });
  const read = await readColdTree({ deps, liveRecords: live.value, workspace });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.kind === "split") {
    return ok({ kind: "not-cold", surfaces: read.value.surfaces, why: "split-surfaces" });
  }
  if (read.value.kind === "live") {
    return ok({ kind: "not-cold", why: "live-session" });
  }
  return ok(
    judgeColdSeat({
      binding: binding.value,
      liveRecords: live.value,
      pinnedSessionId,
      transcriptExists: () => transcript,
      tree: read.value.tree,
      workspaceCwd: workspace.currentDirectory,
    }),
  );
}

/**
 * Judge a reopened tab cold, giving it up to `coldShellPolls` polls to come up as a bare shell: a tab cmux has just
 * reopened may not have started its shell yet, and an empty tree is never read as one. A cold read is taken twice,
 * a pause apart, and the SECOND is the answer: a shell still running its startup file can read bare for an instant,
 * and the line typed into it is the one carrying the routed credential. A FAILED read is retried only
 * {@link COLD_READ_ERROR_LIMIT} times running: each cmux read can take its whole 15s timeout, and a socket that stopped
 * answering would otherwise hold the chair for every poll of the budget before any refusal is printed.
 *
 * @param deps the pass's effects
 * @param workspace the workspace to read
 * @param pinnedSessionId the supervisor pin's session id, for the chair's tab only
 * @returns the confirming read of a cold verdict, the first other settled verdict, or the last read when the polls
 *   ran out
 */
export async function awaitColdVerdict({
  deps,
  workspace,
  pinnedSessionId,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  pinnedSessionId: string | undefined;
}): Promise<Result<ColdSeatVerdict, ReseatError>> {
  let read = await judgeWorkspaceCold({ deps, pinnedSessionId, workspace });
  let failedRunning = read.isErr() ? 1 : 0;
  for (
    let poll = 1;
    poll < deps.coldShellPolls && failedRunning < COLD_READ_ERROR_LIMIT && !coldVerdictSettled({ read });
    poll += 1
  ) {
    await deps.pause();
    read = await judgeWorkspaceCold({ deps, pinnedSessionId, workspace });
    failedRunning = read.isErr() ? failedRunning + 1 : 0;
  }
  if (read.isOk() && read.value.kind === "cold") {
    await deps.pause();
    return judgeWorkspaceCold({ deps, pinnedSessionId, workspace });
  }
  return read;
}

/**
 * Whether a read is final: anything but a failed read or a tab that is not yet a bare shell — an empty tree whose
 * shell has not started, or a lone `login` still handing over to it and so read as an unrecognised prompt, waits too.
 */
function coldVerdictSettled({ read }: { read: Result<ColdSeatVerdict, ReseatError> }): boolean {
  if (read.isErr()) {
    return false;
  }
  return (
    read.value.kind !== "not-cold" ||
    (read.value.why !== "not-a-bare-shell" &&
      read.value.why !== "unrecognised-prompt" &&
      read.value.why !== "no-process")
  );
}
