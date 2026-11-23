/**
 * `slopweaver fleet status` — the single pane of glass.
 *
 * Every field on it is computed at call time from `handover`'s board, the run journal, `git`, the PR check
 * rollup and the operating system's view of the agent process. **Nothing is read from a hand-written file and
 * nothing is cached** — see {@link ../../../measurement/status} for the measured reason, which is that a stale
 * hand-maintained board caused duplicate work twice in one day.
 *
 * `say` / `stop` / `reap` — the levers that queued instructions for, or ended, a headless drive — are gone along
 * with the launcher they served (AGENTS.md rule 2). `status` is a pure read and stays.
 */

import { logger } from "../../../lib/logger.js";
import { measureBoard, renderBoardJson } from "../../../measurement/board.js";
import { defaultSessionsDir, discoverSessions } from "../../../measurement/sessions.js";
import { renderFleetStatus } from "../../../measurement/status.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import {
  boolFlag,
  type FleetPaths,
  type FleetVerb,
  fleetPaths,
  fleetUsage,
  parseFleetArgs,
  stringFlag,
  VERB_ARG_OFFSET,
} from "./core.js";

/** Parse and print, returning the exit code on any failure and the flags on success. */
function resolve({ verb, argv }: { verb: FleetVerb; argv: readonly string[] }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: fleetUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseFleetArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: fleetUsage({ verb }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/**
 * Print the pane — human lines, or the machine shape under `--json`.
 *
 * Both come from ONE {@link measureBoard} call. The JSON is not a second rendering of a second measurement:
 * it is the same object the terminal view was built from, which is what makes `fleet status --json` usable as
 * the contract another surface reads rather than as a lookalike.
 */
function printPane({
  slugs,
  paths,
  base,
  json,
}: {
  slugs: readonly string[];
  paths: FleetPaths;
  base: string | undefined;
  json: boolean;
}): number {
  const board = measureBoard({
    base,
    handoverDir: paths.handoverDir,
    nowMs: Date.now(),
    // Read ONCE for the whole board so every row is judged against the same instant's registry.
    roster: discoverSessions({ sessionsDir: defaultSessionsDir() }),
    runsDir: paths.runsDir,
    slugs,
  });
  if (board.problem !== undefined) {
    logger.error({ msg: `fleet status: ${board.problem}` });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: renderBoardJson({ board }) });
  } else {
    renderFleetStatus({ base, nowIso: board.measuredAtIso, workstreams: board.workstreams }).forEach((line) => {
      logger.out({ line });
    });
  }
  board.unknown.forEach((slug) => {
    // Named and not found is a REFUSAL to report on, never a silent omission: the caller asked about this slug
    // by name, and a pane that just does not mention it reads as "nothing to say about it".
    logger.error({ msg: `fleet status: no doc on the board claims "${slug}"` });
  });
  return board.unknown.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * `fleet status` — the single pane, every field measured at call time.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runFleetStatus(argv: readonly string[]): Promise<number> {
  const parsed = resolve({ argv, verb: "status" });
  if (typeof parsed === "number") {
    return parsed;
  }
  return printPane({
    // No default: an unset `--base` means "resolve each repository's own trunk", which is the only answer a
    // board spanning two repositories with two different trunks can give.
    base: stringFlag({ name: "base", parsed }),
    json: boolFlag({ name: "json", parsed }),
    paths: fleetPaths({ parsed }),
    slugs: parsed.positionals,
  });
}

export const fleetStatusCommand = defineCommand({ run: runFleetStatus });
