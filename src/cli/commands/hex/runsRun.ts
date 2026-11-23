/**
 * `slopweaver hex runs --project <id>` — when this project last actually executed, and whether it worked.
 *
 * The verb that dates everything else: `hex output` hands back the DRAFT session's latest preview, so a
 * reader who does not know when the notebook last ran cannot say how old the numbers are. A run row carries
 * its trigger (API, scheduled, app refresh), its status and its URL, so a failed overnight schedule is
 * visible as the reason a published dashboard is stale.
 */
import { listRuns } from "../../../hex/reads.js";
import type { HexProjectRun } from "../../../hex/responses.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexObjectOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_RUNS_USAGE } from "./usage.js";

/**
 * Run the `hex runs` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexRuns(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["runs"] });
  if (askedForHelp({ rest, usage: HEX_RUNS_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexObjectOptions({
    extraFlag: null,
    idFlag: "project",
    rest,
    usageHint: "--project 1b0c…, the UUID after `/hex/` in the project's URL",
  });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_RUNS_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const listed = await listRuns({ client: opened.client, limit: options.limit, projectId: options.id });
  if (listed.isErr()) {
    return exitForHexError({ error: listed.error });
  }
  if (options.json) {
    logger.out({ line: safeJsonStringify({ label: "hex runs", value: listed.value }) });
    return EXIT_OK;
  }
  logger.out({ line: `${String(listed.value.length)} run(s) of ${options.id}, newest first` });
  listed.value.forEach((run) => {
    logger.out({
      line: `  ${run.status}  ${run.runTrigger}  v${run.projectVersion}  started ${startedWord({ run })}  ended ${endedWord({ run })}`,
    });
    logger.out({ line: `    ${run.runUrl}` });
  });
  return EXIT_OK;
}

/** When a run started — `not started` when Hex reports no start time, because it has not begun. */
function startedWord({ run }: { run: HexProjectRun }): string {
  const started = run.startTime;
  if (started === null) {
    return "not started";
  }
  return started;
}

/** When a run ended — `still running` when Hex reports no end time, because it has not finished. */
function endedWord({ run }: { run: HexProjectRun }): string {
  const ended = run.endTime;
  if (ended === null) {
    return "still running";
  }
  return ended;
}

export const hexRunsCommand = defineCommand({ run: runHexRuns });
