/**
 * `slopweaver worktree list|status|remove` — the read-and-retire half of the noun.
 *
 * `status` is the verb that answers the question the shared-symlink defect made unanswerable: is THIS
 * worktree's `node_modules` its own, and does it match its own lockfile? A worktree whose dependency state
 * cannot be measured reports that rather than reporting clean, which is the whole reason it exists.
 */
import { logger } from "../../../lib/logger.js";
import {
  productionReadDeps,
  removeWorktree,
  renderWorktreeStatus,
  type WorktreeRow,
  worktreeRows,
  worktreeStatus,
} from "../../../worktree/inventory.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { stringFlagOr } from "../../parseFlags.js";
import { parseWorktreeArgs, targetRepoRoot, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";

/** The ref `status` measures drift against when the caller names none. */
const DEFAULT_BASE = "origin/main";

/** Everything the three verbs share: parsed flags, the repository to act on, and the JSON switch. */
interface Resolved {
  readonly repoRoot: string;
  readonly slug: string | undefined;
  readonly json: boolean;
  readonly force: boolean;
  readonly base: string;
}

/** Parse and resolve one verb's arguments, or print usage and hand back the exit code. */
function resolve({ argv, verb }: { argv: readonly string[]; verb: string }): Resolved | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: worktreeUsage({ verb }) });
    return EXIT_USAGE;
  }
  const repoRoot = targetRepoRoot({ cwd: process.cwd(), parsed: parsed.value });
  if (repoRoot === undefined) {
    logger.error({ msg: `worktree ${verb}: not inside a git repository, and no --repo was given` });
    return EXIT_USAGE;
  }
  return {
    base: stringFlagOr({ fallback: DEFAULT_BASE, name: "base", parsed: parsed.value }),
    force: parsed.value.values["force"] === true,
    json: parsed.value.values["json"] === true,
    repoRoot,
    slug: parsed.value.positionals[0],
  };
}

/** How a `list` line names a row's branch: the branch, or `(detached)` for a detached HEAD, which has none. */
function listedBranch({ row }: { row: WorktreeRow }): string {
  const { branch } = row;
  if (branch === null) {
    return "(detached)";
  }
  return branch;
}

/** What `remove` says it retired: the path, then the branch it held, or `detached` for a detached HEAD. */
function removedLine({ row }: { row: WorktreeRow }): string {
  const { branch } = row;
  if (branch === null) {
    return `removed ${row.path} (detached)`;
  }
  return `removed ${row.path} (${branch})`;
}

/**
 * `worktree list` — every worktree of the repository, main checkout first.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runWorktreeList(argv: readonly string[]): number {
  const resolved = resolve({ argv, verb: "list" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const deps = productionReadDeps();
  const rows = worktreeRows({ worktrees: deps.worktrees({ repoRoot: resolved.repoRoot }) });
  if (resolved.json) {
    logger.out({ line: JSON.stringify({ rows }) });
    return EXIT_OK;
  }
  for (const row of rows) {
    logger.out({
      line: `${row.isMain ? "main   " : "worktree"} ${row.slug}  ${listedBranch({ row })}  ${row.path}`,
    });
  }
  return EXIT_OK;
}

/**
 * `worktree status` — one worktree's branch, base drift and dependency state.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero reports a worktree that was not found, never a broken tool
 */
export function runWorktreeStatus(argv: readonly string[]): number {
  const resolved = resolve({ argv, verb: "status" });
  if (typeof resolved === "number") {
    return resolved;
  }
  if (resolved.slug === undefined) {
    logger.error({ msg: worktreeUsage({ verb: "status" }) });
    return EXIT_USAGE;
  }
  const status = worktreeStatus({
    base: resolved.base,
    deps: productionReadDeps(),
    repoRoot: resolved.repoRoot,
    slug: resolved.slug,
  });
  if (status.isErr()) {
    logger.error({ msg: `worktree status: ${status.error.message}` });
    return EXIT_ERROR;
  }
  if (resolved.json) {
    logger.out({ line: JSON.stringify(status.value) });
    return EXIT_OK;
  }
  for (const line of renderWorktreeStatus({ status: status.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * `worktree remove` — retire one worktree and its directory.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runWorktreeRemove(argv: readonly string[]): number {
  const resolved = resolve({ argv, verb: "remove" });
  if (typeof resolved === "number") {
    return resolved;
  }
  if (resolved.slug === undefined) {
    logger.error({ msg: worktreeUsage({ verb: "remove" }) });
    return EXIT_USAGE;
  }
  const removed = removeWorktree({
    deps: productionReadDeps(),
    force: resolved.force,
    repoRoot: resolved.repoRoot,
    slug: resolved.slug,
  });
  if (removed.isErr()) {
    logger.error({ msg: `worktree remove: ${removed.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({
    line: resolved.json ? JSON.stringify({ removed: removed.value }) : removedLine({ row: removed.value }),
  });
  return EXIT_OK;
}

export const worktreeListCommand = defineCommand({ run: runWorktreeList });
export const worktreeStatusCommand = defineCommand({ run: runWorktreeStatus });
export const worktreeRemoveCommand = defineCommand({ run: runWorktreeRemove });
