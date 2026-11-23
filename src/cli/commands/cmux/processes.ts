/**
 * `slopweaver cmux processes` — the real OS process tree cmux attributes to one workspace.
 *
 * This is the "is there an orphan" question answered without `ps | grep`, and it retires a documented hack:
 * `skills/supervisor/SKILL.md` § 3's manual resume recipe cross-referenced `ps aux | grep "bin/claude"` against a
 * worktree path because "cmux does not expose the OS pid itself". Measured false — `system.top` with
 * `include_processes` returns the pid tree down to the `claude`/`codex` process, cross-checked live against
 * `ps -p <pid>` for an exact match including the full command line.
 *
 * The trees hang off SURFACES rather than off the workspace row; `parseProcessTrees` in `cmux/processTree.ts` is
 * where that is handled, and why it is not obvious.
 */
import type { CmuxProcess } from "../../../cmux/client.js";
import { logger } from "../../../lib/logger.js";
import { err } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxArgs, VERB_ARG_OFFSET, workspaceOperand } from "./core.js";

/**
 * Render one process tree as indented lines.
 *
 * @param processes the roots to render
 * @param depth how deep this level is, for indentation
 * @returns one line per process, deepest last
 */
export function renderProcessTree({
  processes,
  depth = 0,
}: {
  processes: readonly CmuxProcess[];
  depth?: number;
}): readonly string[] {
  const lines: string[] = [];
  for (const process of processes) {
    lines.push(`${"  ".repeat(depth)}${String(process.pid)}\t${process.name}`);
    lines.push(...renderProcessTree({ depth: depth + 1, processes: process.children }));
  }
  return lines;
}

/**
 * Run `cmux processes`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxProcesses(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "processes" }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb: "processes" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: cmuxUsage({ verb: "processes" }) });
    return EXIT_USAGE;
  }
  const ref = workspaceOperand({ parsed: parsed.value, precedence: "flag" });
  if (ref === undefined) {
    logger.error({ msg: "cmux processes: --workspace is required" });
    logger.error({ msg: cmuxUsage({ verb: "processes" }) });
    return EXIT_USAGE;
  }
  const tree = await withCmuxSessionHost({
    body: async ({ harness, host }) => {
      const resolved = await harness.resolve({ handle: ref });
      return resolved.isErr() ? err(resolved.error) : host.processTree({ workspaceId: resolved.value.session.id });
    },
  });
  if (tree.isErr()) {
    logger.error({ msg: `cmux processes: ${tree.error.message}` });
    return EXIT_ERROR;
  }
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(tree.value) });
    return EXIT_OK;
  }
  for (const line of renderProcessTree({ processes: tree.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const cmuxProcessesCommand = defineCommand({ run: runCmuxProcesses });
