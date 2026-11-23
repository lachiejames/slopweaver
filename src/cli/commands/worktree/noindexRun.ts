/**
 * `slopweaver worktree noindex` — make a repository's worktrees directory one Spotlight never indexes.
 *
 * The same repair every `git worktree add` in this repository performs first (`worktree/location.ts` has the
 * measurement and the proof), exposed as a verb so an existing checkout — one whose worktrees predate the
 * convention — can be brought across deliberately and its outcome read back, rather than waiting for the
 * next spawn to do it as a side effect.
 */
import { logger } from "../../../lib/logger.js";
import {
  ensureNoindexWorktreesDir,
  type WorktreesDirStep,
  worktreesDir,
  worktreesLink,
} from "../../../worktree/location.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWorktreeArgs, targetRepoRoot, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";

/** What each step reads as, once taken. */
const STEP_LINES: Readonly<Record<WorktreesDirStep, string>> = {
  "create-alias": "created the `worktrees` symlink to `worktrees.noindex`",
  "create-dir": "created `worktrees.noindex`",
  "rename-alias-to-dir": "renamed the real `worktrees` directory to `worktrees.noindex`",
};

/**
 * The lines the verb prints for one outcome.
 *
 * @param repoRoot the main checkout the repair ran in
 * @param steps the steps taken, in order
 * @returns one line per fact, outcome first
 */
export function renderNoindexReport({
  repoRoot,
  steps,
}: {
  repoRoot: string;
  steps: readonly WorktreesDirStep[];
}): readonly string[] {
  const outcome = steps.length === 0 ? "already Spotlight-safe" : "made Spotlight-safe";
  return [
    `${outcome}: ${worktreesLink({ repoRoot })} -> ${worktreesDir({ repoRoot })}`,
    ...steps.map((step) => `  ${STEP_LINES[step]}`),
  ];
}

/**
 * `worktree noindex` — rename, create or confirm the `.noindex` worktrees directory and its alias.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runWorktreeNoindex(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb: "noindex" }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb: "noindex" });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: worktreeUsage({ verb: "noindex" }) });
    return EXIT_USAGE;
  }
  const repoRoot = targetRepoRoot({ cwd: process.cwd(), parsed: parsed.value });
  if (repoRoot === undefined) {
    logger.error({ msg: "worktree noindex: not inside a git repository, and no --repo was given" });
    return EXIT_USAGE;
  }
  const ensured = ensureNoindexWorktreesDir({ repoRoot });
  if (ensured.isErr()) {
    logger.error({ msg: `worktree noindex: ${ensured.error.message}` });
    return EXIT_ERROR;
  }
  if (parsed.value.values["json"] === true) {
    logger.out({
      line: JSON.stringify({
        dir: worktreesDir({ repoRoot }),
        link: worktreesLink({ repoRoot }),
        steps: ensured.value,
      }),
    });
    return EXIT_OK;
  }
  for (const line of renderNoindexReport({ repoRoot, steps: ensured.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const worktreeNoindexCommand = defineCommand({ run: runWorktreeNoindex });
