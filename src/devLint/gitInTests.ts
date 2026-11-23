/**
 * The gate that stops a test running git against the real repository.
 *
 * ## Why a gate and not a convention
 *
 * Git exports `GIT_DIR` and `GIT_WORK_TREE` into hook processes and **those override `cwd`**. A test doing
 * shelling out to git with a `cwd` of its temp fixture therefore ignores that `cwd` whenever the suite runs
 * under a hook. The `pre-push` hook no longer runs the suite (it runs `yarn validate:local`,
 * which has no test lane), so the hook path is now `yarn validate` run by hand — narrower, and not gone.
 *
 * That has happened. A fixture line reading `git checkout -b some-branch` created that branch
 * in slopweaver, moved the active worktree onto it, and left 35 commits named `seed`, `work` and `attrs` on
 * a live PR branch. It surfaced only when a rebase tried to apply a commit called `seed`.
 *
 * The fix at the time was to pass a stripped environment at each call site. That is a convention: it works
 * until someone writing a new test does not know about it, which is exactly how the first one happened —
 * `gitDiff.ts` had carried the same warning, in the same repository, for weeks.
 *
 * So the invocation itself is refused. `src/__tests__/tempGitRepo.ts` is the one sanctioned door; it strips
 * the environment AND asserts the target is under the OS temp directory before running anything, so the
 * damage is impossible rather than merely unlikely.
 *
 * The scanner is a regex over test sources. That is enough: it is not defending against a
 * determined author, it is defending against a reasonable one who has never heard of `GIT_DIR`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportEmptySelection } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** The one module allowed to spawn git from a test. */
const SANCTIONED = "src/__tests__/tempGitRepo.ts";

/** Test sources are the scope: production code goes through `gitRun.ts`, which already strips the env. */
function inScope({ path }: { path: string }): boolean {
  return path.startsWith("src/__tests__/") && path.endsWith(".ts") && path !== SANCTIONED;
}

/**
 * Any child-process spawn whose command is git.
 *
 * Matches the spawn helpers by name rather than trying to understand the call, because a test that reaches
 * for `spawnSync` instead of `execFileSync` has exactly the same problem.
 */
const GIT_SPAWN = /\b(?:execFileSync|execSync|spawnSync|execFile|spawn|exec)\s*\(\s*["'`]git["'`]/;

/** One offending line. */
interface GitInTestHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Find every direct git invocation in a test source.
 *
 * @param path the repo-relative path, for reporting
 * @param content the file's text
 * @returns the offending lines
 */
export function findGitSpawns({ path, content }: { path: string; content: string }): readonly GitInTestHit[] {
  return content
    .split("\n")
    .map((text, index) => ({ line: index + 1, path, text: text.trim() }))
    .filter((hit) => GIT_SPAWN.test(hit.text));
}

/**
 * Scan every test source, print each hit, and return an exit code.
 *
 * @returns 0 when clean, 1 when any test invokes git directly or the scan could not run
 */
export function runGitInTests(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("git-in-tests: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const hits: GitInTestHit[] = [];
  const unreadable: string[] = [];
  const selected = files.filter((candidate) => inScope({ path: candidate }));
  for (const path of selected) {
    try {
      appendAll({ from: findGitSpawns({ content: readFileSync(join(root, path), "utf8"), path }), into: hits });
    } catch {
      // A test this gate could not read is a test it did not check, and reporting clean over it is
      // the silent-failure shape the repo keeps paying for.
      unreadable.push(path);
    }
  }
  const unseen =
    unreadable.length +
    reportEmptySelection({
      label: "git-in-tests",
      selected: selected.length,
      write: (text) => {
        process.stderr.write(text);
      },
    });
  return report({ hits, unreadable, unseen });
}

/** Print the outcome. */
function report({
  hits,
  unreadable,
  unseen,
}: {
  hits: readonly GitInTestHit[];
  unreadable: readonly string[];
  unseen: number;
}): number {
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.text}\n`);
  }
  for (const path of unreadable) {
    process.stderr.write(`  ${path}  (unreadable — not checked)\n`);
  }
  const outcome = gateOutcome({ refused: hits.length, unseen });
  if (outcome === "clean") {
    process.stdout.write("git-in-tests: clean\n");
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a file that could not be read was not checked, so this reports
    // the gap rather than a policy verdict over it
    process.stderr.write("git-in-tests: a test could not be read, so this scan is incomplete, not clean.\n");
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "git-in-tests" }),
      detail: `${String(hits.length)} direct git invocation(s) in tests`,
    })}\n`,
  );
  return 1;
}
