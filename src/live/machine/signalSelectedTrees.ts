/**
 * Signal every pid a reap plan selected, deepest first within each target, re-checking each one against a fresh
 * process table before it is signalled — the one execution loop `machine reap` (orphaned shells and stray dev
 * servers) and `cmux close`'s worktree-residue reap share.
 *
 * The plan and the signal are seconds apart, and a pid the kernel recycled in that window points at a different
 * process, so a pid whose argv moved since the plan selected it is reported rather than signalled
 * (`./reap.ts`'s `stillTheSameProcess`). Which targets are combined, which signal `kill` sends, and what an
 * unreadable re-read means all stay with the caller.
 */
import type { ProcessRow } from "../standing/processes.js";
import { stillTheSameProcess } from "./reap.js";

/**
 * Signal each selected tree's pids in plan order, collecting what went out and what did not.
 *
 * @param targets the selected trees, each its pids deepest first and the argv the plan saw for every one
 * @param processes the process table re-read immediately before signalling
 * @param kill signals one pid — the reason it failed, or `undefined` when the signal went out
 * @returns the pids signalled, and every pid not signalled with why, each in signal order
 */
export function signalSelectedTrees({
  targets,
  processes,
  kill,
}: {
  targets: readonly { readonly treePids: readonly number[]; readonly argvByPid: Readonly<Record<string, string>> }[];
  processes: readonly ProcessRow[];
  kill: (input: { pid: number }) => string | undefined;
}): { readonly killed: readonly number[]; readonly failed: readonly { readonly pid: number; readonly why: string }[] } {
  const current = new Map(processes.map((row) => [row.pid, row.argv]));
  const killed: number[] = [];
  const failed: { pid: number; why: string }[] = [];
  for (const target of targets) {
    for (const pid of target.treePids) {
      if (!stillTheSameProcess({ current, pid, target })) {
        failed.push({ pid, why: "it is no longer the process the plan selected — gone, or the pid was reused" });
        continue;
      }
      const why = kill({ pid });
      if (why === undefined) {
        killed.push(pid);
        continue;
      }
      failed.push({ pid, why });
    }
  }
  return { failed, killed };
}
