/**
 * Answering "is the session this workspace was opened for still there?" — the one question a dispatch record
 * cannot answer about itself.
 *
 * ## Why a screen read is not this answer
 *
 * `live/turn/dispatch.ts`'s `freshScreenTruth` classifies a fresh workspace's SCREEN, and its default arm is
 * `working`: no completion marker rendered means the turn has not reported finishing. That is a correct
 * answer to "has it finished?" and carries no information at all about "does it exist?". Measured
 * (the incident this module was written for): a loop read `--poll` → `{"kind":"working"}`, could not tell
 * whether anything was behind it, spent an hour proving a negative four different ways — and every one of
 * those four ways was wrong, because it looked for the session in places `askSessionPlan` never puts one (a
 * per-ask worktree, a handover run journal). The oracle it needed was the workspace id the dispatch record
 * already carried, and no verb asked cmux about it.
 *
 * ## The two honest phantoms, and why anything else is `unknown`
 *
 * - **`workspace-gone`** — cmux's own inventory no longer lists the recorded workspace id. A closed tab.
 * - **`host-exited`** — cmux still lists it, but nothing is running inside it except the surface's own idle
 *   shell. The agent quit and left a prompt.
 *
 * Everything else answers {@link WorkspaceLiveness} `unknown`, never `phantom`, and that direction is
 * deliberate: a false `phantom` resurfaces an ask a real session IS working on, which costs a duplicate
 * dispatch and a second tag at the person waiting. A false `alive` costs one more sweep tick. So a socket
 * that will not connect, a malformed reply, or a timeout is a broken ORACLE and is reported as one.
 *
 * ## Do not match the host binary by name
 *
 * Measured across all 26 live workspaces on this machine (reproduce the workspace count with
 * `cmux workspace list --json | jq length`): cmux reports a live Claude Code process's `name` as its VERSION
 * string — `2.1.241`, and `2.1.240` in the one workspace running an older build — not `claude`. A check for
 * the host's own binary name would have called every one of them a phantom. {@link classifyWorkspaceLiveness}
 * therefore asks the inverse, which needs no version table: is there anything in this tree that is NOT a
 * shell or cmux's own keepalive `sleep`?
 */
import { withCmuxSessionHost } from "../sessionHarness/cmuxHost.js";
import type { SessionHarnessError } from "../sessionHarness/errors.js";
import type { CmuxProcess } from "./client.js";
import type { CmuxError } from "./errors.js";

/**
 * Process names that prove nothing is being worked on — the surface's own login shell, and the `sleep` cmux
 * itself keeps in every surface (present in all 26 trees measured, live and idle alike). A leading `-` is
 * how a login shell reports itself.
 */
const IDLE_PROCESS_NAMES: ReadonlySet<string> = new Set([
  "bash",
  "dash",
  "fish",
  "login",
  "sh",
  "sleep",
  "zsh",
  "-bash",
  "-zsh",
]);

/** Why a recorded workspace holds no session. Both are checkable facts, never an inference from silence. */
export type PhantomReason = "workspace-gone" | "host-exited";

/** What cmux says about one recorded workspace, right now. */
export type WorkspaceLiveness =
  | { readonly kind: "alive"; readonly workspaceId: string; readonly pid: number; readonly process: string }
  | {
      readonly kind: "phantom";
      readonly workspaceId: string;
      readonly why: PhantomReason;
      readonly reason: string;
    }
  | { readonly kind: "unknown"; readonly workspaceId: string; readonly reason: string };

/** Reading one workspace's liveness — injected so every consumer is testable with a plain fake. */
export type WorkspaceLivenessCheck = (options: { workspaceId: string }) => Promise<WorkspaceLiveness>;

/** The first non-idle process anywhere in a tree, searched depth-first. */
function firstWorkingProcess({ processes }: { processes: readonly CmuxProcess[] }): CmuxProcess | undefined {
  for (const process of processes) {
    if (!IDLE_PROCESS_NAMES.has(process.name)) {
      return process;
    }
    const nested = firstWorkingProcess({ processes: process.children });
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

/**
 * Classify a workspace cmux still knows about, from its own process tree. Pure and total.
 *
 * The whole tree is searched, not only its roots: cmux attributes the surface's foreground process as a root
 * in every tree measured here, but a host launched from the surface's shell would hang off it instead, and
 * calling that a phantom would be the expensive direction to be wrong in.
 *
 * @param processes the process tree cmux attributes to the workspace's surfaces
 * @param workspaceId the workspace being classified, carried through onto the verdict
 * @returns `alive` naming the process that proves it, or `phantom` with `host-exited`
 */
export function classifyWorkspaceLiveness({
  processes,
  workspaceId,
}: {
  processes: readonly CmuxProcess[];
  workspaceId: string;
}): WorkspaceLiveness {
  const working = firstWorkingProcess({ processes });
  if (working === undefined) {
    return {
      kind: "phantom",
      reason: `cmux still lists workspace ${workspaceId}, but nothing is running in it beyond an idle shell — the host exited`,
      why: "host-exited",
      workspaceId,
    };
  }
  return { kind: "alive", pid: working.pid, process: working.name, workspaceId };
}

/**
 * Whether a tree is POSITIVELY a bare shell: at least one shell in it, and nothing anywhere that is not a shell
 * or cmux's keepalive `sleep`. Stricter than {@link classifyWorkspaceLiveness}, which reads an empty tree as
 * `host-exited`: a caller about to CLOSE a workspace on this answer needs a shell it saw, not the absence of
 * anything else, since a malformed `system.top` reply parses to an empty tree too.
 *
 * @param processes the process tree cmux attributes to the workspace's surfaces
 * @returns true only when a shell is present and nothing in the tree is working
 */
export function isBareShellTree({ processes }: { processes: readonly CmuxProcess[] }): boolean {
  const hasShell = processes.some((process) => process.name !== "sleep" && IDLE_PROCESS_NAMES.has(process.name));
  return hasShell && firstWorkingProcess({ processes }) === undefined;
}

/**
 * The `phantom` verdict for a workspace cmux's own inventory no longer lists.
 *
 * @param workspaceId the recorded workspace id that resolved to nothing
 * @returns the verdict
 */
export function workspaceGone({ workspaceId }: { workspaceId: string }): WorkspaceLiveness {
  return {
    kind: "phantom",
    reason: `cmux has no workspace ${workspaceId} — the workspace this dispatch recorded is gone`,
    why: "workspace-gone",
    workspaceId,
  };
}

/**
 * Whether a failure is the inventory answering "I do not have that workspace", as opposed to the oracle itself
 * being broken. Pure — the code, never the English of the message: a raw cmux `not_found`, or the harness's
 * `SESSION_NOT_FOUND`, which is exactly that `not_found` on a resolve translated at the seam.
 *
 * @param error the typed cmux or harness failure
 * @returns whether it is a not-found from a resolve
 */
export function isWorkspaceNotFound({ error }: { error: CmuxError | SessionHarnessError }): boolean {
  if (error.code === "SESSION_NOT_FOUND") {
    return true;
  }
  return error.code === "CALL_FAILED" && error.cmuxCode === "not_found";
}

/**
 * The production liveness check: resolve the recorded id through the session harness, then ask the cmux host
 * for its process tree — a cmux-only oracle the control plane's liveness events replace in stage 2. One
 * connection for both calls. The harness answers `SESSION_NOT_FOUND` for exactly the `not_found` resolve
 * {@link isWorkspaceNotFound} recognises on a raw cmux failure.
 *
 * @returns the check
 */
export function realWorkspaceLivenessCheck(): WorkspaceLivenessCheck {
  return ({ workspaceId }) =>
    withCmuxSessionHost({
      body: async ({ harness, host }) => {
        const resolved = await harness.resolve({ handle: workspaceId });
        if (resolved.isErr()) {
          return isWorkspaceNotFound({ error: resolved.error })
            ? workspaceGone({ workspaceId })
            : { kind: "unknown" as const, reason: resolved.error.message, workspaceId };
        }
        const tree = await host.processTree({ workspaceId });
        return tree.isErr()
          ? { kind: "unknown" as const, reason: tree.error.message, workspaceId }
          : classifyWorkspaceLiveness({ processes: tree.value, workspaceId });
      },
    });
}
