/**
 * `slopweaver worktree here` — the standing check a spawned child runs BEFORE it writes anything.
 *
 * The effectful shell only: it reads the three facts (which repository, main checkout or linked worktree,
 * which branch) and hands them to `worktree/standing.ts`, which owns the decision and the wording.
 *
 * Deliberately NOT part of `inventoryRun.ts`'s shared `resolve`: every other verb resolves `--repo` to a
 * main checkout and acts on it, while this one's entire subject is the caller's OWN cwd. Reusing a resolver
 * whose default answer is "the main checkout" in the one verb that exists to say "you are in the main
 * checkout" is how the question gets silently answered wrong.
 */
import { isDeclaredMainCheckout } from "../../../admit/declaredMainCheckouts.js";
import { isMainWorktree } from "../../../admit/mainWorktree.js";
import { logger } from "../../../lib/logger.js";
import { productionReadDeps } from "../../../worktree/inventory.js";
import { mainCheckoutRoot } from "../../../worktree/shell.js";
import { classifyStanding, renderStanding, type StandingFacts } from "../../../worktree/standing.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWorktreeArgs, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";

/**
 * Read the facts about where a caller is standing.
 *
 * @param cwd the directory to describe
 * @returns the facts {@link classifyStanding} decides from
 */
function readStandingFacts({ cwd }: { cwd: string }): StandingFacts {
  const root = mainCheckoutRoot({ cwd });
  const branch = productionReadDeps().git({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd });
  return {
    branch: branch === undefined || branch === "HEAD" ? undefined : branch,
    cwd,
    declared: root === undefined ? false : isDeclaredMainCheckout({ cwd: root }),
    isMainWorktree: root !== undefined && isMainWorktree({ cwd }),
    mainCheckoutRoot: root,
  };
}

/**
 * `worktree here` — where this session is standing, and whether writing here is its own business.
 *
 * Exits non-zero for anything but a linked worktree, so a child can gate its own first write on it
 * (`slopweaver worktree here || <ask>`). That is a FINDING, not a broken tool — the same convention
 * `worktree status` and `checkout status` already use.
 *
 * @param argv the full process argv
 * @returns the process exit code — 0 in a linked worktree, non-zero anywhere a write is not this session's
 */
export function runWorktreeHere(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb: "here" }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb: "here" });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: worktreeUsage({ verb: "here" }) });
    return EXIT_USAGE;
  }
  const report = classifyStanding({ facts: readStandingFacts({ cwd: process.cwd() }) });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(report) });
  } else {
    for (const line of renderStanding({ report })) {
      logger.out({ line });
    }
  }
  return report.writable ? EXIT_OK : EXIT_ERROR;
}

export const worktreeHereCommand = defineCommand({ run: runWorktreeHere });
