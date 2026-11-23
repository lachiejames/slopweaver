/**
 * The pure half of `./runDueVerbProcess.ts`: what a run-due verb child is launched as, how its ending maps back to an
 * exit code, and the words a signal retirement uses for what happened to it. Nothing here touches a process; the
 * effectful shell next door does, and every decision it makes is one of these functions over values it read.
 */
import { constants } from "node:os";

import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * The CLI tier this process is running, which a verb child must run too: the exec arguments that load it (tsx's
 * loader on the source tier, none on the built one) and the entry script itself. The executable is always this
 * process's own node, and that is a literal at the one spawn rather than a field, so nothing a caller hands in can
 * name another program.
 */
export interface RunDueCliLaunch {
  readonly execArgv: readonly string[];
  readonly entrypoint: string;
  /**
   * Whether the child leads a process group of its own. True for the OUTERMOST run-due; false for a run-due that is
   * itself a verb child, whose own child must stay in the group its parent's kill reaches ({@link childLeadsGroup}).
   */
  readonly leadsGroup: boolean;
}

/**
 * The variable a run-due sets on every verb child it launches, holding the run-due's OWN pid. A run-due that finds
 * it naming its parent is NESTED: a row's verb was `automation run-due`, and the group its parent will SIGKILL is the
 * one it is already in.
 *
 * The value is a pid, not a flag, because an environment is inherited by everything below: a verb child that starts
 * another program hands it the mark too, and a later `automation run-due` down that line is OUTERMOST to every group
 * anything signals. Bound to the parent pid, a leaked mark names a process that is not its parent and reads as
 * outermost. The residue, stated: a caller that deliberately sets the variable to its own pid before
 * starting a run-due makes it read as nested.
 */
export const RUN_DUE_VERB_CHILD_ENV = "SLOPWEAVER_RUN_DUE_VERB_CHILD";

/**
 * The value a run-due writes into {@link RUN_DUE_VERB_CHILD_ENV} for its child: its own pid.
 *
 * @param pid the launching run-due's own process id
 * @returns the pid as the variable's text
 */
export function runDueVerbChildMark({ pid }: { pid: number }): string {
  return String(pid);
}

/** What a kill reached: the child's whole group, or the child alone when it shares its caller's group. */
type RunDueKillScope = "group" | "process";

/** What a parent's signal did to the verb child it was running, read when the signal is dispatched. */
export type RunDueVerbTermination =
  | { readonly kind: "killed"; readonly pid: number; readonly scope: RunDueKillScope }
  | { readonly kind: "already-finished"; readonly pid: number; readonly scope: RunDueKillScope }
  | { readonly kind: "none-running" }
  /**
   * The group kill failed, so the child alone was targeted: `sent` when that SIGKILL went out, `gone` when the child
   * had already exited by then. Anything else in its group may outlive it either way.
   */
  | {
      readonly kind: "killed-alone";
      readonly pid: number;
      readonly groupMessage: string;
      readonly child: "sent" | "gone";
    }
  | { readonly kind: "kill-failed"; readonly pid: number; readonly scope: RunDueKillScope; readonly message: string };

/**
 * Whether a verb child this process launches should lead its own process group. Only the outermost run-due's do: a
 * detached child of a NESTED run-due would lead a second group that the outer run-due's group kill cannot reach, and
 * would outlive both. Kept in the outer group instead, it dies with the nested run-due it belongs to.
 *
 * @param inherited this process's own {@link RUN_DUE_VERB_CHILD_ENV}, unset unless something above it was a run-due
 * @param parentPid this process's parent, which a run-due that launched it directly wrote into the variable
 * @returns false only when this process's PARENT is the run-due that marked it
 */
export function childLeadsGroup({
  inherited,
  parentPid,
}: {
  inherited: string | undefined;
  parentPid: number;
}): boolean {
  return inherited !== runDueVerbChildMark({ pid: parentPid });
}

/** How many leading words of a whole-process argv are the runtime and the script: `["node", "slopweaver", noun, …]`. */
const PROCESS_ARGV_PREFIX = 2;

/** The shell convention for a process a signal ended: 128 plus the signal's number. */
const SIGNAL_EXIT_BASE = 128;

/**
 * The arguments a verb child is launched with: this tier's exec arguments, its entry script, then the verb's own words.
 * A row's argv is a whole-process argv (`verbRunArgv` builds `["node", "slopweaver", noun, verb, …]`), so only its
 * tail follows the real entry. Every word is one argument and nothing passes through a shell.
 *
 * @param argv the whole-process argv the row would have handed the dispatcher
 * @param launch the tier this process is running
 * @returns the argument list after the node executable
 */
export function verbChildArgv({
  argv,
  launch,
}: {
  argv: readonly string[];
  launch: RunDueCliLaunch;
}): readonly string[] {
  return [...launch.execArgv, launch.entrypoint, ...argv.slice(PROCESS_ARGV_PREFIX)];
}

/**
 * The exit code a process a signal ended reports, as a shell would.
 *
 * @returns 128 plus the signal's number: 130 for SIGINT, 137 for SIGKILL, 143 for SIGTERM
 */
export function signalledExitCode({ signal }: { signal: NodeJS.Signals }): number {
  return SIGNAL_EXIT_BASE + constants.signals[signal];
}

/**
 * A finished child's exit code, from what Node's `close` event reported. An exit code passes through unchanged, so
 * `EXIT_EXPECTED_EMPTY` still stamps and `EXIT_DEFERRED` still does not; a signal death becomes `128 + n` with a line
 * naming the signal, because a child killed outright wrote no reason of its own.
 *
 * @param code the exit code, or `null` when a signal ended it
 * @param signal the signal that ended it, or `null` when it exited
 * @returns the exit code the row is graded on, and the line to add to its diagnostics, if any
 */
export function closedChildExit({ code, signal }: { code: number | null; signal: NodeJS.Signals | null }): {
  readonly exitCode: number;
  readonly line: string | null;
} {
  if (code !== null) {
    return { exitCode: code, line: null };
  }
  if (signal !== null) {
    return {
      exitCode: signalledExitCode({ signal }),
      line: `automation run-due: the verb child was ended by ${signal}`,
    };
  }
  return {
    exitCode: EXIT_ERROR,
    line: "automation run-due: the verb child closed reporting neither an exit code nor a signal",
  };
}

/**
 * The clause a signal retirement's ledger detail carries about the verb child, so the record says whether the work
 * really stopped.
 *
 * @param termination what the signal handler's kill reported
 * @returns the clause, a sentence fragment
 */
export function terminationClause({ termination }: { termination: RunDueVerbTermination }): string {
  switch (termination.kind) {
    case "killed":
      if (termination.scope === "process") {
        return `its verb child (pid ${String(termination.pid)}), which shares its caller's process group, was sent SIGKILL`;
      }
      return `its verb child (pid ${String(termination.pid)}) and that child's process group were sent SIGKILL`;
    case "already-finished":
      return `its verb child (pid ${String(termination.pid)}) had already exited`;
    case "none-running":
      return "no verb child was running, so the effect ran in this process";
    case "killed-alone": {
      let child = "the child alone was sent SIGKILL";
      if (termination.child === "gone") {
        child = "the child alone was targeted and had already exited";
      }
      return `sending SIGKILL to its verb child's process group (pid ${String(termination.pid)}) failed (${termination.groupMessage}), so ${child}, and anything else in that group may outlive it`;
    }
    case "kill-failed": {
      let target = `its verb child's process group (pid ${String(termination.pid)})`;
      if (termination.scope === "process") {
        target = `its verb child (pid ${String(termination.pid)})`;
      }
      return `sending SIGKILL to ${target} failed (${termination.message}), so that child's death is NOT confirmed`;
    }
    default: {
      const unreachable: never = termination;
      return unreachable;
    }
  }
}

/**
 * Send SIGKILL to a verb child and say what happened. A child that leads its own group is killed by the NEGATIVE
 * pid, which reaches it and every descendant still in that group: a nested `automation run-due` and its own child
 * included, since a nested run-due keeps its child in that same group ({@link childLeadsGroup}). SIGKILL is the one
 * signal none of them can catch, so no nested trap can start a second retirement for the same signal. A child that
 * shares its caller's group, a nested run-due's own, is killed alone: killing the group would kill this process
 * before it retired the attempt.
 *
 * A group kill that fails for any reason but ESRCH (EPERM, when a group member runs as another user) falls back to the
 * child alone, so the process holding the row's effect still dies. Only when that fails too is the
 * death unconfirmed, and the retirement's detail says so; the attempt is retired either way, because this process is
 * exiting and a run left un-retired would only be found later as HOLDER_GONE.
 *
 * @param pid the child's pid, which is also its group's id when it leads one
 * @param leadsGroup whether the child was launched as the leader of its own group
 * @param kill the process edge, `process.kill` in production; it throws as that does
 * @returns `killed`, `already-finished` when nothing it targeted is left, `killed-alone` when only the group kill
 *   failed, or `kill-failed` with the reason
 */
export function killVerbGroup({
  kill,
  leadsGroup,
  pid,
}: {
  kill: (target: { readonly pid: number; readonly signal: NodeJS.Signals }) => void;
  leadsGroup: boolean;
  pid: number;
}): RunDueVerbTermination {
  if (!leadsGroup) {
    const alone = sendKill({ kill, target: pid });
    return terminationFor({ outcome: alone, pid, scope: "process" });
  }
  const group = sendKill({ kill, target: -pid });
  if (group.kind !== "failed") {
    return terminationFor({ outcome: group, pid, scope: "group" });
  }
  const alone = sendKill({ kill, target: pid });
  if (alone.kind === "failed") {
    return { kind: "kill-failed", message: `${group.message}; then ${alone.message}`, pid, scope: "group" };
  }
  return { child: alone.kind, groupMessage: group.message, kind: "killed-alone", pid };
}

/** What one SIGKILL did: sent, found nothing to kill, or failed with a reason. */
type SentKill =
  { readonly kind: "sent" } | { readonly kind: "gone" } | { readonly kind: "failed"; readonly message: string };

/** Send one SIGKILL, reading ESRCH as nothing left to kill. */
function sendKill({
  kill,
  target,
}: {
  kill: (target: { readonly pid: number; readonly signal: NodeJS.Signals }) => void;
  target: number;
}): SentKill {
  try {
    kill({ pid: target, signal: "SIGKILL" });
    return { kind: "sent" };
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
    if (code === "ESRCH") {
      return { kind: "gone" };
    }
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** One kill's outcome as the termination a retirement records. */
function terminationFor({
  outcome,
  pid,
  scope,
}: {
  outcome: SentKill;
  pid: number;
  scope: RunDueKillScope;
}): RunDueVerbTermination {
  switch (outcome.kind) {
    case "sent":
      return { kind: "killed", pid, scope };
    case "gone":
      return { kind: "already-finished", pid, scope };
    case "failed":
      return { kind: "kill-failed", message: outcome.message, pid, scope };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
