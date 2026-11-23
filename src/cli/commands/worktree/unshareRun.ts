/**
 * `slopweaver worktree unshare` — take this checkout's native binaries off the inode yarn shares with every
 * other checkout on the machine, and report the ones that are still on it.
 *
 * The repair half of what `worktree create` now does automatically after every install. It exists as a verb
 * because the trees that were poisoned before the automatic step landed cannot repair themselves: the main
 * checkout and every worktree created before it still carry yarn's inodes, and `worktree/execInodes.ts` has
 * the measurement showing that one in-place write to one of those leaves the binary PERMANENTLY
 * unexecutable in all of them at once.
 *
 * `--report` is the read-only rung and is what `doctor`'s own line is built on. `--all` walks the main
 * checkout and every worktree git registers for it, which is the shape the repair pass actually needs.
 */
import { cachePaths } from "../../../cacheHome.js";
import { listWorktrees } from "../../../cmux/worktree.js";
import { logger } from "../../../lib/logger.js";
import { ok, type Result } from "../../../lib/result.js";
import { withDepsLock } from "../../../worktree/depsLock.js";
import {
  type ExecInodeReport,
  execInodesNeedAttention,
  renderExecInodeReport,
  tallyExecInodes,
} from "../../../worktree/execInodes.js";
import { privatiseExecInodes } from "../../../worktree/execInodesApply.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWorktreeArgs, targetRepoRoot, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";

/** Every root one invocation should walk, main checkout first. */
function rootsFor({ repoRoot, all }: { repoRoot: string; all: boolean }): readonly string[] {
  if (!all) {
    return [repoRoot];
  }
  const linked = listWorktrees({ repoRoot })
    .map((worktree) => worktree.path)
    .filter((path) => path !== repoRoot);
  return [repoRoot, ...linked];
}

/**
 * Walk one root, holding its deps lock (`worktree/depsLock.ts`) when the walk writes, so a relink never lands in
 * the `node_modules` a provision, a prune or a removal holds. `--report` writes nothing.
 */
function walkRoot({
  root,
  apply,
  execStore,
}: {
  root: string;
  apply: boolean;
  execStore: string;
}): Result<ExecInodeReport, string> {
  if (!apply) {
    return ok(privatiseExecInodes({ apply, execStore, root }));
  }
  return withDepsLock({ act: () => privatiseExecInodes({ apply, execStore, root }), waitMs: 0, worktree: root });
}

/** Walk every root, naming each one whose lock was not taken rather than relinking under its holder. */
function walkAll({ roots, apply, execStore }: { roots: readonly string[]; apply: boolean; execStore: string }): {
  reports: readonly ExecInodeReport[];
  refused: number;
} {
  const reports: ExecInodeReport[] = [];
  let refused = 0;
  for (const root of roots) {
    const walked = walkRoot({ apply, execStore, root });
    if (walked.isErr()) {
      refused += 1;
      logger.error({ msg: `${root} was not unshared, because its deps lock was not taken: ${walked.error}` });
      continue;
    }
    reports.push(walked.value);
  }
  return { refused, reports };
}

/** The trailing summary across every root walked, so a long `--all` run ends with the number that matters. */
function summaryLine({ reports }: { reports: readonly ExecInodeReport[] }): string {
  const totals = reports.map((report) => tallyExecInodes({ report }));
  const relinked = totals.reduce((sum, tally) => sum + tally.relinked.count, 0);
  const shared = totals.reduce((sum, tally) => sum + tally.shared.count, 0);
  const failed = totals.reduce((sum, tally) => sum + tally.failed.count, 0);
  return (
    `${String(reports.length)} root(s): ${String(relinked)} relinked · ${String(shared)} still shared with yarn's store · ` +
    `${String(failed)} failed`
  );
}

/**
 * The `worktree unshare` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any root is still shared or a relink failed, which is a
 *   finding rather than a broken tool
 */
export function runWorktreeUnshare(argv: readonly string[]): number {
  const parsed = parseWorktreeArgs({ rest: argv.slice(VERB_ARG_OFFSET), verb: "unshare" });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.out({ line: worktreeUsage({ verb: "unshare" }) });
    return EXIT_USAGE;
  }
  const repoRoot = targetRepoRoot({ cwd: process.cwd(), parsed: parsed.value });
  if (repoRoot === undefined) {
    logger.error({ msg: "not inside a git repository — pass --repo <main checkout>" });
    return EXIT_ERROR;
  }
  const { execStore } = cachePaths();
  const { refused, reports } = walkAll({
    apply: parsed.value.values["report"] !== true,
    execStore,
    roots: rootsFor({ all: parsed.value.values["all"] === true, repoRoot }),
  });
  printReports({ asJson: parsed.value.values["json"] === true, execStore, reports });
  const attention = refused > 0 || reports.some((one) => execInodesNeedAttention({ report: one }));
  return attention ? EXIT_ERROR : EXIT_OK;
}

/** Print every walk, as JSON or as the human report. */
function printReports({
  reports,
  execStore,
  asJson,
}: {
  reports: readonly ExecInodeReport[];
  execStore: string;
  asJson: boolean;
}): void {
  if (asJson) {
    logger.out({ line: JSON.stringify({ execStore, reports }, null, 2) });
    return;
  }
  for (const one of reports) {
    for (const line of renderExecInodeReport({ report: one })) {
      logger.out({ line });
    }
  }
  logger.out({ line: summaryLine({ reports }) });
}

export const worktreeUnshareCommand = defineCommand({ run: runWorktreeUnshare });
