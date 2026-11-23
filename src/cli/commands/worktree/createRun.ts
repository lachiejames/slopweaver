/**
 * `slopweaver worktree create` — the one door for making a worktree that is actually runnable.
 *
 * The install is part of creation rather than a thing to remember, for the reason `checkouts/sync.ts` states
 * about its own post-pull install: a remembered second step is a step that gets skipped, and when it is
 * skipped here the symptom appears somewhere else entirely — a gate reporting `Cannot find module` for code
 * nobody touched. See `worktree/deps.ts` for the measured failure and the disk numbers that make a real
 * per-worktree tree affordable.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  defaultRequest,
  productionProvisionDeps,
  provisionWorktree,
  renderProvisionReport,
  type WorktreeRequest,
} from "../../../worktree/provision.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, stringFlagOr } from "../../parseFlags.js";
import {
  depsMode,
  parseWorktreeArgs,
  stringFlag,
  switchPair,
  targetRepoRoot,
  VERB_ARG_OFFSET,
  worktreeUsage,
} from "./core.js";

/**
 * Fold the parsed flags into one request, accumulating EVERY problem rather than stopping at the first.
 *
 * A caller who typed two contradictory switches and a bad `--deps` value should learn about both in one run;
 * the alternative is three invocations to discover three typos.
 *
 * @param parsed the verb's parsed flags
 * @param slug the positional naming both the directory and, by default, the branch
 * @returns the request, or every problem with it
 */
function resolveCreateRequest({ parsed, slug }: { parsed: ParsedFlags; slug: string }): Result<WorktreeRequest> {
  const install = switchPair({ fallback: true, name: "install", parsed });
  const build = switchPair({ fallback: false, name: "build", parsed });
  const devBuild = switchPair({ fallback: true, name: "dev-build", parsed });
  const deps = depsMode({ parsed });
  const repoRoot = targetRepoRoot({ cwd: process.cwd(), parsed });
  const problems = [
    ...(install.isErr() ? install.error : []),
    ...(build.isErr() ? build.error : []),
    ...(devBuild.isErr() ? devBuild.error : []),
    ...(deps.isErr() ? deps.error : []),
    ...(repoRoot === undefined ? ["not inside a git repository, and no --repo was given"] : []),
  ];
  if (install.isErr() || build.isErr() || devBuild.isErr() || deps.isErr() || repoRoot === undefined) {
    return err(problems);
  }
  return ok({
    ...defaultRequest({ repoRoot, slug }),
    baseBranch: stringFlag({ name: "base", parsed }),
    branch: stringFlagOr({ fallback: slug, name: "branch", parsed }),
    build: build.value,
    deps: deps.value,
    devBuild: devBuild.value,
    install: install.value,
  });
}

/** Print every problem plus the verb's usage line, and hand back the usage exit code. */
function reportUsage({ problems }: { problems: readonly string[] }): number {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
  logger.error({ msg: worktreeUsage({ verb: "create" }) });
  return EXIT_USAGE;
}

/**
 * `worktree create` — create or reuse a worktree, install its own dependencies, optionally build it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runWorktreeCreate(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb: "create" }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb: "create" });
  if (parsed.isErr()) {
    return reportUsage({ problems: parsed.error });
  }
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    return reportUsage({ problems: ["worktree create needs a slug"] });
  }
  const request = resolveCreateRequest({ parsed: parsed.value, slug });
  if (request.isErr()) {
    return reportUsage({ problems: request.error });
  }
  const provisioned = provisionWorktree({ deps: productionProvisionDeps(), request: request.value });
  if (provisioned.isErr()) {
    logger.error({ msg: `worktree create: ${provisioned.error.message}` });
    return EXIT_ERROR;
  }
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(provisioned.value) });
    return EXIT_OK;
  }
  for (const line of renderProvisionReport({ report: provisioned.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const worktreeCreateCommand = defineCommand({ run: runWorktreeCreate });
