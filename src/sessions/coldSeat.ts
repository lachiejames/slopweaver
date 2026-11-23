/**
 * Whether a workspace is a COLD seat — a reopened tab whose pane is a shell waiting at its prompt, nothing running,
 * with a saved session the fleet can resume in it — and, if so, which session. Pure: the tree, the live records, the
 * binding cmux kept and the transcript check all arrive as values.
 *
 * ## Why a cold seat exists at all
 *
 * MEASURED: cmux's own restore re-ran every seat's `claude --resume <id>` with the setup-token env
 * dropped from its binding, so the chair and every worker came up signed out. The owner's rule is that restoration uses our own
 * commands. With
 * cmux's restore switched off (`slopweaver fleet restore-policy --apply`) a reopened tab is a bare shell instead, and
 * the live-session pass (`./reseat.ts`'s `sessionInTree`) sees nothing in it to resume. This is the read that does.
 *
 * ## Which id, and why the pin wins
 *
 * The chair's id is the supervisor PIN, because the pin is what the rest of the fleet already treats as the chair.
 * cmux's binding is the fallback for a worker, which has no pin. When both name a session and they differ, the pin
 * still wins and the difference is carried out so the caller prints it rather than swallowing it.
 *
 * ## What "at its prompt" can and cannot see
 *
 * The resume line is TYPED, so whatever has the terminal's input gets it. A tree is read as a prompt only when it is
 * exactly ONE shell and nothing else, or that shell under the one `login` that started it. MEASURED by the
 * r3 review pass, three idle tabs read with `SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"workspace_id":"workspace:N"}'`
 * on cmux 0.64.22: a tab at its prompt is `[zsh]` alone. MEASURED on cmux 0.65.2: the same tab's
 * `processes` is EMPTY and its `login` and `-/bin/zsh` sit in the surface's `unattributed_tty_process_pids`
 * (`../cmux/processTree.ts`), so the judge is handed the tree with those processes grafted back from the process
 * table (`./coldGraft.ts`'s `graftTtyProcesses`, which fails closed on every way the two reads can disagree) and
 * reads `[login → [zsh]]` as the prompt it is. Reading `processes` alone that
 * night returned `no-process` for every reopened tab, the pinned chair's included, and `fleet resume` refused the
 * whole fleet `NO_LIVE_SESSION` with a fallback (`session re-seat`) that never seats the chair. The `sleep` beside a
 * shell in other trees is not a keepalive: cmux's zsh integration starts
 * its git-HEAD watcher (a `sleep 1` loop) in `preexec` and stops it in `precmd`
 * (`/Applications/cmux.app/Contents/Resources/shell-integration/cmux-zsh-integration.zsh`, `_cmux_start_git_head_watch`),
 * so a `sleep` is itself the sign a foreground command is running. cmux also lists a foreground process as its own
 * root rather than under the shell, so a script, a nested shell, a `sleep 600` or `login` before its shell starts each
 * adds a root or is not a shell, and is refused. A reply with any process in the tab that will not decode is a failed
 * read rather than a shorter tree (`../cmux/processTree.ts`).
 *
 * RESIDUE, stated rather than discovered:
 * - a prompt the shell's own startup file raises (an updater's `[Y/n]`) runs inside the shell process and is invisible
 *   to a process tree; the chair's tab is read twice a pause apart, and a worker's at the scan and again just before
 *   the send with nothing deliberately between them, which narrows the startup window and no more;
 * - the tab is judged, then the line is sent: a command the owner starts in that instant receives it;
 * - a shell is known by its process NAME, the one thing cmux reports, so a program that is not a shell but is named
 *   like one (`/tmp/zsh`) reads as one. Anything that could pick that name could fake its argv too, and a local
 *   process acting against the owner is outside this setup's trust model (`.claude/rules/journalled-grants.md`).
 */
import { basename } from "node:path";

import type { CmuxProcess } from "../cmux/client.js";
import type { CmuxResumeBinding } from "../cmux/resumeBinding.js";
import { flattenProcessTreePids } from "../live/standing/processes.js";
import { isShellName, LOGIN_NAME } from "./coldProcessClass.js";
import type { SessionRecord } from "./liveSessions.js";

/** Why a workspace is not a cold seat. */
export type NotColdReason =
  /** A live Claude session already runs in it: the live-session pass owns it. */
  | "live-session"
  /** The saved session is already live in another tab, so resuming it here would run it twice. */
  | "live-elsewhere"
  /** Anything but one childless shell runs in it, so a typed line could land in that program. */
  | "not-a-bare-shell"
  /**
   * The tab holds more than one surface: its processes are read across all of them and a typed line reaches only
   * the selected one, so a shell on a hidden split could vouch for a surface running who knows what. Close the extra surface and the tab is judged again.
   */
  | "split-surfaces"
  /**
   * Nothing runs in it at all — a shell not started yet, or one that exited — so it is no seat to type into and no
   * program to leave alone either: it is named for the supervisor.
   */
  | "no-process"
  /**
   * One childless process this module does not know as a shell holds a saved session nothing runs: very likely a
   * shell by another name, so it is named for the supervisor, never typed into.
   */
  | "unrecognised-prompt"
  /** It is a bare shell, and nothing records a session for it. */
  | "no-saved-session";

/** One workspace's cold-seat verdict. */
export type ColdSeatVerdict =
  | {
      readonly kind: "cold";
      readonly sessionId: string;
      /** The tab's own directory: where the typed resume line runs, and where its transcript was found. */
      readonly cwd: string;
      /** The launch argv cmux saved for this same session, empty when it saved none or saved a different one. */
      readonly argv: string;
      /** The pin's id and the binding's, when they named different sessions. */
      readonly mismatch: { readonly pinned: string; readonly bound: string } | undefined;
    }
  | { readonly kind: "not-cold"; readonly why: NotColdReason }
  /** A bare shell with a saved session whose transcript is not under the tab's directory, so nothing resumes there. */
  | { readonly kind: "unresumable"; readonly sessionId: string; readonly cwd: string };

/**
 * The session id to resume: the pin, else the binding's checkpoint, else none. Exported so a caller can stat the
 * session's transcript BEFORE it reads the tab's tree, and hand {@link judgeColdSeat} the answer it already has.
 *
 * @param pinnedSessionId the supervisor pin's session id, for the chair's tab only
 * @param binding the session cmux saved for the workspace, when it saved one
 * @returns the session id, or `undefined` when neither names one
 */
export function savedSessionId({
  pinnedSessionId,
  binding,
}: {
  pinnedSessionId: string | undefined;
  binding: CmuxResumeBinding | undefined;
}): string | undefined {
  if (pinnedSessionId !== undefined) {
    return pinnedSessionId;
  }
  return binding?.checkpointId;
}

/**
 * The one process a typed line would reach, when the tree has exactly one: a lone childless root, or the lone childless
 * child of a lone `login` (the shape cmux 0.65.2 reports for a tab at its prompt, grafted). Anything else — two roots, a
 * root with a child that is not that, a `login` with no child yet or more than one — is `undefined`.
 *
 * @param tree the tab's process tree
 * @returns that process, or `undefined`
 */
function promptCandidate({ tree }: { tree: readonly CmuxProcess[] }): CmuxProcess | undefined {
  const [only] = tree;
  if (tree.length !== 1 || only === undefined) {
    return undefined;
  }
  if (only.children.length === 0) {
    return only;
  }
  const [child] = only.children;
  if (basename(only.name) === LOGIN_NAME && only.children.length === 1 && child !== undefined) {
    return child.children.length === 0 ? child : undefined;
  }
  return undefined;
}

/**
 * Whether a tree is a shell waiting at its prompt: exactly one process, a shell, with no child — on its own, or
 * under the one `login` that started it.
 *
 * @param tree the process tree cmux attributes to the workspace
 * @returns true only for those exact shapes
 */
export function isPromptShellTree({ tree }: { tree: readonly CmuxProcess[] }): boolean {
  const candidate = promptCandidate({ tree });
  return candidate !== undefined && isShellName({ name: candidate.name });
}

/**
 * Judge one workspace: cold, not cold and why, or cold with a session that cannot be resumed.
 *
 * @param tree the process tree cmux attributes to the workspace
 * @param liveRecords the registry records whose own process runs NOW, machine-wide and any kind
 *   (`../fleet/liveSeat.ts`'s `liveSeatsFromScan`)
 * @param binding the session cmux saved for the workspace, when it saved one
 * @param pinnedSessionId the supervisor pin's session id, for the chair's tab only
 * @param workspaceCwd the directory cmux reports the tab in, where the typed line runs
 * @param transcriptExists whether a session's transcript is on disk under a directory
 * @returns the verdict
 */
export function judgeColdSeat({
  tree,
  liveRecords,
  binding,
  pinnedSessionId,
  workspaceCwd,
  transcriptExists,
}: {
  tree: readonly CmuxProcess[];
  liveRecords: readonly SessionRecord[];
  binding: CmuxResumeBinding | undefined;
  pinnedSessionId: string | undefined;
  workspaceCwd: string;
  transcriptExists: (options: { cwd: string; sessionId: string }) => boolean;
}): ColdSeatVerdict {
  const pids = new Set(flattenProcessTreePids({ roots: tree }));
  if (liveRecords.some((record) => pids.has(record.pid))) {
    return { kind: "not-cold", why: "live-session" };
  }
  if (tree.length === 0) {
    return { kind: "not-cold", why: "no-process" };
  }
  const sessionId = savedSessionId({ binding, pinnedSessionId });
  const liveElsewhere = liveRecords.some((record) => record.sessionId === sessionId);
  if (!isPromptShellTree({ tree })) {
    return { kind: "not-cold", why: notPromptWhy({ liveElsewhere, sessionId, tree }) };
  }
  if (sessionId === undefined) {
    return { kind: "not-cold", why: "no-saved-session" };
  }
  if (liveElsewhere) {
    return { kind: "not-cold", why: "live-elsewhere" };
  }
  if (!transcriptExists({ cwd: workspaceCwd, sessionId })) {
    return { cwd: workspaceCwd, kind: "unresumable", sessionId };
  }
  return coldVerdict({ binding, pinnedSessionId, sessionId, workspaceCwd });
}

/** Why a tree that is not one childless shell is not cold. */
function notPromptWhy({
  tree,
  sessionId,
  liveElsewhere,
}: {
  tree: readonly CmuxProcess[];
  sessionId: string | undefined;
  liveElsewhere: boolean;
}): NotColdReason {
  if (promptCandidate({ tree }) === undefined || sessionId === undefined) {
    return "not-a-bare-shell";
  }
  // Live in another tab is true of the session whatever this process is, and is named either way.
  return liveElsewhere ? "live-elsewhere" : "unrecognised-prompt";
}

/** A cold verdict: the binding's argv only when it saved this same session, and a pin-binding mismatch named. */
function coldVerdict({
  binding,
  pinnedSessionId,
  sessionId,
  workspaceCwd,
}: {
  binding: CmuxResumeBinding | undefined;
  pinnedSessionId: string | undefined;
  sessionId: string;
  workspaceCwd: string;
}): ColdSeatVerdict {
  const sameSession = binding?.checkpointId === sessionId;
  let mismatch: { readonly pinned: string; readonly bound: string } | undefined;
  if (binding !== undefined && pinnedSessionId !== undefined && !sameSession) {
    mismatch = { bound: binding.checkpointId, pinned: pinnedSessionId };
  }
  let argv = "";
  if (sameSession && binding.argv !== undefined) {
    argv = binding.argv;
  }
  return { argv, cwd: workspaceCwd, kind: "cold", mismatch, sessionId };
}
